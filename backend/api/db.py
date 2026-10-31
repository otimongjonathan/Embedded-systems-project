"""Database access: connection handling, initialisation and small helpers."""
import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("COCIS_DB", ROOT / "data" / "cocis.db"))
SCHEMA = ROOT / "database" / "schema.sql"
SEED = ROOT / "database" / "seed.sql"

# Demo credentials: change them before any real deployment.
DEFAULT_ADMIN = ("admin", "Admin@CoCIS2026", "System Administrator", "SUPER_ADMIN")
DEFAULT_DEVICE = ("ESP32-CTRL-01", "esp32-demo-key-change-me")


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def connect() -> sqlite3.Connection:
    # isolation_level=None: we open transactions ourselves with BEGIN IMMEDIATE
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


def get_db():
    """FastAPI dependency: one connection per request."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def write_tx(conn: sqlite3.Connection):
    """BEGIN IMMEDIATE takes SQLite's write lock up front, so two requests
    that touch the same user (e.g. a scan and an offline upload) run one
    after the other instead of interleaving, so there are no race conditions."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


# ---------- hashing ----------------------------------------------------

def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    _, iterations, salt_hex, digest_hex = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return secrets.compare_digest(digest.hex(), digest_hex)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ---------- small helpers ----------------------------------------------

def get_setting(conn, key: str) -> str | None:
    row = conn.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(conn, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO system_settings(key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, now_iso()),
    )


def bump_config_version(conn) -> int:
    """Called inside every transaction that changes something the ESP32 caches."""
    version = int(get_setting(conn, "config_version") or 0) + 1
    set_setting(conn, "config_version", str(version))
    return version


def audit(conn, actor_type: str, actor_id: int | None, action: str, details: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO audit_log(actor_type, actor_id, action, details) VALUES (?, ?, ?, ?)",
        (actor_type, actor_id, action, json.dumps(details) if details else None),
    )


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(SCHEMA.read_text())
        conn.executescript(SEED.read_text())
        username, password, full_name, role = DEFAULT_ADMIN
        if not conn.execute("SELECT 1 FROM admins WHERE username = ?", (username,)).fetchone():
            conn.execute(
                "INSERT INTO admins(username, full_name, password_hash, role) VALUES (?, ?, ?, ?)",
                (username, full_name, hash_password(password), role),
            )
        code, key = DEFAULT_DEVICE
        conn.execute(
            "INSERT OR IGNORE INTO devices(device_code, api_key_hash) VALUES (?, ?)",
            (code, sha256(key)),
        )
    finally:
        conn.close()
