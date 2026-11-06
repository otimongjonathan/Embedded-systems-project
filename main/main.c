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
    printf("\nCoCIS: starting entrance firmware\n");
    // 1. Initialize SPI Bus on SPI2_HOST
    spi_bus_config_t bus = {
        .miso_io_num = PIN_MISO, .mosi_io_num = PIN_MOSI,
        .sclk_io_num = PIN_SCK, .quadwp_io_num = -1, .quadhd_io_num = -1,
        .max_transfer_sz = 4096,
    };
    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        printf("SPI BUS FAILED TO INIT: %s\n", esp_err_to_name(ret));
        return;
    }
    printf("CoCIS: SPI bus initialized\n");

    // 2. Initialize Hardware & Subsystems
    lcd_init();
    lcd_update_idle(0); 

    state_init();
    storage_init();
    door_init();
    rfid_init(); 
    printf("CoCIS: RFID readers initialized\n");
    rooms_init();
    comms_init();
    console_init();

    // 3. Start networking and room monitoring
    vTaskDelay(pdMS_TO_TICKS(3000)); 
    comms_start();

    // 4. Start Time Sync (NTP) before allowing access decisions
    setenv("TZ", "EAT-3", 1); tzset();
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();
    time_t now = 0;
    for (int attempt = 0; attempt < 30; attempt++) {
        time(&now);
        if (now > 1700000000) break;
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    rfid_start();
    printf("CoCIS: RFID polling started\n");
    rooms_start();
    console_start();

    // 5. Print Professional Boot Log
    time(&now);
    struct tm tm;
    localtime_r(&now, &tm);
    char time_str[16];
    strftime(time_str, sizeof(time_str), "%H:%M:%S", &tm);
    
    printf("\n[%s] %-8s %-10s %s\n", time_str, "SYSTEM", "BOOT",
           now > 1700000000 ? "CoCIS Entrance Node Initialized" :
                              "Time not synchronized; access schedule unavailable");
}