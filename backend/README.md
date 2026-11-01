# CoCIS Smart Control and Monitoring System: Database and API

Embedded Systems coursework (BSE III and CS II, 2026/2027). This folder holds the
use cases, architecture, central database, REST API and the group report.

The ESP32 (in Wokwi) handles the doors, beams and lights. It sends every scan and
room change to this **REST API**, which stores them in a **SQLite database**.
Management uses the same API to see who is inside, read reports and change the schedule.

**Quick start on Windows:** install Python (section 1), double-click `setup.bat` once, then
double-click `start.bat`. The browser opens the API docs; log in with `admin` / `Admin@CoCIS2026`.

## Contents

1. [Install what is needed](#1-install-what-is-needed)
2. [Set up the project (once)](#2-set-up-the-project-once)
3. [Start the API and the database](#3-start-the-api-and-the-database)
4. [Test the API in the browser](#4-test-the-api-in-the-browser)
5. [Demo logins and data](#5-demo-logins-and-data)
6. [Working with the database](#6-working-with-the-database)
7. [Run the automated tests](#7-run-the-automated-tests)
8. [Connect the Wokwi ESP32](#8-connect-the-wokwi-esp32)
9. [Troubleshooting](#9-troubleshooting)
10. [Rebuild the report (optional)](#10-rebuild-the-report-optional)

## Folder layout

| Path | Contents |
|------|----------|
| `setup.bat`, `start.bat`, `test.bat`, `reset_db.bat` | Windows: install, start, test, reset the database (double-click them) |
| `setup.sh`, `start.sh`, `test.sh` | The same for macOS and Linux |
| `run.py` | Starts the API and opens the docs (used by both start scripts) |
| `requirements.txt` | The Python packages the API needs |
| `database/schema.sql` | All tables, indexes and views |
| `database/seed.sql` | Demo data: 3 rooms, the weekly schedule, settings, 4 demo users |
| `api/` | FastAPI REST API (device endpoints for the ESP32, management endpoints for staff) |
| `tests/test_api.py` | 15 automated tests |
| `data/cocis.db` | The database file (created automatically the first time the API starts) |
| `docs/CoCIS_Smart_System_Report.docx` | The group report (empty sections are marked "To be completed by") |
| `docs/openapi.json` | API specification, importable into Postman |
| `docs/diagrams/` | Use case, architecture, IR counter, ER and sequence diagrams (SVG and PNG, with generator scripts) |

## 1. Install what is needed

The only thing you must install is **Python 3.10 or newer**. Everything else is installed
by the setup script.

### Windows 10 or 11

1. Go to https://www.python.org/downloads/windows/ and download the latest
   **Windows installer (64-bit)** for Python 3.12 or 3.13.
2. Run it. On the first screen **tick "Add python.exe to PATH"** at the bottom, then click
   **Install Now**. (If the installer offers "Disable path length limit" at the end, click it.)
3. Check it worked: open a **new** Command Prompt or PowerShell window and run

   ```powershell
   py --version
   ```

   It should print `Python 3.12.x` or similar.

If `python` opens the Microsoft Store instead, open **Settings, Apps, Advanced app settings,
App execution aliases** and turn off the two entries for `python.exe` and `python3.exe`.
The setup script prefers the `py` launcher, so this usually does not matter.

### macOS

Install Python 3.10 or newer from https://www.python.org/downloads/macos/ (or `brew install python`).
Check with `python3 --version`.

### Optional tools

| Tool | Why | Where |
|------|-----|-------|
| DB Browser for SQLite | Look inside the database with a graphical window | https://sqlitebrowser.org/dl/ |
| Postman | Another way to call the API (import `docs/openapi.json`) | https://www.postman.com/downloads/ |
| VS Code with the Wokwi extension | Run the ESP32 simulation against this API on the same laptop | https://docs.wokwi.com/vscode/getting-started |

## 2. Set up the project (once)

**Windows:** double-click **`setup.bat`** in this folder. It finds Python, creates a private
package folder called `.venv`, and installs the packages from `requirements.txt` (internet needed,
about a minute). It ends with "Setup finished".

**macOS or Linux:** in a terminal in this folder run

```bash
./setup.sh
```

**Copied the project from another computer?** That is fine. The `.venv` folder only works on
the computer that made it, so the setup script notices a copied one and rebuilds it. If you copy
the folder yourself, you can leave `.venv` out.

<details>
<summary>Doing the same by hand (if you prefer typing the commands)</summary>

Windows, Command Prompt or PowerShell, from this folder:

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

macOS or Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

You do not need to "activate" the virtual environment; the commands above call its Python directly.
</details>

## 3. Start the API and the database

**Windows:** double-click **`start.bat`**. **macOS or Linux:** run `./start.sh`.

A window opens showing:

```text
================================================================
  API docs:  http://127.0.0.1:8000/docs
  Login:     admin / Admin@CoCIS2026   (Authorize button)
  Device:    esp32-demo-key-change-me
  Stop:      press Ctrl+C in this window
================================================================
```

and after two seconds the browser opens the docs page. Keep that window open while you use
the API; close it or press `Ctrl+C` to stop.

There is no separate database server to start. On the first start the API creates
`data/cocis.db` from `database/schema.sql` and fills it with `database/seed.sql`.

Options (Windows shown; on macOS use `./start.sh` with the same options):

| Command | Effect |
|---------|--------|
| `start.bat --port 8001` | Use another port if 8000 is busy |
| `start.bat --lan` | Accept connections from other devices on the network (Windows asks to allow it through the firewall: click Allow) |
| `start.bat --no-browser` | Do not open the browser |

To start it by hand instead: `.venv\Scripts\python run.py` (Windows) or `.venv/bin/python run.py`.

## 4. Test the API in the browser

The docs page (**http://127.0.0.1:8000/docs**) lists every endpoint and lets you call it.
The same instructions are shown at the top of that page.

1. Click **Authorize** (top right, padlock icon). A dialog with two sections opens.
2. **DeviceKey**: enter `esp32-demo-key-change-me` and click **Authorize**.
3. **AdminLogin**: enter username `admin` and password `Admin@CoCIS2026`, leave client_id and
   client_secret empty, and click **Authorize**. It should say "Authorized". Click **Close**.
4. Open **`POST /api/v1/device/access/check`**, click **Try it out**, then **Execute**.
   The example body is already filled in: Lisa Nyonyozi's tag `A1B2C3D4` at the ENTRY door
   on a weekday at 09:00. The answer is `"decision": "GRANTED"`.
5. Open **`GET /api/v1/occupancy`**, **Try it out**, **Execute**: Lisa is listed as inside.

More to try: `GET /api/v1/reports/daily` with date `2026-10-30`, `POST /api/v1/device/rooms/status`
(a lecture room count), `PUT /api/v1/settings/emergency`, `GET /api/v1/audit-log`.

Good to know:

- **Change `event_uuid`** each time you send another scan (for example `01-000124`). A repeated
  `event_uuid` is treated as the same event uploaded twice, and returns the first answer with
  `"duplicate": true`. This is how the ESP32 retries safely.
- Scans are checked against the opening hours, so keep `occurred_at` on a weekday between
  07:00 and 22:00. Sunday or 23:00 gives `OUTSIDE_SCHEDULE`.
- The login is remembered when you refresh the page, and lasts 8 hours.
- For Postman or the firmware, log in with `POST /api/v1/auth/login` (JSON body, example filled in)
  and send the token as `Authorization: Bearer <token>`.

## 5. Demo logins and data

Change these before any real use.

| What | Value |
|------|-------|
| Admin login (SUPER_ADMIN) | `admin` / `Admin@CoCIS2026` |
| ESP32 device key | `esp32-demo-key-change-me` (device `ESP32-CTRL-01`) |
| Demo RFID tags | `A1B2C3D4` Lisa Nyonyozi (student), `11223344` lecturer, `DEADBEEF` security, `CAFEBABE` visitor |
| Rooms | `MAIN` entrance, `LR1` and `LR2` lecture rooms |
| Opening hours | Monday to Friday 07:00 to 22:00, Saturday 08:00 to 17:00, Sunday closed |

## 6. Working with the database

The whole database is one file, `data/cocis.db`.

**Graphical (easiest on Windows):** open `data\cocis.db` in DB Browser for SQLite and use the
**Browse Data** tab. Close DB Browser before resetting the database.

**Command line:** Python 3.12 and newer include a SQLite shell:

```powershell
.venv\Scripts\python -m sqlite3 data\cocis.db
```

(macOS: `.venv/bin/python -m sqlite3 data/cocis.db`, or `sqlite3 data/cocis.db`.) Useful queries:

```sql
SELECT * FROM v_people_inside;              -- who is in the building now
SELECT * FROM access_events ORDER BY id DESC LIMIT 10;
SELECT code, occupant_count, light_on, light_mode FROM rooms;
SELECT * FROM v_daily_access_summary;
```

Type `.quit` to leave.

**Start again with a fresh database:** stop the API, then double-click **`reset_db.bat`**
(macOS: delete `data/cocis.db` and any `cocis.db-wal` and `cocis.db-shm` next to it). The next
start creates a new database with the demo data. This deletes all recorded data.

**Use a different database file:** set `COCIS_DB` before starting.
Windows PowerShell: `$env:COCIS_DB="C:\temp\test.db"; .venv\Scripts\python run.py`.
macOS: `COCIS_DB=/tmp/test.db .venv/bin/python run.py`.

The tables, columns and relationships are explained in Chapter 6 of the report.

## 7. Run the automated tests

**Windows:** double-click **`test.bat`**. **macOS or Linux:** `./test.sh`.

The tests use their own temporary database, so they never touch `data/cocis.db`, and they
can run while the API is running. Expected result: `15 passed` (a warning about `httpx` is harmless).

## 8. Connect the Wokwi ESP32

In Wokwi the ESP32 joins the open Wi-Fi network `Wokwi-GUEST` and cannot reach `localhost`. Either:

- **Wokwi extension for VS Code** (simplest): the simulated ESP32 reaches the laptop at
  `http://host.wokwi.internal:8000`. Start the API with `start.bat` first.
- **Wokwi in the browser:** expose the API with a tunnel such as ngrok
  (`ngrok http 8000`) or Cloudflare Tunnel, and use the tunnel's https address as the base URL
  in the firmware.

The firmware sends the header `X-Device-Key: esp32-demo-key-change-me` on every request. The
request and response formats are in Chapter 7 of the report and on the docs page.

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `setup.bat` says Python was not found | Install Python as in section 1 with "Add python.exe to PATH" ticked, then open a **new** window and try again |
| `'python' is not recognized` or the Microsoft Store opens | Use `py` instead of `python`, or turn off the App execution aliases (section 1) |
| `No module named fastapi` or `No module named uvicorn` | Run `setup.bat` again. Use `.venv\Scripts\python`, not plain `python` |
| `.venv\Scripts\python` not found after copying from a Mac | The Mac `.venv` does not work on Windows; `setup.bat` deletes and rebuilds it |
| `pip` errors such as `SSL`, `Could not find a version` or timeouts | Check the internet connection (pip downloads from pypi.org); on campus Wi-Fi with a proxy, try a phone hotspot |
| `running scripts is disabled on this system` | You tried `Activate.ps1`. It is not needed: use the `.bat` files or `.venv\Scripts\python` directly |
| `Port 8000 is already in use` | The API is already running in another window, or another program uses the port: close it, or `start.bat --port 8001` |
| Browser shows "This site can't be reached" | The start window must stay open. Use `http://127.0.0.1:8000/docs` (the address `0.0.0.0` does not work in a browser) |
| `database is locked` | Close DB Browser for SQLite. If the project is in a OneDrive folder (Desktop or Documents often are), move it to `C:\Projects\` so OneDrive does not lock the file |
| `401 Unauthorized` | Click **Authorize** and log in again (tokens last 8 hours), or check the device key |
| `403 Forbidden` | The logged-in role is not allowed to do this (only SUPER_ADMIN can change the schedule or users) |
| Scan always `OUTSIDE_SCHEDULE` | Use an `occurred_at` time inside the opening hours, for example a weekday at 09:00 |
| Scan returns `"duplicate": true` | Change `event_uuid` to a new value |
| `reset_db.bat` cannot delete the database | Stop the API and close DB Browser first |

## 10. Rebuild the report (optional)

Editing the .docx directly in Word is fine, and is the easiest way on Windows. To regenerate it
from source instead (macOS or Linux; this overwrites manual edits made in Word):

```bash
NODE_PATH=$(npm root -g) node docs/build_report.js && python3 docs/postprocess_report.py
```

This needs Node.js with the `docx` package, LibreOffice and Poppler. The post-processor stops
if an em or en dash appears in the text.
