"""Endpoints for management (dashboard, Postman, or the ESP32 serial menu
forwarding an administrator's login). Authenticated with a bearer token."""
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from .db import (audit, bump_config_version, get_db, get_setting, now_iso, set_setting,
                 sha256, verify_password, write_tx)
from .schemas import (EmergencyUpdate, LightMode, Login, ScheduleUpdate, SettingsUpdate,
                      UserCreate, UserUpdate)
from .security import current_admin, require_role

router = APIRouter(prefix="/api/v1")
SESSION_HOURS = 8


# ======================= AUTH ==============================================

@router.post("/auth/login", tags=["Auth"])
def login(body: Login, conn=Depends(get_db)):
    admin = conn.execute("SELECT * FROM admins WHERE username = ?", (body.username,)).fetchone()
    if not admin or not admin["is_active"] or not verify_password(body.password, admin["password_hash"]):
        with write_tx(conn):
            audit(conn, "SYSTEM", None, "LOGIN_FAILED", {"username": body.username})
        raise HTTPException(401, "Wrong username or password")
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(hours=SESSION_HOURS)).isoformat(timespec="seconds")
    with write_tx(conn):
        conn.execute("INSERT INTO admin_sessions(token_hash, admin_id, expires_at) VALUES (?, ?, ?)",
                     (sha256(token), admin["id"], expires))
        audit(conn, "ADMIN", admin["id"], "LOGIN")
    return {"access_token": token, "token_type": "bearer", "expires_at": expires,
            "role": admin["role"], "full_name": admin["full_name"]}


@router.post("/auth/logout", tags=["Auth"])
def logout(admin=Depends(current_admin), conn=Depends(get_db)):
    conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (admin["token_hash"],))
    return {"logged_out": True}


@router.get("/auth/me", tags=["Auth"])
def me(admin=Depends(current_admin)):
    return {k: admin[k] for k in ("id", "username", "full_name", "role")}


# ======================= USERS (RFID tag holders) ==========================

@router.get("/users", tags=["Users"])
def list_users(q: Optional[str] = None, role: Optional[str] = None, active: Optional[bool] = None,
               admin=Depends(current_admin), conn=Depends(get_db)):
    sql, args = "SELECT * FROM users WHERE 1=1", []
    if q:
        sql += " AND (full_name LIKE ? OR reg_number LIKE ? OR rfid_uid LIKE ?)"
        args += [f"%{q}%"] * 3
    if role:
        sql += " AND role = ?"; args.append(role)
    if active is not None:
        sql += " AND is_active = ?"; args.append(int(active))
    return [dict(r) for r in conn.execute(sql + " ORDER BY full_name", args)]


@router.get("/users/{user_id}", tags=["Users"])
def get_user(user_id: int, admin=Depends(current_admin), conn=Depends(get_db)):
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        raise HTTPException(404, "User not found")
    visit = conn.execute("SELECT time_in FROM building_visits WHERE user_id = ? AND time_out IS NULL",
                         (user_id,)).fetchone()
    return {**dict(user), "is_inside": visit is not None, "inside_since": visit["time_in"] if visit else None}


@router.post("/users", status_code=201, tags=["Users"])
def create_user(body: UserCreate, admin=Depends(require_role("SUPER_ADMIN")), conn=Depends(get_db)):
    try:
        with write_tx(conn):
            cur = conn.execute(
                "INSERT INTO users(rfid_uid, full_name, reg_number, email, phone, role, department) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (body.rfid_uid, body.full_name, body.reg_number, body.email, body.phone, body.role, body.department))
            bump_config_version(conn)
            audit(conn, "ADMIN", admin["id"], "USER_CREATE", body.model_dump())
    except sqlite3.IntegrityError:
        raise HTTPException(409, "RFID tag or registration number already registered")
    return get_user(cur.lastrowid, admin, conn)


@router.patch("/users/{user_id}", tags=["Users"])
def update_user(user_id: int, body: UserUpdate, admin=Depends(require_role("SUPER_ADMIN")),
                conn=Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "Nothing to update")
    if "is_active" in changes:
        changes["is_active"] = int(changes["is_active"])
    sets = ", ".join(f"{k} = ?" for k in changes)
    try:
        with write_tx(conn):
            cur = conn.execute(f"UPDATE users SET {sets}, updated_at = ? WHERE id = ?",
                               [*changes.values(), now_iso(), user_id])
            if cur.rowcount == 0:
                raise HTTPException(404, "User not found")
            bump_config_version(conn)
            audit(conn, "ADMIN", admin["id"], "USER_UPDATE", {"user_id": user_id, **changes})
    except sqlite3.IntegrityError:
        raise HTTPException(409, "RFID tag or registration number already registered")
    return get_user(user_id, admin, conn)


@router.delete("/users/{user_id}", tags=["Users"])
def deactivate_user(user_id: int, admin=Depends(require_role("SUPER_ADMIN")), conn=Depends(get_db)):
    """Soft delete: the tag stops working but history is kept for the records."""
    return update_user(user_id, UserUpdate(is_active=False), admin, conn)


# ======================= OCCUPANCY & LOGS ==================================

@router.get("/occupancy", tags=["Occupancy"])
def occupancy(admin=Depends(current_admin), conn=Depends(get_db)):
    people = [dict(r) for r in conn.execute("SELECT * FROM v_people_inside ORDER BY time_in")]
    rooms = [dict(r) for r in conn.execute(
        "SELECT code, name, occupant_count, is_occupied, light_on, light_mode, last_activity_at, updated_at "
        "FROM rooms WHERE room_type = 'LECTURE_ROOM' ORDER BY code")]
    return {"people_inside_count": len(people), "people_inside": people, "rooms": rooms,
            "emergency_mode": get_setting(conn, "emergency_mode") == "true", "as_of": now_iso()}


@router.get("/access-events", tags=["Occupancy"])
def access_events(date_from: Optional[date] = Query(None, alias="from"),
                  date_to: Optional[date] = Query(None, alias="to"),
                  door: Optional[str] = None, decision: Optional[str] = None,
                  user_id: Optional[int] = None, limit: int = Query(50, le=500), offset: int = 0,
                  admin=Depends(current_admin), conn=Depends(get_db)):
    sql = ("SELECT e.*, u.full_name FROM access_events e LEFT JOIN users u ON u.id = e.user_id "
           "WHERE 1=1")
    args = []
    if date_from:
        sql += " AND e.occurred_at >= ?"; args.append(date_from.isoformat())
    if date_to:
        sql += " AND e.occurred_at < ?"; args.append((date_to + timedelta(days=1)).isoformat())
    for col, val in (("door", door), ("decision", decision), ("user_id", user_id)):
        if val is not None:
            sql += f" AND e.{col} = ?"; args.append(val)
    total = conn.execute(f"SELECT COUNT(*) FROM ({sql})", args).fetchone()[0]
    rows = conn.execute(sql + " ORDER BY e.occurred_at DESC LIMIT ? OFFSET ?", [*args, limit, offset])
    return {"total": total, "limit": limit, "offset": offset, "items": [dict(r) for r in rows]}


@router.get("/visits", tags=["Occupancy"])
def visits(on: Optional[date] = Query(None, alias="date"), user_id: Optional[int] = None,
           admin=Depends(current_admin), conn=Depends(get_db)):
    sql = ("SELECT v.id, v.user_id, u.full_name, u.rfid_uid, v.visit_date, v.time_in, v.time_out "
           "FROM building_visits v JOIN users u ON u.id = v.user_id WHERE 1=1")
    args = []
    if on:
        sql += " AND v.visit_date = ?"; args.append(on.isoformat())
    if user_id:
        sql += " AND v.user_id = ?"; args.append(user_id)
    return [dict(r) for r in conn.execute(sql + " ORDER BY v.time_in DESC LIMIT 500", args)]


# ======================= ROOMS & LIGHTING ==================================

@router.get("/rooms", tags=["Rooms & Lighting"])
def rooms(admin=Depends(current_admin), conn=Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM rooms ORDER BY id")]


@router.get("/rooms/{code}/history", tags=["Rooms & Lighting"])
def room_history(code: str, on: Optional[date] = Query(None, alias="date"),
                 admin=Depends(current_admin), conn=Depends(get_db)):
    on = on or date.today()
    rows = conn.execute(
        "SELECT l.occupant_count, l.is_occupied, l.light_on, l.trigger, l.occurred_at FROM room_status_logs l "
        "JOIN rooms r ON r.id = l.room_id WHERE r.code = ? AND substr(l.occurred_at,1,10) = ? "
        "ORDER BY l.occurred_at", (code.upper(), on.isoformat()))
    return [dict(r) for r in rows]


@router.put("/rooms/{code}/light-mode", tags=["Rooms & Lighting"])
def set_light_mode(code: str, body: LightMode, admin=Depends(require_role("SECURITY")),
                   conn=Depends(get_db)):
    """Manual override, e.g. force LR1 lights off during a power-saving period.
    AUTO returns control to the IR beam occupancy counter. The ESP32 picks this up on its next config pull."""
    with write_tx(conn):
        cur = conn.execute("UPDATE rooms SET light_mode = ? WHERE code = ? AND room_type = 'LECTURE_ROOM'",
                           (body.mode, code.upper()))
        if cur.rowcount == 0:
            raise HTTPException(404, "Unknown lecture room")
        version = bump_config_version(conn)
        audit(conn, "ADMIN", admin["id"], "LIGHT_MODE", {"room": code.upper(), "mode": body.mode})
    return {"room": code.upper(), "light_mode": body.mode, "config_version": version}


# ======================= SCHEDULE & SETTINGS ===============================

@router.get("/schedule", tags=["Schedule & Settings"])
def get_schedule(admin=Depends(current_admin), conn=Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM access_schedule ORDER BY day_of_week")]


@router.put("/schedule", tags=["Schedule & Settings"])
def put_schedule(body: ScheduleUpdate, admin=Depends(require_role("SUPER_ADMIN")), conn=Depends(get_db)):
    for d in body.days:
        if d.open_time >= d.close_time:
            raise HTTPException(422, f"Day {d.day_of_week}: open_time must be before close_time")
    with write_tx(conn):
        for d in body.days:
            conn.execute(
                "UPDATE access_schedule SET is_open = ?, open_time = ?, close_time = ?, updated_by = ?, "
                "updated_at = ? WHERE day_of_week = ?",
                (int(d.is_open), d.open_time, d.close_time, admin["id"], now_iso(), d.day_of_week))
        version = bump_config_version(conn)
        audit(conn, "ADMIN", admin["id"], "SCHEDULE_UPDATE", body.model_dump())
    return {"schedule": get_schedule(admin, conn), "config_version": version}


@router.get("/settings", tags=["Schedule & Settings"])
def get_settings(admin=Depends(current_admin), conn=Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM system_settings ORDER BY key")]


@router.patch("/settings", tags=["Schedule & Settings"])
def patch_settings(body: SettingsUpdate, admin=Depends(require_role("SUPER_ADMIN")), conn=Depends(get_db)):
    changes = body.model_dump(exclude_none=True)
    with write_tx(conn):
        for key, value in changes.items():
            set_setting(conn, key, str(value))
        bump_config_version(conn)
        audit(conn, "ADMIN", admin["id"], "SETTINGS_UPDATE", changes)
    return get_settings(admin, conn)


@router.put("/settings/emergency", tags=["Schedule & Settings"])
def emergency(body: EmergencyUpdate, admin=Depends(require_role("SECURITY")), conn=Depends(get_db)):
    """Fire / evacuation: unlock every door regardless of schedule."""
    with write_tx(conn):
        set_setting(conn, "emergency_mode", "true" if body.enabled else "false")
        version = bump_config_version(conn)
        audit(conn, "ADMIN", admin["id"], "EMERGENCY_ON" if body.enabled else "EMERGENCY_OFF",
              {"reason": body.reason})
    return {"emergency_mode": body.enabled, "config_version": version}


# ======================= REPORTS & ADMINISTRATION ==========================

@router.get("/reports/daily", tags=["Reports"])
def daily_report(on: Optional[date] = Query(None, alias="date"),
                 admin=Depends(current_admin), conn=Depends(get_db)):
    day = (on or date.today()).isoformat()
    totals = conn.execute("SELECT * FROM v_daily_access_summary WHERE day = ?", (day,)).fetchone()
    denied = {r["reason"]: r["n"] for r in conn.execute(
        "SELECT reason, COUNT(*) n FROM access_events WHERE decision='DENIED' "
        "AND substr(occurred_at,1,10) = ? GROUP BY reason", (day,))}
    unique_visitors = conn.execute(
        "SELECT COUNT(DISTINCT user_id) FROM building_visits WHERE visit_date = ?", (day,)).fetchone()[0]
    return {
        "date": day,
        "entries": totals["entries"] if totals else 0,
        "exits": totals["exits"] if totals else 0,
        "denied": totals["denied"] if totals else 0,
        "denied_by_reason": denied,
        "unique_visitors": unique_visitors,
        "peak_occupancy": _peak_occupancy(conn, day),
        "lighting": _lighting_usage(conn, day),
    }


def _peak_occupancy(conn, day: str) -> dict:
    """Sweep through the day's entries (+1) and exits (-1) in time order."""
    start = conn.execute(
        "SELECT COUNT(*) FROM building_visits WHERE time_in < ? AND (time_out IS NULL OR time_out >= ?)",
        (day, day)).fetchone()[0]
    moves = conn.execute(
        "SELECT occurred_at, CASE door WHEN 'ENTRY' THEN 1 ELSE -1 END AS d FROM access_events "
        "WHERE decision = 'GRANTED' AND user_id IS NOT NULL AND substr(occurred_at,1,10) = ? "
        "ORDER BY occurred_at", (day,))
    current, peak, peak_at = start, start, None
    for m in moves:
        current += m["d"]
        if current > peak:
            peak, peak_at = current, m["occurred_at"]
    return {"count": peak, "at": peak_at}


def _lighting_usage(conn, day: str) -> list[dict]:
    """Hours each room's lights were on, and the energy that used (kWh)."""
    out = []
    day_start = datetime.fromisoformat(day)
    day_end = min(day_start + timedelta(days=1), datetime.now())
    for room in conn.execute("SELECT id, code, light_watts FROM rooms WHERE room_type='LECTURE_ROOM'"):
        before = conn.execute(
            "SELECT light_on FROM room_status_logs WHERE room_id = ? AND occurred_at < ? "
            "ORDER BY occurred_at DESC LIMIT 1", (room["id"], day)).fetchone()
        on_since = day_start if before and before["light_on"] else None
        seconds = 0.0
        for log in conn.execute(
                "SELECT light_on, occurred_at FROM room_status_logs WHERE room_id = ? "
                "AND substr(occurred_at,1,10) = ? ORDER BY occurred_at", (room["id"], day)):
            t = datetime.fromisoformat(log["occurred_at"])
            if log["light_on"] and on_since is None:
                on_since = t
            elif not log["light_on"] and on_since is not None:
                seconds += (t - on_since).total_seconds(); on_since = None
        if on_since is not None and day_end > on_since:
            seconds += (day_end - on_since).total_seconds()
        hours = seconds / 3600
        out.append({"room": room["code"], "lights_on_hours": round(hours, 2),
                    "energy_kwh": round(hours * room["light_watts"] / 1000, 3)})
    return out


@router.get("/devices", tags=["Reports"])
def devices(admin=Depends(current_admin), conn=Depends(get_db)):
    rows = conn.execute("SELECT id, device_code, firmware_version, ip_address, free_heap, sd_free_kb, "
                        "pending_events, last_seen_at FROM devices")
    out = []
    for r in rows:
        d = dict(r)
        seen = d["last_seen_at"]
        d["online"] = bool(seen) and datetime.now() - datetime.fromisoformat(seen) < timedelta(
            seconds=3 * int(get_setting(conn, "heartbeat_interval_s")))
        out.append(d)
    return out


@router.get("/audit-log", tags=["Reports"])
def audit_log(limit: int = Query(100, le=1000), admin=Depends(require_role("SUPER_ADMIN")),
              conn=Depends(get_db)):
    return [dict(r) for r in conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))]
