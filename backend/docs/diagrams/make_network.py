"""Generates network.svg: where each part runs and how it connects (run: python3 make_network.py)."""
from html import escape

W, H = 1700, 1000
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
       'font-family="Helvetica Neue, Helvetica, Arial, sans-serif">',
       '<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" '
       'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#334155"/></marker></defs>',
       '<style>.t{font-size:24px;font-weight:700;fill:#0f172a}.h{font-size:19px;font-weight:700;fill:#0f172a}'
       '.b{font-size:16px;fill:#1e293b}.s{font-size:14px;fill:#475569}.l{font-size:14px;font-weight:700}</style>',
       f'<rect width="{W}" height="{H}" fill="#fff"/>',
       f'<text x="{W/2}" y="44" text-anchor="middle" style="font-size:28px;font-weight:700;fill:#0f172a">'
       'Network view: how the controllers reach the API and the database</text>']


def zone(x, y, w, h, title, sub, fill, stroke):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
    out.append(f'<text x="{x + w/2}" y="{y + 34}" text-anchor="middle" class="t">{escape(title)}</text>')
    out.append(f'<text x="{x + w/2}" y="{y + 58}" text-anchor="middle" class="s">{escape(sub)}</text>')


def box(x, y, w, h, title, lines, stroke="#334155", fill="#fff"):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
    out.append(f'<text x="{x + 16}" y="{y + 28}" class="h">{escape(title)}</text>')
    for i, line in enumerate(lines):
        out.append(f'<text x="{x + 16}" y="{y + 52 + i * 21}" class="b">{escape(line)}</text>')


def arrow(points, label, colour="#334155", dashed=False, lx=None, ly=None, both=False):
    d = "M" + " L".join(f"{x},{y}" for x, y in points)
    extra = ' stroke-dasharray="9 6"' if dashed else ""
    start = ' marker-start="url(#a)"' if both else ""
    out.append(f'<path d="{d}" fill="none" stroke="{colour}" stroke-width="3"{extra} marker-end="url(#a)"{start}/>')
    if label:
        x = lx if lx is not None else (points[0][0] + points[-1][0]) / 2
        y = ly if ly is not None else (points[0][1] + points[-1][1]) / 2 - 10
        for i, part in enumerate(label.split("|")):
            out.append(f'<text x="{x}" y="{y + i * 18}" text-anchor="middle" class="l" fill="{colour}">{escape(part)}</text>')


zone(30, 80, 440, 820, "1. Wokwi (cloud)", "simulated ESP32 boards, Wi-Fi Wokwi-GUEST", "#eff6ff", "#3b82f6")
zone(620, 80, 380, 820, "2. Internet", "public services", "#f8fafc", "#94a3b8")
zone(1150, 80, 520, 820, "3. Laptop or college server", "runs start.bat and bridge.bat; database stays here", "#faf5ff", "#7c3aed")

ENT = ["MFRC522 readers, servos, LCD,", "SD card, PIR rooms", "Decides every scan itself", "MQTT client: esp-mqtt",
       "Publishes JSON to cocis/...", "Listens on cocis/cmd/entrance"]
box(55, 160, 390, 60 + 21 * len(ENT), "Entrance ESP32 (group firmware)", ENT, "#2563eb")
HTTP = ["IR beam rooms, offline queue", "HTTP client: esp_http_client", "Calls /api/v1/device/... directly",
        "Needs a tunnel to reach the laptop"]
box(55, 490, 390, 60 + 21 * len(HTTP), "Reference HTTP ESP32 (optional)", HTTP, "#0891b2")
BRK = ["broker.hivemq.com : 1883", "Topics:", "  cocis/event/access", "  cocis/state/occupancy",
       "  cocis/state/room1, room2", "  cocis/config/schedule", "  cocis/cmd/entrance"]
box(650, 160, 320, 60 + 21 * len(BRK), "MQTT broker", BRK, "#64748b")
TUN = ["ngrok or Cloudflare Tunnel", "public https address for", "the laptop's API"]
box(650, 540, 320, 60 + 21 * len(TUN), "Tunnel (optional)", TUN, "#64748b")
BRI = ["Subscribes to the ESP32's topics", "Turns each message into an API call", "Sends lockdown back as MQTT"]
box(1175, 160, 470, 60 + 21 * len(BRI), "MQTT bridge (bridge/mqtt_bridge.py)", BRI, "#7c3aed")
API = ["Device endpoints: X-Device-Key", "  /device/relay, /device/access/check ...", "Staff endpoints: login token and roles",
       "Validates every body with Pydantic models"]
box(1175, 400, 470, 60 + 21 * len(API), "REST API (FastAPI, port 8000)", API, "#7c3aed")
box(1175, 660, 220, 125, "SQLite database", ["data/cocis.db", "11 tables, 2 views"], "#a21caf", "#fdf4ff")
box(1425, 660, 220, 125, "Browser", ["Dashboard, Swagger UI", "Virtual ESP32 (CLI)"], "#7c3aed")

arrow([(445, 230), (650, 230)], "MQTT publish|JSON over Wi-Fi", "#2563eb", lx=547, ly=205)
arrow([(970, 230), (1175, 230)], "MQTT subscribe|laptop connects out", "#7c3aed", lx=1072, ly=205)
arrow([(1175, 280), (970, 340)], "LOCKDOWN /|UNLOCK", "#7c3aed", dashed=True, lx=1072, ly=330)
arrow([(650, 380), (445, 330)], "command", "#2563eb", dashed=True, lx=547, ly=385)
arrow([(1410, 283), (1410, 400)], "HTTP POST /device/relay", "#7c3aed", lx=1530, ly=350)
arrow([(1285, 544), (1285, 660)], "SQL", "#a21caf", lx=1315, ly=610)
arrow([(1535, 660), (1535, 544)], "HTTP + token", "#7c3aed", lx=1600, ly=610)
arrow([(445, 580), (650, 600)], "HTTPS", "#0891b2", lx=547, ly=570)
arrow([(970, 600), (1175, 500)], "HTTP to :8000", "#0891b2", lx=1072, ly=590)

out.append(f'<rect x="55" y="700" width="390" height="160" rx="10" fill="#fff7ed" stroke="#ea580c" stroke-width="2"/>')
for i, line in enumerate(["Same network? No.", "Both the ESP32 and the laptop open an", "outward connection to the broker, so",
                          "no router setup is needed. Only the", "bridge and the API touch the database."]):
    out.append(f'<text x="75" y="{732 + i * 24}" class="{"h" if i == 0 else "b"}">{escape(line)}</text>')
out.append("</svg>")
open("network.svg", "w", encoding="utf-8").write("\n".join(out))
print("wrote network.svg")
