# Database

SQLite, one file: `data/cocis.db`. The API creates it from these files on first start.

| File | Contents |
|------|----------|
| `schema.sql` | 11 tables, indexes, 2 views |
| `seed.sql` | 3 rooms, weekly schedule, settings, 4 demo users |

## Tables

| Table | Holds |
|-------|-------|
| `users` | RFID tag holders |
| `access_events` | Every scan, granted or denied; `source` is ONLINE, OFFLINE_SYNC or MQTT |
| `building_visits` | Time in and time out of each visit |
| `rooms` | Live state of MAIN, LR1, LR2 |
| `room_status_logs` | Every room count and light change (IR beams or PIR motion) |
| `access_schedule` | Opening hours per day |
| `system_settings` | Light delay, emergency mode, config version |
| `admins`, `admin_sessions` | Staff logins and tokens |
| `devices` | ESP32 controllers and their health |
| `audit_log` | Every staff action |

Views: `v_people_inside` (who is inside now), `v_daily_access_summary`.

## Look inside

| Tool | How |
|------|-----|
| DB Browser for SQLite | Open `data\cocis.db` (https://sqlitebrowser.org) |
| Command line | `.venv\Scripts\python -m sqlite3 data\cocis.db` |

```sql
SELECT * FROM v_people_inside;
SELECT code, occupant_count, light_on FROM rooms;
```

## Reset

Stop the API, then `reset_db.bat` (or delete `data/cocis.db`). The next start creates a fresh database.
To use another file: set `COCIS_DB` before starting.

Full design (ER diagram, data dictionary, rules): Chapter 6 of the report.
