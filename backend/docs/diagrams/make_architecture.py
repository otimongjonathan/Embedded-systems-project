"""Generates architecture.svg: the implemented system, from the devices to the database
(run: python3 make_architecture.py)."""
from html import escape

W, H = 2000, 1080
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
       'font-family="Helvetica Neue, Helvetica, Arial, sans-serif">',
       '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" '
       'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>',
       '<style>.t{font-size:25px;font-weight:700;fill:#0f172a}.h{font-size:19px;font-weight:700;fill:#0f172a}'
       '.b{font-size:16px;fill:#1e293b}.s{font-size:14px;fill:#475569}.l{font-size:15px;font-weight:700}'
       '.td{font-size:15px;fill:#0f172a}.th{font-size:15px;font-weight:700;fill:#000}</style>',
       f'<rect width="{W}" height="{H}" fill="#fff"/>',
       f'<text x="{W/2}" y="46" text-anchor="middle" style="font-size:30px;font-weight:700;fill:#0f172a">'
       'CoCIS Smart Control and Monitoring System: Architecture</text>']


def layer(x, w, title, sub, fill, stroke):
    out.append(f'<rect x="{x}" y="80" width="{w}" height="970" rx="16" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
    out.append(f'<text x="{x + w/2}" y="116" text-anchor="middle" class="t">{escape(title)}</text>')
    out.append(f'<text x="{x + w/2}" y="140" text-anchor="middle" class="s">{escape(sub)}</text>')


def box(x, y, w, title, lines=(), stroke="#334155", fill="#fff", h=None):
    h = h or 44 + 21 * len(lines)
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>')
    out.append(f'<text x="{x + 14}" y="{y + 27}" class="h">{escape(title)}</text>')
    for i, line in enumerate(lines):
        out.append(f'<text x="{x + 14}" y="{y + 50 + i * 21}" class="b">{escape(line)}</text>')
    return y + h


def arrow(x1, y1, x2, y2, label="", colour="#334155", both=False, lx=None, ly=None):
    start = ' marker-start="url(#a)"' if both else ""
    out.append(f'<path d="M{x1},{y1} L{x2},{y2}" stroke="{colour}" stroke-width="3" fill="none" marker-end="url(#a)"{start}/>')
    for i, part in enumerate(label.split("|") if label else []):
        out.append(f'<text x="{lx if lx is not None else (x1 + x2) / 2}" y="{(ly if ly is not None else (y1 + y2) / 2 - 12) + i * 18}" '
                   f'text-anchor="middle" class="l" fill="{colour}">{escape(part)}</text>')


# ---------- layer 1: field devices ----------
layer(30, 420, "1. Field devices", "Wokwi parts", "#f8fafc", "#cbd5e1")
y = box(50, 160, 380, "Main entrance", ["MFRC522 RFID reader: entry lane", "MFRC522 RFID reader: exit lane",
                                        "Servo: entry door, servo: exit door", "Green and red LED, buzzer",
                                        "LCD 16x2 (I2C)"], "#2563eb", "#eff6ff")
y = box(50, y + 22, 380, "Lecture Room 1", ["PIR motion sensor, room light"], "#16a34a", "#f0fdf4")
y = box(50, y + 22, 380, "Lecture Room 2", ["PIR motion sensor, room light"], "#16a34a", "#f0fdf4")
y = box(50, y + 22, 380, "Storage", ["microSD card: access.csv log", "NVS flash: cards, people inside,", "schedule (survive a reboot)"],
        "#d97706", "#fffbeb")
box(50, y + 22, 380, "Serial monitor", ["Console menu, admin PIN login"], "#d97706", "#fffbeb")

# ---------- layer 2: ESP32 ----------
layer(510, 540, "2. ESP32 controller", "one board, ESP-IDF and FreeRTOS", "#f1f5f9", "#334155")
tasks = [("rfid task (priority 6)", "reads both readers, decides, logs, publishes", "#dbeafe", "#3b82f6"),
         ("door task (priority 4)", "opens a servo for 3 s (door queue)", "#dbeafe", "#3b82f6"),
         ("room_lights task (priority 4)", "PIR every 100 ms, lights, 5 s hold", "#dcfce7", "#16a34a"),
         ("console task (priority 3)", "commands, admin PIN, schedule, cards", "#fef3c7", "#d97706"),
         ("MQTT client (esp-mqtt)", "Wi-Fi, publishes JSON, receives commands", "#ede9fe", "#7c3aed")]
ty = 160
for title, sub, fill, stroke in tasks:
    out.append(f'<rect x="530" y="{ty}" width="500" height="62" rx="9" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>')
    out.append(f'<text x="548" y="{ty + 27}" class="h">{escape(title)}</text><text x="548" y="{ty + 49}" class="s">{escape(sub)}</text>')
    ty += 74
out.append(f'<rect x="530" y="{ty}" width="500" height="62" rx="9" fill="#fff" stroke="#64748b" stroke-dasharray="6 4"/>')
out.append(f'<text x="780" y="{ty + 27}" text-anchor="middle" class="h">Shared state</text>'
           f'<text x="780" y="{ty + 49}" text-anchor="middle" class="s">state mutex, storage mutex, door queue</text>')
ty += 92
out.append(f'<text x="780" y="{ty}" text-anchor="middle" class="h">Access decision rules (state.c)</text>')
rows = [("#", "Condition", "Result"), ("1", "Lockdown active", "Deny"), ("2", "Card not authorised", "Deny"),
        ("3", "Entry outside schedule", "Deny"), ("4", "Entry, already inside", "Deny"), ("5", "Exit, not inside", "Deny"),
        ("6", "Otherwise (exit after hours too)", "Open")]
ry = ty + 14
for i, (n, cond, res) in enumerate(rows):
    cls = "th" if i == 0 else "td"
    out.append(f'<rect x="530" y="{ry}" width="500" height="36" fill="#fff" stroke="#000"/>')
    out.append(f'<text x="546" y="{ry + 24}" class="{cls}">{n}</text><text x="590" y="{ry + 24}" class="{cls}">{escape(cond)}</text>'
               f'<text x="930" y="{ry + 24}" class="{cls}">{res}</text>')
    ry += 36
out.append(f'<line x1="576" y1="{ty + 14}" x2="576" y2="{ry}" stroke="#000"/><line x1="916" y1="{ty + 14}" x2="916" y2="{ry}" stroke="#000"/>')

# ---------- layer 3: internet ----------
layer(1110, 320, "3. Internet", "public MQTT broker", "#f8fafc", "#94a3b8")
box(1130, 230, 280, "broker.hivemq.com", ["port 1883", "", "cocis/event/access", "cocis/state/occupancy",
                                          "cocis/state/room1, room2", "cocis/config/schedule", "cocis/cmd/entrance"], "#64748b")

# ---------- layer 4: server ----------
layer(1490, 480, "4. Server (laptop)", "start.bat and bridge.bat", "#faf5ff", "#7c3aed")
box(1510, 160, 440, "MQTT bridge", ["Python, paho-mqtt", "Message to API call, stable ids", "Lockdown to the ESP32"], "#7c3aed")
box(1510, 370, 440, "REST API (FastAPI)", ["Device endpoints: X-Device-Key", "Staff endpoints: token and roles",
                                           "Pydantic models validate input", "Rules, transactions, audit log"], "#7c3aed")
box(1510, 590, 320, "SQLite database", ["11 tables, 2 views", "access_events, building_visits,", "room_status_logs, users, ..."],
    "#a21caf", "#fdf4ff")
box(1510, 800, 440, "Staff in a browser", ["Dashboard (live, Database tab)", "Swagger UI (API documentation)"], "#7c3aed")

# ---------- connections ----------
for y1, y2 in [(234, 191), (363, 330), (450, 350), (558, 560), (666, 420)]:
    arrow(430, y1, 530, y2, both=True)
arrow(1030, 487, 1130, 400, "MQTT|Wi-Fi", "#7c3aed", both=True, lx=1080, ly=490)
arrow(1410, 270, 1510, 213, "MQTT", "#7c3aed", both=True, lx=1460, ly=225)
arrow(1650, 267, 1650, 370, "HTTP", "#7c3aed", lx=1685, ly=315)
arrow(1650, 498, 1650, 590, "SQL", "#a21caf", lx=1680, ly=550)
arrow(1890, 800, 1890, 498, "HTTP|token", "#7c3aed", lx=1925, ly=650)
out.append("</svg>")
open("architecture.svg", "w", encoding="utf-8").write("\n".join(out))
print("wrote architecture.svg")
