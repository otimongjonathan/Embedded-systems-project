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
        "web.c"
    INCLUDE_DIRS "."
    EMBED_FILES "web/index.html"
    REQUIRES
        driver esp_wifi esp_netif esp_event
        nvs_flash mqtt json
        fatfs sdmmc
        esp_driver_i2c
        esp_http_server
)