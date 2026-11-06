"""Stand-in for the entrance ESP32: publishes exactly the MQTT messages its firmware publishes.

Use it to test the bridge, the database and the dashboard when the Wokwi simulation of the
entrance firmware is not running. The rules copy the firmware's state.c (authorised tags,
one daily time window, anti-passback) and the JSON copies comms.c, byte for byte.

    python bridge/entrance_sim.py            interactive (type help)
    python bridge/entrance_sim.py --demo     scripted run
"""
import argparse
import json
import shlex
import time
from datetime import datetime

import paho.mqtt.client as mqtt

TOPIC_EVENT, TOPIC_OCC, TOPIC_SCHED = "cocis/event/access", "cocis/state/occupancy", "cocis/config/schedule"


class Entrance:
    def __init__(self, broker, port):
        self.authorised = {"11223344", "01020304"}       # DEFAULT_AUTHORIZED_TAGS in config.h
        self.inside: list[str] = []
        self.start, self.end = 7 * 60, 21 * 60           # state_init(): 07:00 to 21:00
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="cocis-entrance-sim")
        self.client.connect(broker, port, keepalive=30)
        self.client.loop_start()

    def publish(self, topic, payload, retain):
        self.client.publish(topic, payload, qos=1, retain=retain).wait_for_publish(5)

    def in_window(self, minute):
        return self.start <= minute < self.end if self.start <= self.end else (minute >= self.start or minute < self.end)

    def scan(self, tag, entry):
        """state_evaluate() followed by comms_publish_event() and comms_publish_occupancy()."""
        tag = tag.upper().zfill(8)
        now = datetime.now()
        minute = now.hour * 60 + now.minute
        if tag not in self.authorised:
            result = "DENIED_UNKNOWN"
        elif entry:
            result = ("DENIED_SCHEDULE" if not self.in_window(minute) else
                      "DENIED_ALREADY_IN" if tag in self.inside else "OK")
            if result == "OK":
                self.inside.append(tag)
        elif tag not in self.inside:
            result = "DENIED_NOT_IN"
        else:
            self.inside.remove(tag)
            result = "OK" if self.in_window(minute) else "OK_AFTER_HOURS"
        ts = int(time.time())
        self.publish(TOPIC_EVENT, json.dumps({"tag": tag, "dir": "IN" if entry else "OUT", "result": result, "ts": ts},
                                             separators=(",", ":")), retain=False)
        self.publish(TOPIC_OCC, f'{{"count":{len(self.inside)},"ts":{ts}}}', retain=True)
        print(f"  {'IN ' if entry else 'OUT'} {tag}: {result}   (inside: {len(self.inside)})")

    def room(self, n, on):
        """comms_publish_room(): PIR motion turns a room's lights on, 5 s without motion turns them off."""
        self.publish(f"cocis/state/room{n}", f'{{"occupied":{str(on).lower()},"lights":{str(on).lower()},'
                                             f'"ts":{int(time.time())}}}', retain=True)
        print(f"  room{n}: {'motion, lights ON' if on else 'vacant, lights off'}")

    def schedule(self, start, end):
        """comms_publish_schedule() after 'schedule set HH:MM HH:MM'."""
        h1, m1 = map(int, start.split(":")); h2, m2 = map(int, end.split(":"))
        self.start, self.end = h1 * 60 + m1, h2 * 60 + m2
        self.publish(TOPIC_SCHED, f'{{"start":"{h1:02d}:{m1:02d}","end":"{h2:02d}:{m2:02d}",'
                                  f'"version":{int(time.time())}}}', retain=True)
        print(f"  schedule {h1:02d}:{m1:02d} to {h2:02d}:{m2:02d}")

    def command(self, line):
        a = shlex.split(line)
        if not a:
            return
        if a[0] == "scan" and len(a) == 3:
            self.scan(a[2], a[1] in ("in", "entry", "en"))
        elif a[0] == "user" and len(a) == 3 and a[1] == "add":
            self.authorised.add(a[2].upper().zfill(8)); print(f"  user {a[2].upper()} authorised")
        elif a[0] == "room" and len(a) == 3:
            self.room(int(a[1]), a[2] in ("on", "motion"))
        elif a[0] == "schedule" and len(a) == 3:
            self.schedule(a[1], a[2])
        elif a[0] == "who":
            print("  inside:", ", ".join(self.inside) or "nobody")
        elif a[0] in ("help", "?"):
            print("  scan in|out <HEX>   user add <HEX>   room 1|2 on|off   schedule HH:MM HH:MM   who   quit")
        elif a[0] in ("quit", "exit"):
            raise SystemExit
        else:
            print("  unknown command, type help")


def demo(e: Entrance, pause: float):
    steps = [("Card 11223344 (lecturer) enters", "scan in 11223344"),
             ("Card 01020304 (student) enters", "scan in 01020304"),
             ("The same card again: anti-passback", "scan in 01020304"),
             ("An unknown card", "scan in DEADBEEF"),
             ("Motion in room 1: lights on", "room 1 on"),
             ("Admin authorises a new card on the ESP32", "user add AABBCCDD"),
             ("The new card enters", "scan in AABBCCDD"),
             ("Room 1 vacant: lights off", "room 1 off"),
             ("Lecturer leaves", "scan out 11223344")]
    for title, cmd in steps:
        print(f"\n--- {title} ---\n> {cmd}")
        e.command(cmd)
        time.sleep(pause)
    print("\nDone. Check the dashboard (Overview and Database tabs).")


def main():
    p = argparse.ArgumentParser(description="Publishes the entrance ESP32's MQTT messages")
    p.add_argument("--broker", default="broker.hivemq.com")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--demo", action="store_true")
    p.add_argument("--pause", type=float, default=2.0)
    args = p.parse_args()
    e = Entrance(args.broker, args.port)
    print(f"Entrance stand-in connected to {args.broker}. It publishes the same messages as the ESP32 firmware.")
    if args.demo:
        demo(e, args.pause)
        return
    e.command("help")
    while True:
        try:
            e.command(input("> "))
        except (EOFError, KeyboardInterrupt, SystemExit):
            break


if __name__ == "__main__":
    main()
