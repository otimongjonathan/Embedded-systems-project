#!/usr/bin/env bash
# MQTT bridge: stores the entrance ESP32's messages in the database (./start.sh must be running).
cd "$(dirname "$0")"
.venv/bin/python -c "import paho.mqtt" 2>/dev/null || ./setup.sh || exit 1
exec .venv/bin/python bridge/mqtt_bridge.py "$@"
