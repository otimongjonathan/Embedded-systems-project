# MQTT Bridge

Connects the group's entrance ESP32 (which speaks MQTT) to the REST API and database.
**No change to the firmware is needed.**

```text
Entrance ESP32 (Wokwi) --MQTT--> broker.hivemq.com --MQTT--> bridge --HTTP--> REST API --> SQLite --> dashboard
```

## Run

1. `start.bat` (API and database). Keep it open.
2. `bridge.bat` (this bridge). Keep it open.
3. Start the entrance firmware in Wokwi, or `entrance_sim.bat` to test without it.
4. Watch the dashboard: Overview and the Database tab.

macOS / Linux: `./start.sh`, `./bridge.sh`, `./entrance_sim.sh`.

## What it stores

| ESP32 publishes | Example | Bridge does | Ends up in |
|-----------------|---------|-------------|------------|
| `cocis/event/access` | `{"tag":"11223344","dir":"IN","result":"OK","ts":...}` | `POST /api/v1/device/relay` | `access_events` (source `MQTT`), `building_visits` |
| `cocis/state/room1`, `room2` | `{"occupied":true,"lights":true,"ts":...}` | `POST /api/v1/device/relay` | `room_status_logs`, `rooms` |
| `cocis/state/occupancy` | `{"count":2,"ts":...}` | Compares with the database | Printed only |
| `cocis/config/schedule` | `{"start":"07:00","end":"21:00",...}` | `PUT /api/v1/schedule` (all days) | `access_schedule` |
| Card authorised on the ESP32 | first GRANTED scan of an unknown card | `POST /api/v1/users` | `users` |

Every message also sends `POST /device/heartbeat`, so the dashboard shows `ESP32-MQTT-ENTRANCE` online.

Dashboard to ESP32: when `lockdown_mode` changes (`PUT /api/v1/settings/lockdown`), the bridge publishes
`LOCKDOWN` or `UNLOCK` to `cocis/cmd/entrance` (retained).

## Result codes

| ESP32 result | Stored as |
|--------------|-----------|
| `OK` | GRANTED, OK |
| `OK_AFTER_HOURS` | GRANTED, OK_AFTER_HOURS |
| `DENIED_UNKNOWN` | DENIED, UNKNOWN_TAG |
| `DENIED_SCHEDULE` | DENIED, OUTSIDE_SCHEDULE |
| `DENIED_ALREADY_IN` | DENIED, ALREADY_INSIDE |
| `DENIED_NOT_IN` | DENIED, NOT_INSIDE |

## Network

| Question | Answer |
|----------|--------|
| Same network as the ESP32? | No. Both connect out to the public broker over the internet |
| Port forwarding or tunnel? | Not needed for MQTT |
| Where is the database? | Only on the laptop; the bridge reaches the API on `127.0.0.1` |
| Internet needed? | Yes, on the laptop running the bridge |

## Safe by design

- Each scan gets a stable id (`MQ-<tag>-<IN|OUT>-<time>`), so a repeated message is stored once.
- Retained messages older than 10 minutes are ignored (left-overs from earlier runs).
- Before the ESP32 has the time from NTP, the bridge uses its own clock.

## Limits (firmware side, not changed)

- `broker.hivemq.com` is public: anyone using the same `cocis/...` topics (for example another group)
  is also stored. For a real deployment, change `MQTT_URI` in the firmware's `config.h` to a private broker.
- The firmware ignores `LOCKDOWN`: `comms.c` line 75 compares the topic with 19 characters, but
  `cocis/cmd/entrance` has 18. Changing both `19`s on that line to `18` makes lockdown work.
- PIR sensors detect motion, not people, so rooms are stored as 1 (occupied) or 0 (vacant).

## Options

`bridge.bat --broker <host> --port 1883 --api http://127.0.0.1:8000/api/v1`
