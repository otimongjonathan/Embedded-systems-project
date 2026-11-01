#!/usr/bin/env bash
# Starts the API (the database is created on the first run) and opens the docs.
# Options: ./start.sh --port 8001   ./start.sh --lan   ./start.sh --no-browser
cd "$(dirname "$0")"
.venv/bin/python -c 'import uvicorn, multipart' 2>/dev/null || ./setup.sh || exit 1
exec .venv/bin/python run.py "$@"
