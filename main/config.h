#pragma once
#include <stdint.h>

/* Pins */
#define PIN_SCK          18
#define PIN_MISO         19
#define PIN_MOSI         23
#define PIN_RFID_EN_CS    5
#define PIN_RFID_EN_RST   4
#define PIN_RFID_EX_CS   15
#define PIN_RFID_EX_RST   2
#define PIN_SD_CS        16
#define PIN_SERVO_EN     13
#define PIN_SERVO_EX     33
#define PIN_LED_GREEN    12
#define PIN_LED_RED      14
#define PIN_BUZZER       27

/* Room Pins */
#define PIN_PIR_R1       34
#define PIN_LIGHT_R1     26
#define PIN_PIR_R2       35
#define PIN_LIGHT_R2     25

/* Network */
#define WIFI_SSID        "Wokwi-GUEST"
#define WIFI_PASS        ""
#define MQTT_URI         "mqtt://broker.hivemq.com:1883"
#define MQTT_CLIENT_ID   "cocis-entrance-01"

/* Topics */
#define TOPIC_OCC        "cocis/state/occupancy"
#define TOPIC_EVENT      "cocis/event/access"
#define TOPIC_SCHED      "cocis/config/schedule"
#define TOPIC_ROOM1      "cocis/state/room1"
#define TOPIC_ROOM2      "cocis/state/room2"

/* Authorized tags */
#define AUTH_USERS_MAX   64
static const uint32_t DEFAULT_AUTHORIZED_TAGS[] = { 0x11223344, 0x01020304 };
#define N_DEFAULT_AUTH   (sizeof(DEFAULT_AUTHORIZED_TAGS)/sizeof(DEFAULT_AUTHORIZED_TAGS[0]))

/* Limits */
#define INSIDE_MAX       16
#define ADMIN_TTL_S      300
#define DOOR_OPEN_MS     3000
#define SCAN_COOLDOWN_MS 1500
