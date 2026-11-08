#!/usr/bin/env bash
# One-time setup on macOS or Linux: creates .venv and installs the packages.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python || true)
if [ -z "$PY" ] || ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "Python 3.10 or newer was not found. Install it from https://www.python.org/downloads/ and try again."
  exit 1
fi
# a .venv copied from Windows or another computer does not work here: rebuild it
if [ -d .venv ] && ! .venv/bin/python -c 'import sys' 2>/dev/null; then
  echo "The existing .venv was made on another computer. Rebuilding it..."
  rm -rf .venv
fi
[ -x .venv/bin/python ] || "$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip --disable-pip-version-check -q
.venv/bin/python -m pip install -r requirements.txt --disable-pip-version-check
echo "Setup finished. Now run ./start.sh to start the API."
