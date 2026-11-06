"""Renders captured serial and console output (docs/screenshots/text/*.txt) as
terminal-window images for the report (run: python3 make_terminals.py).
The text is copied unchanged from the Wokwi serial monitor and the virtual ESP32."""
from html import escape
from pathlib import Path
import subprocess

TEXT = Path(__file__).resolve().parent.parent / "screenshots" / "text"
OUT = TEXT.parent
LINE, CHAR, PAD = 22, 9.6, 22

SHOTS = {  # file: window title
    "wokwi_serial": "Wokwi serial monitor: start-up, offline scans, room count and status",
    "wokwi_help": "Wokwi serial monitor: the management menu",
    "virtual_demo": "Virtual ESP32 demo (demo.bat), steps 2 to 7",
    "virtual_demo2": "Virtual ESP32 demo (demo.bat), steps 8 to 10",
    "bridge_log": "MQTT bridge (bridge.bat): entrance ESP32 messages stored in the database",
}


def colour(line: str) -> str:
    if line.startswith(">"):
        return "#7dd3fc"                      # typed commands
    if "DENIED" in line or "!!" in line:
        return "#fca5a5"
    if "GRANTED" in line or line.startswith(("[sync]", "[cocis]", "[mqtt]", "[room]", "[user]")):
        return "#86efac"
    if line.startswith("---"):
        return "#fde68a"
    return "#e5e7eb"


for name, title in SHOTS.items():
    lines = (TEXT / f"{name}.txt").read_text(encoding="utf-8").rstrip("\n").split("\n")
    w = int(max(len(l) for l in lines) * CHAR + 2 * PAD)
    w = max(w, 900)
    h = 44 + len(lines) * LINE + PAD
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
           f'<rect width="{w}" height="{h}" rx="10" fill="#111827"/>',
           f'<rect width="{w}" height="34" rx="10" fill="#374151"/><rect y="24" width="{w}" height="10" fill="#374151"/>',
           '<circle cx="20" cy="17" r="6" fill="#ef4444"/><circle cx="40" cy="17" r="6" fill="#f59e0b"/>'
           '<circle cx="60" cy="17" r="6" fill="#22c55e"/>',
           f'<text x="{w / 2}" y="22" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" '
           f'font-size="14" fill="#e5e7eb">{escape(title)}</text>']
    for i, line in enumerate(lines):
        out.append(f'<text x="{PAD}" y="{44 + (i + 1) * LINE - 6}" font-family="Menlo, Consolas, monospace" '
                   f'font-size="16" fill="{colour(line)}" xml:space="preserve">{escape(line)}</text>')
    out.append("</svg>")
    svg = OUT / f"{name}.svg"
    svg.write_text("\n".join(out), encoding="utf-8")
    subprocess.run(["rsvg-convert", "-w", str(w * 2), str(svg), "-o", str(OUT / f"{name}.png")], check=True)
    svg.unlink()
    print("wrote", name + ".png")
