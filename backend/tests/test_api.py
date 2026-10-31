import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest

os.environ["COCIS_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402

DEV = {"X-Device-Key": "esp32-demo-key-change-me"}
WED_9AM = "2026-10-28T09:00:00"     # Wednesday, inside 07:00-22:00
WED_11PM = "2026-10-28T23:00:00"    # outside schedule
SUN_NOON = "2026-11-01T12:00:00"    # Sunday, building closed
_n = 0


def uuid():
    global _n
    _n += 1
    return f"01-{_n:08d}"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        token = c.post("/api/v1/auth/login",
                       json={"username": "admin", "password": "Admin@CoCIS2026"}).json()["access_token"]
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


def scan(c, uid, door, at=WED_9AM, event_uuid=None):
    return c.post("/api/v1/device/access/check", headers=DEV, json={
        "event_uuid": event_uuid or uuid(), "rfid_uid": uid, "door": door, "occurred_at": at}).json()


def test_health(client):
    assert client.get("/api/v1/health").json()["status"] == "ok"


def test_device_key_required(client):
    r = client.post("/api/v1/device/access/check", headers={"X-Device-Key": "wrong"},
                    json={"event_uuid": uuid(), "rfid_uid": "A1B2C3D4", "door": "ENTRY", "occurred_at": WED_9AM})
    assert r.status_code == 401


def test_entry_exit_cycle_and_anti_passback(client):
    assert scan(client, "a1b2c3d4", "ENTRY")["decision"] == "GRANTED"            # lower case accepted
    assert scan(client, "A1B2C3D4", "ENTRY")["reason"] == "ALREADY_INSIDE"
    occ = client.get("/api/v1/occupancy").json()
    assert "Lisa Nyonyozi" in [p["full_name"] for p in occ["people_inside"]]
    assert scan(client, "A1B2C3D4", "EXIT", "2026-10-28T12:00:00")["decision"] == "GRANTED"
    assert scan(client, "A1B2C3D4", "EXIT", "2026-10-28T12:01:00")["reason"] == "NOT_INSIDE"


def test_unknown_tag_and_schedule(client):
    assert scan(client, "00000000", "ENTRY")["reason"] == "UNKNOWN_TAG"
    assert scan(client, "11223344", "ENTRY", WED_11PM)["reason"] == "OUTSIDE_SCHEDULE"
    assert scan(client, "11223344", "ENTRY", SUN_NOON)["reason"] == "OUTSIDE_SCHEDULE"


def test_cannot_exit_outside_schedule(client):
    assert scan(client, "DEADBEEF", "ENTRY", "2026-10-28T21:00:00")["decision"] == "GRANTED"
    assert scan(client, "DEADBEEF", "EXIT", WED_11PM)["reason"] == "OUTSIDE_SCHEDULE"
    assert scan(client, "DEADBEEF", "EXIT", "2026-10-28T21:30:00")["decision"] == "GRANTED"


def test_retry_is_idempotent(client):
    first = scan(client, "CAFEBABE", "ENTRY", event_uuid="01-retry-0001")
    again = scan(client, "CAFEBABE", "ENTRY", event_uuid="01-retry-0001")
    assert first["decision"] == "GRANTED" and again["duplicate"] is True
    scan(client, "CAFEBABE", "EXIT", "2026-10-28T10:00:00")


def test_concurrent_entries_create_one_visit(client):
    def go(i):
        return scan(client, "11223344", "ENTRY", "2026-10-28T13:00:00")["decision"]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(go, range(8)))
    assert results.count("GRANTED") == 1
    scan(client, "11223344", "EXIT", "2026-10-28T14:00:00")


def test_offline_batch_upload(client):
    batch = {
        "access_events": [
            {"event_uuid": "01-off-0002", "rfid_uid": "A1B2C3D4", "door": "EXIT",
             "occurred_at": "2026-10-28T16:00:00", "decision": "GRANTED", "reason": "OK"},
            {"event_uuid": "01-off-0001", "rfid_uid": "A1B2C3D4", "door": "ENTRY",
             "occurred_at": "2026-10-28T15:00:00", "decision": "GRANTED", "reason": "OK"},
        ],
        "room_events": [
            {"event_uuid": "01-room-0001", "room_code": "LR1", "occupant_count": 1, "light_on": True,
             "trigger": "PERSON_IN", "occurred_at": "2026-10-28T15:05:00"},
            {"event_uuid": "01-room-0002", "room_code": "LR1", "occupant_count": 0, "light_on": False,
             "trigger": "PERSON_OUT", "occurred_at": "2026-10-28T17:05:00"},
        ],
    }
    r = client.post("/api/v1/device/events/batch", headers=DEV, json=batch).json()
    assert len(r["accepted"]) == 4
    r = client.post("/api/v1/device/events/batch", headers=DEV, json=batch).json()
    assert len(r["duplicates"]) == 4                                    # re-upload is safe
    visits = client.get("/api/v1/visits", params={"date": "2026-10-28", "user_id": 1}).json()
    assert any(v["time_in"] == "2026-10-28T15:00:00" and v["time_out"] == "2026-10-28T16:00:00" for v in visits)
    report = client.get("/api/v1/reports/daily", params={"date": "2026-10-28"}).json()
    lr1 = next(x for x in report["lighting"] if x["room"] == "LR1")
    assert lr1["lights_on_hours"] == 2.0 and lr1["energy_kwh"] == 0.96
    assert report["peak_occupancy"]["count"] >= 1


def test_schedule_change_bumps_config(client):
    before = client.get("/api/v1/device/config", headers=DEV).json()["config_version"]
    r = client.put("/api/v1/schedule", json={"days": [
        {"day_of_week": 0, "is_open": True, "open_time": "09:00", "close_time": "13:00"}]})
    assert r.status_code == 200
    cfg = client.get("/api/v1/device/config", headers=DEV).json()
    assert cfg["config_version"] == before + 1
    assert cfg["schedule"][0]["is_open"] == 1
    bad = client.put("/api/v1/schedule", json={"days": [
        {"day_of_week": 1, "is_open": True, "open_time": "18:00", "close_time": "08:00"}]})
    assert bad.status_code == 422


def test_viewer_cannot_change_schedule(client):
    from api.db import connect, hash_password
    conn = connect()
    conn.execute("INSERT OR IGNORE INTO admins(username, full_name, password_hash, role) VALUES (?,?,?,?)",
                 ("viewer", "Viewer", hash_password("viewer-pass"), "VIEWER"))
    conn.commit()
    conn.close()
    token = client.post("/api/v1/auth/login", json={"username": "viewer", "password": "viewer-pass"}).json()
    r = client.put("/api/v1/schedule", headers={"Authorization": f"Bearer {token['access_token']}"},
                   json={"days": [{"day_of_week": 0, "is_open": False, "open_time": "09:00", "close_time": "13:00"}]})
    assert r.status_code == 403
    assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401


def test_user_crud_and_deactivation(client):
    r = client.post("/api/v1/users", json={"rfid_uid": "0badf00d", "full_name": "New Student", "role": "STUDENT"})
    assert r.status_code == 201
    uid = r.json()["id"]
    assert client.post("/api/v1/users", json={"rfid_uid": "0BADF00D", "full_name": "Dup"}).status_code == 409
    client.delete(f"/api/v1/users/{uid}")
    assert scan(client, "0BADF00D", "ENTRY")["reason"] == "INACTIVE_USER"


def test_emergency_mode_opens_doors(client):
    client.put("/api/v1/settings/emergency", json={"enabled": True, "reason": "Fire drill"})
    assert scan(client, "00000000", "EXIT", WED_11PM)["reason"] == "EMERGENCY_OPEN"
    client.put("/api/v1/settings/emergency", json={"enabled": False, "reason": "Drill over"})
    actions = [a["action"] for a in client.get("/api/v1/audit-log").json()]
    assert "EMERGENCY_ON" in actions and "EMERGENCY_OFF" in actions


def test_heartbeat_and_devices(client):
    r = client.post("/api/v1/device/heartbeat", headers=DEV,
                    json={"firmware_version": "1.0.0", "free_heap": 120000, "pending_events": 0}).json()
    assert "config_version" in r
    assert client.get("/api/v1/devices").json()[0]["online"] is True


def test_still_occupants_keep_lights_on(client):
    """IR beam counting: the room stays occupied while count > 0, however still people are."""
    def report(uuid_, count, light, trig, at):
        return client.post("/api/v1/device/rooms/status", headers=DEV, json={
            "event_uuid": uuid_, "room_code": "LR2", "occupant_count": count, "light_on": light,
            "trigger": trig, "occurred_at": at}).json()
    report("01-lr2-0001", 1, True, "PERSON_IN", "2026-10-29T09:00:00")
    report("01-lr2-0002", 2, True, "PERSON_IN", "2026-10-29T09:00:05")
    room = next(r for r in client.get("/api/v1/occupancy").json()["rooms"] if r["code"] == "LR2")
    assert room["occupant_count"] == 2 and room["is_occupied"] == 1 and room["light_on"] == 1
    report("01-lr2-0003", 1, True, "PERSON_OUT", "2026-10-29T11:00:00")
    report("01-lr2-0004", 0, False, "PERSON_OUT", "2026-10-29T11:00:30")
    room = next(r for r in client.get("/api/v1/occupancy").json()["rooms"] if r["code"] == "LR2")
    assert room["occupant_count"] == 0 and room["is_occupied"] == 0
    assert report("01-lr2-0004", 0, False, "PERSON_OUT", "2026-10-29T11:00:30")["duplicate"] is True
    bad = client.post("/api/v1/device/rooms/status", headers=DEV, json={
        "event_uuid": "01-lr2-0005", "room_code": "LR2", "occupant_count": -1, "light_on": False,
        "trigger": "PERSON_OUT", "occurred_at": "2026-10-29T11:01:00"})
    assert bad.status_code == 422
