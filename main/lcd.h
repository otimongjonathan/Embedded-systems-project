#pragma once
#include <stdint.h>
#include <stdbool.h>

void lcd_init(void);
void lcd_update_idle(int occupancy);
void lcd_show_access(uint32_t tag, bool is_entry, const char* result);