#!/usr/bin/env bash
# Virtual ESP32 serial menu (./start.sh must be running).
cd "$(dirname "$0")"
exec .venv/bin/python simulator/virtual_esp32.py "$@"
