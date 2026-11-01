#include "state.h"
#include "config.h"
#include "storage.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <string.h>

typedef struct {
    SemaphoreHandle_t mtx;
    int      occupancy;
    uint32_t inside[INSIDE_MAX];
    int      inside_n;
    uint32_t auth_tags[AUTH_USERS_MAX];
    int      auth_tags_n;
    int      sched_start;
    int      sched_end;
    bool     admin;
    time_t   admin_since;
    room_state_t room[2];
} state_data_t;

static state_data_t s;

// Define the global lockdown flag
bool g_lockdown_active = false; 

const char *state_result_str(result_t r) {
    switch (r) {
        case RES_OK:                 return "OK";
        case RES_OK_AFTER_HOURS:     return "OK_AFTER_HOURS";
        case RES_DENIED_UNKNOWN:     return "DENIED_UNKNOWN";
        case RES_DENIED_SCHEDULE:    return "DENIED_SCHEDULE";
        case RES_DENIED_ALREADY_IN:  return "DENIED_ALREADY_IN";
        case RES_DENIED_NOT_IN:      return "DENIED_NOT_IN";
    }
    return "?";
}

static bool in_window(int mod) {
    return (s.sched_start <= s.sched_end)
         ? (mod >= s.sched_start && mod < s.sched_end)
         : (mod >= s.sched_start || mod < s.sched_end);
}

static int find_inside(uint32_t tag) {
    for (int i = 0; i < s.inside_n; i++) if (s.inside[i] == tag) return i;
    return -1;
}

void state_init(void) {
    memset(&s, 0, sizeof(s));
    s.mtx = xSemaphoreCreateMutex();
    s.sched_start = 7 * 60;
    s.sched_end   = 21 * 60;

    int st = -1, en = -1;
    storage_load_schedule(&st, &en);
    if (st >= 0 && en >= 0) { s.sched_start = st; s.sched_end = en; }

    uint32_t tags[INSIDE_MAX]; int n = 0;
    storage_load_inside(tags, &n);
    if (n > INSIDE_MAX) n = INSIDE_MAX;
    memcpy(s.inside, tags, n * sizeof(uint32_t));
    s.inside_n  = n;
    s.occupancy = n;

    // Load or initialize authorized users
    uint32_t u_tags[AUTH_USERS_MAX]; int u_n = 0;
    storage_load_users(u_tags, &u_n);
    if (u_n == 0) {
        for (size_t i = 0; i < N_DEFAULT_AUTH && i < AUTH_USERS_MAX; i++) {
            u_tags[i] = DEFAULT_AUTHORIZED_TAGS[i];
        }
        u_n = (int)N_DEFAULT_AUTH;
        storage_save_users(u_tags, u_n);
    }
    if (u_n > AUTH_USERS_MAX) u_n = AUTH_USERS_MAX;
    memcpy(s.auth_tags, u_tags, u_n * sizeof(uint32_t));
    s.auth_tags_n = u_n;
}

void state_persist(void) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    int st = s.sched_start, en = s.sched_end;
    int n  = s.inside_n;
    uint32_t tags[INSIDE_MAX];
    memcpy(tags, s.inside, n * sizeof(uint32_t));

    int un = s.auth_tags_n;
    uint32_t utags[AUTH_USERS_MAX];
    memcpy(utags, s.auth_tags, un * sizeof(uint32_t));
    xSemaphoreGive(s.mtx);

    storage_save_schedule(st, en);
    storage_save_inside(tags, n);
    storage_save_users(utags, un);
}

int state_occupancy(void) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    int v = s.occupancy;
    xSemaphoreGive(s.mtx);
    return v;
}

int state_inside_count(void) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    int v = s.inside_n;
    xSemaphoreGive(s.mtx);
    return v;
}

uint32_t state_inside_at(int idx) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    uint32_t v = (idx >= 0 && idx < s.inside_n) ? s.inside[idx] : 0;
    xSemaphoreGive(s.mtx);
    return v;
}

bool state_user_add(uint32_t tag) {
    if (tag == 0) return false;
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    for (int i = 0; i < s.auth_tags_n; i++) {
        if (s.auth_tags[i] == tag) {
            xSemaphoreGive(s.mtx);
            return false; // Already authorized
        }
    }
    if (s.auth_tags_n >= AUTH_USERS_MAX) {
        xSemaphoreGive(s.mtx);
        return false; // List full
    }
    s.auth_tags[s.auth_tags_n++] = tag;
    int un = s.auth_tags_n;
    uint32_t utags[AUTH_USERS_MAX];
    memcpy(utags, s.auth_tags, un * sizeof(uint32_t));
    xSemaphoreGive(s.mtx);

    storage_save_users(utags, un);
    return true;
}

bool state_user_remove(uint32_t tag) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    int idx = -1;
    for (int i = 0; i < s.auth_tags_n; i++) {
        if (s.auth_tags[i] == tag) {
            idx = i;
            break;
        }
    }
    if (idx < 0) {
        xSemaphoreGive(s.mtx);
        return false;
    }
    for (int i = idx; i < s.auth_tags_n - 1; i++) {
        s.auth_tags[i] = s.auth_tags[i + 1];
    }
    s.auth_tags_n--;
    int un = s.auth_tags_n;
    uint32_t utags[AUTH_USERS_MAX];
    memcpy(utags, s.auth_tags, un * sizeof(uint32_t));
    xSemaphoreGive(s.mtx);

    storage_save_users(utags, un);
    return true;
}

int state_user_count(void) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    int n = s.auth_tags_n;
    xSemaphoreGive(s.mtx);
    return n;
}

uint32_t state_user_at(int idx) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    uint32_t tag = (idx >= 0 && idx < s.auth_tags_n) ? s.auth_tags[idx] : 0;
    xSemaphoreGive(s.mtx);
    return tag;
}

bool state_user_is_authorized(uint32_t tag) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    bool ok = false;
    for (int i = 0; i < s.auth_tags_n; i++) {
        if (s.auth_tags[i] == tag) {
            ok = true;
            break;
        }
    }
    xSemaphoreGive(s.mtx);
    return ok;
}

void state_get_schedule(int *start, int *end) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    *start = s.sched_start; *end = s.sched_end;
    xSemaphoreGive(s.mtx);
}

void state_set_schedule(int start, int end) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    s.sched_start = start; s.sched_end = end;
    xSemaphoreGive(s.mtx);
}

result_t state_evaluate(uint32_t tag, bool is_entry, time_t now) {
    // --- LOCKDOWN OVERRIDE ---
    if (g_lockdown_active) {
        return RES_DENIED_SCHEDULE; // Deny all access during lockdown
    }
    // -------------------------

    struct tm tm; localtime_r(&now, &tm);
    int mod = tm.tm_hour * 60 + tm.tm_min;

    xSemaphoreTake(s.mtx, portMAX_DELAY);
    bool known = false;
    for (int i = 0; i < s.auth_tags_n; i++) {
        if (s.auth_tags[i] == tag) {
            known = true;
            break;
        }
    }

    result_t res;
    if (!known) {
        res = RES_DENIED_UNKNOWN;
    } else if (is_entry) {
        if (!in_window(mod))            res = RES_DENIED_SCHEDULE;
        else if (find_inside(tag) >= 0) res = RES_DENIED_ALREADY_IN;
        else {
            s.inside[s.inside_n++] = tag;
            s.occupancy = s.inside_n;
            res = RES_OK;
        }
    } else {
        int idx = find_inside(tag);
        if (idx < 0) res = RES_DENIED_NOT_IN;
        else {
            for (int i = idx; i < s.inside_n - 1; i++)
                s.inside[i] = s.inside[i+1];
            s.inside_n--;
            s.occupancy = s.inside_n;
            res = in_window(mod) ? RES_OK : RES_OK_AFTER_HOURS;
        }
    }
    xSemaphoreGive(s.mtx);
    return res;
}

bool state_admin_active(void) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    bool ok = s.admin && (time(NULL) - s.admin_since < ADMIN_TTL_S);
    if (!ok) s.admin = false;
    xSemaphoreGive(s.mtx);
    return ok;
}

bool state_admin_login(const char *pin) {
    if (strcmp(pin, "1234") != 0) return false;
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    s.admin = true; s.admin_since = time(NULL);
    xSemaphoreGive(s.mtx);
    return true;
}

void state_admin_logout(void) {
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    s.admin = false;
    xSemaphoreGive(s.mtx);
}

void state_room_get(int room, room_state_t *out) {
    if (room < 0 || room > 1) return;
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    *out = s.room[room];
    xSemaphoreGive(s.mtx);
}

void state_room_set(int room, bool occupied, bool lights) {
    if (room < 0 || room > 1) return;
    xSemaphoreTake(s.mtx, portMAX_DELAY);
    s.room[room].occupied = occupied;
    s.room[room].lights   = lights;
    xSemaphoreGive(s.mtx);
}
