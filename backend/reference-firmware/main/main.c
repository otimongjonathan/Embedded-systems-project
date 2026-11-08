/*
 * CoCIS Smart Control and Monitoring System: ESP32 firmware (ESP-IDF, FreeRTOS)
 *
 * One ESP32 runs the main entrance and both lecture rooms (report, Chapter 3).
 *
 * Tasks
 *   access_task    RFID taps at the entry and exit readers, door servos, LEDs, buzzer
 *   lighting_task  IR beam pairs at the LR1 and LR2 doors, people counting, lights, LCD
 *   menu_task      serial monitor menu for staff
 *   network_task   Wi-Fi, clock, heartbeat, config download, upload of queued events
 *
 * Shared resources
 *   state_mutex    cached config, who is inside, room counts, recent log
 *   sd_mutex       every SD card file operation
 *   lcd_mutex      the LCD
 *   event_queue    room events from the lighting task to the network task
 *   tap_queue      simulated taps typed in the serial menu, to the access task
 *
 * Wokwi has no RFID reader part, so a reader is simulated by the potentiometer
 * (which card is held) and a pushbutton (tapping it on the reader), or by the
 * serial command "tap <UID> entry|exit". IR beams are simulated by pushbuttons:
 * pressing beam A then beam B is a person walking in.
 */
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/ledc.h"
#include "driver/sdspi_host.h"
#include "driver/spi_common.h"
#include "driver/uart.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_rom_crc.h"
#include "esp_rom_sys.h"
#include "esp_sntp.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_vfs_fat.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sdmmc_cmd.h"

/* Messages go straight to the serial monitor (the wokwi.com build hides ESP_LOG output). */
#define NOTE(fmt, ...) printf("\n[cocis] " fmt "\n", ##__VA_ARGS__)

/* ---------------- settings you may change ---------------- */
#define WIFI_SSID        "Wokwi-GUEST"
#define WIFI_PASS        ""
#define WIFI_CHANNEL     6                    /* Wokwi-GUEST is on channel 6: connects faster */
/* Wokwi for VS Code reaches the laptop as host.wokwi.internal. On wokwi.com use
 * a tunnel address instead, e.g. "https://abcd-1234.ngrok-free.app/api/v1",
 * or type "server <url>" in the serial monitor. */
#define DEFAULT_API_BASE "http://host.wokwi.internal:8000/api/v1"
#define DEVICE_KEY       "esp32-demo-key-change-me"
#define DEVICE_NO        "01"
#define FW_VERSION       "1.0.0"
#define TIMEZONE         "EAT-3"              /* East Africa Time, UTC+3 */

/* ---------------- pins (see diagram.json) ---------------- */
#define PIN_SD_MOSI   23
#define PIN_SD_MISO   19
#define PIN_SD_SCK    18
#define PIN_SD_CS      5
#define PIN_LCD_SDA   21
#define PIN_LCD_SCL   22
#define PIN_SERVO_IN  26     /* entry door */
#define PIN_SERVO_OUT 27     /* exit door */
#define PIN_BTN_IN    32     /* tap card on the ENTRY reader */
#define PIN_BTN_OUT   33     /* tap card on the EXIT reader */
#define PIN_CARD_POT  34     /* ADC1 channel 6: which card is held */
#define PIN_LED_GREEN 25
#define PIN_LED_RED    4
#define PIN_BUZZER    12
#define PIN_LR1_A     13     /* LR1 beam A, corridor side */
#define PIN_LR1_B     14     /* LR1 beam B, room side */
#define PIN_LR2_A     16
#define PIN_LR2_B     17
#define PIN_LR1_LIGHT  2
#define PIN_LR2_LIGHT 15

#define MOUNT       "/sd"
#define LCD_ADDR    0x27
#define CROSS_MS    1500     /* both beams must break within this time */
#define DOOR_OPEN_MS 3000
#define MAX_TAGS    64
#define MAX_INSIDE  64
#define LOG_SIZE    20
#define BATCH_MAX   40

/* ---------------- shared state (state_mutex) ---------------- */
typedef struct { bool is_open; int open_min, close_min; } day_t;
typedef struct { char uid[21]; char name[40]; char role[12]; } tag_t;
typedef struct {
    int version;
    bool emergency;
    int light_off_delay_s, heartbeat_s;
    day_t days[7];                     /* 0 = Sunday, like struct tm.tm_wday */
    tag_t tags[MAX_TAGS];
    int n_tags;
    char light_mode[2][10];            /* AUTO, FORCE_ON, FORCE_OFF for LR1, LR2 */
} config_t;

typedef struct {
    const char *code;
    int pin_a, pin_b, pin_light;
    int count;
    bool light_on;
    int64_t empty_since_ms;            /* when the count last reached 0 */
    const char *pending;               /* trigger of a count change not yet reported */
    char first;                        /* first beam broken: 'A', 'B' or 0 */
    int64_t first_ms;
    bool last_a, last_b;
} room_t;

typedef struct { char uuid[24]; char room[4]; int count; bool light_on; char trigger[16]; char at[20]; } room_event_t;
typedef struct { char uid[21]; bool entry; } tap_t;

static config_t cfg;
static char inside[MAX_INSIDE][21];
static int n_inside;
static room_t rooms[2] = {
    {.code = "LR1", .pin_a = PIN_LR1_A, .pin_b = PIN_LR1_B, .pin_light = PIN_LR1_LIGHT},
    {.code = "LR2", .pin_a = PIN_LR2_A, .pin_b = PIN_LR2_B, .pin_light = PIN_LR2_LIGHT},
};
static char recent[LOG_SIZE][96];      /* last scans, for the "log" command */
static int recent_next;
static char lcd_msg[2][21];            /* message lines shown after a scan */
static int64_t lcd_msg_until;

static SemaphoreHandle_t state_mutex, sd_mutex, lcd_mutex;
static QueueHandle_t event_queue, tap_queue;
static volatile bool wifi_up, sim_offline, force_sync, sd_ok;
static volatile bool api_ok;                /* the last API call got an answer */
static volatile int64_t api_retry_ms;       /* after a failure, wait before trying again */
static volatile int outbox_count;
static char api_base[128] = DEFAULT_API_BASE;
static char admin_token[64], admin_role[16];
static uint32_t boot_id, event_seq;
static portMUX_TYPE seq_mux = portMUX_INITIALIZER_UNLOCKED;
static adc_oneshot_unit_handle_t adc;
static esp_timer_handle_t door_timer;

/* Demo cards selectable with the potentiometer (they match database/seed.sql). */
static const char *demo_cards[] = {"A1B2C3D4", "11223344", "DEADBEEF", "CAFEBABE", "0BADCAFE"};
#define N_DEMO_CARDS 5

#define LOCK(m)   xSemaphoreTake(m, portMAX_DELAY)
#define UNLOCK(m) xSemaphoreGive(m)

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

/* ======================= time ======================= */

static bool clock_valid(void)
{
    time_t t = time(NULL);
    struct tm tm;
    localtime_r(&t, &tm);
    return tm.tm_year + 1900 >= 2024;
}

static void now_iso(char out[20])
{
    time_t t = time(NULL);
    struct tm tm;
    localtime_r(&t, &tm);
    strftime(out, 20, "%Y-%m-%dT%H:%M:%S", &tm);
}

/* Set the clock from a local time string: the server time in a heartbeat, or the "time" command. */
static void set_clock_from_iso(const char *iso)
{
    struct tm tm = {0};
    if (!iso || sscanf(iso, "%d-%d-%dT%d:%d:%d", &tm.tm_year, &tm.tm_mon, &tm.tm_mday,
                       &tm.tm_hour, &tm.tm_min, &tm.tm_sec) != 6) return;
    tm.tm_year -= 1900;
    tm.tm_mon -= 1;
    tm.tm_isdst = -1;
    struct timeval tv = {.tv_sec = mktime(&tm)};
    settimeofday(&tv, NULL);
    NOTE("Clock set to %s", iso);
}

static int hhmm_to_min(const char *s) { int h = 0, m = 0; sscanf(s, "%d:%d", &h, &m); return h * 60 + m; }

/* Caller holds state_mutex. */
static bool within_schedule(void)
{
    if (!clock_valid()) return false;          /* unknown time: refuse, never guess */
    time_t t = time(NULL);
    struct tm tm;
    localtime_r(&t, &tm);
    const day_t *d = &cfg.days[tm.tm_wday];
    int m = tm.tm_hour * 60 + tm.tm_min;
    return d->is_open && d->open_min <= m && m < d->close_min;
}

static void new_uuid(char out[24])
{
    taskENTER_CRITICAL(&seq_mux);
    uint32_t n = ++event_seq;
    taskEXIT_CRITICAL(&seq_mux);
    snprintf(out, 24, DEVICE_NO "-%08" PRIX32 "-%05" PRIu32, boot_id, n);
}

/* ======================= LCD (HD44780 behind a PCF8574) ======================= */

static void lcd_write(uint8_t b) { i2c_master_write_to_device(I2C_NUM_0, LCD_ADDR, &b, 1, pdMS_TO_TICKS(20)); }

static void lcd_nibble(uint8_t nib, uint8_t rs)
{
    uint8_t d = (nib << 4) | rs | 0x08;        /* 0x08 = backlight */
    lcd_write(d | 0x04);                       /* EN high */
    esp_rom_delay_us(1);
    lcd_write(d);                              /* EN low */
    esp_rom_delay_us(50);
}

static void lcd_byte(uint8_t b, uint8_t rs) { lcd_nibble(b >> 4, rs); lcd_nibble(b & 0x0F, rs); }

static void lcd_init(void)
{
    i2c_config_t c = {.mode = I2C_MODE_MASTER, .sda_io_num = PIN_LCD_SDA, .scl_io_num = PIN_LCD_SCL,
                      .sda_pullup_en = true, .scl_pullup_en = true, .master.clk_speed = 100000};
    i2c_param_config(I2C_NUM_0, &c);
    i2c_driver_install(I2C_NUM_0, I2C_MODE_MASTER, 0, 0, 0);
    vTaskDelay(pdMS_TO_TICKS(50));
    lcd_nibble(0x03, 0); vTaskDelay(pdMS_TO_TICKS(5));
    lcd_nibble(0x03, 0); vTaskDelay(pdMS_TO_TICKS(1));
    lcd_nibble(0x03, 0);
    lcd_nibble(0x02, 0);                       /* 4-bit mode */
    lcd_byte(0x28, 0);                         /* 2+ lines, 5x8 font */
    lcd_byte(0x0C, 0);                         /* display on, no cursor */
    lcd_byte(0x06, 0);                         /* move right after each character */
    lcd_byte(0x01, 0);                         /* clear */
    vTaskDelay(pdMS_TO_TICKS(2));
}

/* Write one full 20 character line of the 20x4 display. */
static void lcd_line(int row, const char *text)
{
    static const uint8_t offset[4] = {0x00, 0x40, 0x14, 0x54};
    char buf[21];
    snprintf(buf, sizeof buf, "%-20.20s", text);
    LOCK(lcd_mutex);
    lcd_byte(0x80 | offset[row], 0);
    for (int i = 0; i < 20; i++) lcd_byte((uint8_t)buf[i], 1);
    UNLOCK(lcd_mutex);
}

/* ======================= doors, LEDs, buzzer ======================= */

static void servo_angle(ledc_channel_t ch, int deg)
{
    uint32_t us = 500 + deg * 2000 / 180;      /* 0.5 ms = 0 degrees, 2.5 ms = 180 degrees */
    ledc_set_duty(LEDC_LOW_SPEED_MODE, ch, us * 16384 / 20000);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, ch);
}

static void beep(int ms, int hz)
{
    ledc_set_freq(LEDC_LOW_SPEED_MODE, LEDC_TIMER_1, hz);
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2, 512);       /* 50 % of 10 bits */
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2);
    vTaskDelay(pdMS_TO_TICKS(ms));
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2, 0);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_2);
}

/* esp_timer callback: close both doors and switch the status LEDs off,
 * unless emergency mode is holding the doors open. */
static void door_close_cb(void *arg)
{
    bool hold = false;
    if (xSemaphoreTake(state_mutex, pdMS_TO_TICKS(100))) { hold = cfg.emergency; UNLOCK(state_mutex); }
    if (!hold) { servo_angle(LEDC_CHANNEL_0, 0); servo_angle(LEDC_CHANNEL_1, 0); }
    gpio_set_level(PIN_LED_GREEN, 0);
    gpio_set_level(PIN_LED_RED, 0);
}

static void outputs_init(void)
{
    ledc_timer_config_t servo_t = {.speed_mode = LEDC_LOW_SPEED_MODE, .timer_num = LEDC_TIMER_0,
                                   .duty_resolution = LEDC_TIMER_14_BIT, .freq_hz = 50, .clk_cfg = LEDC_AUTO_CLK};
    ledc_timer_config(&servo_t);
    ledc_timer_config_t buzz_t = {.speed_mode = LEDC_LOW_SPEED_MODE, .timer_num = LEDC_TIMER_1,
                                  .duty_resolution = LEDC_TIMER_10_BIT, .freq_hz = 2000, .clk_cfg = LEDC_AUTO_CLK};
    ledc_timer_config(&buzz_t);
    ledc_channel_config_t ch[3] = {
        {.gpio_num = PIN_SERVO_IN, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0},
        {.gpio_num = PIN_SERVO_OUT, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_1, .timer_sel = LEDC_TIMER_0},
        {.gpio_num = PIN_BUZZER, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_2, .timer_sel = LEDC_TIMER_1},
    };
    for (int i = 0; i < 3; i++) ledc_channel_config(&ch[i]);
    servo_angle(LEDC_CHANNEL_0, 0);
    servo_angle(LEDC_CHANNEL_1, 0);

    gpio_config_t out = {.pin_bit_mask = (1ULL << PIN_LED_GREEN) | (1ULL << PIN_LED_RED) |
                                         (1ULL << PIN_LR1_LIGHT) | (1ULL << PIN_LR2_LIGHT),
                         .mode = GPIO_MODE_OUTPUT};
    gpio_config(&out);
    gpio_config_t in = {.pin_bit_mask = (1ULL << PIN_BTN_IN) | (1ULL << PIN_BTN_OUT) | (1ULL << PIN_LR1_A) |
                                        (1ULL << PIN_LR1_B) | (1ULL << PIN_LR2_A) | (1ULL << PIN_LR2_B),
                        .mode = GPIO_MODE_INPUT, .pull_up_en = GPIO_PULLUP_ENABLE};
    gpio_config(&in);

    adc_oneshot_unit_init_cfg_t unit = {.unit_id = ADC_UNIT_1};
    adc_oneshot_new_unit(&unit, &adc);
    adc_oneshot_chan_cfg_t chan = {.atten = ADC_ATTEN_DB_11, .bitwidth = ADC_BITWIDTH_12};
    adc_oneshot_config_channel(adc, ADC_CHANNEL_6, &chan);

    esp_timer_create_args_t ta = {.callback = door_close_cb, .name = "door"};
    esp_timer_create(&ta, &door_timer);
}

/* ======================= SD card ======================= */

static uint32_t crc_of(const char *s) { return esp_rom_crc32_le(0, (const uint8_t *)s, strlen(s)); }

/* Append "<line>,<crc>" to a file. Caller must NOT hold sd_mutex. */
static void sd_append(const char *file, const char *line)
{
    if (!sd_ok) return;
    char path[48];
    snprintf(path, sizeof path, MOUNT "/%s", file);
    LOCK(sd_mutex);
    FILE *f = fopen(path, "a");
    if (f) { fprintf(f, "%s,%08" PRIX32 "\n", line, crc_of(line)); fclose(f); }
    else NOTE("Cannot write %s", path);
    UNLOCK(sd_mutex);
}

/* Split "<data>,<crc>" and check the CRC. Returns false for a damaged line. */
static bool crc_ok(char *line)
{
    line[strcspn(line, "\r\n")] = 0;
    char *comma = strrchr(line, ',');
    if (!comma) return false;
    *comma = 0;
    return strtoul(comma + 1, NULL, 16) == crc_of(line);
}

/* Daily log names in 8.3 form: AC261030.CSV for access, RM261030.CSV for rooms. */
static void daily_name(char out[16], const char *prefix)
{
    time_t t = time(NULL);
    struct tm tm;
    localtime_r(&t, &tm);
    if (clock_valid()) strftime(out + 2, 14, "%y%m%d.CSV", &tm);
    else strcpy(out + 2, "NOCLOCK.CSV");
    memcpy(out, prefix, 2);
}

static void save_inside_locked(void)        /* caller holds state_mutex */
{
    if (!sd_ok) return;
    LOCK(sd_mutex);
    FILE *f = fopen(MOUNT "/inside.csv", "w");
    if (f) { for (int i = 0; i < n_inside; i++) fprintf(f, "%s\n", inside[i]); fclose(f); }
    UNLOCK(sd_mutex);
}

/* Write the config to users.csv, schedule.csv and config.csv. Each is written to
 * a .tmp file first and then swapped in, so a power cut never leaves half a file. */
static void save_config_locked(void)        /* caller holds state_mutex */
{
    if (!sd_ok) return;
    LOCK(sd_mutex);
    FILE *f = fopen(MOUNT "/users.tmp", "w");
    if (f) {
        for (int i = 0; i < cfg.n_tags; i++) fprintf(f, "%s,%s,%s\n", cfg.tags[i].uid, cfg.tags[i].name, cfg.tags[i].role);
        fclose(f); unlink(MOUNT "/users.csv"); rename(MOUNT "/users.tmp", MOUNT "/users.csv");
    }
    f = fopen(MOUNT "/schedule.tmp", "w");
    if (f) {
        for (int d = 0; d < 7; d++)
            fprintf(f, "%d,%d,%02d:%02d,%02d:%02d\n", d, cfg.days[d].is_open, cfg.days[d].open_min / 60,
                    cfg.days[d].open_min % 60, cfg.days[d].close_min / 60, cfg.days[d].close_min % 60);
        fclose(f); unlink(MOUNT "/schedule.csv"); rename(MOUNT "/schedule.tmp", MOUNT "/schedule.csv");
    }
    f = fopen(MOUNT "/config.tmp", "w");
    if (f) {
        fprintf(f, "config_version,%d\nemergency_mode,%d\nlight_off_delay_s,%d\nheartbeat_interval_s,%d\n"
                   "light_mode_LR1,%s\nlight_mode_LR2,%s\n", cfg.version, cfg.emergency, cfg.light_off_delay_s,
                cfg.heartbeat_s, cfg.light_mode[0], cfg.light_mode[1]);
        fclose(f); unlink(MOUNT "/config.csv"); rename(MOUNT "/config.tmp", MOUNT "/config.csv");
    }
    UNLOCK(sd_mutex);
}

/* Built-in defaults (same as database/seed.sql), used until a config is downloaded. */
static void default_config(void)
{
    cfg.version = 0;
    cfg.emergency = false;
    cfg.light_off_delay_s = 30;
    cfg.heartbeat_s = 60;
    for (int d = 0; d < 7; d++) cfg.days[d] = (day_t){d >= 1 && d <= 5, 7 * 60, 22 * 60};
    cfg.days[6] = (day_t){true, 8 * 60, 17 * 60};
    static const char *seed[4][3] = {{"A1B2C3D4", "Lisa Nyonyozi", "STUDENT"}, {"11223344", "Dr. Mary Lecturer", "LECTURER"},
                                     {"DEADBEEF", "Security Officer", "SECURITY"}, {"CAFEBABE", "Guest Visitor", "VISITOR"}};
    cfg.n_tags = 4;
    for (int i = 0; i < 4; i++) {
        strcpy(cfg.tags[i].uid, seed[i][0]);
        strcpy(cfg.tags[i].name, seed[i][1]);
        strcpy(cfg.tags[i].role, seed[i][2]);
    }
    strcpy(cfg.light_mode[0], "AUTO");
    strcpy(cfg.light_mode[1], "AUTO");
}

/* At boot: read the last saved config and the inside list, if the card has them. */
static void load_from_sd(void)
{
    if (!sd_ok) return;
    char line[128];
    LOCK(state_mutex);
    LOCK(sd_mutex);
    FILE *f = fopen(MOUNT "/users.csv", "r");
    if (f) {
        cfg.n_tags = 0;
        while (cfg.n_tags < MAX_TAGS && fgets(line, sizeof line, f)) {
            line[strcspn(line, "\r\n")] = 0;
            tag_t *t = &cfg.tags[cfg.n_tags];
            if (sscanf(line, "%20[^,],%39[^,],%11s", t->uid, t->name, t->role) == 3) cfg.n_tags++;
        }
        fclose(f);
    }
    f = fopen(MOUNT "/schedule.csv", "r");
    if (f) {
        int d, open, oh, om, ch, cm;
        while (fgets(line, sizeof line, f))
            if (sscanf(line, "%d,%d,%d:%d,%d:%d", &d, &open, &oh, &om, &ch, &cm) == 6 && d >= 0 && d < 7)
                cfg.days[d] = (day_t){open, oh * 60 + om, ch * 60 + cm};
        fclose(f);
    }
    f = fopen(MOUNT "/config.csv", "r");
    if (f) {
        char key[32], val[32];
        while (fgets(line, sizeof line, f)) {
            if (sscanf(line, "%31[^,],%31s", key, val) != 2) continue;
            if (!strcmp(key, "config_version")) cfg.version = atoi(val);
            else if (!strcmp(key, "emergency_mode")) cfg.emergency = atoi(val);
            else if (!strcmp(key, "light_off_delay_s")) cfg.light_off_delay_s = atoi(val);
            else if (!strcmp(key, "heartbeat_interval_s")) cfg.heartbeat_s = atoi(val);
            else if (!strcmp(key, "light_mode_LR1")) strlcpy(cfg.light_mode[0], val, 10);
            else if (!strcmp(key, "light_mode_LR2")) strlcpy(cfg.light_mode[1], val, 10);
        }
        fclose(f);
    }
    f = fopen(MOUNT "/inside.csv", "r");
    if (f) {
        n_inside = 0;
        while (n_inside < MAX_INSIDE && fgets(line, sizeof line, f)) {
            line[strcspn(line, "\r\n")] = 0;
            if (line[0]) strlcpy(inside[n_inside++], line, 21);
        }
        fclose(f);
    }
    int pending = 0;
    f = fopen(MOUNT "/outbox.csv", "r");
    if (f) { while (fgets(line, sizeof line, f)) pending++; fclose(f); }
    outbox_count = pending;
    UNLOCK(sd_mutex);
    UNLOCK(state_mutex);
    NOTE("SD: config v%d, %d tags, %d inside, %d queued events", cfg.version, cfg.n_tags, n_inside, pending);
}

static void sd_init(void)
{
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI2_HOST;
    spi_bus_config_t bus = {.mosi_io_num = PIN_SD_MOSI, .miso_io_num = PIN_SD_MISO, .sclk_io_num = PIN_SD_SCK,
                            .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = 4000};
    if (spi_bus_initialize(host.slot, &bus, SDSPI_DEFAULT_DMA) != ESP_OK) return;
    sdspi_device_config_t slot = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot.gpio_cs = PIN_SD_CS;
    slot.host_id = host.slot;
    esp_vfs_fat_sdmmc_mount_config_t mount = {.format_if_mount_failed = true, .max_files = 4,
                                              .allocation_unit_size = 16 * 1024};
    sdmmc_card_t *card;
    esp_err_t err = esp_vfs_fat_sdspi_mount(MOUNT, &host, &slot, &mount, &card);
    sd_ok = (err == ESP_OK);
    if (sd_ok) NOTE("SD card mounted at " MOUNT);
    else NOTE("No SD card (%s): logs and the offline queue are disabled", esp_err_to_name(err));
}

static long sd_free_kb(void)
{
    uint64_t total = 0, free_b = 0;
    if (!sd_ok || esp_vfs_fat_info(MOUNT, &total, &free_b) != ESP_OK) return -1;
    return (long)(free_b / 1024);
}

/* ======================= outbox (store and forward) ======================= */

static void outbox_add(const char *line)
{
    if (!sd_ok) { NOTE("No SD card: event lost: %s", line); return; }
    sd_append("outbox.csv", line);
    outbox_count++;
}

/* ======================= HTTP ======================= */

static bool online(void) { return wifi_up && !sim_offline; }

static const char *net_state(void) { return !online() ? "OFFLINE" : api_ok ? "ONLINE" : "NO API"; }

/* One HTTP request. Returns the status code, or -1 if the API could not be reached. */
static int http_call(esp_http_client_method_t method, const char *path, const char *body,
                     bool use_admin_token, char *resp, int resp_size)
{
    if (!online()) return -1;
    /* After a failed call, go straight to the offline path for 30 s instead of
     * making every person at the door wait for another timeout. */
    if (!api_ok && api_retry_ms && now_ms() < api_retry_ms) return -1;
    char url[200];
    snprintf(url, sizeof url, "%s%s", api_base, path);
    esp_http_client_config_t c = {.url = url, .method = method, .timeout_ms = 4000};
    if (strncmp(url, "https", 5) == 0) c.crt_bundle_attach = esp_crt_bundle_attach;
    esp_http_client_handle_t h = esp_http_client_init(&c);
    if (!h) return -1;
    esp_http_client_set_header(h, "Content-Type", "application/json");
    esp_http_client_set_header(h, "X-Device-Key", DEVICE_KEY);
    esp_http_client_set_header(h, "ngrok-skip-browser-warning", "1");
    if (use_admin_token && admin_token[0]) {
        char auth[80];
        snprintf(auth, sizeof auth, "Bearer %s", admin_token);
        esp_http_client_set_header(h, "Authorization", auth);
    }
    int len = body ? strlen(body) : 0;
    int status = -1;
    if (esp_http_client_open(h, len) == ESP_OK) {
        if (len) esp_http_client_write(h, body, len);
        esp_http_client_fetch_headers(h);
        status = esp_http_client_get_status_code(h);
        int total = 0, r;
        while (resp && total < resp_size - 1 && (r = esp_http_client_read(h, resp + total, resp_size - 1 - total)) > 0)
            total += r;
        if (resp) resp[total] = 0;
    }
    esp_http_client_close(h);
    esp_http_client_cleanup(h);
    api_ok = status > 0;
    if (!api_ok) api_retry_ms = now_ms() + 30000;
    return status;
}

/* ======================= access control ======================= */

static int inside_index(const char *uid)    /* caller holds state_mutex */
{
    for (int i = 0; i < n_inside; i++) if (!strcmp(inside[i], uid)) return i;
    return -1;
}

static const tag_t *find_tag(const char *uid) /* caller holds state_mutex */
{
    for (int i = 0; i < cfg.n_tags; i++) if (!strcasecmp(cfg.tags[i].uid, uid)) return &cfg.tags[i];
    return NULL;
}

static void mark_inside(const char *uid, bool entry) /* caller holds state_mutex */
{
    int i = inside_index(uid);
    if (entry && i < 0 && n_inside < MAX_INSIDE) strlcpy(inside[n_inside++], uid, 21);
    if (!entry && i >= 0) { memmove(inside[i], inside[i + 1], (n_inside - i - 1) * 21); n_inside--; }
    save_inside_locked();
}

/* The same six rules as api/access_logic.py, used when the API cannot be reached. */
static const char *decide_offline(const char *uid, bool entry, const char **reason)
{
    const tag_t *t = find_tag(uid);
    bool in = inside_index(uid) >= 0;
    if (cfg.emergency) { *reason = "EMERGENCY_OPEN"; return "GRANTED"; }
    if (!t) { *reason = "UNKNOWN_TAG"; return "DENIED"; }
    if (!within_schedule()) { *reason = "OUTSIDE_SCHEDULE"; return "DENIED"; }
    if (entry && in) { *reason = "ALREADY_INSIDE"; return "DENIED"; }
    if (!entry && !in) { *reason = "NOT_INSIDE"; return "DENIED"; }
    *reason = "OK";
    return "GRANTED";
}

static const char *reason_text(const char *reason)
{
    if (!strcmp(reason, "OK")) return "Access granted";
    if (!strcmp(reason, "EMERGENCY_OPEN")) return "EMERGENCY: go out";
    if (!strcmp(reason, "UNKNOWN_TAG")) return "Unknown card";
    if (!strcmp(reason, "INACTIVE_USER")) return "Card deactivated";
    if (!strcmp(reason, "OUTSIDE_SCHEDULE")) return "Building closed";
    if (!strcmp(reason, "ALREADY_INSIDE")) return "Already checked in";
    if (!strcmp(reason, "NOT_INSIDE")) return "Not checked in";
    return reason;
}

static void room_reset_all(const char *trigger);

/* A card was tapped on the entry or exit reader. */
static void handle_tap(const char *uid_in, bool entry)
{
    char uid[21], uuid[24], at[20], name[40] = "Unknown card";
    char decision[10] = "DENIED", reason[20] = "UNKNOWN_TAG";
    strlcpy(uid, uid_in, sizeof uid);
    for (char *p = uid; *p; p++) if (*p >= 'a' && *p <= 'z') *p -= 32;
    const char *door = entry ? "ENTRY" : "EXIT";
    new_uuid(uuid);
    now_iso(at);

    /* 1. Online path: the API decides and records in one transaction. */
    char body[200], resp[512];
    snprintf(body, sizeof body, "{\"event_uuid\":\"%s\",\"rfid_uid\":\"%s\",\"door\":\"%s\",\"occurred_at\":\"%s\"}",
             uuid, uid, door, at);
    int status = clock_valid() ? http_call(HTTP_METHOD_POST, "/device/access/check", body, false, resp, sizeof resp) : -1;
    bool via_api = false;
    if (status == 200) {
        cJSON *j = cJSON_Parse(resp);
        cJSON *d = cJSON_GetObjectItem(j, "decision"), *r = cJSON_GetObjectItem(j, "reason");
        if (cJSON_IsString(d) && cJSON_IsString(r)) {
            strlcpy(decision, d->valuestring, sizeof decision);
            strlcpy(reason, r->valuestring, sizeof reason);
            cJSON *n = cJSON_GetObjectItem(cJSON_GetObjectItem(j, "user"), "full_name");
            if (cJSON_IsString(n)) strlcpy(name, n->valuestring, sizeof name);
            via_api = true;
        }
        cJSON_Delete(j);
    }

    LOCK(state_mutex);
    if (!via_api) {
        /* 2. Offline path: same rules on the cached config, queued for upload. */
        const char *r;
        strlcpy(decision, decide_offline(uid, entry, &r), sizeof decision);
        strlcpy(reason, r, sizeof reason);
        const tag_t *t = find_tag(uid);
        if (t) strlcpy(name, t->name, sizeof name);
    }
    bool granted = !strcmp(decision, "GRANTED");
    if (granted) mark_inside(uid, entry);     /* the server opens a visit for every granted scan */
    bool building_empty = granted && !entry && n_inside == 0;
    char line[96];
    snprintf(line, sizeof line, "%.8s %-5s %-8.8s %-7s %s", at + 11, door, uid, decision, reason);
    strlcpy(recent[recent_next], line, sizeof recent[0]);
    recent_next = (recent_next + 1) % LOG_SIZE;
    snprintf(lcd_msg[0], 21, "%s %s", granted ? "OK" : "NO", name);
    snprintf(lcd_msg[1], 21, "%s", reason_text(reason));
    lcd_msg_until = now_ms() + 3000;
    UNLOCK(state_mutex);

    char rec[160], file[16];
    snprintf(rec, sizeof rec, "%s,%s,%s,%s,%s,%s", uuid, uid, door, decision, reason, at);
    daily_name(file, "AC");
    sd_append(file, rec);
    if (!via_api) {
        char ob[170];
        snprintf(ob, sizeof ob, "A,%s", rec);
        outbox_add(ob);
    }
    printf("\n[%s] %s %s %s: %s %s (%s)\n> ", at + 11, door, uid, name, decision, reason, via_api ? "API" : "offline");
    fflush(stdout);

    /* Doors, LEDs and buzzer. */
    if (granted) {
        servo_angle(entry ? LEDC_CHANNEL_0 : LEDC_CHANNEL_1, 90);
        gpio_set_level(PIN_LED_GREEN, 1);
        beep(120, 2000);
    } else {
        gpio_set_level(PIN_LED_RED, 1);
        beep(500, 400);
    }
    esp_timer_stop(door_timer);
    esp_timer_start_once(door_timer, DOOR_OPEN_MS * 1000);

    /* Safeguard 4: the last person left the building, so the rooms must be empty. */
    if (building_empty) room_reset_all("COUNT_RESET");
}

static void access_task(void *arg)
{
    bool last_in = true, last_out = true;       /* pull-ups: idle level is 1 */
    int last_card = -1;
    for (;;) {
        tap_t tap;
        if (xQueueReceive(tap_queue, &tap, pdMS_TO_TICKS(20))) handle_tap(tap.uid, tap.entry);

        int raw = 0;
        adc_oneshot_read(adc, ADC_CHANNEL_6, &raw);
        int card = raw * N_DEMO_CARDS / 4096;
        if (card >= N_DEMO_CARDS) card = N_DEMO_CARDS - 1;
        if (card != last_card) {
            last_card = card;
            LOCK(state_mutex);
            const tag_t *t = find_tag(demo_cards[card]);
            snprintf(lcd_msg[0], 21, "Card: %s", t ? t->name : "unregistered");
            snprintf(lcd_msg[1], 21, "UID %s", demo_cards[card]);
            lcd_msg_until = now_ms() + 2000;
            UNLOCK(state_mutex);
        }

        bool in = gpio_get_level(PIN_BTN_IN), out = gpio_get_level(PIN_BTN_OUT);
        if (last_in && !in) handle_tap(demo_cards[card], true);     /* falling edge = press */
        if (last_out && !out) handle_tap(demo_cards[card], false);
        last_in = in;
        last_out = out;
    }
}

/* ======================= lighting ======================= */

/* Caller holds state_mutex. Queues the room's state for the API. */
static void room_report(room_t *r, const char *trigger)
{
    room_event_t ev;
    new_uuid(ev.uuid);
    strlcpy(ev.room, r->code, sizeof ev.room);
    ev.count = r->count;
    ev.light_on = r->light_on;
    strlcpy(ev.trigger, trigger, sizeof ev.trigger);
    now_iso(ev.at);
    if (xQueueSend(event_queue, &ev, 0) != pdTRUE) NOTE("event_queue full");
}

/* A person crossed a doorway (delta +1 in, -1 out). Used by the beams and by "walk";
 * only the beams need to print a fresh prompt, the menu prints its own. */
static void room_person(int i, int delta, bool prompt)
{
    LOCK(state_mutex);
    room_t *r = &rooms[i];
    if (delta > 0) r->count++;
    else if (r->count > 0) r->count--;      /* safeguard 1: never below 0 */
    else { UNLOCK(state_mutex); return; }
    if (r->count > 0) r->empty_since_ms = 0;
    else r->empty_since_ms = now_ms();
    r->pending = delta > 0 ? "PERSON_IN" : "PERSON_OUT";   /* reported by the lighting loop */
    UNLOCK(state_mutex);
    printf("\n[%s] %s, now %d inside\n%s", rooms[i].code, delta > 0 ? "person in" : "person out", rooms[i].count,
           prompt ? "> " : "");
    fflush(stdout);
}

static void room_reset_all(const char *trigger)
{
    LOCK(state_mutex);
    for (int i = 0; i < 2; i++)
        if (rooms[i].count > 0) {
            rooms[i].count = 0;
            rooms[i].empty_since_ms = now_ms();
            rooms[i].pending = trigger;
        }
    UNLOCK(state_mutex);
}

/* Beam state machine: A then B within CROSS_MS = in, B then A = out. */
static void poll_beams(int i)
{
    room_t *r = &rooms[i];
    bool a = !gpio_get_level(r->pin_a), b = !gpio_get_level(r->pin_b);   /* pressed = beam broken */
    int64_t t = now_ms();
    if (r->first && t - r->first_ms > CROSS_MS) r->first = 0;              /* incomplete crossing */
    if (a && !r->last_a) {
        if (r->first == 'B') { r->first = 0; room_person(i, -1, true); }
        else { r->first = 'A'; r->first_ms = t; }
    }
    if (b && !r->last_b) {
        if (r->first == 'A') { r->first = 0; room_person(i, +1, true); }
        else { r->first = 'B'; r->first_ms = t; }
    }
    r->last_a = a;
    r->last_b = b;
}

static void lighting_task(void *arg)
{
    bool last_emergency = false;
    int64_t next_lcd = 0;
    for (;;) {
        for (int i = 0; i < 2; i++) poll_beams(i);

        LOCK(state_mutex);
        bool open_now = within_schedule();
        for (int i = 0; i < 2; i++) {
            room_t *r = &rooms[i];
            if (clock_valid() && !open_now && r->count > 0) {          /* safeguard 3: closing time */
                r->count = 0;
                r->empty_since_ms = now_ms();
                r->pending = "COUNT_RESET";
            }
            const char *mode = cfg.light_mode[i];
            bool want, manual = strcmp(mode, "AUTO") != 0;
            if (cfg.emergency) want = true;                             /* light the way out */
            else if (!strcmp(mode, "FORCE_ON")) want = true;
            else if (!strcmp(mode, "FORCE_OFF")) want = false;
            else if (r->count > 0) want = true;
            else want = r->light_on && now_ms() - r->empty_since_ms < cfg.light_off_delay_s * 1000LL;
            /* One report per change: the count change and the light it causes go together. */
            if (want != r->light_on || r->pending) {
                const char *why = r->pending ? r->pending : cfg.emergency ? "EMERGENCY"
                                : manual ? "MANUAL_OVERRIDE" : r->count ? "PERSON_IN" : "PERSON_OUT";
                r->light_on = want;
                gpio_set_level(r->pin_light, want);
                room_report(r, why);
                r->pending = NULL;
            }
        }
        bool emergency = cfg.emergency;
        UNLOCK(state_mutex);

        if (emergency != last_emergency) {                             /* hold both doors open */
            last_emergency = emergency;
            servo_angle(LEDC_CHANNEL_0, emergency ? 90 : 0);
            servo_angle(LEDC_CHANNEL_1, emergency ? 90 : 0);
            printf("\n*** EMERGENCY MODE %s ***\n> ", emergency ? "ON: doors open" : "OFF");
            fflush(stdout);
        }

        if (now_ms() >= next_lcd) {                                    /* refresh the LCD twice a second */
            next_lcd = now_ms() + 500;
            char l0[21], l1[21], l2[21], l3[21], hm[6] = "--:--", at[20];
            if (clock_valid()) { now_iso(at); memcpy(hm, at + 11, 5); }
            LOCK(state_mutex);
            snprintf(l0, 21, "CoCIS %s %s", hm, net_state());
            if (cfg.emergency) snprintf(l1, 21, "!! EMERGENCY OPEN !!");
            else snprintf(l1, 21, "In:%-3d Queue:%d", n_inside, outbox_count);
            snprintf(l2, 21, "LR1:%d %-3s LR2:%d %s", rooms[0].count, rooms[0].light_on ? "ON" : "off",
                     rooms[1].count, rooms[1].light_on ? "ON" : "off");
            bool msg = now_ms() < lcd_msg_until;
            snprintf(l3, 21, "%s", msg ? lcd_msg[1] : "Tap a card");
            if (msg) snprintf(l1, 21, "%s", lcd_msg[0]);
            UNLOCK(state_mutex);
            lcd_line(0, l0); lcd_line(1, l1); lcd_line(2, l2); lcd_line(3, l3);
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

/* ======================= network and sync ======================= */

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) esp_wifi_connect();
    else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (wifi_up) NOTE("Wi-Fi lost (reason %d), reconnecting", ((wifi_event_sta_disconnected_t *)data)->reason);
        wifi_up = false;
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        wifi_up = true;
        NOTE("Wi-Fi connected, IP " IPSTR, IP2STR(&((ip_event_got_ip_t *)data)->ip_info.ip));
    }
}

static void wifi_init(void)
{
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t wc = WIFI_INIT_CONFIG_DEFAULT();
    esp_err_t err = esp_wifi_init(&wc);
    if (err != ESP_OK) NOTE("esp_wifi_init failed: %s", esp_err_to_name(err));
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL);
    wifi_config_t sta = {.sta = {.ssid = WIFI_SSID, .password = WIFI_PASS, .channel = WIFI_CHANNEL}};
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &sta);
    err = esp_wifi_start();
    NOTE("Connecting to %s ... %s", WIFI_SSID, esp_err_to_name(err));

    setenv("TZ", TIMEZONE, 1);
    tzset();
}

/* Internet time, started once Wi-Fi has an address. The server's time in the
 * heartbeat reply is the fallback when NTP is not reachable. */
static void sntp_start(void)
{
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_setservername(1, "time.google.com");
    esp_sntp_init();
}

/* Download the config and replace the cached copy (UC15). */
static void fetch_config(void)
{
    char *buf = malloc(12000);
    if (!buf) return;
    int status = http_call(HTTP_METHOD_GET, "/device/config", NULL, false, buf, 12000);
    cJSON *j = status == 200 ? cJSON_Parse(buf) : NULL;
    free(buf);
    if (!j) { NOTE("Config download failed (%d)", status); return; }

    LOCK(state_mutex);
    cfg.version = cJSON_GetObjectItem(j, "config_version")->valueint;
    cfg.emergency = cJSON_IsTrue(cJSON_GetObjectItem(j, "emergency_mode"));
    cfg.light_off_delay_s = cJSON_GetObjectItem(j, "light_off_delay_s")->valueint;
    cfg.heartbeat_s = cJSON_GetObjectItem(j, "heartbeat_interval_s")->valueint;
    cJSON *d;
    cJSON_ArrayForEach(d, cJSON_GetObjectItem(j, "schedule")) {
        int dow = cJSON_GetObjectItem(d, "day_of_week")->valueint;
        if (dow < 0 || dow > 6) continue;
        cfg.days[dow] = (day_t){cJSON_GetObjectItem(d, "is_open")->valueint != 0,
                                hhmm_to_min(cJSON_GetObjectItem(d, "open_time")->valuestring),
                                hhmm_to_min(cJSON_GetObjectItem(d, "close_time")->valuestring)};
    }
    cJSON *modes = cJSON_GetObjectItem(j, "room_light_modes");
    for (int i = 0; i < 2; i++) {
        cJSON *m = cJSON_GetObjectItem(modes, rooms[i].code);
        if (cJSON_IsString(m)) strlcpy(cfg.light_mode[i], m->valuestring, 10);
    }
    cfg.n_tags = 0;
    cJSON_ArrayForEach(d, cJSON_GetObjectItem(j, "authorised_tags")) {
        if (cfg.n_tags >= MAX_TAGS) break;
        tag_t *t = &cfg.tags[cfg.n_tags++];
        strlcpy(t->uid, cJSON_GetObjectItem(d, "rfid_uid")->valuestring, sizeof t->uid);
        strlcpy(t->name, cJSON_GetObjectItem(d, "full_name")->valuestring, sizeof t->name);
        strlcpy(t->role, cJSON_GetObjectItem(d, "role")->valuestring, sizeof t->role);
    }
    /* The server is the source of truth for who is inside, but only once our own
     * queued scans have reached it; otherwise keep the local list. */
    if (outbox_count == 0) {
        n_inside = 0;
        cJSON_ArrayForEach(d, cJSON_GetObjectItem(j, "currently_inside"))
            if (n_inside < MAX_INSIDE) strlcpy(inside[n_inside++], d->valuestring, 21);
        save_inside_locked();
    }
    save_config_locked();
    int v = cfg.version;
    UNLOCK(state_mutex);
    cJSON_Delete(j);
    printf("\n[sync] config version %d downloaded and saved to SD\n> ", v);
    fflush(stdout);
}

static void heartbeat(void)
{
    char body[200], resp[200];
    esp_netif_ip_info_t ip = {0};
    esp_netif_get_ip_info(esp_netif_get_handle_from_ifkey("WIFI_STA_DEF"), &ip);
    snprintf(body, sizeof body, "{\"firmware_version\":\"" FW_VERSION "\",\"ip_address\":\"" IPSTR "\","
             "\"free_heap\":%" PRIu32 ",\"sd_free_kb\":%ld,\"pending_events\":%d}",
             IP2STR(&ip.ip), esp_get_free_heap_size(), sd_free_kb(), outbox_count);
    if (http_call(HTTP_METHOD_POST, "/device/heartbeat", body, false, resp, sizeof resp) != 200) return;
    cJSON *j = cJSON_Parse(resp);
    if (!j) return;
    if (!clock_valid()) set_clock_from_iso(cJSON_GetObjectItem(j, "server_time")->valuestring);
    int version = cJSON_GetObjectItem(j, "config_version")->valueint;
    bool emergency = cJSON_IsTrue(cJSON_GetObjectItem(j, "emergency_mode"));
    cJSON_Delete(j);
    LOCK(state_mutex);
    bool changed = version != cfg.version;
    cfg.emergency = emergency;               /* emergency reaches the doors within one heartbeat */
    UNLOCK(state_mutex);
    if (changed) fetch_config();
}

/* Send one room event now, or keep it in the outbox if the API is unreachable. */
static void send_room_event(const room_event_t *ev)
{
    char line[160], file[16];
    snprintf(line, sizeof line, "%s,%s,%d,%d,%s,%s", ev->uuid, ev->room, ev->count, ev->light_on, ev->trigger, ev->at);
    daily_name(file, "RM");
    sd_append(file, line);
    char body[256];
    snprintf(body, sizeof body, "{\"event_uuid\":\"%s\",\"room_code\":\"%s\",\"occupant_count\":%d,"
             "\"light_on\":%s,\"trigger\":\"%s\",\"occurred_at\":\"%s\"}",
             ev->uuid, ev->room, ev->count, ev->light_on ? "true" : "false", ev->trigger, ev->at);
    if (!clock_valid() || http_call(HTTP_METHOD_POST, "/device/rooms/status", body, false, NULL, 0) != 200) {
        char ob[170];
        snprintf(ob, sizeof ob, "R,%s", line);
        outbox_add(ob);
    }
}

/* Upload up to BATCH_MAX queued lines; remove them once the API has them (UC14). */
static void flush_outbox(void)
{
    if (!sd_ok || outbox_count == 0 || !online()) return;
    cJSON *batch = cJSON_CreateObject();
    cJSON *acc = cJSON_AddArrayToObject(batch, "access_events");
    cJSON *rms = cJSON_AddArrayToObject(batch, "room_events");
    char line[200];
    int taken = 0, damaged = 0;
    LOCK(sd_mutex);
    FILE *f = fopen(MOUNT "/outbox.csv", "r");
    while (f && taken < BATCH_MAX && fgets(line, sizeof line, f)) {
        taken++;
        if (!crc_ok(line)) { damaged++; continue; }   /* a torn write after a power cut */
        char uuid[24], a[24], b[16], c[16], d[24], at[20];
        if (line[0] == 'A' && sscanf(line + 2, "%23[^,],%23[^,],%15[^,],%15[^,],%23[^,],%19s", uuid, a, b, c, d, at) == 6) {
            cJSON *e = cJSON_CreateObject();
            cJSON_AddStringToObject(e, "event_uuid", uuid);
            cJSON_AddStringToObject(e, "rfid_uid", a);
            cJSON_AddStringToObject(e, "door", b);
            cJSON_AddStringToObject(e, "decision", c);
            cJSON_AddStringToObject(e, "reason", d);
            cJSON_AddStringToObject(e, "occurred_at", at);
            cJSON_AddItemToArray(acc, e);
        } else if (line[0] == 'R' && sscanf(line + 2, "%23[^,],%15[^,],%15[^,],%15[^,],%23[^,],%19s", uuid, a, b, c, d, at) == 6) {
            cJSON *e = cJSON_CreateObject();
            cJSON_AddStringToObject(e, "event_uuid", uuid);
            cJSON_AddStringToObject(e, "room_code", a);
            cJSON_AddNumberToObject(e, "occupant_count", atoi(b));
            cJSON_AddBoolToObject(e, "light_on", atoi(c));
            cJSON_AddStringToObject(e, "trigger", d);
            cJSON_AddStringToObject(e, "occurred_at", at);
            cJSON_AddItemToArray(rms, e);
        } else damaged++;
    }
    if (f) fclose(f);
    UNLOCK(sd_mutex);

    char *body = cJSON_PrintUnformatted(batch);
    cJSON_Delete(batch);
    char resp[64];
    int status = http_call(HTTP_METHOD_POST, "/device/events/batch", body, false, resp, sizeof resp);
    free(body);
    if (status != 200 && status != 422) return;  /* try again later; 422 = rejected, drop it */

    /* Remove the first 'taken' lines: copy the rest to a temp file and swap it in. */
    LOCK(sd_mutex);
    f = fopen(MOUNT "/outbox.csv", "r");
    FILE *t = fopen(MOUNT "/outbox.tmp", "w");
    int n = 0, left = 0;
    while (f && t && fgets(line, sizeof line, f))
        if (++n > taken) { fputs(line, t); left++; }
    if (f) fclose(f);
    if (t) fclose(t);
    unlink(MOUNT "/outbox.csv");
    rename(MOUNT "/outbox.tmp", MOUNT "/outbox.csv");
    UNLOCK(sd_mutex);
    outbox_count = left;
    printf("\n[sync] uploaded %d queued events (%d damaged lines skipped), %d left\n> ", taken - damaged, damaged, left);
    fflush(stdout);
}

static void network_task(void *arg)
{
    wifi_init();
    int64_t next_beat = 0, next_flush = 0;
    bool was_online = false;
    for (;;) {
        room_event_t ev;
        while (xQueueReceive(event_queue, &ev, pdMS_TO_TICKS(200))) send_room_event(&ev);

        static bool sntp_started;
        if (wifi_up && !sntp_started) { sntp_started = true; sntp_start(); }
        bool on = online();
        if (on && !was_online) { next_beat = 0; next_flush = 0; }   /* just reconnected: sync now */
        was_online = on;
        if (!on) continue;
        int64_t t = now_ms();
        if (t >= next_beat || force_sync) {
            heartbeat();
            next_beat = t + cfg.heartbeat_s * 1000LL;
        }
        if (t >= next_flush || force_sync) {
            flush_outbox();
            next_flush = t + 5000;
        }
        if (force_sync) { force_sync = false; fetch_config(); }
    }
}

/* ======================= serial menu ======================= */

static void print_help(void)
{
    printf("\n=========== CoCIS serial menu ===========\n"
           " status                 everything at a glance\n"
           " inside                 who is in the building\n"
           " rooms                  lecture rooms: people and lights\n"
           " log                    last %d scans\n"
           " schedule               opening hours in use\n"
           " tags                   cards known for offline use\n"
           " outbox                 events waiting for upload\n"
           " sync                   upload now and download the config\n"
           " offline on|off         simulate losing the network\n"
           " server <url>           API base, e.g. https://x.ngrok-free.app/api/v1\n"
           " tap <UID> entry|exit   simulate a card tap\n"
           " walk LR1|LR2 in|out    simulate a person crossing a room door\n"
           " time <YYYY-MM-DDTHH:MM:SS>  set the clock by hand (normally NTP or the API)\n"
           " -- staff only (login first) --\n"
           " login <user> <pass>    e.g. login admin Admin@CoCIS2026\n"
           " setday <0-6> <HH:MM> <HH:MM> | setday <0-6> closed   (0 = Sunday)\n"
           " emergency on|off <reason>\n"
           " light LR1|LR2 AUTO|FORCE_ON|FORCE_OFF\n"
           " logout\n"
           "=========================================\n", LOG_SIZE);
}

static const char *DAYS[7] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

static void print_status(void)
{
    char at[20] = "clock not set";
    if (clock_valid()) now_iso(at);
    LOCK(state_mutex);
    printf("\nTime       %s\nNetwork    %s (Wi-Fi %s%s)\nAPI        %s\nConfig     version %d%s\n"
           "Emergency  %s\nInside     %d people\nLR1        %d people, lights %s (%s)\nLR2        %d people, lights %s (%s)\n"
           "Queue      %d events waiting\nSD card    %s, %ld KB free\nHeap       %" PRIu32 " bytes free\nStaff      %s\n",
           at, net_state(), wifi_up ? "up" : "down", sim_offline ? ", simulated offline" : "",
           api_base, cfg.version, cfg.version ? "" : " (built-in defaults)", cfg.emergency ? "ON" : "off", n_inside,
           rooms[0].count, rooms[0].light_on ? "ON" : "off", cfg.light_mode[0],
           rooms[1].count, rooms[1].light_on ? "ON" : "off", cfg.light_mode[1], outbox_count,
           sd_ok ? "mounted" : "MISSING", sd_free_kb(), esp_get_free_heap_size(),
           admin_token[0] ? admin_role : "not logged in");
    UNLOCK(state_mutex);
}

/* Send a staff command to the API with the stored login token. */
static void staff_call(esp_http_client_method_t m, const char *path, const char *body)
{
    if (!admin_token[0]) { printf("Log in first: login <user> <pass>\n"); return; }
    char resp[300];
    int status = http_call(m, path, body, true, resp, sizeof resp);
    if (status == 200) { printf("Done. Downloading the new config...\n"); force_sync = true; }
    else if (status == -1) printf("The API cannot be reached. Settings can only be changed online,\n"
                                  "so that every change is authenticated and recorded centrally.\n");
    else printf("Refused (%d): %s\n", status, resp);
}

static void run_command(char *cmdline)
{
    char *argv[6] = {0};
    int argc = 0;
    for (char *tok = strtok(cmdline, " "); tok && argc < 6; tok = strtok(NULL, " ")) argv[argc++] = tok;
    if (argc == 0) return;
    const char *c = argv[0];

    if (!strcmp(c, "help") || !strcmp(c, "?")) print_help();
    else if (!strcmp(c, "status")) print_status();
    else if (!strcmp(c, "inside")) {
        LOCK(state_mutex);
        printf("%d inside the building:\n", n_inside);
        for (int i = 0; i < n_inside; i++) {
            const tag_t *t = find_tag(inside[i]);
            printf("  %-10s %s\n", inside[i], t ? t->name : "?");
        }
        UNLOCK(state_mutex);
    } else if (!strcmp(c, "rooms")) {
        LOCK(state_mutex);
        for (int i = 0; i < 2; i++)
            printf("  %s  %d people  lights %-3s  mode %s\n", rooms[i].code, rooms[i].count,
                   rooms[i].light_on ? "ON" : "off", cfg.light_mode[i]);
        UNLOCK(state_mutex);
    } else if (!strcmp(c, "log")) {
        LOCK(state_mutex);
        printf("  time     door  uid      result  reason\n");
        for (int i = 0; i < LOG_SIZE; i++) {
            const char *l = recent[(recent_next + i) % LOG_SIZE];
            if (l[0]) printf("  %s\n", l);
        }
        UNLOCK(state_mutex);
    } else if (!strcmp(c, "schedule")) {
        LOCK(state_mutex);
        for (int d = 0; d < 7; d++) {
            if (cfg.days[d].is_open)
                printf("  %s  %02d:%02d to %02d:%02d\n", DAYS[d], cfg.days[d].open_min / 60, cfg.days[d].open_min % 60,
                       cfg.days[d].close_min / 60, cfg.days[d].close_min % 60);
            else printf("  %s  closed\n", DAYS[d]);
        }
        printf("  Building is %s now\n", within_schedule() ? "OPEN" : "CLOSED");
        UNLOCK(state_mutex);
    } else if (!strcmp(c, "tags")) {
        LOCK(state_mutex);
        for (int i = 0; i < cfg.n_tags; i++)
            printf("  %-10s %-24s %s\n", cfg.tags[i].uid, cfg.tags[i].name, cfg.tags[i].role);
        UNLOCK(state_mutex);
    } else if (!strcmp(c, "outbox")) printf("%d events waiting for upload\n", outbox_count);
    else if (!strcmp(c, "sync")) { api_retry_ms = 0; force_sync = true; printf("Syncing...\n"); }
    else if (!strcmp(c, "offline") && argc == 2) {
        sim_offline = !strcmp(argv[1], "on");
        printf("Network %s\n", sim_offline ? "OFF (simulated): scans are decided locally and queued" : "back ON");
    } else if (!strcmp(c, "server") && argc == 2) {
        strlcpy(api_base, argv[1], sizeof api_base);
        api_retry_ms = 0;
        printf("API base is now %s\n", api_base);
        force_sync = true;
    } else if (!strcmp(c, "tap") && argc == 3) {
        tap_t t;
        strlcpy(t.uid, argv[1], sizeof t.uid);
        t.entry = !strcasecmp(argv[2], "entry") || !strcasecmp(argv[2], "in");
        xQueueSend(tap_queue, &t, 0);
    } else if (!strcmp(c, "time") && argc == 2) {
        set_clock_from_iso(argv[1]);
        char at[20];
        now_iso(at);
        printf("Clock is now %s\n", at);
    } else if (!strcmp(c, "walk") && argc == 3) {
        int i = !strcasecmp(argv[1], "LR2");
        room_person(i, !strcasecmp(argv[2], "in") ? +1 : -1, false);
    } else if (!strcmp(c, "login") && argc == 3) {
        char body[160], resp[400];
        snprintf(body, sizeof body, "{\"username\":\"%s\",\"password\":\"%s\"}", argv[1], argv[2]);
        int status = http_call(HTTP_METHOD_POST, "/auth/login", body, false, resp, sizeof resp);
        cJSON *j = status == 200 ? cJSON_Parse(resp) : NULL;
        if (j) {
            strlcpy(admin_token, cJSON_GetObjectItem(j, "access_token")->valuestring, sizeof admin_token);
            strlcpy(admin_role, cJSON_GetObjectItem(j, "role")->valuestring, sizeof admin_role);
            printf("Logged in as %s (%s)\n", argv[1], admin_role);
            cJSON_Delete(j);
        } else printf(status == -1 ? "The API cannot be reached\n" : "Wrong username or password\n");
    } else if (!strcmp(c, "logout")) {
        if (admin_token[0]) http_call(HTTP_METHOD_POST, "/auth/logout", NULL, true, NULL, 0);
        admin_token[0] = 0;
        printf("Logged out\n");
    } else if (!strcmp(c, "setday") && argc >= 3) {
        char body[160];
        int d = atoi(argv[1]);
        if (d < 0 || d > 6) { printf("Day must be 0 (Sunday) to 6 (Saturday)\n"); return; }
        if (!strcmp(argv[2], "closed"))
            snprintf(body, sizeof body, "{\"days\":[{\"day_of_week\":%d,\"is_open\":false,\"open_time\":\"07:00\",\"close_time\":\"22:00\"}]}", d);
        else if (argc == 4)
            snprintf(body, sizeof body, "{\"days\":[{\"day_of_week\":%d,\"is_open\":true,\"open_time\":\"%.5s\",\"close_time\":\"%.5s\"}]}",
                     d, argv[2], argv[3]);
        else { printf("Usage: setday <0-6> <HH:MM> <HH:MM>\n"); return; }
        staff_call(HTTP_METHOD_PUT, "/schedule", body);
    } else if (!strcmp(c, "emergency") && argc >= 2) {
        char body[160];
        snprintf(body, sizeof body, "{\"enabled\":%s,\"reason\":\"%s\"}", strcmp(argv[1], "on") ? "false" : "true",
                 argc >= 3 ? argv[2] : "serial menu");
        staff_call(HTTP_METHOD_PUT, "/settings/emergency", body);
    } else if (!strcmp(c, "light") && argc == 3) {
        char body[64], path[48];
        snprintf(body, sizeof body, "{\"mode\":\"%s\"}", argv[2]);
        snprintf(path, sizeof path, "/rooms/%s/light-mode", argv[1]);
        staff_call(HTTP_METHOD_PUT, path, body);
    } else printf("Unknown command. Type help\n");
}

static void menu_task(void *arg)
{
    uart_driver_install(UART_NUM_0, 1024, 0, 0, NULL, 0);
    char line[128];
    int len = 0;
    print_help();
    printf("> ");
    fflush(stdout);
    for (;;) {
        uint8_t ch;
        if (uart_read_bytes(UART_NUM_0, &ch, 1, portMAX_DELAY) != 1) continue;
        if (ch == '\r' || ch == '\n') {
            if (len == 0) continue;
            line[len] = 0;
            printf("\n");
            run_command(line);
            len = 0;
            printf("> ");
        } else if ((ch == 8 || ch == 127) && len > 0) {
            len--;
            printf("\b \b");
        } else if (ch >= 32 && len < (int)sizeof line - 1) {
            line[len++] = ch;
            putchar(ch);
        }
        fflush(stdout);
    }
}

/* ======================= start-up ======================= */

static void cocis_start(void)
{
    printf("\nCoCIS firmware " FW_VERSION ", ESP-IDF %s\n", esp_get_idf_version());
    if (nvs_flash_init() != ESP_OK) { nvs_flash_erase(); nvs_flash_init(); }
    /* "API not reachable" is normal when running without a tunnel: keep the menu readable. */
    esp_log_level_set("esp-tls", ESP_LOG_NONE);
    esp_log_level_set("transport_base", ESP_LOG_NONE);
    esp_log_level_set("HTTP_CLIENT", ESP_LOG_NONE);
    boot_id = esp_random();
    state_mutex = xSemaphoreCreateMutex();
    sd_mutex = xSemaphoreCreateMutex();
    lcd_mutex = xSemaphoreCreateMutex();
    event_queue = xQueueCreate(32, sizeof(room_event_t));
    tap_queue = xQueueCreate(8, sizeof(tap_t));

    default_config();
    outputs_init();
    lcd_init();
    lcd_line(0, "CoCIS Smart System");
    lcd_line(1, "Starting...");
    sd_init();
    load_from_sd();

    /* Access is the most time critical, so it gets the highest priority. */
    xTaskCreate(access_task, "access", 8192, NULL, 6, NULL);
    xTaskCreate(lighting_task, "lighting", 6144, NULL, 5, NULL);
    xTaskCreate(network_task, "network", 10240, NULL, 4, NULL);
    xTaskCreate(menu_task, "menu", 8192, NULL, 3, NULL);
}

#ifdef ARDUINO
/* wokwi.com builds ESP-IDF code inside the Arduino ESP32 core, whose own app_main
 * starts the C++ functions setup() and loop(). This file is C, so the two functions
 * are given their C++ symbol names; setup() runs the same start-up as app_main. */
void arduino_setup(void) __asm__("_Z5setupv");
void arduino_loop(void) __asm__("_Z4loopv");
void arduino_setup(void) { cocis_start(); }
void arduino_loop(void) { vTaskDelay(portMAX_DELAY); }
#else
void app_main(void) { cocis_start(); }
#endif
