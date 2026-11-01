#!/usr/bin/env bash
# Runs the automated tests. They use a temporary database, never data/cocis.db.
cd "$(dirname "$0")"
exec .venv/bin/python -m pytest -q tests
