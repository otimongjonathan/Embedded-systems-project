# Reference HTTP Controller Firmware

An alternative controller used to build and test the API. **The group's firmware is the main ESP-IDF project in the repository root**, connected through `bridge/`.

ESP-IDF and FreeRTOS firmware for one ESP32 that runs the main entrance and both lecture rooms.

**Run it:** https://wokwi.com/projects/479503784454238209 (press the green play button)

## Files

| File | Purpose |
|------|---------|
| `main/main.c` | All the firmware (one file) |
| `diagram.json` | Wokwi circuit, 21 parts |
| `CMakeLists.txt`, `main/CMakeLists.txt`, `sdkconfig.defaults` | Build with `idf.py` |
| `wokwi.toml` | Run the `idf.py` build in Wokwi for VS Code |

## Tasks

| Task | Priority | Job |
|------|----------|-----|
| `access_task` | 6 | Card taps, access decision, doors, LEDs, buzzer |
| `lighting_task` | 5 | IR beams, people counts, lights, LCD |
| `network_task` | 4 | Wi-Fi, clock, heartbeat, config download, upload queue |
| `menu_task` | 3 | Serial monitor menu |

Shared data is protected by `state_mutex`, `sd_mutex` and `lcd_mutex`; tasks talk through `event_queue` and `tap_queue`.

## Using the simulation

| Part | Use |
|------|-----|
| Potentiometer | Pick the card being held (shown on the LCD) |
| Tap ENTRY / Tap EXIT (keys 1, 2) | Tap that card on the entry or exit reader |
| LR1 beam A, B (keys Q, W) | A then B = person in, B then A = person out |
| LR2 beam A, B (keys A, S) | Same for Lecture Room 2 |
| Serial monitor | Type `help` |
| SD Card tab | See the log files and `outbox.csv` |

First type `time 2026-10-30T09:00:00` (a weekday morning). Until the clock is set, all scans are refused.

## Serial commands

| Command | Does |
|---------|------|
| `status`, `inside`, `rooms`, `log`, `schedule`, `tags`, `outbox` | Show information |
| `tap A1B2C3D4 entry` | Simulated card tap |
| `walk LR1 in` | Simulated room crossing |
| `offline on` / `offline off` | Simulate losing the network |
| `sync` | Upload the queue and download the config now |
| `server <url>` | Set the API address |
| `time <YYYY-MM-DDTHH:MM:SS>` | Set the clock by hand |
| `login admin Admin@CoCIS2026` | Staff login, then `setday`, `emergency on <reason>`, `light LR1 FORCE_ON` |

## Connecting to the API (optional)

Without the API the firmware works offline (LCD shows `NO API`) and queues events on the SD card.

| Where | How |
|-------|-----|
| wokwi.com | Run `start.bat`, then `ngrok http 8000`, then type `server https://<ngrok-address>/api/v1` |
| Wokwi for VS Code | `idf.py build`, then "Wokwi: Start Simulator"; the default `http://host.wokwi.internal:8000/api/v1` works |

## Updating the Wokwi project

Paste `main/main.c` into `main.c` (and `diagram.json` if changed), then click **SAVE**. The link stays the same.

## Notes

- wokwi.com compiles ESP-IDF code inside the Arduino ESP32 core (ESP-IDF 5.5). The `#ifdef ARDUINO` block at the end of `main.c` handles that; `idf.py` uses `app_main`.
- SD file names are 8.3 (`AC261030.CSV`, `outbox.csv`), so no long file name support is needed.
