#include "rooms.h"
#include "config.h"
#include "state.h"
#include "comms.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <stdio.h>

#define HOLD_TICKS 50 // 50 * 100ms = 5.0 seconds

static int s_override[2] = { -1, -1 }; // -1 = AUTO, 1 = FORCED ON, 0 = FORCED OFF

void rooms_set_override(int room_num, int mode) {
    if (room_num < 1 || room_num > 2) return;
    s_override[room_num - 1] = mode;
}

int rooms_get_override(int room_num) {
    if (room_num < 1 || room_num > 2) return -1;
    return s_override[room_num - 1];
}

static void room_lighting_task(void *arg) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PIN_PIR_R1) | (1ULL << PIN_PIR_R2),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);

    gpio_config_t out_conf = {
        .pin_bit_mask = (1ULL << PIN_LIGHT_R1) | (1ULL << PIN_LIGHT_R2),
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&out_conf);

    // Initial state: OFF (hold timer expired)
    int r1_off_timer = HOLD_TICKS;
    int r2_off_timer = HOLD_TICKS;
    int last_r1_state = 0;
    int last_r2_state = 0;

    gpio_set_level(PIN_LIGHT_R1, 0);
    gpio_set_level(PIN_LIGHT_R2, 0);
    state_room_set(0, false, false);
    state_room_set(1, false, false);

    for (;;) {
        bool r1_motion = gpio_get_level(PIN_PIR_R1);
        bool r2_motion = gpio_get_level(PIN_PIR_R2);

        // --- Room 1 Logic ---
        if (r1_motion) {
            r1_off_timer = 0;
        } else if (r1_off_timer < HOLD_TICKS) {
            r1_off_timer++;
        }

        int r1_auto_state = (r1_off_timer < HOLD_TICKS) ? 1 : 0;
        int r1_state = (s_override[0] != -1) ? s_override[0] : r1_auto_state;

        if (r1_state != last_r1_state) {
            last_r1_state = r1_state;
            gpio_set_level(PIN_LIGHT_R1, r1_state);
            state_room_set(0, r1_state ? true : false, r1_state ? true : false);
            comms_publish_room(1, r1_state ? true : false, r1_state ? true : false);

            if (s_override[0] != -1) {
                printf("\n[ROOM 1] Manual Override -> Lights %s\n> ", r1_state ? "ON" : "OFF");
            } else {
                printf("\n[ROOM 1] %s -> Lights %s\n> ",
                       r1_state ? "Motion Detected" : "Vacant (Timeout)",
                       r1_state ? "ON" : "OFF");
            }
            fflush(stdout);
        }

        // --- Room 2 Logic ---
        if (r2_motion) {
            r2_off_timer = 0;
        } else if (r2_off_timer < HOLD_TICKS) {
            r2_off_timer++;
        }

        int r2_auto_state = (r2_off_timer < HOLD_TICKS) ? 1 : 0;
        int r2_state = (s_override[1] != -1) ? s_override[1] : r2_auto_state;

        if (r2_state != last_r2_state) {
            last_r2_state = r2_state;
            gpio_set_level(PIN_LIGHT_R2, r2_state);
            state_room_set(1, r2_state ? true : false, r2_state ? true : false);
            comms_publish_room(2, r2_state ? true : false, r2_state ? true : false);

            if (s_override[1] != -1) {
                printf("\n[ROOM 2] Manual Override -> Lights %s\n> ", r2_state ? "ON" : "OFF");
            } else {
                printf("\n[ROOM 2] %s -> Lights %s\n> ",
                       r2_state ? "Motion Detected" : "Vacant (Timeout)",
                       r2_state ? "ON" : "OFF");
            }
            fflush(stdout);
        }

        vTaskDelay(pdMS_TO_TICKS(100)); // Sample every 100ms for high responsiveness
    }
}

void rooms_init(void) {
    // Initialized in task
}

void rooms_start(void) {
    xTaskCreate(room_lighting_task, "room_lights", 4096, NULL, 4, NULL);
}
