# CoCIS Smart Control and Monitoring System: Backend

The server side of the project: REST API, database, dashboard and the MQTT bridge that connects
the group's ESP32 firmware (the project one folder up) to them.
Embedded Systems coursework, Makerere University, 2026/2027.

Reference HTTP controller in Wokwi: https://wokwi.com/projects/479503784454238209

## The apps

| App | Folder | What it does | Guide |
|-----|--------|--------------|-------|
| Reference HTTP controller | `reference-firmware/` | Alternative ESP32 firmware that calls the API directly (IR beam rooms, offline queue); not the group's firmware | [reference-firmware/README.md](reference-firmware/README.md) |
| MQTT bridge | `bridge/` | Connects the group's MQTT entrance ESP32 to the API, with no firmware change | [bridge/README.md](bridge/README.md) |
| REST API | `api/` | Decides access, stores every event, reports, logins | [api/README.md](api/README.md) |
| Database | `database/` | SQLite schema and demo data | [database/README.md](database/README.md) |
| Dashboard | `dashboard/` | Web page for management | [dashboard/README.md](dashboard/README.md) |
| Virtual ESP32 | `simulator/` | Software copy of the controller, for testing without hardware | [simulator/README.md](simulator/README.md) |
| Report | `docs/` | Group report (Word), diagrams, screenshots | [docs/README.md](docs/README.md) |

```text
 Entrance ESP32 --MQTT--> broker.hivemq.com --> MQTT bridge --HTTP--+
 HTTP ESP32 or Virtual ESP32 ---------------------HTTP/JSON---------+--> REST API --> SQLite database
                                                Dashboard, Swagger UI --HTTP--^
```

## Quick start (Windows)

1. Install **Python 3.12** from https://www.python.org/downloads/windows/ and tick
   **"Add python.exe to PATH"** on the first screen.
2. Double-click **`setup.bat`** (once).
3. Double-click **`start.bat`**. Keep the window open.
4. Double-click **`bridge.bat`** to connect the group's MQTT entrance ESP32 (or **`demo.bat`** for the virtual ESP32).
5. Open **http://127.0.0.1:8000/dashboard/** and log in. The **Database** tab shows rows arriving live.

macOS or Linux: `./setup.sh`, `./start.sh`, `./demo.sh`.

## Demo logins

| What | Value |
|------|-------|
| Admin (dashboard, Swagger, serial menu) | `admin` / `Admin@CoCIS2026` |
| ESP32 device key | `esp32-demo-key-change-me` |
| RFID cards | `A1B2C3D4` Lisa Nyonyozi, `11223344` lecturer, `DEADBEEF` security, `CAFEBABE` visitor |
| Opening hours | Mon to Fri 07:00 to 22:00, Sat 08:00 to 17:00, Sun closed |

## Scripts

| Windows | macOS / Linux | Does |
|---------|---------------|------|
| `setup.bat` | `./setup.sh` | Installs the Python packages into `.venv` |
| `start.bat` | `./start.sh` | Starts the API, database and dashboard, opens the API docs |
| `demo.bat` | `./demo.sh` | Scripted demonstration with the virtual ESP32 |
| `simulate.bat` | `./simulate.sh` | Virtual ESP32 serial menu |
| `bridge.bat` | `./bridge.sh` | MQTT bridge for the group's entrance ESP32 |
| `entrance_sim.bat` | `./entrance_sim.sh` | Sends the entrance ESP32's MQTT messages, for testing the bridge |
| `test.bat` | `./test.sh` | Runs the 22 automated tests |
| `reset_db.bat` | delete `data/cocis.db` | Fresh database with demo data |

## Common problems

| Problem | Fix |
|---------|-----|
| Python not found | Reinstall with "Add python.exe to PATH" ticked, then open a new window |
| Copied from another computer | Just run `setup.bat` again; it rebuilds `.venv` |
| Port 8000 already in use | `start.bat --port 8001`, then use that port in the links |
| Page cannot be reached | Keep the `start.bat` window open; use `http://127.0.0.1:8000` |
| Scans refused with `OUTSIDE_SCHEDULE` | Use a weekday time (the building is closed on Sundays) |

More fixes are in each app's guide.
