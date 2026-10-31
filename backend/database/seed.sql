-- Demo data for the Wokwi pilot. Admin and device credentials are inserted
-- by api/db.py (they need hashing), not here.

INSERT OR IGNORE INTO rooms (code, name, room_type, capacity, light_watts) VALUES
    ('MAIN', 'CoCIS Main Entrance', 'ENTRANCE',     NULL,  0),
    ('LR1',  'Lecture Room 1',      'LECTURE_ROOM', 120, 480),
    ('LR2',  'Lecture Room 2',      'LECTURE_ROOM', 80,  320);

-- Mon-Fri 07:00-22:00, Saturday 08:00-17:00, Sunday closed
INSERT OR IGNORE INTO access_schedule (day_of_week, is_open, open_time, close_time) VALUES
    (0, 0, '08:00', '17:00'),
    (1, 1, '07:00', '22:00'),
    (2, 1, '07:00', '22:00'),
    (3, 1, '07:00', '22:00'),
    (4, 1, '07:00', '22:00'),
    (5, 1, '07:00', '22:00'),
    (6, 1, '08:00', '17:00');

INSERT OR IGNORE INTO system_settings (key, value, description) VALUES
    ('emergency_mode',        'false', 'true = all doors unlocked (fire / evacuation)'),
    ('light_off_delay_s',     '30',    'Seconds after a room count reaches 0 before its lights switch off'),
    ('timezone',              'EAT-3', 'POSIX TZ string used by the ESP32 (Africa/Kampala)'),
    ('config_version',        '1',     'Incremented on every config change; ESP32 re-downloads when it changes'),
    ('heartbeat_interval_s',  '60',    'How often the ESP32 calls /device/heartbeat');

-- RFID UIDs below match the tags used in the Wokwi simulation
INSERT OR IGNORE INTO users (rfid_uid, full_name, reg_number, email, role, department) VALUES
    ('A1B2C3D4', 'Lisa Nyonyozi',     '24/U/0001', 'lisa.nyonyozi@students.mak.ac.ug', 'STUDENT',  'Computer Science'),
    ('11223344', 'Dr. Mary Lecturer', 'STF-0042',  'mary@cis.mak.ac.ug',               'LECTURER', 'Computer Science'),
    ('DEADBEEF', 'Security Officer',  'STF-0100',  'security@cis.mak.ac.ug',           'SECURITY', 'Estates'),
    ('CAFEBABE', 'Guest Visitor',     NULL,        NULL,                               'VISITOR',  NULL);
