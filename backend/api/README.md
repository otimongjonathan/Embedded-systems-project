# REST API

FastAPI service between the ESP32 and the database. It also serves the dashboard.

## Run

| Windows | macOS / Linux |
|---------|---------------|
| `setup.bat` once, then `start.bat` | `./setup.sh` once, then `./start.sh` |

| Address | What |
|---------|------|
| http://127.0.0.1:8000/docs | Swagger UI: try every endpoint |
| http://127.0.0.1:8000/dashboard/ | Management dashboard |
| http://127.0.0.1:8000/api/v1/health | Health check |

Options: `start.bat --port 8001`, `--lan` (other devices may connect), `--no-browser`.

Swagger UI loads its page files from the internet (cdn.jsdelivr.net). The dashboard and the API itself work offline.

## Test in Swagger UI

1. Click **Authorize**.
2. **DeviceKey**: `esp32-demo-key-change-me`. **AdminLogin**: `admin` / `Admin@CoCIS2026`. Click Authorize for each.
3. Open `POST /api/v1/device/access/check`, **Try it out**, **Execute**: the answer is `GRANTED`.
4. Open `GET /api/v1/occupancy`: Lisa is inside.

Change `event_uuid` before sending the same scan again (a repeated one is treated as a duplicate).

## Endpoints

| Group | Endpoints | Login |
|-------|-----------|-------|
| Device (ESP32) | `access/check`, `rooms/status`, `events/batch`, `relay` (MQTT bridge), `config`, `heartbeat` | `X-Device-Key` |
| Auth | `auth/login`, `auth/token`, `auth/logout`, `auth/me` | none / token |
| Occupancy | `occupancy`, `access-events`, `visits` | any role |
| Rooms | `rooms`, `rooms/{code}/history`, `rooms/{code}/light-mode` | any / SECURITY |
| Schedule and settings | `schedule`, `settings`, `settings/emergency`, `settings/lockdown` | SUPER_ADMIN / SECURITY |
| Users | `users` (list, add, edit, deactivate) | SUPER_ADMIN to change |
| Reports | `reports/daily`, `devices`, `audit-log` | any / SUPER_ADMIN |
| Database viewer | `db/tables`, `db/{table}` (read-only, no secrets) | SUPER_ADMIN |

All paths start with `/api/v1/`. Full details: Swagger UI, `docs/openapi.json`, or Chapter 7 of the report.

## Files

| File | Purpose |
|------|---------|
| `main.py` | App, docs text, dashboard mount |
| `routes_device.py` | ESP32 endpoints, including `/device/relay` for the MQTT bridge |
| `routes_admin.py` | Staff endpoints and reports |
| `access_logic.py` | The six access rules, visits, room state |
| `security.py` | Device key, tokens, roles |
| `schemas.py` | Request validation with examples |
| `db.py` | Connections, transactions, password hashing |

## Tests

`test.bat` (or `./test.sh`): 22 tests, using a temporary database.
