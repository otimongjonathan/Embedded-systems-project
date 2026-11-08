#include "comms.h"
#include "config.h"
#include "state.h"
#include "web.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include <string.h>
#include <time.h>

static const char *TAG = "comms";
static esp_mqtt_client_handle_t s_mqtt = NULL;
static esp_netif_t *s_wifi_netif = NULL;
static bool s_wifi_ready = false;
static bool s_mqtt_requested = false;
typedef struct {
    uint32_t tag;
    bool is_in;
    char result[32];
    time_t ts;
} access_event_t;

#define ACCESS_EVENT_HISTORY 20
static access_event_t s_event_history[ACCESS_EVENT_HISTORY];
static int s_event_history_count;
static SemaphoreHandle_t s_event_history_mtx;

// Reference the global flag from state.c
extern bool g_lockdown_active;

static void pub_retained(const char *t, const char *p) {
    if (!s_mqtt) return;
    esp_mqtt_client_publish(s_mqtt, t, p, 0, 1, 1);
}

static void publish_event_history(void) {
    if (!s_mqtt || !s_event_history_mtx) return;
    cJSON *history = cJSON_CreateArray();
    xSemaphoreTake(s_event_history_mtx, portMAX_DELAY);
    for (int i = 0; i < s_event_history_count; i++) {
        cJSON *item = cJSON_CreateObject();
        char tag_text[9];
        snprintf(tag_text, sizeof(tag_text), "%08lX",
                 (unsigned long)s_event_history[i].tag);
        cJSON_AddStringToObject(item, "tag", tag_text);
        cJSON_AddStringToObject(item, "dir",
                                s_event_history[i].is_in ? "IN" : "OUT");
        cJSON_AddStringToObject(item, "result", s_event_history[i].result);
        cJSON_AddNumberToObject(item, "ts", (double)s_event_history[i].ts);
        cJSON_AddItemToArray(history, item);
    }
    xSemaphoreGive(s_event_history_mtx);
    char *text = cJSON_PrintUnformatted(history);
    if (text) {
        int msg_id = esp_mqtt_client_publish(s_mqtt, TOPIC_EVENT_HISTORY, text, 0, 1, 1);
        ESP_LOGI(TAG, "Published %d access-history events (message id %d)",
                 s_event_history_count, msg_id);
        cJSON_free(text);
    }
    cJSON_Delete(history);
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
    if (!s_event_history_mtx) return;
    xSemaphoreTake(s_event_history_mtx, portMAX_DELAY);
    if (s_event_history_count < ACCESS_EVENT_HISTORY) {
        memmove(&s_event_history[1], &s_event_history[0],
                (size_t)s_event_history_count * sizeof(s_event_history[0]));
        s_event_history_count++;
    } else {
        memmove(&s_event_history[1], &s_event_history[0],
                (ACCESS_EVENT_HISTORY - 1) * sizeof(s_event_history[0]));
    }
    s_event_history[0].tag = tag;
    s_event_history[0].is_in = is_in;
    snprintf(s_event_history[0].result, sizeof(s_event_history[0].result),
             "%s", result ? result : "?");
    s_event_history[0].ts = time(NULL);
    xSemaphoreGive(s_event_history_mtx);

    if (!s_mqtt) return;
    publish_event_history();

    cJSON *o = cJSON_CreateObject();
    char t[16]; snprintf(t, sizeof(t), "%08lX", (unsigned long)tag);
    cJSON_AddStringToObject(o, "tag", t);
    cJSON_AddStringToObject(o, "dir", is_in ? "IN" : "OUT");
    cJSON_AddStringToObject(o, "result", result);
    cJSON_AddNumberToObject(o, "ts", (double)time(NULL));
    char *s = cJSON_PrintUnformatted(o);
    esp_mqtt_client_publish(s_mqtt, TOPIC_EVENT, s, 0, 1, 0);
    cJSON_free(s); cJSON_Delete(o);
}

static void reply_to_dashboard(const char *client_id, const char *command, bool ok) {
    if (!client_id || !command || !*client_id || strlen(client_id) > 48) return;
    for (const char *p = client_id; *p; ++p)
        if (!( (*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
               (*p >= '0' && *p <= '9') || *p == '-' || *p == '_')) return;
    char reply_topic[80];
    snprintf(reply_topic, sizeof(reply_topic), "cocis/response/entrance/%s", client_id);
    cJSON *reply = cJSON_CreateObject();
    if (!reply) return;
    cJSON_AddStringToObject(reply, "command", command);
    cJSON_AddBoolToObject(reply, "ok", ok);
    cJSON_AddBoolToObject(reply, "lockdown", state_lockdown_active());
    char *text = cJSON_PrintUnformatted(reply);
    if (text) {
        esp_mqtt_client_publish(s_mqtt, reply_topic, text, 0, 1, 0);
        cJSON_free(text);
    }
    cJSON_Delete(reply);
}

static void handle_dashboard_command(const char *data, int data_len) {
    cJSON *request = cJSON_ParseWithLength(data, (size_t)data_len);
    if (!request) return;
    cJSON *cmd = cJSON_GetObjectItem(request, "command");
    cJSON *client = cJSON_GetObjectItem(request, "clientId");
    cJSON *pin = cJSON_GetObjectItem(request, "pin");
    bool ok = false;
    if (cJSON_IsString(cmd) && cJSON_IsString(client)) {
        if (strcmp(cmd->valuestring, "LOGIN") == 0) {
            ok = cJSON_IsString(pin) && state_admin_login(pin->valuestring);
        } else if (state_admin_active() && strcmp(cmd->valuestring, "SCHEDULE") == 0) {
            cJSON *start = cJSON_GetObjectItem(request, "start");
            cJSON *end = cJSON_GetObjectItem(request, "end");
            if (cJSON_IsNumber(start) && cJSON_IsNumber(end) &&
                start->valueint >= 0 && start->valueint < 1440 &&
                end->valueint >= 0 && end->valueint < 1440 &&
                start->valueint != end->valueint) {
                state_set_schedule(start->valueint, end->valueint);
                state_persist();
                comms_publish_schedule(start->valueint, end->valueint);
                ok = true;
            }
        } else if (state_admin_active() && strcmp(cmd->valuestring, "LOCKDOWN") == 0) {
            cJSON *active = cJSON_GetObjectItem(request, "active");
            if (cJSON_IsBool(active)) {
                state_set_lockdown(cJSON_IsTrue(active));
                char mode[32];
                snprintf(mode, sizeof(mode), "{\"active\":%s}", cJSON_IsTrue(active) ? "true" : "false");
                pub_retained(TOPIC_LOCKDOWN, mode);
                ok = true;
            }
        }
        reply_to_dashboard(client->valuestring, cmd->valuestring, ok);
    }
    cJSON_Delete(request);
}

static void mqtt_cb(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_mqtt_event_handle_t ev = (esp_mqtt_event_handle_t)data;
    if (id == MQTT_EVENT_CONNECTED) {
        ESP_LOGI(TAG, "MQTT connected");
        esp_mqtt_client_subscribe(s_mqtt, TOPIC_ROOM1, 0);
        esp_mqtt_client_subscribe(s_mqtt, TOPIC_ROOM2, 0);
        esp_mqtt_client_subscribe(s_mqtt, TOPIC_EVENT_HISTORY, 1);
        esp_mqtt_client_subscribe(s_mqtt, TOPIC_COMMAND, 1);
        
        comms_publish_occupancy(state_occupancy());
        char mode[32];
        snprintf(mode, sizeof(mode), "{\"active\":%s}", state_lockdown_active() ? "true" : "false");
        pub_retained(TOPIC_LOCKDOWN, mode);
        int st, en; state_get_schedule(&st, &en);
        comms_publish_schedule(st, en);
        publish_event_history();
    } else if (id == MQTT_EVENT_DATA) {
        ESP_LOGD(TAG, "MQTT data received on %.*s", ev->topic_len, ev->topic);
        if (ev->topic_len == (int)strlen(TOPIC_COMMAND) &&
            strncmp(ev->topic, TOPIC_COMMAND, ev->topic_len) == 0) {
            handle_dashboard_command(ev->data, ev->data_len);
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

static void configure_dns_fallback(void) {
    esp_netif_dns_info_t dns = {0};
    dns.ip.type = ESP_IPADDR_TYPE_V4;
    dns.ip.u_addr.ip4.addr = esp_ip4addr_aton("8.8.8.8");
    esp_err_t err = esp_netif_set_dns_info(s_wifi_netif, ESP_NETIF_DNS_MAIN, &dns);
    if (err != ESP_OK) ESP_LOGW(TAG, "Could not set DNS server: %s", esp_err_to_name(err));
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *got_ip = (ip_event_got_ip_t *)event_data;
        configure_dns_fallback();
        s_wifi_ready = true;
        ESP_LOGI(TAG, "Wi-Fi connected: " IPSTR, IP2STR(&got_ip->ip_info.ip));
        ESP_LOGI(TAG, "Dashboard: http://" IPSTR "/", IP2STR(&got_ip->ip_info.ip));
        web_start();
        if (s_mqtt_requested) mqtt_start();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_ready = false;
        ESP_LOGW(TAG, "Wi-Fi disconnected");
    }
}

static void wifi_start(void) {
    esp_netif_init();
    esp_event_loop_create_default();
    s_wifi_netif = esp_netif_create_default_wifi_sta();
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

void comms_init(void) {
    s_event_history_mtx = xSemaphoreCreateMutex();
    wifi_start();
}

void comms_start(void) {
    s_mqtt_requested = true;
    if (s_wifi_ready) mqtt_start();
    else ESP_LOGI(TAG, "Waiting for Wi-Fi before starting MQTT");
}
