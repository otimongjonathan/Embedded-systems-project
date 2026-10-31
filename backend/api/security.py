"""Authentication for the two kinds of API client.

* ESP32 controller -> header  X-Device-Key: <key>
* Management users -> header  Authorization: Bearer <token>  (from /auth/login)
"""
from datetime import datetime

from fastapi import Depends, Header, HTTPException, status

from .db import get_db, now_iso, sha256

ROLE_RANK = {"VIEWER": 1, "SECURITY": 2, "SUPER_ADMIN": 3}


def require_device(x_device_key: str = Header(..., alias="X-Device-Key"), conn=Depends(get_db)):
    device = conn.execute(
        "SELECT * FROM devices WHERE api_key_hash = ?", (sha256(x_device_key),)
    ).fetchone()
    if not device:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid device key")
    conn.execute("UPDATE devices SET last_seen_at = ? WHERE id = ?", (now_iso(), device["id"]))
    return dict(device)


def current_admin(authorization: str = Header(None), conn=Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    row = conn.execute(
        "SELECT a.*, s.expires_at FROM admin_sessions s JOIN admins a ON a.id = s.admin_id "
        "WHERE s.token_hash = ?",
        (sha256(token),),
    ).fetchone()
    if not row or not row["is_active"] or row["expires_at"] < datetime.now().isoformat():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    admin = dict(row)
    admin.pop("password_hash")
    admin["token_hash"] = sha256(token)
    return admin


def require_role(minimum: str):
    """Dependency factory: require_role('SECURITY') allows SECURITY and SUPER_ADMIN."""
    def checker(admin=Depends(current_admin)):
        if ROLE_RANK[admin["role"]] < ROLE_RANK[minimum]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role {minimum} or higher")
        return admin
    return checker
