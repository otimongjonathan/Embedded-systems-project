# Virtual ESP32

A Python copy of the controller: same menu, same access rules, same IR counting and light timer,
same SD outbox and same API calls. Use it to test the API and dashboard on any laptop.

## Run

Start the API first (`start.bat`), then:

| Windows | macOS / Linux | Does |
|---------|---------------|------|
| `demo.bat` | `./demo.sh` | Scripted demonstration of every feature |
| `simulate.bat` | `./simulate.sh` | Interactive serial menu (type `help`) |

## The demo

| Step | Shows |
|------|-------|
| 1 | Config download, status |
| 2 to 4 | Entry granted, anti-passback, unknown card |
| 5 | People walking in and out of LR1 |
| 6 | Wi-Fi lost: local decisions, events queued |
| 7 | Wi-Fi back: queue uploaded, no duplicates |
| 8 | Staff login, emergency mode |
| 9, 10 | Everyone leaves; lights off after 30 s |

If the building is closed now (evening or Sunday), the demo clock starts on a weekday at 09:00.

## Options

| Option | Example |
|--------|---------|
| `--time` | `simulate.bat --time 2026-10-30T09:00` |
| `--api` | `simulate.bat --api http://127.0.0.1:8001/api/v1` |
| `--pause` | `demo.bat --pause 2` (seconds between steps) |

Its SD card files go in `simulator/sd/`. Only the Python standard library is used.
