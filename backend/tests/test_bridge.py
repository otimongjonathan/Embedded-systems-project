"""The MQTT bridge: converting the entrance ESP32's messages, and storing them through /device/relay."""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("COCIS_DB", os.path.join(tempfile.mkdtemp(), "test.db"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import mqtt_bridge as bridge  # noqa: E402
from api.main import app  # noqa: E402

BRIDGE = {"X-Device-Key": "mqtt-bridge-key-change-me"}
TS = 1793635200          # 2026-11-02, a valid ESP32 clock


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        token = c.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin@CoCIS2026"}).json()["access_token"]
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


def test_firmware_results_are_mapped_faithfully():
    ok = bridge.access_to_api({"tag": "11223344", "dir": "IN", "result": "OK", "ts": TS})
    assert (ok["door"], ok["decision"], ok["reason"]) == ("ENTRY", "GRANTED", "OK")
    assert ok["event_uuid"] == f"MQ-11223344-IN-{TS}"            # stable, so a repeat is stored once
    late = bridge.access_to_api({"tag": "11223344", "dir": "OUT", "result": "OK_AFTER_HOURS", "ts": TS})
    assert (late["door"], late["decision"], late["reason"]) == ("EXIT", "GRANTED", "OK_AFTER_HOURS")
    for result, reason in [("DENIED_UNKNOWN", "UNKNOWN_TAG"), ("DENIED_SCHEDULE", "OUTSIDE_SCHEDULE"),
                           ("DENIED_ALREADY_IN", "ALREADY_INSIDE"), ("DENIED_NOT_IN", "NOT_INSIDE")]:
        ev = bridge.access_to_api({"tag": "deadbeef", "dir": "IN", "result": result, "ts": TS})
        assert (ev["decision"], ev["reason"], ev["rfid_uid"]) == ("DENIED", reason, "DEADBEEF")
    no_clock = bridge.access_to_api({"tag": "11223344", "dir": "IN", "result": "OK", "ts": 12})
    assert no_clock["occurred_at"][:4] != "1970"                   # ESP32 clock not set yet


def test_pir_rooms_are_stored_as_occupied_or_vacant():
    on = bridge.room_to_api(1, {"occupied": True, "lights": True, "ts": TS})
    assert (on["room_code"], on["occupant_count"], on["light_on"], on["trigger"]) == ("LR1", 1, True, "MOTION")
    off = bridge.room_to_api(2, {"occupied": False, "lights": False, "ts": TS + 5})
    assert (off["room_code"], off["occupant_count"], off["trigger"]) == ("LR2", 0, "NO_MOTION")


def test_relay_stores_mqtt_events_once(client):
    entry = bridge.access_to_api({"tag": "01020304", "dir": "IN", "result": "OK", "ts": TS})
    room = bridge.room_to_api(1, {"occupied": True, "lights": True, "ts": TS})
    r = client.post("/api/v1/device/relay", headers=BRIDGE, json={"access_events": [entry], "room_events": [room]})
    assert r.status_code == 200 and len(r.json()["accepted"]) == 2
    again = client.post("/api/v1/device/relay", headers=BRIDGE, json={"access_events": [entry], "room_events": [room]})
    assert again.json()["duplicates"] == [entry["event_uuid"], room["event_uuid"]]
    rows = client.get("/api/v1/db/access_events").json()
    stored = [dict(zip(rows["columns"], r)) for r in rows["rows"] if r[rows["columns"].index("event_uuid")] == entry["event_uuid"]]
    assert stored[0]["source"] == "MQTT"
    occ = client.get("/api/v1/occupancy").json()
    assert "01020304" in [p["rfid_uid"] for p in occ["people_inside"]]
    assert next(x for x in occ["rooms"] if x["code"] == "LR1")["light_on"] == 1


def test_lockdown_setting_reaches_the_bridge(client):
    assert client.put("/api/v1/settings/lockdown", json={"enabled": True, "reason": "Drill"}).status_code == 200
    beat = client.post("/api/v1/device/heartbeat", headers=BRIDGE, json={}).json()
    assert beat["lockdown_mode"] is True and client.get("/api/v1/occupancy").json()["lockdown_mode"] is True
    client.put("/api/v1/settings/lockdown", json={"enabled": False, "reason": "Drill over"})
    assert client.get("/api/v1/occupancy").json()["lockdown_mode"] is False
