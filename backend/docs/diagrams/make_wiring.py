"""Generates wiring.svg: every Wokwi part and the ESP32 pin it uses (run: python3 make_wiring.py).
The pins match reference-firmware/main/main.c and reference-firmware/diagram.json."""
from html import escape

W, H = 1600, 1060
TOP, STEP, BOX_H = 150, 98, 74
ESP = (650, 950)                    # left and right edge of the ESP32 block

LEFT = [  # (part, detail, pin label, colour)
    ("MFRC522 reader: entry", "CS (SDA) and RST", "GPIO 5, GPIO 4", "#2563eb"),
    ("MFRC522 reader: exit", "CS (SDA) and RST", "GPIO 15, GPIO 2", "#2563eb"),
    ("Entry door servo", "PWM 50 Hz, LEDC channel 0", "GPIO 13", "#ea580c"),
    ("Exit door servo", "PWM 50 Hz, LEDC channel 1", "GPIO 33", "#ea580c"),
    ("Green LED", "access granted", "GPIO 12", "#16a34a"),
    ("Red LED", "access denied", "GPIO 14", "#dc2626"),
    ("Buzzer", "short beep OK, long beep denied", "GPIO 27", "#475569"),
    ("LCD 16x2 (address 0x27)", "SDA GPIO 21, SCL GPIO 22", "I2C", "#0891b2"),
]
RIGHT = [
    ("Shared SPI bus: readers and SD", "SCK 18, MISO 19, MOSI 23", "SPI", "#334155"),
    ("microSD card: access.csv", "chip select", "GPIO 16", "#b45309"),
    ("PIR sensor: Lecture Room 1", "motion output", "GPIO 34", "#16a34a"),
    ("Light: Lecture Room 1", "LED", "GPIO 26", "#ca8a04"),
    ("PIR sensor: Lecture Room 2", "motion output", "GPIO 35", "#16a34a"),
    ("Light: Lecture Room 2", "LED", "GPIO 25", "#ca8a04"),
    ("Serial monitor", "console menu, 115200 baud", "UART0", "#7c3aed"),
    ("Wi-Fi", "Wokwi-GUEST, MQTT to the broker", "radio", "#7c3aed"),
]

out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
       'font-family="Helvetica Neue, Helvetica, Arial, sans-serif">',
       '<style>.n{font-size:19px;font-weight:700;fill:#0f172a}.d{font-size:15px;fill:#475569}'
       '.p{font-size:15px;font-weight:700}.h{font-size:22px;font-weight:700;fill:#0f172a}</style>',
       f'<rect width="{W}" height="{H}" fill="#fff"/>',
       f'<text x="{W / 2}" y="46" text-anchor="middle" style="font-size:28px;font-weight:700;fill:#0f172a">'
       'Entrance and rooms controller: parts and ESP32 pins</text>',
       '<text x="250" y="112" text-anchor="middle" class="h">Main entrance</text>',
       '<text x="1350" y="112" text-anchor="middle" class="h">Storage, lecture rooms, communication</text>']

# ESP32 block
y0, y1 = TOP - 10, TOP + STEP * 8 - 14
out.append(f'<rect x="{ESP[0]}" y="{y0}" width="{ESP[1] - ESP[0]}" height="{y1 - y0}" rx="16" fill="#1e293b"/>')
out.append(f'<text x="{(ESP[0] + ESP[1]) / 2}" y="{(y0 + y1) / 2 - 16}" text-anchor="middle" '
           'style="font-size:30px;font-weight:700;fill:#fff">ESP32</text>')
out.append(f'<text x="{(ESP[0] + ESP[1]) / 2}" y="{(y0 + y1) / 2 + 16}" text-anchor="middle" '
           'style="font-size:17px;fill:#cbd5e1">DevKitC V4, ESP-IDF, FreeRTOS</text>')

for side, items in (("L", LEFT), ("R", RIGHT)):
    for i, (name, detail, pin, colour) in enumerate(items):
        y = TOP + i * STEP
        bx = 60 if side == "L" else 1140
        out.append(f'<rect x="{bx}" y="{y}" width="400" height="{BOX_H}" rx="10" fill="#f8fafc" '
                   f'stroke="{colour}" stroke-width="2.5"/>')
        out.append(f'<text x="{bx + 18}" y="{y + 31}" class="n">{escape(name)}</text>')
        out.append(f'<text x="{bx + 18}" y="{y + 56}" class="d">{escape(detail)}</text>')
        ly = y + BOX_H / 2
        x_from, x_to = (bx + 400, ESP[0]) if side == "L" else (ESP[1], bx)
        out.append(f'<line x1="{x_from}" y1="{ly}" x2="{x_to}" y2="{ly}" stroke="{colour}" stroke-width="3"/>')
        out.append(f'<circle cx="{ESP[0] if side == "L" else ESP[1]}" cy="{ly}" r="6" fill="{colour}"/>')
        tx = (x_from + x_to) / 2
        out.append(f'<text x="{tx}" y="{ly - 9}" text-anchor="middle" class="p" fill="{colour}">{escape(pin)}</text>')

out.append(f'<text x="{W / 2}" y="{H - 46}" text-anchor="middle" class="d">Both RFID readers and the SD card share one SPI bus '
           '(SPI2); each has its own chip-select pin. Every part shares 3.3 V and GND.</text>')
out.append(f'<text x="{W / 2}" y="{H - 20}" text-anchor="middle" class="d">Pins from main/config.h and diagram.json '
           'of the entrance firmware.</text>')
out.append("</svg>")
open("wiring.svg", "w", encoding="utf-8").write("\n".join(out))
print("wrote wiring.svg")
