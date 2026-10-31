#include "lcd.h"
#include "driver/i2c_master.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_rom_sys.h"
#include <stdio.h>
#include <string.h>

#define LCD_ADDR 0x27

static i2c_master_bus_handle_t bus_handle;
static i2c_master_dev_handle_t dev_handle;

static void lcd_send_nibble(uint8_t nibble, bool is_data) {
    uint8_t rs = is_data ? 0x01 : 0x00;
    uint8_t bl = 0x08; // Backlight ON
    uint8_t en = 0x04; // Enable
    
    uint8_t data = (nibble << 4) & 0xF0;
    
    uint8_t high = data | rs | en | bl;
    uint8_t low  = data | rs | bl;
    
    i2c_master_transmit(dev_handle, &high, 1, 1000);
    esp_rom_delay_us(1000); // Exact hardware delay needed for the LCD
    i2c_master_transmit(dev_handle, &low, 1, 1000);
    esp_rom_delay_us(1000);
}

static void lcd_send_cmd(uint8_t cmd) {
    lcd_send_nibble(cmd >> 4, false);
    lcd_send_nibble(cmd & 0x0F, false);
}

static void lcd_send_data(uint8_t data) {
    lcd_send_nibble(data >> 4, true);
    lcd_send_nibble(data & 0x0F, true);
}

static void lcd_clear(void) {
    lcd_send_cmd(0x01);
    vTaskDelay(pdMS_TO_TICKS(2));
}

static void lcd_put_cur(int row, int col) {
    switch (row) {
        case 0: lcd_send_cmd(0x80 + col); break;
        case 1: lcd_send_cmd(0xC0 + col); break;
    }
}

static void lcd_send_string(char *str) {
    while (*str) lcd_send_data(*str++);
}

void lcd_init(void) {
    i2c_master_bus_config_t i2c_mst_config = {
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .i2c_port = I2C_NUM_0,
        .scl_io_num = 22,
        .sda_io_num = 21,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    i2c_new_master_bus(&i2c_mst_config, &bus_handle);

    i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = LCD_ADDR,
        .scl_speed_hz = 100000,
    };
    i2c_master_bus_add_device(bus_handle, &dev_cfg, &dev_handle);

    vTaskDelay(pdMS_TO_TICKS(100)); // Wait for LCD power-up

    // The absolute standard HD44780 wake-up sequence
    lcd_send_nibble(0x03, false); vTaskDelay(pdMS_TO_TICKS(5));
    lcd_send_nibble(0x03, false); vTaskDelay(pdMS_TO_TICKS(1));
    lcd_send_nibble(0x03, false);
    lcd_send_nibble(0x02, false); // Set to 4-bit mode

    // Configuration
    lcd_send_cmd(0x28); // 2 lines, 5x8 font
    lcd_send_cmd(0x08); // Display OFF
    lcd_send_cmd(0x01); // Clear display
    vTaskDelay(pdMS_TO_TICKS(2));
    lcd_send_cmd(0x06); // Increment cursor
    lcd_send_cmd(0x0C); // Display ON
}

void lcd_update_idle(int occupancy) {
    char line1[17], line2[17];
    snprintf(line1, sizeof(line1), " CoCIS Security ");
    snprintf(line2, sizeof(line2), "Occupancy: %d   ", occupancy);
    lcd_put_cur(0, 0); lcd_send_string(line1);
    lcd_put_cur(1, 0); lcd_send_string(line2);
}

void lcd_show_access(uint32_t tag, bool is_entry, const char* result) {
    char line1[17], line2[17];
    bool granted = (strstr(result, "OK") != NULL);
    
    if (granted) {
        snprintf(line1, sizeof(line1), "ACCESS GRANTED  ");
    } else {
        snprintf(line1, sizeof(line1), "ACCESS DENIED   ");
    }
    
    snprintf(line2, sizeof(line2), "%s %08lX", is_entry ? "IN " : "OUT", (unsigned long)tag);
    
    lcd_put_cur(0, 0); lcd_send_string(line1);
    lcd_put_cur(1, 0); lcd_send_string(line2);
}