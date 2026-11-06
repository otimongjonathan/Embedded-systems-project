"""Virtual ESP32: a software copy of the controller firmware for testing without hardware.

It behaves like reference-firmware/main/main.c: the same serial-menu commands, the same six
access rules when offline, the same IR beam counting and light timer, the same
store-and-forward outbox (kept in simulator/sd/ with a CRC-32 on every line), and
it calls the same /api/v1/device/... endpoints with the same JSON.

Use it to test the API and the dashboard on a laptop, with no Wokwi account, no
tunnel and no sensors. Only the Python standard library is used.

    python simulator/virtual_esp32.py               interactive serial menu
    python simulator/virtual_esp32.py --demo        scripted demonstration of every feature
    python simulator/virtual_esp32.py --time 2026-10-30T09:00   start the clock at a weekday morning

Windows: double-click simulate.bat (menu) or demo.bat (demonstration).
"""
import argparse
import json
import os
import random
import shlex
import sys
import threading
import time
import urllib.error
import urllib.request
import zlib
from datetime import datetime, timedelta
from pathlib import Path

SD = Path(__file__).resolve().parent / "sd"          # stands in for the microSD card
DEVICE_KEY = "esp32-demo-key-change-me"
CROSS_S = 1.5                                         # both beams within 1.5 s
DEMO_CARDS = {"A1B2C3D4": "Lisa Nyonyozi", "11223344": "Dr. Mary Lecturer",   # as in database/seed.sql
              "DEADBEEF": "Security Officer", "CAFEBABE": "Guest Visitor"}


def crc_line(text: str) -> str:
    return f"{text},{zlib.crc32(text.encode()) & 0xFFFFFFFF:08X}"


def crc_ok(line: str):
    data, _, crc = line.rstrip("\n").rpartition(",")
    try:
        return data if int(crc, 16) == zlib.crc32(data.encode()) & 0xFFFFFFFF else None
    except ValueError:
        return None


class VirtualESP32:
    def __init__(self, api_base: str, start_time: datetime | None):
        self.api = api_base.rstrip("/")
        self.offset = (start_time - datetime.now()) if start_time else timedelta(0)
        self.offline = False
        self.lock = threading.Lock()                  # plays the role of state_mutex
        self.boot_id = f"{random.getrandbits(32):08X}"
        self.seq = 0
        self.token = None
        self.cfg = {"config_version": 0, "emergency_mode": False, "light_off_delay_s": 30,
                    "heartbeat_interval_s": 60, "room_light_modes": {"LR1": "AUTO", "LR2": "AUTO"},
                    "schedule": [{"day_of_week": d, "is_open": 1 <= d <= 5, "open_time": "07:00",
                                  "close_time": "22:00"} for d in range(7)],
                    "authorised_tags": [{"rfid_uid": u, "full_name": n, "role": ""} for u, n in DEMO_CARDS.items()]}
        self.cfg["schedule"][6] = {"day_of_week": 6, "is_open": True, "open_time": "08:00", "close_time": "17:00"}
        self.inside: set[str] = set()
        self.rooms = {code: {"count": 0, "light_on": False, "empty_since": None, "first": None}
                      for code in ("LR1", "LR2")}
        SD.mkdir(exist_ok=True)
        self.outbox = SD / "outbox.csv"
        self.outbox.touch()
        self.next_beat = 0.0
        self.running = True

    # ---------- time ----------
    def now(self) -> datetime:
        return datetime.now() + self.offset

    def iso(self) -> str:
        return self.now().strftime("%Y-%m-%dT%H:%M:%S")

    def within_schedule(self) -> bool:
        t = self.now()
        dow = (t.weekday() + 1) % 7                   # 0 = Sunday, like struct tm.tm_wday
        day = next(d for d in self.cfg["schedule"] if d["day_of_week"] == dow)
        return bool(day["is_open"]) and day["open_time"] <= t.strftime("%H:%M") < day["close_time"]

    def uuid(self) -> str:
        self.seq += 1
        return f"01-{self.boot_id}-{self.seq:05d}"

    # ---------- HTTP ----------
    def call(self, method, path, body=None, admin=False):
        """Returns (status, json). status -1 means the API could not be reached."""
        if self.offline:
            return -1, None
        req = urllib.request.Request(self.api + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", "X-Device-Key": DEVICE_KEY})
        if admin and self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=4) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"null")
            except ValueError:
                return e.code, None
        except (urllib.error.URLError, OSError):
            return -1, None

    # ---------- SD card ----------
    def sd_append(self, name, text):
        with open(SD / name, "a", encoding="utf-8") as f:
            f.write(crc_line(text) + "\n")

    def queued(self) -> int:
        return sum(1 for _ in open(self.outbox, encoding="utf-8"))

    # ---------- access control ----------
    def decide_offline(self, uid, entry):
        """The six rules of api/access_logic.py, on the cached config."""
        tags = {t["rfid_uid"]: t for t in self.cfg["authorised_tags"]}
        if self.cfg["emergency_mode"]:
            return "GRANTED", "EMERGENCY_OPEN"
        if uid not in tags:
            return "DENIED", "UNKNOWN_TAG"
        if not self.within_schedule():
            return "DENIED", "OUTSIDE_SCHEDULE"
        if entry and uid in self.inside:
            return "DENIED", "ALREADY_INSIDE"
        if not entry and uid not in self.inside:
            return "DENIED", "NOT_INSIDE"
        return "GRANTED", "OK"

    def tap(self, uid, entry):
        uid = uid.upper()
        door = "ENTRY" if entry else "EXIT"
        ev = {"event_uuid": self.uuid(), "rfid_uid": uid, "door": door, "occurred_at": self.iso()}
        status, resp = self.call("POST", "/device/access/check", ev)
        with self.lock:
            if status == 200:
                decision, reason, source = resp["decision"], resp["reason"], "API"
                name = (resp.get("user") or {}).get("full_name", "Unknown card")
            else:
                decision, reason = self.decide_offline(uid, entry)
                source = "offline"
                name = next((t["full_name"] for t in self.cfg["authorised_tags"] if t["rfid_uid"] == uid), "Unknown card")
                self.sd_append("outbox.csv", f"A,{ev['event_uuid']},{uid},{door},{decision},{reason},{ev['occurred_at']}")
            if decision == "GRANTED":                 # the server opens a visit for every granted scan
                (self.inside.add if entry else self.inside.discard)(uid)
            empty = decision == "GRANTED" and not entry and not self.inside
        self.sd_append(f"AC{self.now():%y%m%d}.CSV", f"{ev['event_uuid']},{uid},{door},{decision},{reason},{ev['occurred_at']}")
        door_msg = "door opens for 3 s" if decision == "GRANTED" else "door stays shut"
        print(f"[{ev['occurred_at'][11:]}] {door} {uid} {name}: {decision} {reason} ({source}), {door_msg}")
        if empty:
            self.reset_rooms("COUNT_RESET")
        return decision, reason

    # ---------- lecture rooms ----------
    def report_room(self, code, trigger):
        r = self.rooms[code]
        ev = {"event_uuid": self.uuid(), "room_code": code, "occupant_count": r["count"],
              "light_on": r["light_on"], "trigger": trigger, "occurred_at": self.iso()}
        line = f"{ev['event_uuid']},{code},{r['count']},{int(r['light_on'])},{trigger},{ev['occurred_at']}"
        self.sd_append(f"RM{self.now():%y%m%d}.CSV", line)
        if self.call("POST", "/device/rooms/status", ev)[0] != 200:
            self.sd_append("outbox.csv", "R," + line)

    def update_light(self, code, trigger):
        """Light rules: emergency or FORCE_ON = on, FORCE_OFF = off, AUTO = on while count > 0,
        off when the room has been empty for light_off_delay_s seconds. Caller holds the lock."""
        r = self.rooms[code]
        mode = self.cfg["room_light_modes"].get(code, "AUTO")
        if self.cfg["emergency_mode"] or mode == "FORCE_ON":
            want = True
        elif mode == "FORCE_OFF":
            want = False
        elif r["count"] > 0:
            want = True
        else:
            want = r["light_on"] and time.time() - (r["empty_since"] or 0) < self.cfg["light_off_delay_s"]
        if want != r["light_on"] or trigger:
            r["light_on"] = want
            self.report_room(code, trigger or ("EMERGENCY" if self.cfg["emergency_mode"] else
                                               "MANUAL_OVERRIDE" if mode != "AUTO" else "PERSON_OUT"))

    def person(self, code, delta):
        with self.lock:
            r = self.rooms[code]
            if delta < 0 and r["count"] == 0:
                print(f"[{code}] count is already 0 (safeguard: never below 0)")
                return
            r["count"] += delta
            r["empty_since"] = time.time() if r["count"] == 0 else None
            self.update_light(code, "PERSON_IN" if delta > 0 else "PERSON_OUT")
            print(f"[{code}] person {'in' if delta > 0 else 'out'}, now {r['count']} inside, lights {'ON' if r['light_on'] else 'off'}")

    def beam(self, code, beam):
        """Feed one beam break (A = corridor side, B = room side) to the state machine."""
        r = self.rooms[code]
        t = time.time()
        if r["first"] and t - r["first"][1] > CROSS_S:
            r["first"] = None                         # incomplete crossing, ignored
        if r["first"] and r["first"][0] != beam:
            r["first"] = None
            self.person(code, +1 if beam == "B" else -1)
        else:
            r["first"] = (beam, t)

    def reset_rooms(self, trigger):
        with self.lock:
            for code, r in self.rooms.items():
                if r["count"]:
                    r["count"], r["empty_since"] = 0, time.time()
                    self.update_light(code, trigger)
                    print(f"[{code}] count reset to 0 ({trigger})")

    # ---------- sync ----------
    def fetch_config(self):
        status, cfg = self.call("GET", "/device/config")
        if status != 200:
            return False
        with self.lock:
            self.cfg = cfg
            if self.queued() == 0:                    # server knows best once our queue is empty
                self.inside = set(cfg["currently_inside"])
            with open(SD / "users.csv", "w", encoding="utf-8") as f:
                f.writelines(f"{t['rfid_uid']},{t['full_name']},{t['role']}\n" for t in cfg["authorised_tags"])
        print(f"[sync] config version {cfg['config_version']} downloaded and saved to the SD card")
        return True

    def heartbeat(self):
        status, resp = self.call("POST", "/device/heartbeat", {
            "firmware_version": "virtual-1.0", "ip_address": "127.0.0.1", "free_heap": 150000,
            "sd_free_kb": 950000, "pending_events": self.queued()})
        if status != 200:
            return
        with self.lock:
            self.cfg["emergency_mode"] = resp["emergency_mode"]
            changed = resp["config_version"] != self.cfg["config_version"]
        if changed:
            self.fetch_config()

    def flush_outbox(self):
        lines = open(self.outbox, encoding="utf-8").readlines()
        if not lines or self.offline:
            return
        batch = {"access_events": [], "room_events": []}
        for line in lines[:40]:
            data = crc_ok(line)
            if not data:
                continue                              # damaged line (torn write): skipped
            f = data.split(",")
            if f[0] == "A":
                batch["access_events"].append(dict(zip(
                    ["event_uuid", "rfid_uid", "door", "decision", "reason", "occurred_at"], f[1:])))
            else:
                batch["room_events"].append({"event_uuid": f[1], "room_code": f[2], "occupant_count": int(f[3]),
                                             "light_on": f[4] == "1", "trigger": f[5], "occurred_at": f[6]})
        if not batch["access_events"] and not batch["room_events"]:
            open(self.outbox, "w", encoding="utf-8").writelines(lines[40:])   # only damaged lines
            return
        status, resp = self.call("POST", "/device/events/batch", batch)
        if status in (200, 422):
            open(self.outbox, "w", encoding="utf-8").writelines(lines[40:])
            if status == 200:
                print(f"[sync] uploaded {len(resp['accepted'])} queued events "
                      f"({len(resp['duplicates'])} already known), {len(lines[40:])} left")

    def background(self):
        """network_task and the light timer of lighting_task."""
        while self.running:
            with self.lock:
                for code in self.rooms:
                    if self.rooms[code]["count"] and not self.within_schedule():
                        self.rooms[code]["count"] = 0
                        self.update_light(code, "COUNT_RESET")
                    else:
                        self.update_light(code, None)
            if not self.offline and time.time() >= self.next_beat:
                self.heartbeat()
                self.next_beat = time.time() + self.cfg["heartbeat_interval_s"]
            if not self.offline:
                self.flush_outbox()
            time.sleep(1)

    # ---------- serial menu ----------
    HELP = """
=========== CoCIS virtual ESP32 menu ===========
 status                 everything at a glance
 inside | rooms | schedule | outbox
 sync                   upload now and download the config
 offline on|off         simulate losing the network
 tap <UID> entry|exit   card tap, e.g. tap A1B2C3D4 entry
 beam LR1|LR2 A|B       break one IR beam (A then B = in, B then A = out)
 walk LR1|LR2 in|out    a full crossing (both beams)
 time <YYYY-MM-DDTHH:MM> set the simulated clock
 login <user> <pass> | logout
 setday <0-6> <HH:MM> <HH:MM> | setday <0-6> closed
 emergency on|off <reason>
 light LR1|LR2 AUTO|FORCE_ON|FORCE_OFF
 help | quit
================================================"""

    def staff(self, method, path, body):
        if not self.token:
            print("Log in first: login admin Admin@CoCIS2026")
            return
        status, resp = self.call(method, path, body, admin=True)
        if status == 200:
            print("Done. Downloading the new config...")
            self.fetch_config()
        elif status == -1:
            print("The API cannot be reached: settings can only be changed online.")
        else:
            print(f"Refused ({status}): {resp}")

    def command(self, line):
        a = shlex.split(line)
        if not a:
            return
        c = a[0].lower()
        if c in ("help", "?"):
            print(self.HELP)
        elif c == "status":
            print(f"Time       {self.iso()} ({'OPEN' if self.within_schedule() else 'CLOSED'})\n"
                  f"Network    {'OFFLINE (simulated)' if self.offline else 'ONLINE'}\nAPI        {self.api}\n"
                  f"Config     version {self.cfg['config_version']}\nEmergency  {'ON' if self.cfg['emergency_mode'] else 'off'}\n"
                  f"Inside     {len(self.inside)} people\n" +
                  "".join(f"{k}        {r['count']} people, lights {'ON' if r['light_on'] else 'off'} "
                          f"({self.cfg['room_light_modes'].get(k, 'AUTO')})\n" for k, r in self.rooms.items()) +
                  f"Queue      {self.queued()} events waiting\nStaff      {'logged in' if self.token else 'not logged in'}")
        elif c == "inside":
            print(f"{len(self.inside)} inside:", ", ".join(sorted(self.inside)) or "nobody")
        elif c == "rooms":
            for k, r in self.rooms.items():
                print(f"  {k}  {r['count']} people  lights {'ON' if r['light_on'] else 'off'}")
        elif c == "schedule":
            for d in self.cfg["schedule"]:
                day = "Sun Mon Tue Wed Thu Fri Sat".split()[d["day_of_week"]]
                print(f"  {day}  " + (f"{d['open_time']} to {d['close_time']}" if d["is_open"] else "closed"))
        elif c == "outbox":
            print(f"{self.queued()} events waiting for upload (simulator/sd/outbox.csv)")
        elif c == "sync":
            self.flush_outbox(); self.fetch_config()
        elif c == "offline" and len(a) == 2:
            self.offline = a[1] == "on"
            print("Network OFF (simulated): scans are decided locally and queued" if self.offline else "Network back ON")
            if not self.offline:
                self.next_beat = 0
        elif c == "tap" and len(a) == 3:
            self.tap(a[1], a[2].lower() in ("entry", "in"))
        elif c == "beam" and len(a) == 3:
            self.beam(a[1].upper(), a[2].upper())
        elif c == "walk" and len(a) == 3:
            first, second = ("A", "B") if a[2] == "in" else ("B", "A")
            self.beam(a[1].upper(), first); time.sleep(0.3); self.beam(a[1].upper(), second)
        elif c == "time" and len(a) == 2:
            self.offset = datetime.fromisoformat(a[1]) - datetime.now()
            print("Clock set to", self.iso())
        elif c == "login" and len(a) == 3:
            status, resp = self.call("POST", "/auth/login", {"username": a[1], "password": a[2]})
            if status == 200:
                self.token = resp["access_token"]
                print(f"Logged in as {a[1]} ({resp['role']})")
            else:
                print("The API cannot be reached" if status == -1 else "Wrong username or password")
        elif c == "logout":
            self.call("POST", "/auth/logout", admin=True); self.token = None; print("Logged out")
        elif c == "setday" and len(a) >= 3:
            d = int(a[1])
            day = ({"day_of_week": d, "is_open": False, "open_time": "07:00", "close_time": "22:00"} if a[2] == "closed"
                   else {"day_of_week": d, "is_open": True, "open_time": a[2], "close_time": a[3]})
            self.staff("PUT", "/schedule", {"days": [day]})
        elif c == "emergency" and len(a) >= 2:
            self.staff("PUT", "/settings/emergency", {"enabled": a[1] == "on", "reason": " ".join(a[2:]) or "serial menu"})
        elif c == "light" and len(a) == 3:
            self.staff("PUT", f"/rooms/{a[1].upper()}/light-mode", {"mode": a[2].upper()})
        elif c in ("quit", "exit"):
            raise SystemExit
        else:
            print("Unknown command. Type help")


def demo(esp: VirtualESP32, pause: float):
    """A scripted run through every feature, for the presentation."""
    def step(title, *cmds):
        print(f"\n--- {title} ---")
        for cmd in cmds:
            print(f"> {cmd}")
            esp.command(cmd)
            time.sleep(pause)

    step("1. Start-up: download the config and check the API", "sync", "status")
    step("2. Lisa enters the building (online decision by the API)", "tap A1B2C3D4 entry")
    step("3. Anti-passback: the same card again at the entry is refused", "tap A1B2C3D4 entry")
    step("4. An unknown card is refused", "tap 0BADCAFE entry")
    step("5. Two people walk into Lecture Room 1, one leaves (IR beams)", "walk LR1 in", "walk LR1 in", "walk LR1 out", "rooms")
    step("6. Wi-Fi is lost: the ESP32 keeps working on its own",
         "offline on", "tap 11223344 entry", "walk LR2 in", "outbox")
    step("7. Wi-Fi is back: the queue is uploaded with no duplicates", "offline off", "sync", "outbox")
    step("8. Staff log in through the serial menu and use emergency mode",
         "login admin Admin@CoCIS2026", "emergency on Fire drill", "tap CAFEBABE entry", "emergency off Drill over")
    step("9. Everyone leaves: lights go off after the delay", "walk LR1 out", "walk LR2 out",
         "tap A1B2C3D4 exit", "tap 11223344 exit", "tap CAFEBABE exit", "rooms")
    delay = esp.cfg["light_off_delay_s"]
    print(f"\nThe rooms are empty. Unlike a motion sensor, the count (not movement) decides,"
          f"\nand the lights switch off {delay} s after the count reaches 0. Waiting...")
    time.sleep(delay + 2)
    step("10. Lights are now off in both rooms", "rooms")
    print("\nDemo finished. Open the dashboard (http://127.0.0.1:8000/dashboard/) to see all of this recorded.")


def main():
    p = argparse.ArgumentParser(description="Virtual ESP32 controller for the CoCIS system")
    p.add_argument("--api", default="http://127.0.0.1:8000/api/v1")
    p.add_argument("--time", help="start the simulated clock here, e.g. 2026-10-30T09:00 (a weekday morning)")
    p.add_argument("--demo", action="store_true", help="run the scripted demonstration")
    p.add_argument("--pause", type=float, default=1.0, help="seconds between demo steps")
    args = p.parse_args()

    start = datetime.fromisoformat(args.time) if args.time else None
    if args.demo and not start:                       # the demo needs the building to be open
        now = datetime.now()
        if not (now.weekday() < 5 and 7 <= now.hour < 21):
            start = (now - timedelta(days=(now.weekday() - 2) % 7)).replace(hour=9, minute=0, second=0)
            print(f"Building is closed now, so the demo clock starts on {start:%A %d %B %Y} at 09:00")
    esp = VirtualESP32(args.api, start)
    if esp.call("GET", "/health")[0] != 200:
        print(f"The API at {args.api} is not reachable: start it first (start.bat or ./start.sh).")
        print("Continuing anyway: everything is decided offline and queued on the virtual SD card.")
    threading.Thread(target=esp.background, daemon=True).start()
    if args.demo:
        demo(esp, args.pause)
        return
    print(esp.HELP)
    while True:
        try:
            esp.command(input("> "))
        except (EOFError, KeyboardInterrupt, SystemExit):
            break
        except Exception as e:                        # a typo must not stop the controller
            print("Error:", e)
    esp.running = False


if __name__ == "__main__":
    os.system("")                                     # enable ANSI handling in old Windows consoles
    main()
