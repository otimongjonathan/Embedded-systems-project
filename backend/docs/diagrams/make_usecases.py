"""Generates the UML use case diagrams usecase_system.svg and usecase_device.svg
(run: python3 make_usecases.py)."""
import math
from html import escape

RX, RY = 140, 44


def ellipse_edge(cx, cy, tx, ty, rx=RX, ry=RY):
    a = math.atan2(ty - cy, tx - cx)
    k = 1 / math.sqrt((math.cos(a) / rx) ** 2 + (math.sin(a) / ry) ** 2)
    return cx + k * math.cos(a), cy + k * math.sin(a)


class Diagram:
    def __init__(self, w, h, title, boundary, label):
        self.w, self.h, self.parts, self.uc = w, h, [], {}
        bx, by, bw, bh = boundary
        self.parts.append(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="6" fill="#f8fafc" stroke="#334155" stroke-width="2"/>')
        self.parts.append(f'<text x="{bx + bw / 2}" y="{by + 30}" text-anchor="middle" class="sys">{escape(label)}</text>')
        self.title = title
        self.actors = {}

    def actor(self, key, x, y, name, clock=False):
        self.actors[key] = (x, y)
        if clock:
            self.parts.append(f'<circle cx="{x}" cy="{y}" r="30" fill="#fff" stroke="#0f172a" stroke-width="2.5"/>'
                              f'<path d="M{x},{y - 18} V{y} H{x + 14}" stroke="#0f172a" stroke-width="2.5" fill="none"/>')
            ty = y + 56
        else:
            self.parts.append(
                f'<g stroke="#0f172a" stroke-width="2.5" fill="none"><circle cx="{x}" cy="{y - 38}" r="14" fill="#fff"/>'
                f'<line x1="{x}" y1="{y - 24}" x2="{x}" y2="{y + 14}"/><line x1="{x - 24}" y1="{y - 10}" x2="{x + 24}" y2="{y - 10}"/>'
                f'<line x1="{x}" y1="{y + 14}" x2="{x - 18}" y2="{y + 44}"/><line x1="{x}" y1="{y + 14}" x2="{x + 18}" y2="{y + 44}"/></g>')
            ty = y + 70
        for i, line in enumerate(name.split("|")):
            self.parts.append(f'<text x="{x}" y="{ty + 20 * i}" text-anchor="middle" class="act">{escape(line)}</text>')

    def usecase(self, key, x, y, uid, name, fill="#eef2ff"):
        self.uc[key] = (x, y)
        self.parts.append(f'<ellipse cx="{x}" cy="{y}" rx="{RX}" ry="{RY}" fill="{fill}" stroke="#3730a3" stroke-width="2"/>')
        lines = name.split("|")
        top = y - 10 * (len(lines) - 1) + 2
        self.parts.append(f'<text x="{x}" y="{top - 16}" text-anchor="middle" class="uid">{uid}</text>')
        for i, line in enumerate(lines):
            self.parts.append(f'<text x="{x}" y="{top + 6 + 20 * i}" text-anchor="middle" class="uc">{escape(line)}</text>')

    def assoc(self, actor, uc):
        ax, ay = self.actors[actor]
        cx, cy = self.uc[uc]
        ex, ey = ellipse_edge(cx, cy, ax, ay)
        sx = ax + (32 if cx > ax else -32)
        self.parts.append(f'<line x1="{sx}" y1="{ay}" x2="{ex:.0f}" y2="{ey:.0f}" stroke="#334155" stroke-width="1.8"/>')

    def dep(self, src, dst, label):
        sx, sy = self.uc[src]
        dx, dy = self.uc[dst]
        x1, y1 = ellipse_edge(sx, sy, dx, dy)
        x2, y2 = ellipse_edge(dx, dy, sx, sy)
        self.parts.append(f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" stroke="#7c3aed" '
                          f'stroke-width="1.6" stroke-dasharray="8 5" marker-end="url(#open)"/>')
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        self.parts.append(f'<rect x="{mx - 40}" y="{my - 13}" width="80" height="20" fill="#fff"/>'
                          f'<text x="{mx}" y="{my + 2}" text-anchor="middle" class="st">«{label}»</text>')

    def generalise(self, child, parent):
        cx, cy = self.actors[child]
        px, py = self.actors[parent]
        y1, y2 = cy + 100, py - 62
        self.parts.append(f'<line x1="{cx}" y1="{y1}" x2="{px}" y2="{y2}" stroke="#0f172a" stroke-width="2" marker-end="url(#gen)"/>')

    def note(self, x, y, w, lines):
        h = 18 + 20 * len(lines)
        self.parts.append(f'<path d="M{x},{y} h{w - 16} l16,16 v{h - 16} h-{w} z" fill="#fefce8" stroke="#ca8a04"/>')
        for i, line in enumerate(lines):
            self.parts.append(f'<text x="{x + 12}" y="{y + 24 + 20 * i}" class="nt">{escape(line)}</text>')

    def save(self, path):
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
<defs>
<marker id="open" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto"><path d="M0,0 L12,6 L0,12" fill="none" stroke="#7c3aed" stroke-width="1.6"/></marker>
<marker id="gen" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="16" markerHeight="16" orient="auto"><path d="M0,0 L14,7 L0,14 z" fill="#fff" stroke="#0f172a" stroke-width="1.5"/></marker>
</defs>
<style>.sys{{font-size:20px;font-weight:700;fill:#0f172a}} .act{{font-size:16px;font-weight:700;fill:#0f172a}}
.uc{{font-size:15px;fill:#1e1b4b}} .uid{{font-size:12px;font-weight:700;fill:#6366f1}} .st{{font-size:13px;font-style:italic;fill:#6d28d9}}
.nt{{font-size:14px;fill:#713f12}}</style>
<rect width="{self.w}" height="{self.h}" fill="#fff"/>
<text x="{self.w / 2}" y="44" text-anchor="middle" style="font-size:26px;font-weight:700;fill:#0f172a">{escape(self.title)}</text>
{"".join(self.parts)}</svg>'''
        open(path, "w").write(svg)


# ---------------- System-level use case diagram ----------------
d = Diagram(1720, 1240, "Use case diagram: CoCIS Smart Control and Monitoring System",
            (330, 80, 1060, 1130), "CoCIS Smart Control and Monitoring System")
d.actor("user", 170, 280, "Building User|(student, staff, visitor)")
d.actor("occ", 170, 650, "Room Occupant")
d.actor("time", 170, 1000, "Time|(5 s without motion)", clock=True)
d.actor("admin", 1560, 230, "System|Administrator")
d.actor("sec", 1560, 590, "Security Officer")
d.actor("view", 1560, 950, "Management|Viewer")

d.usecase("uc01", 560, 200, "UC01", "Enter Building")
d.usecase("uc02", 560, 360, "UC02", "Exit Building")
d.usecase("uc03", 880, 280, "UC03", "Verify Access|(card, schedule, inside)", "#e0e7ff")
d.usecase("uc04", 560, 650, "UC04", "Detect Motion in|Lecture Room")
d.usecase("uc05", 830, 800, "UC05", "Control Room|Lighting", "#e0e7ff")
d.usecase("uc06", 560, 1000, "UC06", "Switch Lights Off|When Vacant")
d.usecase("uc09", 870, 500, "UC09", "Log In", "#e0e7ff")
d.usecase("uc10", 1180, 170, "UC10", "Manage Authorised|Cards")
d.usecase("uc11", 1180, 300, "UC11", "Configure Access|Schedule")
d.usecase("uc12", 1180, 540, "UC12", "Lock Down the|Entrance")
d.usecase("uc13", 1180, 670, "UC13", "Override Room|Lights")
d.usecase("uc07", 1180, 920, "UC07", "View Occupancy")
d.usecase("uc08", 1180, 1060, "UC08", "View Logs and|Reports")

for a, u in [("user", "uc01"), ("user", "uc02"), ("occ", "uc04"), ("time", "uc06"),
             ("admin", "uc10"), ("admin", "uc11"), ("sec", "uc12"), ("sec", "uc13"),
             ("view", "uc07"), ("view", "uc08")]:
    d.assoc(a, u)
d.dep("uc01", "uc03", "include")
d.dep("uc02", "uc03", "include")
d.dep("uc04", "uc05", "include")
d.dep("uc06", "uc05", "include")
d.dep("uc13", "uc05", "extend")
for u in ["uc10", "uc11", "uc12", "uc13", "uc07", "uc08"]:
    d.dep(u, "uc09", "include")
d.generalise("admin", "sec")
d.generalise("sec", "view")
d.note(1420, 1080, 290, ["Administrator inherits Security", "Officer, who inherits Viewer", "(console PIN on the ESP32;", "roles in the API and dashboard)"])
d.save("usecase_system.svg")

# ---------------- Controller, bridge and API use case diagram ----------------
d = Diagram(1500, 880, "Use case diagram: entrance ESP32, MQTT bridge and the Database API",
            (330, 80, 900, 780), "MQTT integration and REST API")
d.actor("esp", 170, 260, "Entrance ESP32")
d.actor("bri", 170, 640, "MQTT Bridge")
d.usecase("p", 580, 180, "UC14", "Publish Scan and|Room State (MQTT)")
d.usecase("r", 580, 360, "UC15", "Relay Messages|to the Database")
d.usecase("h", 580, 540, "UC15a", "Report Controller|Health")
d.usecase("l", 580, 710, "UC16", "Forward Lockdown|Command")
d.usecase("auth", 1010, 480, "", "Authenticate Device|(X-Device-Key)", "#e0e7ff")
d.usecase("once", 1010, 250, "", "Store Event Once|(stable event_uuid)", "#e0e7ff")
d.assoc("esp", "p")
for u in "rhl":
    d.assoc("bri", u)
d.dep("r", "once", "include")
for u in "rh":
    d.dep(u, "auth", "include")
d.dep("h", "r", "extend")
d.note(1060, 640, 300, ["The ESP32 never calls the API:", "it publishes to the broker and", "the bridge makes the requests"])
d.save("usecase_device.svg")
