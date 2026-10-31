#include "rooms.h"
#include "config.h"
#include "state.h"
#include "comms.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static void room_lighting_task(void *arg) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PIN_PIR_R1) | (1ULL << PIN_PIR_R2),
        .mode = GPIO_MODE_INPUT,
    };
    gpio_config(&io_conf);

    gpio_config_t out_conf = {
        .pin_bit_mask = (1ULL << PIN_LIGHT_R1) | (1ULL << PIN_LIGHT_R2),
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&out_conf);

    int r1_off_timer = 0;
    int r2_off_timer = 0;
    int last_r1_state = -1;
    int last_r2_state = -1;

    for (;;) {
        bool r1_motion = gpio_get_level(PIN_PIR_R1);
        bool r2_motion = gpio_get_level(PIN_PIR_R2);

        // Room 1 Logic
        if (r1_motion) {
            r1_off_timer = 0;
        } else if (r1_off_timer < 5) {
            r1_off_timer++;
        }
        int r1_state = (r1_off_timer < 5) ? 1 : 0;

        // Only update and publish if the state changed!
        if (r1_state != last_r1_state) {
            last_r1_state = r1_state;
            gpio_set_level(PIN_LIGHT_R1, r1_state);
            state_room_set(0, r1_state, r1_state);
            comms_publish_room(1, r1_state, r1_state);
        }

        // Room 2 Logic
        if (r2_motion) {
            r2_off_timer = 0;
        } else if (r2_off_timer < 5) {
            r2_off_timer++;
        }
        int r2_state = (r2_off_timer < 5) ? 1 : 0;

        if (r2_state != last_r2_state) {
            last_r2_state = r2_state;
            gpio_set_level(PIN_LIGHT_R2, r2_state);
            state_room_set(1, r2_state, r2_state);
            comms_publish_room(2, r2_state, r2_state);
        }

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

void rooms_init(void) {
    // Initialization handled in task
}

void rooms_start(void) {
    xTaskCreate(room_lighting_task, "room_lights", 4096, NULL, 4, NULL);
}