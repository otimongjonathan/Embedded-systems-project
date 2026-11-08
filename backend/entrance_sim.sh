#!/usr/bin/env bash
# Stand-in for the entrance ESP32: publishes the same MQTT messages as its firmware.
cd "$(dirname "$0")"
exec .venv/bin/python bridge/entrance_sim.py "$@"
