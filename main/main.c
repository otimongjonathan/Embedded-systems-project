#include "config.h"
#include "state.h"
#include "storage.h"
#include "door.h"
#include "rfid.h"
#include "comms.h"
#include "console.h"
#include "rooms.h"
#include "lcd.h"
#include "driver/spi_master.h"
#include "esp_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <time.h>
#include <stdlib.h>
#include <stdio.h>

void app_main(void) {
    // 1. Initialize SPI Bus on SPI2_HOST
    spi_bus_config_t bus = {
        .miso_io_num = PIN_MISO, .mosi_io_num = PIN_MOSI,
        .sclk_io_num = PIN_SCK, .quadwp_io_num = -1, .quadhd_io_num = -1,
        .max_transfer_sz = 4096,
    };
    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        printf("SPI BUS FAILED TO INIT: %s\n", esp_err_to_name(ret));
    }

    // 2. Initialize Hardware & Subsystems
    lcd_init();
    lcd_update_idle(0); // Show welcome screen immediately

    state_init();
    storage_init();
    door_init();
    rfid_init();
    rooms_init();
    comms_init();
    console_init();

    // 3. Start FreeRTOS Tasks
    rfid_start();
    rooms_start();
    
    // Wait 3 seconds for WiFi to connect before starting MQTT
    vTaskDelay(pdMS_TO_TICKS(3000)); 
    comms_start();
    
    console_start();

    // 4. Start Time Sync (NTP)
    setenv("TZ", "EAT-3", 1); tzset();
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();

    printf("\n=== CoCIS Entrance & Rooms ===\ntype 'help'\n");
}