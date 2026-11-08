"""Endpoints called by the ESP32 controller (authenticated with X-Device-Key)."""
from fastapi import APIRouter, Depends, HTTPException

from . import access_logic as logic
from .db import get_db, get_setting, now_iso, write_tx
from .schemas import AccessCheck, EventBatch, Heartbeat, RoomStatus
from .security import require_device

router = APIRouter(prefix="/api/v1/device", tags=["Device (ESP32)"])


def ts(dt) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


@router.post("/access/check")
def access_check(body: AccessCheck, device=Depends(require_device), conn=Depends(get_db)):
    """Online path: the ESP32 sends a scan, the server decides, records it and
    answers in one transaction. The ESP32 opens the door only on GRANTED."""
    with write_tx(conn):
        prior = logic.existing_event(conn, body.event_uuid)
        if prior:  # ESP32 retried after a timeout: return the original answer
            return {"decision": prior["decision"], "reason": prior["reason"],
                    "event_id": prior["id"], "duplicate": True}
        decision, reason, user = logic.decide(conn, body.rfid_uid, body.door, body.occurred_at)
        event_id = logic.record_access(
            conn, event_uuid=body.event_uuid, rfid_uid=body.rfid_uid, door=body.door,
            decision=decision, reason=reason, user=user, occurred_at=ts(body.occurred_at), source="ONLINE")
        inside = conn.execute("SELECT COUNT(*) FROM v_people_inside").fetchone()[0]
    return {
        "decision": decision,
        "reason": reason,
        "event_id": event_id,
        "user": {"id": user["id"], "full_name": user["full_name"], "role": user["role"]} if user else None,
        "people_inside": inside,
        "duplicate": False,
    }


@router.post("/rooms/status")
def room_status(body: RoomStatus, device=Depends(require_device), conn=Depends(get_db)):
    """A person crossed a lecture-room doorway (IR beams), or the lights changed."""
    room = conn.execute("SELECT * FROM rooms WHERE code = ?", (body.room_code,)).fetchone()
    if not room:
        raise HTTPException(404, "Unknown room")
    with write_tx(conn):
        stored = logic.apply_room_status(
            conn, event_uuid=body.event_uuid, room=room, occupant_count=body.occupant_count,
            light_on=body.light_on, trigger=body.trigger, occurred_at=ts(body.occurred_at))
    return {"stored": stored, "duplicate": not stored}


@router.post("/events/batch")
def upload_batch(body: EventBatch, device=Depends(require_device), conn=Depends(get_db)):
    """Offline path: records queued on the SD card while Wi-Fi was down.
    The decision was already made by the ESP32, so we store it as-is.
    Duplicate event_uuids are skipped, so re-sending a batch is always safe."""
    return store_decided_events(conn, body, "OFFLINE_SYNC")


@router.post("/relay")
def relay(body: EventBatch, device=Depends(require_device), conn=Depends(get_db)):
    """MQTT path: events from a controller that decides on its own and publishes to an
    MQTT broker (the entrance ESP32), forwarded live by bridge/mqtt_bridge.py.
    Stored like a batch, with source MQTT; duplicates are skipped the same way."""
    return store_decided_events(conn, body, "MQTT")


def store_decided_events(conn, body: EventBatch, source: str) -> dict:
    """Store events whose decision a controller has already made."""
    accepted, duplicates = [], []
    with write_tx(conn):
        for ev in sorted(body.access_events, key=lambda e: e.occurred_at):
            if logic.existing_event(conn, ev.event_uuid):
                duplicates.append(ev.event_uuid)
                continue
            user = conn.execute("SELECT * FROM users WHERE rfid_uid = ?", (ev.rfid_uid,)).fetchone()
            logic.record_access(
                conn, event_uuid=ev.event_uuid, rfid_uid=ev.rfid_uid, door=ev.door,
                decision=ev.decision, reason=ev.reason, user=user,
                occurred_at=ts(ev.occurred_at), source=source)
            accepted.append(ev.event_uuid)
        for ev in sorted(body.room_events, key=lambda e: e.occurred_at):
            room = conn.execute("SELECT * FROM rooms WHERE code = ?", (ev.room_code,)).fetchone()
            ok = logic.apply_room_status(
                conn, event_uuid=ev.event_uuid, room=room, occupant_count=ev.occupant_count,
                light_on=ev.light_on, trigger=ev.trigger, occurred_at=ts(ev.occurred_at))
            (accepted if ok else duplicates).append(ev.event_uuid)
    # The ESP32 deletes from its SD queue every uuid in accepted + duplicates.
    return {"accepted": accepted, "duplicates": duplicates}


@router.get("/config")
def device_config(device=Depends(require_device), conn=Depends(get_db)):
    """Everything the ESP32 caches on its SD card to decide offline."""
    schedule = [dict(r) for r in conn.execute(
        "SELECT day_of_week, is_open, open_time, close_time FROM access_schedule ORDER BY day_of_week")]
    users = [dict(r) for r in conn.execute(
        "SELECT rfid_uid, full_name, role FROM users WHERE is_active = 1 ORDER BY rfid_uid")]
    inside = [r["rfid_uid"] for r in conn.execute("SELECT rfid_uid FROM v_people_inside")]
    rooms = {r["code"]: r["light_mode"] for r in conn.execute(
        "SELECT code, light_mode FROM rooms WHERE room_type = 'LECTURE_ROOM'")}
    return {
        "config_version": int(get_setting(conn, "config_version")),
        "server_time": now_iso(),
        "timezone": get_setting(conn, "timezone"),
        "emergency_mode": get_setting(conn, "emergency_mode") == "true",
        "light_off_delay_s": int(get_setting(conn, "light_off_delay_s")),
        "heartbeat_interval_s": int(get_setting(conn, "heartbeat_interval_s")),
        "schedule": schedule,
        "room_light_modes": rooms,
        "authorised_tags": users,
        "currently_inside": inside,
    }


@router.post("/heartbeat")
def heartbeat(body: Heartbeat, device=Depends(require_device), conn=Depends(get_db)):
    """Periodic 'I am alive'. Reply tells the ESP32 whether to re-download config."""
    conn.execute(
        "UPDATE devices SET firmware_version = ?, ip_address = ?, free_heap = ?, sd_free_kb = ?, "
        "pending_events = ?, last_seen_at = ? WHERE id = ?",
        (body.firmware_version, body.ip_address, body.free_heap, body.sd_free_kb,
         body.pending_events, now_iso(), device["id"]))
    return {
        "server_time": now_iso(),
        "config_version": int(get_setting(conn, "config_version")),
        "emergency_mode": get_setting(conn, "emergency_mode") == "true",
        "lockdown_mode": get_setting(conn, "lockdown_mode") == "true",
    }
