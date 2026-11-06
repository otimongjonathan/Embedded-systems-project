#pragma once
#include <stdbool.h>

void rfid_init(void);
void rfid_start(void);
void rfid_simulate_scan(bool is_entry);