"""Core business rules: who may pass which door, and when.

The ESP32 runs the same rules locally (from the config it downloaded) when
it is offline, so the decision order here must match the firmware:

  1. Emergency mode on         -> GRANTED / EMERGENCY_OPEN
  2. Tag not registered        -> DENIED  / UNKNOWN_TAG
  3. User deactivated          -> DENIED  / INACTIVE_USER
  4. Outside today's schedule  -> DENIED  / OUTSIDE_SCHEDULE  (entry AND exit)
  5. ENTRY but already inside  -> DENIED  / ALREADY_INSIDE    (anti-passback)
     EXIT  but not inside      -> DENIED  / NOT_INSIDE
  6. Otherwise                 -> GRANTED / OK
"""
from datetime import datetime

from .db import get_setting


def day_of_week(dt: datetime) -> int:
    """0 = Sunday … 6 = Saturday, matching C's struct tm.tm_wday on the ESP32."""
    return (dt.weekday() + 1) % 7


def within_schedule(conn, at: datetime) -> bool:
    row = conn.execute(
        "SELECT is_open, open_time, close_time FROM access_schedule WHERE day_of_week = ?",
        (day_of_week(at),),
    ).fetchone()
    if not row or not row["is_open"]:
        return False
    hhmm = at.strftime("%H:%M")
    return row["open_time"] <= hhmm < row["close_time"]


def open_visit(conn, user_id: int):
    return conn.execute(
        "SELECT * FROM building_visits WHERE user_id = ? AND time_out IS NULL", (user_id,)
    ).fetchone()


def decide(conn, rfid_uid: str, door: str, at: datetime) -> tuple[str, str, dict | None]:
    """Return (decision, reason, user_row). Pure read; writes happen in record_access()."""
    user = conn.execute("SELECT * FROM users WHERE rfid_uid = ?", (rfid_uid,)).fetchone()
    if get_setting(conn, "emergency_mode") == "true":
        return "GRANTED", "EMERGENCY_OPEN", user
    if not user:
        return "DENIED", "UNKNOWN_TAG", None
    if not user["is_active"]:
        return "DENIED", "INACTIVE_USER", user
    if not within_schedule(conn, at):
        return "DENIED", "OUTSIDE_SCHEDULE", user
    inside = open_visit(conn, user["id"]) is not None
    if door == "ENTRY" and inside:
        return "DENIED", "ALREADY_INSIDE", user
    if door == "EXIT" and not inside:
        return "DENIED", "NOT_INSIDE", user
    return "GRANTED", "OK", user


def record_access(conn, *, event_uuid, rfid_uid, door, decision, reason, user, occurred_at, source):
    """Insert the event and keep building_visits in step. Must run inside write_tx()."""
    cur = conn.execute(
        "INSERT INTO access_events(event_uuid, rfid_uid, user_id, door, decision, reason, source, occurred_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (event_uuid, rfid_uid, user["id"] if user else None, door, decision, reason, source, occurred_at),
    )
    event_id = cur.lastrowid
    if decision != "GRANTED" or not user:
        return event_id

    visit = open_visit(conn, user["id"])
    if door == "ENTRY" and not visit:
        conn.execute(
            "INSERT INTO building_visits(user_id, entry_event_id, time_in) VALUES (?, ?, ?)",
            (user["id"], event_id, occurred_at),
        )
    elif door == "EXIT" and visit:
        conn.execute(
            "UPDATE building_visits SET exit_event_id = ?, time_out = ? WHERE id = ?",
            (event_id, occurred_at, visit["id"]),
        )
    return event_id


def existing_event(conn, event_uuid: str):
    return conn.execute("SELECT * FROM access_events WHERE event_uuid = ?", (event_uuid,)).fetchone()


def apply_room_status(conn, *, event_uuid, room, occupant_count, light_on, trigger, occurred_at) -> bool:
    """Log a room change reported by the IR beam counter; update the room's live state only if this report is
    newer than what we already hold (offline uploads can arrive out of order).
    Returns False if the event_uuid was already stored."""
    is_occupied = int(occupant_count > 0)
    if conn.execute("SELECT 1 FROM room_status_logs WHERE event_uuid = ?", (event_uuid,)).fetchone():
        return False
    conn.execute(
        "INSERT INTO room_status_logs(event_uuid, room_id, occupant_count, is_occupied, light_on, trigger, occurred_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (event_uuid, room["id"], occupant_count, is_occupied, int(light_on), trigger, occurred_at),
    )
    conn.execute(
        "UPDATE rooms SET occupant_count = ?, is_occupied = ?, light_on = ?, updated_at = ?, "
        "last_activity_at = CASE WHEN ? IN ('PERSON_IN','PERSON_OUT') THEN ? ELSE last_activity_at END "
        "WHERE id = ? AND (updated_at IS NULL OR updated_at <= ?)",
        (occupant_count, is_occupied, int(light_on), occurred_at, trigger, occurred_at, room["id"], occurred_at),
    )
    return True
