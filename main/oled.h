#pragma once
#include <stdint.h>
#include <stdbool.h>

void oled_init(void);
void oled_update_idle(int occupancy);
void oled_show_access(uint32_t tag, bool is_entry, const char* result);