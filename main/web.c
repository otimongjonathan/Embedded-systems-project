#include "web.h"
#include "state.h"
#include "config.h"
#include "comms.h"
#include "storage.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "cJSON.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <stdio.h>
#include <string.h>
#include <time.h>

static const char *TAG = "web";
static httpd_handle_t s_server;
static SemaphoreHandle_t s_events_mutex;
static bool s_started;

typedef struct {
    uint32_t tag;
    bool entry;
    char result[32];
    time_t ts;
} web_event_t;

#define WEB_EVENT_COUNT 20
static web_event_t s_events[WEB_EVENT_COUNT];
static int s_event_count;

extern const unsigned char web_index_html_start[] asm("_binary_index_html_start");
extern const unsigned char web_index_html_end[] asm("_binary_index_html_end");

void web_record_event(uint32_t tag, bool is_entry, const char *result) {
    if (!s_events_mutex) return;
    xSemaphoreTake(s_events_mutex, portMAX_DELAY);
    if (s_event_count < WEB_EVENT_COUNT) {
        memmove(&s_events[1], &s_events[0], (size_t)s_event_count * sizeof(s_events[0]));
        s_event_count++;
    } else {
        memmove(&s_events[1], &s_events[0], (WEB_EVENT_COUNT - 1) * sizeof(s_events[0]));
    }
    s_events[0].tag = tag;
    s_events[0].entry = is_entry;
    snprintf(s_events[0].result, sizeof(s_events[0].result), "%s", result ? result : "?");
    s_events[0].ts = time(NULL);
    xSemaphoreGive(s_events_mutex);
}

static esp_err_t send_json(httpd_req_t *req, cJSON *json, int status) {
    char *text = cJSON_PrintUnformatted(json);
    if (!text) return ESP_ERR_NO_MEM;
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_status(req, status == 200 ? "200 OK" : "400 Bad Request");
    esp_err_t err = httpd_resp_sendstr(req, text);
    cJSON_free(text);
    return err;
}

static esp_err_t index_get(httpd_req_t *req) {
    size_t size = (size_t)(web_index_html_end - web_index_html_start);
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, (const char *)web_index_html_start, size);
}

static esp_err_t status_get(httpd_req_t *req) {
    int start, end;
    state_get_schedule(&start, &end);
    room_state_t room1, room2;
    state_room_get(0, &room1);
    state_room_get(1, &room2);

    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "occupancy", state_occupancy());
    cJSON_AddNumberToObject(o, "capacity", INSIDE_MAX);
    cJSON_AddBoolToObject(o, "lockdown", state_lockdown_active());
    cJSON_AddBoolToObject(o, "admin", state_admin_active());
    cJSON_AddBoolToObject(o, "access_log_ready", storage_log_ready());
    cJSON *schedule = cJSON_AddObjectToObject(o, "schedule");
    cJSON_AddNumberToObject(schedule, "start", start);
    cJSON_AddNumberToObject(schedule, "end", end);
    cJSON *rooms = cJSON_AddArrayToObject(o, "rooms");
    cJSON *r = cJSON_CreateObject();
    cJSON_AddBoolToObject(r, "occupied", room1.occupied);
    cJSON_AddBoolToObject(r, "lights", room1.lights);
    cJSON_AddItemToArray(rooms, r);
    r = cJSON_CreateObject();
    cJSON_AddBoolToObject(r, "occupied", room2.occupied);
    cJSON_AddBoolToObject(r, "lights", room2.lights);
    cJSON_AddItemToArray(rooms, r);
    esp_err_t err = send_json(req, o, 200);
    cJSON_Delete(o);
    return err;
}

static esp_err_t events_get(httpd_req_t *req) {
    cJSON *events = cJSON_CreateArray();
    storage_event_t saved[20];
    int saved_count = storage_load_events(saved, 20);
    if (saved_count > 0) {
        for (int i = 0; i < saved_count; i++) {
            cJSON *e = cJSON_CreateObject();
            char tag[9];
            snprintf(tag, sizeof(tag), "%08lX", (unsigned long)saved[i].tag);
            cJSON_AddStringToObject(e, "tag", tag);
            cJSON_AddStringToObject(e, "direction", saved[i].is_in ? "ENTRY" : "EXIT");
            cJSON_AddStringToObject(e, "result", saved[i].result);
            cJSON_AddNumberToObject(e, "ts", (double)saved[i].ts);
            cJSON_AddItemToArray(events, e);
        }
    } else {
        xSemaphoreTake(s_events_mutex, portMAX_DELAY);
        for (int i = 0; i < s_event_count; i++) {
            cJSON *e = cJSON_CreateObject();
            char tag[9];
            snprintf(tag, sizeof(tag), "%08lX", (unsigned long)s_events[i].tag);
            cJSON_AddStringToObject(e, "tag", tag);
            cJSON_AddStringToObject(e, "direction", s_events[i].entry ? "ENTRY" : "EXIT");
            cJSON_AddStringToObject(e, "result", s_events[i].result);
            cJSON_AddNumberToObject(e, "ts", (double)s_events[i].ts);
            cJSON_AddItemToArray(events, e);
        }
        xSemaphoreGive(s_events_mutex);
    }
    esp_err_t err = send_json(req, events, 200);
    cJSON_Delete(events);
    return err;
}

static esp_err_t read_body(httpd_req_t *req, char *buf, size_t size) {
    if (req->content_len <= 0 || (size_t)req->content_len >= size) return ESP_ERR_INVALID_SIZE;
    int received = httpd_req_recv(req, buf, req->content_len);
    if (received != req->content_len) return ESP_FAIL;
    buf[received] = '\0';
    return ESP_OK;
}

static esp_err_t login_post(httpd_req_t *req) {
    char body[64];
    if (read_body(req, body, sizeof(body)) != ESP_OK) return httpd_resp_send_err(req, 400, "Invalid request");
    cJSON *o = cJSON_Parse(body);
    cJSON *pin = o ? cJSON_GetObjectItem(o, "pin") : NULL;
    bool ok = cJSON_IsString(pin) && state_admin_login(pin->valuestring);
    if (o) cJSON_Delete(o);
    cJSON *response = cJSON_CreateObject();
    cJSON_AddBoolToObject(response, "ok", ok);
    esp_err_t err = send_json(req, response, ok ? 200 : 400);
    cJSON_Delete(response);
    return err;
}

static esp_err_t schedule_post(httpd_req_t *req) {
    if (!state_admin_active()) return httpd_resp_send_err(req, 403, "Admin login required");
    char body[128];
    if (read_body(req, body, sizeof(body)) != ESP_OK) return httpd_resp_send_err(req, 400, "Invalid request");
    cJSON *o = cJSON_Parse(body);
    cJSON *start = o ? cJSON_GetObjectItem(o, "start") : NULL;
    cJSON *end = o ? cJSON_GetObjectItem(o, "end") : NULL;
    bool valid = cJSON_IsNumber(start) && cJSON_IsNumber(end) &&
                 start->valueint >= 0 && start->valueint < 1440 &&
                 end->valueint >= 0 && end->valueint < 1440 &&
                 start->valueint != end->valueint;
    if (valid) {
        state_set_schedule(start->valueint, end->valueint);
        state_persist();
        comms_publish_schedule(start->valueint, end->valueint);
    }
    if (o) cJSON_Delete(o);
    return valid ? httpd_resp_sendstr(req, "{\"ok\":true}") :
                   httpd_resp_send_err(req, 400, "Invalid schedule");
}

static esp_err_t lockdown_post(httpd_req_t *req) {
    if (!state_admin_active()) return httpd_resp_send_err(req, 403, "Admin login required");
    char body[64];
    if (read_body(req, body, sizeof(body)) != ESP_OK) return httpd_resp_send_err(req, 400, "Invalid request");
    cJSON *o = cJSON_Parse(body);
    cJSON *active = o ? cJSON_GetObjectItem(o, "active") : NULL;
    bool valid = cJSON_IsBool(active);
    if (valid) state_set_lockdown(cJSON_IsTrue(active));
    if (o) cJSON_Delete(o);
    return valid ? httpd_resp_sendstr(req, "{\"ok\":true}") :
                   httpd_resp_send_err(req, 400, "Invalid lockdown value");
}

void web_init(void) {
    s_events_mutex = xSemaphoreCreateMutex();
}

void web_start(void) {
    if (s_started) return;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 8;
    if (httpd_start(&s_server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Could not start HTTP server");
        return;
    }
    s_started = true;
    httpd_uri_t routes[] = {
        { .uri = "/", .method = HTTP_GET, .handler = index_get },
        { .uri = "/api/status", .method = HTTP_GET, .handler = status_get },
        { .uri = "/api/events", .method = HTTP_GET, .handler = events_get },
        { .uri = "/api/login", .method = HTTP_POST, .handler = login_post },
        { .uri = "/api/schedule", .method = HTTP_POST, .handler = schedule_post },
        { .uri = "/api/lockdown", .method = HTTP_POST, .handler = lockdown_post },
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++)
        httpd_register_uri_handler(s_server, &routes[i]);
    ESP_LOGI(TAG, "Dashboard HTTP server started on port %d", config.server_port);
}
