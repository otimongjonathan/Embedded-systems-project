#pragma once
#include <stdint.h>
#include <stdbool.h>

void rfid_init(void);
void rfid_start(void);
void rfid_trigger_scan(uint32_t tag, bool is_entry);
