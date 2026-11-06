-- =====================================================================
--  CoCIS Smart Control & Monitoring System: central database schema
--  Engine : SQLite 3 (single file: data/cocis.db)
--  Author : Lisa Nyonyozi (database & API)
--
--  One ESP32 controller (main entrance + Lecture Room 1 + Lecture Room 2)
--  talks to this database ONLY through the REST API. The SD card on the
--  ESP32 keeps a local copy of the same records (CSV) so the system keeps
--  working when Wi-Fi is down; queued records are uploaded later and the
--  UNIQUE event_uuid columns below stop them being stored twice.
-- =====================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;          -- readers never block the writer

-- ---------------------------------------------------------------------
-- 1. USERS: every person who owns an RFID tag
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    rfid_uid     TEXT    NOT NULL UNIQUE,              -- e.g. 'A1B2C3D4' (hex, upper case)
    full_name    TEXT    NOT NULL,
    reg_number   TEXT    UNIQUE,                       -- student/staff number
    email        TEXT,
    phone        TEXT,
    role         TEXT    NOT NULL DEFAULT 'STUDENT'
                 CHECK (role IN ('STUDENT','STAFF','LECTURER','SECURITY','VISITOR')),
    department   TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime')),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);

-- ---------------------------------------------------------------------
-- 2. ROOMS: the three controlled zones of the pilot
--    Holds the *current* state; history lives in room_status_logs.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rooms (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,           -- 'MAIN', 'LR1', 'LR2'
    name            TEXT    NOT NULL,
    room_type       TEXT    NOT NULL CHECK (room_type IN ('ENTRANCE','LECTURE_ROOM')),
    capacity        INTEGER,
    light_watts     INTEGER NOT NULL DEFAULT 0,        -- total lamp power, for energy report
    occupant_count  INTEGER NOT NULL DEFAULT 0 CHECK (occupant_count >= 0),  -- from IR beam counter
    is_occupied     INTEGER NOT NULL DEFAULT 0 CHECK (is_occupied IN (0,1)),
    light_on        INTEGER NOT NULL DEFAULT 0 CHECK (light_on IN (0,1)),
    light_mode      TEXT    NOT NULL DEFAULT 'AUTO'
                    CHECK (light_mode IN ('AUTO','FORCE_ON','FORCE_OFF')),
    last_activity_at TEXT,                             -- last time a beam was crossed
    updated_at      TEXT                               -- device time of the last reported change (NULL until first report)
);

-- ---------------------------------------------------------------------
-- 3. ACCESS_EVENTS: every RFID scan at the entrance, granted or denied
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_uuid   TEXT    NOT NULL UNIQUE,              -- generated on the ESP32; idempotency key
    rfid_uid     TEXT    NOT NULL,                     -- kept even if tag is unknown
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    door         TEXT    NOT NULL CHECK (door IN ('ENTRY','EXIT')),
    decision     TEXT    NOT NULL CHECK (decision IN ('GRANTED','DENIED')),
    reason       TEXT    NOT NULL
                 CHECK (reason IN ('OK','UNKNOWN_TAG','INACTIVE_USER','OUTSIDE_SCHEDULE',
                                   'ALREADY_INSIDE','NOT_INSIDE','EMERGENCY_OPEN',
                                   'OK_AFTER_HOURS')),                 -- exit after hours: MQTT entrance controller
    -- ONLINE: decided by this API; OFFLINE_SYNC: decided by the ESP32 while offline;
    -- MQTT: decided by an MQTT controller and relayed by the bridge
    source       TEXT    NOT NULL DEFAULT 'ONLINE' CHECK (source IN ('ONLINE','OFFLINE_SYNC','MQTT')),
    occurred_at  TEXT    NOT NULL,                     -- time on the ESP32 clock (NTP)
    received_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_access_events_time ON access_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_access_events_user ON access_events(user_id, occurred_at);

-- ---------------------------------------------------------------------
-- 4. BUILDING_VISITS: one row per stay inside the building
--    time_out IS NULL  ==> the person is inside right now.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS building_visits (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_event_id   INTEGER NOT NULL REFERENCES access_events(id),
    exit_event_id    INTEGER REFERENCES access_events(id),
    time_in          TEXT    NOT NULL,
    time_out         TEXT,
    visit_date       TEXT    GENERATED ALWAYS AS (substr(time_in,1,10)) VIRTUAL
);
-- Synchronisation guard: a user can never have two open visits at once,
-- even if two requests race each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_visit
    ON building_visits(user_id) WHERE time_out IS NULL;
CREATE INDEX IF NOT EXISTS idx_visits_date ON building_visits(visit_date);

-- ---------------------------------------------------------------------
-- 5. ROOM_STATUS_LOGS: history of occupancy / light changes per room
--    Occupancy comes from a pair of infrared break-beams at each room door:
--    beam A then B = PERSON_IN, beam B then A = PERSON_OUT.
--    A controller with PIR motion sensors reports MOTION / NO_MOTION instead
--    (occupant_count is then 1 for occupied, 0 for vacant).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_status_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_uuid   TEXT    NOT NULL UNIQUE,
    room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    occupant_count INTEGER NOT NULL CHECK (occupant_count >= 0),
    is_occupied  INTEGER NOT NULL CHECK (is_occupied IN (0,1)),
    light_on     INTEGER NOT NULL CHECK (light_on IN (0,1)),
    trigger      TEXT    NOT NULL
                 CHECK (trigger IN ('PERSON_IN','PERSON_OUT','COUNT_RESET','MANUAL_OVERRIDE','SCHEDULE','EMERGENCY',
                                    'MOTION','NO_MOTION')),
    occurred_at  TEXT    NOT NULL,
    received_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_room_logs ON room_status_logs(room_id, occurred_at);

-- ---------------------------------------------------------------------
-- 6. ACCESS_SCHEDULE: permitted access window for each day of the week
--    day_of_week: 0 = Sunday … 6 = Saturday (same as C 'tm_wday')
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_schedule (
    day_of_week  INTEGER PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
    is_open      INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0,1)),
    open_time    TEXT    NOT NULL DEFAULT '07:00',     -- HH:MM, 24-hour
    close_time   TEXT    NOT NULL DEFAULT '22:00',
    updated_by   INTEGER REFERENCES admins(id),
    updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime')),
    CHECK (open_time < close_time)
);

-- ---------------------------------------------------------------------
-- 7. SYSTEM_SETTINGS: small key/value store pushed to the ESP32
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL,
    description  TEXT,
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);

-- ---------------------------------------------------------------------
-- 8. ADMINS: personnel allowed to change configuration
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT    NOT NULL UNIQUE,
    full_name      TEXT    NOT NULL,
    password_hash  TEXT    NOT NULL,                   -- PBKDF2-SHA256, never plain text
    role           TEXT    NOT NULL DEFAULT 'VIEWER'
                   CHECK (role IN ('SUPER_ADMIN','SECURITY','VIEWER')),
    is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);

-- ---------------------------------------------------------------------
-- 9. ADMIN_SESSIONS: bearer tokens issued at login (stored hashed)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash   TEXT    PRIMARY KEY,
    admin_id     INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime')),
    expires_at   TEXT    NOT NULL
);

-- ---------------------------------------------------------------------
-- 10. DEVICES: the ESP32 controller(s) allowed to post data
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code       TEXT    NOT NULL UNIQUE,         -- 'ESP32-CTRL-01'
    api_key_hash      TEXT    NOT NULL,
    firmware_version  TEXT,
    ip_address        TEXT,
    free_heap         INTEGER,
    sd_free_kb        INTEGER,
    pending_events    INTEGER,                         -- queued on SD, not yet uploaded
    last_seen_at      TEXT
);

-- ---------------------------------------------------------------------
-- 11. AUDIT_LOG: who changed what, and when
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type   TEXT    NOT NULL CHECK (actor_type IN ('ADMIN','DEVICE','SYSTEM')),
    actor_id     INTEGER,
    action       TEXT    NOT NULL,                     -- e.g. 'SCHEDULE_UPDATE'
    details      TEXT,                                 -- JSON
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(created_at);

-- ---------------------------------------------------------------------
-- VIEWS used by the API and handy for marking / demos
-- ---------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_people_inside AS
SELECT u.id AS user_id, u.rfid_uid, u.full_name, u.role, v.time_in
FROM building_visits v JOIN users u ON u.id = v.user_id
WHERE v.time_out IS NULL;

CREATE VIEW IF NOT EXISTS v_daily_access_summary AS
SELECT substr(occurred_at,1,10)                                  AS day,
       SUM(door='ENTRY' AND decision='GRANTED')                  AS entries,
       SUM(door='EXIT'  AND decision='GRANTED')                  AS exits,
       SUM(decision='DENIED')                                    AS denied
FROM access_events GROUP BY day;
