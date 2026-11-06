#pragma once
#include <stdbool.h>

void rooms_init(void);
void rooms_start(void);

/* Override mode: 1 = Forced ON, 0 = Forced OFF, -1 = AUTO (PIR sensor) */
void rooms_set_override(int room_num, int mode);
int  rooms_get_override(int room_num);
