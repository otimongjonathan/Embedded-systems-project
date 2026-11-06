#!/usr/bin/env bash
# Scripted demonstration of every feature (./start.sh must be running).
cd "$(dirname "$0")"
exec .venv/bin/python simulator/virtual_esp32.py --demo "$@"
