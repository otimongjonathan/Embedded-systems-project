idf_component_register(
    SRCS
        "main.c"
        "rfid.c"
        "door.c"
        "state.c"
        "storage.c"
        "comms.c"
        "console.c"
        "rooms.c"
        "lcd.c"
    INCLUDE_DIRS "."
    REQUIRES
        driver esp_wifi esp_netif esp_event
        nvs_flash mqtt cjson
        fatfs sdmmc
        esp_driver_i2c
        esp_driver_gpio
        esp_driver_spi
        esp_driver_uart
        esp_driver_ledc
        esp_driver_sdspi
        esp_driver_sdmmc
)
