#include "door.h"
#include "config.h"
#include "driver/ledc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_log.h"

typedef struct { int channel; int ms; } door_req_t;
static QueueHandle_t s_q;
static const char *TAG = "door";

static uint32_t servo_duty_us(uint32_t pulse_us) {
    return (pulse_us * 65535U) / 20000U;
}

static void set_servo_position(int channel, uint32_t pulse_us) {
    ESP_ERROR_CHECK(ledc_set_duty(
        LEDC_LOW_SPEED_MODE, channel, servo_duty_us(pulse_us)));
    ESP_ERROR_CHECK(ledc_update_duty(LEDC_LOW_SPEED_MODE, channel));
}

static void door_task(void *arg) {
    door_req_t r;
    for (;;) {
        if (xQueueReceive(s_q, &r, portMAX_DELAY)) {
            esp_err_t err = ledc_set_duty(
                LEDC_LOW_SPEED_MODE, r.channel, servo_duty_us(2000));
            if (err != ESP_OK) {
                ESP_LOGE(TAG, "Failed to open servo channel %d: %s",
                         r.channel, esp_err_to_name(err));
                continue;
            }
            err = ledc_update_duty(LEDC_LOW_SPEED_MODE, r.channel);
            if (err != ESP_OK) {
                ESP_LOGE(TAG, "Failed to update open servo channel %d: %s",
                         r.channel, esp_err_to_name(err));
                continue;
            }
            ESP_LOGI(TAG, "Servo channel %d opened for %d ms", r.channel, r.ms);
            vTaskDelay(pdMS_TO_TICKS(r.ms));
            ledc_set_duty(LEDC_LOW_SPEED_MODE, r.channel, servo_duty_us(1000));
            ledc_update_duty(LEDC_LOW_SPEED_MODE, r.channel);
            ESP_LOGI(TAG, "Servo channel %d closed", r.channel);
        }
    }
}

void door_init(void) {
    ledc_timer_config_t t = {
        .speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_16_BIT,
        .timer_num = LEDC_TIMER_0, .freq_hz = 50, .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&t));

    ledc_channel_config_t c0 = {
        .gpio_num = PIN_SERVO_EN, .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0,
        .duty = servo_duty_us(1000), .hpoint = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&c0));

    ledc_channel_config_t c1 = {
        .gpio_num = PIN_SERVO_EX, .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_1, .timer_sel = LEDC_TIMER_0,
        .duty = servo_duty_us(1000), .hpoint = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&c1));

    s_q = xQueueCreate(4, sizeof(door_req_t));
    if (!s_q) {
        ESP_LOGE(TAG, "Failed to create servo command queue");
        return;
    }
    xTaskCreate(door_task, "door", 2048, NULL, 4, NULL);
    ESP_LOGI(TAG, "Servos ready: entry GPIO %d, exit GPIO %d",
             PIN_SERVO_EN, PIN_SERVO_EX);
}

void door_open(bool is_entry_door) {
    if (!s_q) {
        ESP_LOGE(TAG, "Servo command ignored: queue is not initialized");
        return;
    }
    door_req_t r = {
        .channel = is_entry_door ? LEDC_CHANNEL_0 : LEDC_CHANNEL_1,
        .ms = DOOR_OPEN_MS
    };
    ESP_LOGI(TAG, "Queueing %s servo command", is_entry_door ? "entry" : "exit");
    if (xQueueSend(s_q, &r, 0) != pdTRUE) {
        ESP_LOGE(TAG, "Servo command queue full; door command dropped");
    }
}

void door_test(bool is_entry_door) {
    int channel = is_entry_door ? LEDC_CHANNEL_0 : LEDC_CHANNEL_1;
    ESP_LOGI(TAG, "Testing %s servo on GPIO %d",
             is_entry_door ? "entry" : "exit",
             is_entry_door ? PIN_SERVO_EN : PIN_SERVO_EX);
    set_servo_position(channel, 2000);
    vTaskDelay(pdMS_TO_TICKS(1000));
    set_servo_position(channel, 1000);
    ESP_LOGI(TAG, "Servo test complete");
}