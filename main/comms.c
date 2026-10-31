#include "comms.h"
#include "config.h"
#include "state.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include <string.h>
#include <time.h>

static const char *TAG = "comms";
static esp_mqtt_client_handle_t s_mqtt = NULL;
static bool s_wifi_ready = false;
static bool s_mqtt_requested = false;

// Reference the global flag from state.c
extern bool g_lockdown_active;

static void pub_retained(const char *t, const char *p) {
    if (!s_mqtt) return;
    esp_mqtt_client_publish(s_mqtt, t, p, 0, 1, 1);
}

void comms_publish_occupancy(int count) {
    char b[64];
    snprintf(b, sizeof(b), "{\"count\":%d,\"ts\":%ld}", count, (long)time(NULL));
    pub_retained(TOPIC_OCC, b);
}

void comms_publish_schedule(int start, int end) {
    char b[96];
    snprintf(b, sizeof(b),
             "{\"start\":\"%02d:%02d\",\"end\":\"%02d:%02d\",\"version\":%ld}",
             start/60, start%60, end/60, end%60, (long)time(NULL));
    pub_retained(TOPIC_SCHED, b);
}

void comms_publish_room(int room_num, bool occupied, bool lights) {
    char topic[32];
    snprintf(topic, sizeof(topic), "cocis/state/room%d", room_num);
    char b[96];
    snprintf(b, sizeof(b), "{\"occupied\":%s,\"lights\":%s,\"ts\":%ld}",
             occupied ? "true" : "false", lights ? "true" : "false", (long)time(NULL));
    pub_retained(topic, b);
}

void comms_publish_event(uint32_t tag, bool is_in, const char *result) {
    if (!s_mqtt) return;
    cJSON *o = cJSON_CreateObject();
    char t[16]; snprintf(t, sizeof(t), "%08lX", (unsigned long)tag);
    cJSON_AddStringToObject(o, "tag", t);
    cJSON_AddStringToObject(o, "dir", is_in ? "IN" : "OUT");
    cJSON_AddStringToObject(o, "result", result);
    cJSON_AddNumberToObject(o, "ts", (double)time(NULL));
    char *s = cJSON_PrintUnformatted(o);
    esp_mqtt_client_publish(s_mqtt, TOPIC_EVENT, s, 0, 0, 0);
    cJSON_free(s); cJSON_Delete(o);
}

static void mqtt_cb(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_mqtt_event_handle_t ev = (esp_mqtt_event_handle_t)data;
    if (id == MQTT_EVENT_CONNECTED) {
        ESP_LOGI(TAG, "MQTT connected");
        esp_mqtt_client_subscribe(s_mqtt, TOPIC_ROOM1, 0);
        esp_mqtt_client_subscribe(s_mqtt, TOPIC_ROOM2, 0);
        esp_mqtt_client_subscribe(s_mqtt, "cocis/cmd/entrance", 1); // Subscribe to Lockdown commands
        
        comms_publish_occupancy(state_occupancy());
        int st, en; state_get_schedule(&st, &en);
        comms_publish_schedule(st, en);
    } else if (id == MQTT_EVENT_DATA) {
        // --- HANDLE LOCKDOWN COMMANDS ---
        if (ev->topic_len == 19 && strncmp(ev->topic, "cocis/cmd/entrance", 19) == 0) {
            char buf[32] = {0};
            int len = ev->data_len < 31 ? ev->data_len : 31;
            memcpy(buf, ev->data, len);
            
            if (strstr(buf, "LOCKDOWN")) {
                ESP_LOGW(TAG, "🚨 LOCKDOWN INITIATED BY ADMIN");
                g_lockdown_active = true;
            } else if (strstr(buf, "UNLOCK")) {
                ESP_LOGW(TAG, "✅ LOCKDOWN LIFTED BY ADMIN");
                g_lockdown_active = false;
            }
            return;
        }

        // --- HANDLE ROOM STATES ---
        bool r1 = (ev->topic_len == (int)strlen(TOPIC_ROOM1)) &&
                  strncmp(ev->topic, TOPIC_ROOM1, ev->topic_len) == 0;
        bool r2 = (ev->topic_len == (int)strlen(TOPIC_ROOM2)) &&
                  strncmp(ev->topic, TOPIC_ROOM2, ev->topic_len) == 0;
        if (!r1 && !r2) return;
        cJSON *o = cJSON_ParseWithLength(ev->data, ev->data_len);
        if (!o) return;
        cJSON *occ = cJSON_GetObjectItem(o, "occupied");
        cJSON *lit = cJSON_GetObjectItem(o, "lights");
        if (cJSON_IsBool(occ) && cJSON_IsBool(lit))
            state_room_set(r1 ? 0 : 1, cJSON_IsTrue(occ), cJSON_IsTrue(lit));
        cJSON_Delete(o);
    }
}

static void mqtt_start(void) {
    if (s_mqtt) return;

    esp_mqtt_client_config_t cfg = {
        .broker.address.uri = MQTT_URI,
        .credentials.client_id = MQTT_CLIENT_ID,
        .session.keepalive = 30,
    };
    s_mqtt = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(s_mqtt, ESP_EVENT_ANY_ID, mqtt_cb, NULL);
    esp_mqtt_client_start(s_mqtt);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        s_wifi_ready = true;
        ESP_LOGI(TAG, "Wi-Fi has an IP address");
        if (s_mqtt_requested) mqtt_start();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_ready = false;
        ESP_LOGW(TAG, "Wi-Fi disconnected");
    }
}

static void wifi_start(void) {
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL);
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    wifi_config_t wc = {0};
    strcpy((char*)wc.sta.ssid, WIFI_SSID);
    strcpy((char*)wc.sta.password, WIFI_PASS);
    wc.sta.threshold.authmode = WIFI_AUTH_OPEN;
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wc);
    esp_wifi_start();
    esp_wifi_connect();
}

void comms_init(void) { wifi_start(); }

void comms_start(void) {
    s_mqtt_requested = true;
    if (s_wifi_ready) mqtt_start();
    else ESP_LOGI(TAG, "Waiting for Wi-Fi before starting MQTT");
}