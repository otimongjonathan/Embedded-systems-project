"""Generates the sequence diagrams seq_*.svg (run: python3 make_sequences.py)."""
from html import escape

COL = {"User": "#0f172a", "RFID reader": "#2563eb", "ESP32": "#334155", "SD card": "#d97706",
       "REST API": "#7c3aed", "SQLite DB": "#a21caf", "Door / LCD": "#16a34a",
       "MFRC522": "#2563eb", "MQTT broker": "#64748b", "Bridge": "#6d28d9", "Dashboard": "#0891b2",
       "PIR sensor": "#16a34a", "Staff": "#0f172a"}


def render(title, parts, steps, path, width=1800):
    gap = (width - 160) / (len(parts) - 1)
    x = {p: 80 + i * gap for i, p in enumerate(parts)}
    y, body = 150, []
    for kind, *a in steps:
        if kind == "msg":
            src, dst, label = a[:3]
            dashed = len(a) > 3 and a[3] == "reply"
            fail = len(a) > 3 and a[3] == "fail"
            x1, x2 = x[src], x[dst]
            y += 20 * (len(label.split("|")) - 1)
            end = x2 if not fail else (x1 + x2) / 2
            dash = ' stroke-dasharray="7 5"' if dashed else ""
            body.append(f'<line x1="{x1}" y1="{y}" x2="{end}" y2="{y}" stroke="#1e293b" stroke-width="2"{dash} '
                        f'marker-end="url(#{"x" if fail else "a"})"/>')
            for i, line in enumerate(label.split("|")):
                body.append(f'<text x="{(x1 + end) / 2}" y="{y - 10 - 20 * (len(label.split("|")) - 1 - i)}" '
                            f'text-anchor="middle" class="m">{escape(line)}</text>')
            y += 50
        elif kind == "note":
            who, text = a
            lines = text.split("|")
            h = 16 + 20 * len(lines)
            body.append(f'<rect x="{x[who] - 190}" y="{y - 22}" width="380" height="{h}" rx="6" '
                        f'fill="#fefce8" stroke="#ca8a04"/>')
            for i, line in enumerate(lines):
                body.append(f'<text x="{x[who]}" y="{y - 2 + 20 * i}" text-anchor="middle" class="n">{escape(line)}</text>')
            y += h + 24
        elif kind == "divider":
            body.append(f'<line x1="30" y1="{y}" x2="{width - 30}" y2="{y}" stroke="#94a3b8" stroke-dasharray="10 6"/>'
                        f'<rect x="{width / 2 - 200}" y="{y - 16}" width="400" height="32" rx="16" fill="#e2e8f0"/>'
                        f'<text x="{width / 2}" y="{y + 6}" text-anchor="middle" class="d">{escape(a[0])}</text>')
            y += 60
    height = y + 70
    heads = []
    for p in parts:
        heads.append(f'<line x1="{x[p]}" y1="110" x2="{x[p]}" y2="{height - 50}" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4 4"/>')
        for yy in (70, height - 70):
            heads.append(f'<rect x="{x[p] - 75}" y="{yy}" width="150" height="40" rx="8" fill="{COL[p]}"/>'
                         f'<text x="{x[p]}" y="{yy + 26}" text-anchor="middle" class="p">{escape(p)}</text>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1e293b"/></marker>
<marker id="x" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="14" markerHeight="14"><path d="M1,1 L9,9 M9,1 L1,9" stroke="#dc2626" stroke-width="2.5"/></marker></defs>
<style>.p{{font-size:17px;font-weight:700;fill:#fff}} .m{{font-size:16px;fill:#0f172a}} .n{{font-size:15px;fill:#713f12}} .d{{font-size:16px;font-weight:700;fill:#334155}}</style>
<rect width="{width}" height="{height}" fill="#fff"/>
<text x="{width / 2}" y="42" text-anchor="middle" style="font-size:26px;font-weight:700;fill:#0f172a">{escape(title)}</text>
{"".join(heads)}{"".join(body)}</svg>'''
    open(path, "w").write(svg)


render("Online access request: tag scanned while Wi-Fi is up",
       ["User", "RFID reader", "ESP32", "SD card", "REST API", "SQLite DB", "Door / LCD"], [
    ("msg", "User", "RFID reader", "taps tag at ENTRY lane"),
    ("msg", "RFID reader", "ESP32", "UID 'A1B2C3D4'"),
    ("note", "ESP32", "Access task: new event_uuid '01-000123'|timestamp from NTP clock"),
    ("msg", "ESP32", "REST API", "POST /api/v1/device/access/check|{event_uuid, rfid_uid, door: ENTRY, occurred_at}"),
    ("msg", "REST API", "SQLite DB", "BEGIN IMMEDIATE (lock)|uuid seen?, user, schedule, open visit?"),
    ("msg", "SQLite DB", "REST API", "rows", "reply"),
    ("note", "REST API", "decide(): rules 1 to 6|result: GRANTED, reason OK"),
    ("msg", "REST API", "SQLite DB", "INSERT access_events|INSERT building_visits (time_in), COMMIT"),
    ("msg", "REST API", "ESP32", "200 {decision: GRANTED, user, people_inside: 37}", "reply"),
    ("msg", "ESP32", "SD card", "append access_log.csv (sd_mutex)"),
    ("msg", "ESP32", "Door / LCD", "open ENTRY servo 3 s|LCD: 'Welcome Lisa'"),
], "seq_online.svg")

render("Offline operation and store-and-forward synchronisation",
       ["User", "ESP32", "SD card", "REST API", "SQLite DB"], [
    ("msg", "User", "ESP32", "taps tag at EXIT lane"),
    ("msg", "ESP32", "REST API", "POST /device/access/check", "fail"),
    ("note", "ESP32", "no reply within 3 s, so OFFLINE mode|decide() using cached users.csv,|schedule.csv and people-inside list"),
    ("msg", "ESP32", "SD card", "append access_log.csv|append outbox.csv (decision, reason, uuid)"),
    ("msg", "ESP32", "User", "door opens (or buzzer if DENIED)", "reply"),
    ("divider", "Wi-Fi connection restored"),
    ("msg", "ESP32", "REST API", "POST /device/heartbeat {pending_events: 12}"),
    ("msg", "REST API", "ESP32", "{config_version: 9, emergency_mode: false}", "reply"),
    ("msg", "SD card", "ESP32", "read up to 200 records from outbox.csv", "reply"),
    ("msg", "ESP32", "REST API", "POST /device/events/batch|{access_events: [...], room_events: [...]}"),
    ("msg", "REST API", "SQLite DB", "ONE transaction, sorted by time|skip uuids already stored, update visits"),
    ("msg", "REST API", "ESP32", "{accepted: [...], duplicates: [...]}", "reply"),
    ("msg", "ESP32", "SD card", "delete those uuids from outbox.csv"),
    ("note", "ESP32", "config_version 9 differs from cached 8"),
    ("msg", "ESP32", "REST API", "GET /device/config"),
    ("msg", "REST API", "ESP32", "schedule, authorised_tags, light modes", "reply"),
    ("msg", "ESP32", "SD card", "overwrite users.csv, schedule.csv"),
], "seq_offline.svg", width=1500)


render("Entrance scan: from the card to the database and dashboard",
       ["User", "MFRC522", "ESP32", "SD card", "MQTT broker", "Bridge", "REST API", "SQLite DB"], [
    ("msg", "User", "MFRC522", "taps card at the ENTRY reader"),
    ("msg", "MFRC522", "ESP32", "UID 11223344 (SPI, rfid task)"),
    ("note", "ESP32", "state_evaluate(): authorised? schedule?|already inside? (under the state mutex)"),
    ("msg", "ESP32", "User", "door opens 3 s, green LED, beep, LCD", "reply"),
    ("msg", "ESP32", "SD card", "append access.csv (storage mutex)"),
    ("msg", "ESP32", "MQTT broker", "publish cocis/event/access|{tag, dir: IN, result: OK, ts}"),
    ("msg", "ESP32", "MQTT broker", "publish cocis/state/occupancy {count} (retained)"),
    ("msg", "MQTT broker", "Bridge", "deliver to subscriber"),
    ("note", "Bridge", "convert: OK to GRANTED / OK|event_uuid MQ-11223344-IN-<ts>"),
    ("msg", "Bridge", "REST API", "POST /device/relay|(X-Device-Key)"),
    ("msg", "REST API", "SQLite DB", "INSERT access_events|+ visit, COMMIT"),
    ("msg", "REST API", "Bridge", "200 {accepted: [uuid]}", "reply"),
    ("note", "REST API", "dashboard refreshes every 3 s:|the person appears under People inside"),
], "seq_mqtt_scan.svg", width=1900)

render("Room lighting and lockdown messages",
       ["PIR sensor", "ESP32", "MQTT broker", "Bridge", "REST API", "Staff"], [
    ("msg", "PIR sensor", "ESP32", "motion (room_lights task, every 100 ms)"),
    ("note", "ESP32", "light ON; after 5 s with no motion: OFF"),
    ("msg", "ESP32", "MQTT broker", "publish cocis/state/room1|{occupied, lights, ts} (retained)"),
    ("msg", "MQTT broker", "Bridge", "deliver"),
    ("msg", "Bridge", "REST API", "POST /device/relay (MOTION)"),
    ("note", "REST API", "rooms (live) + room_status_logs (history)"),
    ("divider", "Dashboard to controller: lockdown"),
    ("msg", "Staff", "REST API", "PUT /api/v1/settings/lockdown {enabled: true}"),
    ("msg", "Bridge", "REST API", "polls every 2 s: lockdown_mode changed"),
    ("msg", "Bridge", "MQTT broker", "publish cocis/cmd/entrance LOCKDOWN (retained)"),
    ("msg", "MQTT broker", "ESP32", "deliver: lockdown flag set|(after the 18-character fix)"),
], "seq_mqtt_room.svg", width=1700)
