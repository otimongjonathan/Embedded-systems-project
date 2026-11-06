# CoCIS Smart Control and Monitoring System

Smart access control, occupancy and automatic lighting for the CoCIS main entrance and two
lecture rooms, on one ESP32 in Wokwi. Embedded Systems coursework, Makerere University, 2026/2027.

## Repository layout

| Path | What it is |
|------|-----------|
| `main/`, `CMakeLists.txt`, `diagram.json`, `wokwi.toml`, ... | ESP32 firmware (ESP-IDF): RFID doors, PIR room lights, LCD, SD card, serial menu, MQTT |
| `backend/` | REST API, SQLite database, management dashboard, and the MQTT bridge that connects the firmware to them |
| `backend/docs/` | Report (Word), video script, diagrams, screenshots |

```text
ESP32 firmware (Wokwi) --MQTT--> broker.hivemq.com --MQTT--> backend/bridge --HTTP--> backend/api --> SQLite
                                                                                  dashboard (browser) --^
```

The firmware is unchanged: it already publishes every scan, room change and schedule over MQTT.
The bridge listens to the same broker and saves them through the API. The ESP32 and the laptop do
not need to be on the same network; both connect out to the broker.

## Run the firmware

Build with ESP-IDF (`idf.py build`) and start the simulation with the Wokwi extension for VS Code.
Type `help` in the serial monitor. Admin login: `login admin 1234`. Authorised cards: `11223344`, `01020304`.

## Run the backend (Windows)

1. Install Python 3.12 from https://www.python.org/downloads/windows/ (tick "Add python.exe to PATH").
2. In `backend/`, double-click `setup.bat` (once).
3. In `backend/`, double-click `start.bat`: API, database and dashboard. Keep it open.
4. In `backend/`, double-click `bridge.bat`: connects the firmware to the database. Keep it open.
5. Start the firmware in Wokwi (or `backend/entrance_sim.bat`, which sends the same messages).
6. Open http://127.0.0.1:8000/dashboard/ and log in with `admin` / `Admin@CoCIS2026`.
   Scans and room changes appear within 3 seconds (Overview and Database tabs).

macOS or Linux: `./setup.sh`, `./start.sh`, `./bridge.sh` in `backend/`.

## Guides

| Guide | Covers |
|-------|--------|
| `backend/README.md` | Installing and running the backend, all scripts, common problems |
| `backend/bridge/README.md` | How the firmware's MQTT messages reach the database |
| `backend/api/README.md` | API endpoints and testing in Swagger UI (http://127.0.0.1:8000/docs) |
| `backend/database/README.md` | Tables and how to look inside the database |
| `backend/dashboard/README.md` | Dashboard tabs |
