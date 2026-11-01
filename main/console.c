#include "console.h"
#include "config.h"
#include "state.h"
#include "storage.h"
#include "comms.h"
#include "rooms.h"
#include "rfid.h"
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <stdarg.h>

static void con_printf(const char *f, ...) {
    va_list ap; va_start(ap, f); vprintf(f, ap); va_end(ap); fflush(stdout);
}

static bool parse_hhmm(const char *s, int *out) {
    int h, m;
    if (sscanf(s, "%d:%d", &h, &m) != 2) return false;
    if (h < 0 || h > 23 || m < 0 || m > 59) return false;
    *out = h*60 + m; return true;
}

static void cmd_help(void) {
    con_printf("\nCommands:\n"
        "  help | status | occupancy | who | logs <n>\n"
        "  scan <in|out> <HEX>                             [simulate swipe]\n"
        "  login <user> <pin> | logout\n"
        "  user list | user add <HEX> | user remove <HEX>   [admin]\n"
        "  schedule show | schedule set <HH:MM> <HH:MM>    [admin]\n"
        "  lights <room1|room2> <on|off|auto>              [admin]\n"
        "  sd dump <n> | config save | reboot\n");
}

static void cmd_status(void) {
    time_t t = time(NULL); struct tm tm; localtime_r(&t, &tm);
    char iso[32]; strftime(iso, sizeof(iso), "%Y-%m-%d %H:%M:%S", &tm);
    int st, en; state_get_schedule(&st, &en);
    room_state_t r1, r2; state_room_get(0, &r1); state_room_get(1, &r2);

    int o1 = rooms_get_override(1);
    int o2 = rooms_get_override(2);
    const char *m1 = (o1 == 1) ? "[FORCED ON]" : ((o1 == 0) ? "[FORCED OFF]" : "[AUTO]");
    const char *m2 = (o2 == 1) ? "[FORCED ON]" : ((o2 == 0) ? "[FORCED OFF]" : "[AUTO]");
    
    con_printf("\n[STATUS]\n"
        "  time      : %s\n"
        "  schedule  : %02d:%02d - %02d:%02d\n"
        "  occupancy : %d\n"
        "  admin     : %s\n"
        "  users     : %d\n"
        "  room1     : occ=%d lights=%d %s\n"
        "  room2     : occ=%d lights=%d %s\n",
        iso, st/60, st%60, en/60, en%60,
        state_occupancy(), state_admin_active() ? "ACTIVE" : "none",
        state_user_count(),
        r1.occupied, r1.lights, m1,
        r2.occupied, r2.lights, m2);
}

static void cmd_who(void) {
    int n = state_inside_count();
    con_printf("\nInside (%d):\n", n);
    for (int i = 0; i < n; i++)
        con_printf("  %08lX\n", (unsigned long)state_inside_at(i));
}

static void handle_command(char *line) {
    char *save = NULL;
    char *tok = strtok_r(line, " \t", &save);
    if (!tok) return;

    if      (!strcmp(tok, "help"))     cmd_help();
    else if (!strcmp(tok, "status"))   cmd_status();
    else if (!strcmp(tok, "who"))      cmd_who();
    else if (!strcmp(tok, "occupancy")) con_printf("Occupancy: %d\n", state_occupancy());
    else if (!strcmp(tok, "scan")) {
        char *dir = strtok_r(NULL, " \t", &save);
        char *hex = strtok_r(NULL, " \t", &save);
        if (!dir || !hex) {
            con_printf("ERR: usage: scan <in|out> <HEX_TAG>\n");
            return;
        }
        bool is_entry = false;
        if (!strcmp(dir, "in") || !strcmp(dir, "entry") || !strcmp(dir, "en")) {
            is_entry = true;
        } else if (!strcmp(dir, "out") || !strcmp(dir, "exit") || !strcmp(dir, "ex")) {
            is_entry = false;
        } else {
            con_printf("ERR: specify direction 'in' or 'out'\n");
            return;
        }
        uint32_t tag = (uint32_t)strtoul(hex, NULL, 16);
        if (tag == 0) {
            con_printf("ERR: invalid hex tag\n");
            return;
        }
        rfid_trigger_scan(tag, is_entry);
    }
    else if (!strcmp(tok, "user")) {
        char *sub = strtok_r(NULL, " \t", &save);
        if (!sub || !strcmp(sub, "list")) {
            int n = state_user_count();
            con_printf("\nAuthorized Users (%d):\n", n);
            for (int i = 0; i < n; i++) {
                con_printf("  [%d] %08lX\n", i + 1, (unsigned long)state_user_at(i));
            }
        } else if (!strcmp(sub, "add")) {
            if (!state_admin_active()) { con_printf("ERR: admin required\n"); return; }
            char *hex = strtok_r(NULL, " \t", &save);
            if (!hex) { con_printf("ERR: usage: user add <HEX_TAG>\n"); return; }
            uint32_t tag = (uint32_t)strtoul(hex, NULL, 16);
            if (tag == 0) { con_printf("ERR: invalid hex tag\n"); return; }
            if (state_user_add(tag)) {
                con_printf("OK: user %08lX added\n", (unsigned long)tag);
            } else {
                con_printf("ERR: already exists or user list full\n");
            }
        } else if (!strcmp(sub, "remove") || !strcmp(sub, "del")) {
            if (!state_admin_active()) { con_printf("ERR: admin required\n"); return; }
            char *hex = strtok_r(NULL, " \t", &save);
            if (!hex) { con_printf("ERR: usage: user remove <HEX_TAG>\n"); return; }
            uint32_t tag = (uint32_t)strtoul(hex, NULL, 16);
            if (tag == 0) { con_printf("ERR: invalid hex tag\n"); return; }
            if (state_user_remove(tag)) {
                con_printf("OK: user %08lX removed\n", (unsigned long)tag);
            } else {
                con_printf("ERR: user not found\n");
            }
        } else {
            con_printf("ERR: usage: user list | user add <HEX> | user remove <HEX>\n");
        }
    }
    else if (!strcmp(tok, "lights")) {
        char *room_str = strtok_r(NULL, " \t", &save);
        char *act = strtok_r(NULL, " \t", &save);
        if (!room_str || !act) {
            con_printf("ERR: usage: lights <room1|room2> <on|off|auto>\n");
            return;
        }
        if (!state_admin_active()) { con_printf("ERR: admin required\n"); return; }
        int r_num = 0;
        if (!strcmp(room_str, "room1") || !strcmp(room_str, "1")) r_num = 1;
        else if (!strcmp(room_str, "room2") || !strcmp(room_str, "2")) r_num = 2;
        else { con_printf("ERR: specify room1 or room2\n"); return; }

        if (!strcmp(act, "on")) {
            rooms_set_override(r_num, 1);
            con_printf("OK: Room %d lights FORCED ON\n", r_num);
        } else if (!strcmp(act, "off")) {
            rooms_set_override(r_num, 0);
            con_printf("OK: Room %d lights FORCED OFF\n", r_num);
        } else if (!strcmp(act, "auto")) {
            rooms_set_override(r_num, -1);
            con_printf("OK: Room %d set to AUTO (PIR sensor mode)\n", r_num);
        } else {
            con_printf("ERR: usage: lights <room1|room2> <on|off|auto>\n");
        }
    }
    else if (!strcmp(tok, "schedule")) {
        char *t2 = strtok_r(NULL, " \t", &save);
        if (t2 && !strcmp(t2, "set")) {
            if (!state_admin_active()) { con_printf("ERR: admin required\n"); return; }
            char *s = strtok_r(NULL, " \t", &save);
            char *e = strtok_r(NULL, " \t", &save);
            int a, b;
            if (!s || !e || !parse_hhmm(s, &a) || !parse_hhmm(e, &b)) {
                con_printf("ERR: usage: schedule set HH:MM HH:MM\n"); return;
            }
            state_set_schedule(a, b);
            state_persist();
            comms_publish_schedule(a, b);
            con_printf("OK: schedule %02d:%02d-%02d:%02d\n", a/60, a%60, b/60, b%60);
        } else {
            int st, en; state_get_schedule(&st, &en);
            con_printf("schedule: %02d:%02d-%02d:%02d\n", st/60, st%60, en/60, en%60);
        }
    }
    else if (!strcmp(tok, "login")) {
        char *p = strtok_r(NULL, " \t", &save);
        p = strtok_r(NULL, " \t", &save);
        if (!p) p = tok; 
        char *pin = strtok_r(NULL, " \t", &save);
        if (!pin) pin = p;
        if (state_admin_login(pin)) con_printf("OK: admin\n");
        else con_printf("ERR: bad pin\n");
    }
    else if (!strcmp(tok, "logout")) { state_admin_logout(); con_printf("OK\n"); }
    else if (!strcmp(tok, "reboot")) {
        con_printf("Rebooting...\n");
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_restart();
    }
    else con_printf("ERR: unknown (try 'help')\n");
}

static void console_task(void *arg) {
    char line[128]; int idx = 0; uint8_t c;
    con_printf("> ");
    for (;;) {
        int n = uart_read_bytes(UART_NUM_0, &c, 1, pdMS_TO_TICKS(100));
        if (n <= 0) continue;
        
        if (c == '\r' || c == '\n') {
            if (idx > 0) {
                line[idx] = 0;
                uart_write_bytes(UART_NUM_0, "\r\n", 2);
                handle_command(line);
                idx = 0;
            }
            con_printf("> ");
        } else if (c == 8 || c == 127) { // Backspace
            if (idx > 0) {
                idx--;
                uart_write_bytes(UART_NUM_0, "\b \b", 3);
            }
        } else if (idx < (int)sizeof(line) - 1) {
            line[idx++] = (char)c;
            uart_write_bytes(UART_NUM_0, (const char*)&c, 1); // Echo
        }
    }
}

void console_init(void) {
    uart_config_t c = {
        .baud_rate = 115200, .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE, .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE, .source_clk = UART_SCLK_DEFAULT,
    };
    uart_param_config(UART_NUM_0, &c);
    uart_driver_install(UART_NUM_0, 1024, 0, 0, NULL, 0);
}

void console_start(void) {
    xTaskCreate(console_task, "console", 4096, NULL, 3, NULL);
}
