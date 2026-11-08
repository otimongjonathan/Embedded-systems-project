#pragma once

#include <stdbool.h>
#include <stdint.h>

void web_init(void);
void web_start(void);
void web_record_event(uint32_t tag, bool is_entry, const char *result);
