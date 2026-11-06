"""End-to-end test: the virtual ESP32 (simulator/virtual_esp32.py) against a live API server.

Covers the device side of the system without hardware: online decisions, working
offline, the CRC-checked outbox, and a safe re-upload after reconnecting."""
import socket
import sys
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

import pytest
import uvicorn

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "simulator"))

import virtual_esp32  # noqa: E402

import api.db  # noqa: E402


@pytest.fixture(scope="module")
def live_api(tmp_path_factory, monkeypatch_module):
    """A real uvicorn server on a free port, with its own empty database."""
    monkeypatch_module.setattr(api.db, "DB_PATH", tmp_path_factory.mktemp("db") / "sim.db")
    monkeypatch_module.setattr(virtual_esp32, "SD", tmp_path_factory.mktemp("sd"))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config("api.main:app", host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}/api/v1"
    server.should_exit = True


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def occupancy(esp):
    esp.token = esp.call("POST", "/auth/login", {"username": "admin", "password": "Admin@CoCIS2026"})[1]["access_token"]
    return esp.call("GET", "/occupancy", admin=True)[1]


def test_virtual_esp32_online_offline_and_resync(live_api):
    esp = virtual_esp32.VirtualESP32(live_api, datetime(2026, 10, 28, 9, 0))   # a Wednesday morning
    assert esp.fetch_config()

    assert esp.tap("A1B2C3D4", True) == ("GRANTED", "OK")                       # decided by the API
    assert esp.tap("A1B2C3D4", True) == ("DENIED", "ALREADY_INSIDE")

    esp.offline = True                                                         # Wi-Fi lost
    assert esp.tap("11223344", True) == ("GRANTED", "OK")                       # decided locally
    assert esp.tap("0BADCAFE", True) == ("DENIED", "UNKNOWN_TAG")
    esp.person("LR1", +1)
    assert esp.queued() == 3                                                   # 2 scans + 1 room change
    saved = esp.outbox.read_text()

    esp.offline = False                                                        # reconnected
    esp.flush_outbox()
    assert esp.queued() == 0
    occ = occupancy(esp)
    assert {p["rfid_uid"] for p in occ["people_inside"]} == {"A1B2C3D4", "11223344"}
    assert next(r for r in occ["rooms"] if r["code"] == "LR1")["occupant_count"] == 1

    esp.outbox.write_text(saved + "R,damaged line,FFFFFFFF\n")                # same batch again, plus a torn line
    esp.flush_outbox()
    assert esp.queued() == 0
    assert occupancy(esp)["people_inside_count"] == 2                           # no duplicate visits
