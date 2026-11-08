#include "rooms.h"
#include "config.h"
#include "state.h"
#include "comms.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <time.h>
#include <stdio.h>

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

        // Current time for logging
        time_t now = time(NULL);
        struct tm tm;
        localtime_r(&now, &tm);
        char time_str[16];
        strftime(time_str, sizeof(time_str), "%H:%M:%S", &tm);

        // --- Room 1 Logic ---
        if (r1_motion) {
            r1_off_timer = 0;
        } else if (r1_off_timer < HOLD_TICKS) {
            r1_off_timer++;
        }

        if (r1_state != last_r1_state) {
            last_r1_state = r1_state;
            gpio_set_level(PIN_LIGHT_R1, r1_state);
            state_room_set(0, r1_state, r1_state);
            comms_publish_room(1, r1_state, r1_state);
            
            if (r1_state) {
                printf("[%s] %-8s %-10s %s\n", time_str, "ROOM1", "LIGHT_ON", "motion detected; relay energized");
                // Intrusion check: If motion but building occupancy is 0
                if (state_occupancy() == 0) {
                    printf("[%s] %-8s %-10s %s\n", time_str, "ROOM1", "INTRUSION", "motion; nobody badged in");
                }
            } else {
                printf("[%s] %-8s %-10s %s\n", time_str, "ROOM1", "LIGHT_OFF", "vacant for 5s; relay de-energized");
            }
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
            state_room_set(1, r2_state, r2_state);
            comms_publish_room(2, r2_state, r2_state);
            
            if (r2_state) {
                printf("[%s] %-8s %-10s %s\n", time_str, "ROOM2", "LIGHT_ON", "motion detected; relay energized");
                if (state_occupancy() == 0) {
                    printf("[%s] %-8s %-10s %s\n", time_str, "ROOM2", "INTRUSION", "motion; nobody badged in");
                }
            } else {
                printf("[%s] %-8s %-10s %s\n", time_str, "ROOM2", "LIGHT_OFF", "vacant for 5s; relay de-energized");
            }
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
