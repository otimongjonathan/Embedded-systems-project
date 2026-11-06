"""MQTT bridge: connects the entrance ESP32 (which talks MQTT) to the REST API and database.

The entrance firmware (Embedded-systems-project-system) decides every scan itself and
publishes JSON messages to a public MQTT broker. This bridge subscribes to the same broker,
turns each message into an API request and so stores it in the database, where the
dashboard shows it. Nothing in the firmware has to change.

    ESP32 (Wokwi) --MQTT--> broker.hivemq.com --MQTT--> this bridge --HTTP--> REST API --> SQLite

Topics (from the firmware's config.h and comms.c)
    cocis/event/access       {"tag":"11223344","dir":"IN","result":"OK","ts":1793...}  one per scan
    cocis/state/occupancy    {"count":2,"ts":...}                                      retained
    cocis/state/room1, room2 {"occupied":true,"lights":true,"ts":...}                  retained
    cocis/config/schedule    {"start":"07:00","end":"21:00","version":...}              retained
    cocis/cmd/entrance       LOCKDOWN / UNLOCK   (published by this bridge when lockdown_mode changes)

Run:  bridge.bat  (Windows)  or  ./bridge.sh  (macOS, Linux), with the API already running.
"""
import argparse
import json
import queue
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime

import paho.mqtt.client as mqtt

PREFIX = "cocis"
TOPICS = {
    "access": f"{PREFIX}/event/access",
    "occupancy": f"{PREFIX}/state/occupancy",
    "room1": f"{PREFIX}/state/room1",
    "room2": f"{PREFIX}/state/room2",
    "schedule": f"{PREFIX}/config/schedule",
    "command": f"{PREFIX}/cmd/entrance",
}
# The firmware's result codes (state.c) and how they are stored in access_events.
RESULTS = {
    "OK": ("GRANTED", "OK"),
    "OK_AFTER_HOURS": ("GRANTED", "OK_AFTER_HOURS"),
    "DENIED_UNKNOWN": ("DENIED", "UNKNOWN_TAG"),
    "DENIED_SCHEDULE": ("DENIED", "OUTSIDE_SCHEDULE"),   # the firmware also uses this during lockdown
    "DENIED_ALREADY_IN": ("DENIED", "ALREADY_INSIDE"),
    "DENIED_NOT_IN": ("DENIED", "NOT_INSIDE"),
}
VALID_EPOCH = 1_600_000_000     # before NTP sync the ESP32 clock reads 1970: use the bridge's time
FRESH_S = 600                   # retained messages older than this are left-overs from earlier runs


def when(ts) -> str:
    """ESP32 Unix time to the local time format used in the database."""
    try:
        ts = float(ts)
    except (TypeError, ValueError):
        ts = 0
    moment = datetime.fromtimestamp(ts) if ts > VALID_EPOCH else datetime.now()
    return moment.strftime("%Y-%m-%dT%H:%M:%S")


def fresh(ts) -> bool:
    """True when an ESP32 timestamp is valid and from the last few minutes."""
    try:
        return float(ts) > VALID_EPOCH and time.time() - float(ts) < FRESH_S
    except (TypeError, ValueError):
        return False


def event_id(*parts, ts=None) -> str:
    """Stable id when the ESP32 clock is valid (so a re-delivered message is stored once),
    otherwise a random one."""
    try:
        valid = float(ts) > VALID_EPOCH
    except (TypeError, ValueError):
        valid = False
    tail = str(int(float(ts))) if valid else uuid.uuid4().hex[:10]
    return "MQ-" + "-".join(str(p) for p in parts) + "-" + tail


def access_to_api(msg: dict) -> dict:
    """{"tag","dir","result","ts"} from the ESP32 -> one access event for POST /device/relay."""
    tag = str(msg["tag"]).upper()
    entry = str(msg.get("dir", "IN")).upper() == "IN"
    decision, reason = RESULTS.get(str(msg.get("result")), ("DENIED", "UNKNOWN_TAG"))
    return {"event_uuid": event_id(tag, "IN" if entry else "OUT", ts=msg.get("ts")),
            "rfid_uid": tag, "door": "ENTRY" if entry else "EXIT",
            "decision": decision, "reason": reason, "occurred_at": when(msg.get("ts"))}


def room_to_api(room_no: int, msg: dict) -> dict:
    """{"occupied","lights","ts"} from a PIR room -> one room event for POST /device/relay.
    PIR sensors detect motion, not people, so the count is stored as 1 (occupied) or 0."""
    occupied, lights = bool(msg.get("occupied")), bool(msg.get("lights"))
    return {"event_uuid": event_id(f"room{room_no}", int(occupied), int(lights), ts=msg.get("ts")),
            "room_code": f"LR{room_no}", "occupant_count": 1 if occupied else 0, "light_on": lights,
            "trigger": "MOTION" if occupied else "NO_MOTION", "occurred_at": when(msg.get("ts"))}


class Api:
    """Small HTTP client for the REST API: device key for device calls, admin token for the rest."""

    def __init__(self, base, device_key, username, password):
        self.base, self.device_key = base.rstrip("/"), device_key
        self.username, self.password, self.token = username, password, None

    def call(self, method, path, body=None, admin=False):
        headers = {"Content-Type": "application/json"}
        if admin:
            if not self.token:
                self.login()
            headers["Authorization"] = f"Bearer {self.token}"
        else:
            headers["X-Device-Key"] = self.device_key
        req = urllib.request.Request(self.base + path, method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            if e.code == 401 and admin:
                self.token = None                       # token expired: log in again next time
            return e.code, e.read().decode(errors="replace")

    def login(self):
        status, body = self.call("POST", "/auth/login", {"username": self.username, "password": self.password})
        if status != 200:
            raise RuntimeError(f"Admin login failed ({status}): {body}")
        self.token = body["access_token"]


class Bridge:
    def __init__(self, api: Api, broker: str, port: int):
        self.api, self.broker, self.port = api, broker, port
        self.inbox: queue.Queue = queue.Queue()
        self.known_tags: set[str] = set()
        self.lockdown = None                          # last value sent to the ESP32
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                                  client_id=f"cocis-bridge-{uuid.uuid4().hex[:6]}")
        self.client.on_connect = self.on_connect
        self.client.on_message = lambda c, u, m: self.inbox.put((m.topic, m.payload, m.retain))

    # ---------- MQTT ----------
    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            print(f"[mqtt] connection refused: {reason_code}")
            return
        topics = [TOPICS[k] for k in ("access", "occupancy", "room1", "room2", "schedule")]
        client.subscribe([(t, 1) for t in topics])
        print(f"[mqtt] connected to {self.broker}:{self.port}, listening on {', '.join(topics)}")

    # ---------- message handling (one worker thread, so the database sees them in order) ----------
    def work(self):
        while True:
            topic, payload, retained = self.inbox.get()
            try:
                msg = json.loads(payload)
                if retained and not fresh(msg.get("ts")):
                    # The broker keeps the last message of each state topic; one from an earlier
                    # run (or another group on this public broker) must not overwrite live data.
                    print(f"[old]   {topic}: retained message from an earlier run, ignored")
                    continue
                if topic == TOPICS["access"]:
                    self.on_access(msg)
                elif topic in (TOPICS["room1"], TOPICS["room2"]):
                    self.on_room(1 if topic == TOPICS["room1"] else 2, msg)
                elif topic == TOPICS["occupancy"]:
                    self.on_occupancy(msg)
                elif topic == TOPICS["schedule"]:
                    self.on_schedule(msg)
                self.heartbeat()
            except (ValueError, KeyError, TypeError) as e:
                print(f"[skip] {topic}: unreadable message {payload[:80]!r} ({e})")
            except (OSError, RuntimeError) as e:
                print(f"[error] {topic}: the API could not be reached ({e}); is start.bat running?")

    def relay(self, access=(), rooms=()):
        status, body = self.api.call("POST", "/device/relay",
                                     {"access_events": list(access), "room_events": list(rooms)})
        if status != 200:
            raise RuntimeError(f"relay refused ({status}): {body}")
        return body

    def on_access(self, msg):
        ev = access_to_api(msg)
        if ev["decision"] == "GRANTED" and ev["rfid_uid"] not in self.known_tags:
            self.register(ev["rfid_uid"])                 # a card added on the ESP32 console
        result = self.relay(access=[ev])
        stored = "stored" if result["accepted"] else "already stored"
        print(f"[scan]  {ev['occurred_at'][11:]}  {ev['door']:<5} {ev['rfid_uid']}  "
              f"{ev['decision']} {ev['reason']}  -> access_events ({stored})")

    def on_room(self, room_no, msg):
        ev = room_to_api(room_no, msg)
        result = self.relay(rooms=[ev])
        stored = "stored" if result["accepted"] else "already stored"
        print(f"[room]  LR{room_no}  {'OCCUPIED' if ev['occupant_count'] else 'vacant'}, "
              f"lights {'ON' if ev['light_on'] else 'off'}  -> room_status_logs ({stored})")

    def on_occupancy(self, msg):
        status, occ = self.api.call("GET", "/occupancy", admin=True)
        if status == 200:
            print(f"[count] entrance ESP32 reports {msg.get('count')} inside; "
                  f"database: {occ['people_inside_count']} inside in total (all controllers)")

    def on_schedule(self, msg):
        start, end = msg.get("start"), msg.get("end")
        if not (start and end) or start >= end:
            print(f"[sched] {start} to {end} crosses midnight; not copied to the database")
            return
        status, days = self.api.call("GET", "/schedule", admin=True)
        if status == 200 and all(d["is_open"] and d["open_time"] == start and d["close_time"] == end for d in days):
            print(f"[sched] ESP32 schedule {start} to {end} already in the database")
            return
        body = {"days": [{"day_of_week": d, "is_open": True, "open_time": start, "close_time": end} for d in range(7)]}
        status, _ = self.api.call("PUT", "/schedule", body, admin=True)
        print(f"[sched] ESP32 schedule {start} to {end} copied to access_schedule" if status == 200
              else f"[sched] could not update the schedule ({status})")

    def register(self, tag):
        status, _ = self.api.call("POST", "/users", {"rfid_uid": tag, "full_name": f"Entrance card {tag}",
                                                     "role": "STUDENT"}, admin=True)
        if status in (201, 409):
            self.known_tags.add(tag)
            if status == 201:
                print(f"[user]  card {tag} was authorised on the ESP32: registered in users")

    def heartbeat(self):
        self.api.call("POST", "/device/heartbeat", {"firmware_version": "entrance-mqtt",
                                                    "ip_address": f"via {self.broker}", "pending_events": 0})

    # ---------- dashboard -> ESP32 ----------
    def watch_lockdown(self):
        """Send lockdown_mode from the database to the ESP32 as its own LOCKDOWN / UNLOCK command.
        Retained, so an ESP32 that connects later still receives the current state."""
        while True:
            try:
                status, occ = self.api.call("GET", "/occupancy", admin=True)
                if status == 200 and occ.get("lockdown_mode") != self.lockdown:
                    self.lockdown = occ.get("lockdown_mode")
                    cmd = "LOCKDOWN" if self.lockdown else "UNLOCK"
                    self.client.publish(TOPICS["command"], cmd, qos=1, retain=True)
                    print(f"[cmd]   lockdown_mode is {self.lockdown}: sent {cmd} to {TOPICS['command']}")
            except (OSError, RuntimeError):
                pass
            time.sleep(2)

    def run(self):
        status, users = self.api.call("GET", "/users", admin=True)
        if status == 200:
            self.known_tags = {u["rfid_uid"] for u in users}
        threading.Thread(target=self.work, daemon=True).start()
        threading.Thread(target=self.watch_lockdown, daemon=True).start()
        self.client.connect(self.broker, self.port, keepalive=30)
        self.client.loop_forever(retry_first_connection=True)


def main():
    p = argparse.ArgumentParser(description="MQTT to REST bridge for the CoCIS entrance controller")
    p.add_argument("--broker", default="broker.hivemq.com", help="must match MQTT_URI in the firmware's config.h")
    p.add_argument("--port", type=int, default=1883)
    p.add_argument("--api", default="http://127.0.0.1:8000/api/v1")
    p.add_argument("--device-key", default="mqtt-bridge-key-change-me")
    p.add_argument("--admin", default="admin")
    p.add_argument("--password", default="Admin@CoCIS2026")
    args = p.parse_args()

    api = Api(args.api, args.device_key, args.admin, args.password)
    try:
        api.call("GET", "/health")
        api.login()
    except (OSError, RuntimeError) as e:
        raise SystemExit(f"The API at {args.api} is not reachable or refused the login ({e}).\n"
                         "Start it first with start.bat (Windows) or ./start.sh.")
    print("=" * 70)
    print(f"  CoCIS MQTT bridge   broker {args.broker}:{args.port}  ->  API {args.api}")
    print("  Every scan, room change, occupancy and schedule message is stored in the database.")
    print("  Stop: Ctrl+C")
    print("=" * 70)
    try:
        Bridge(api, args.broker, args.port).run()
    except KeyboardInterrupt:
        print("\nBridge stopped.")


if __name__ == "__main__":
    main()
