// Builds docs/Video_Script_Lisa_Nyonyozi.docx: the narration and screen plan for Lisa's video (run: NODE_PATH=$(npm root -g) node docs/make_video_script.js docs/Video_Script_Lisa_Nyonyozi.docx).
const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle,
        AlignmentType, HeadingLevel, LevelFormat } = require("docx");

const FONT = "Garamond";
const OUT = process.argv[2];
const b = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const borders = { top: b, bottom: b, left: b, right: b };

function runs(text) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) =>
    t.startsWith("**") ? new TextRun({ text: t.slice(2, -2), bold: true }) : new TextRun(t));
}
const P = (t) => new Paragraph({ children: runs(t), spacing: { after: 120, line: 300 } });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const bullet = (t) => new Paragraph({ numbering: { reference: "b", level: 0 }, children: runs(t), spacing: { after: 60 } });

const W = [3000, 6026];
function cell(text, w, head) {
  return new TableCell({
    borders, width: { size: w, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: String(text).split("\n").map((line) => new Paragraph({
      spacing: { after: 40, line: 280 }, children: head ? [new TextRun({ text: line, bold: true })] : runs(line) })),
  });
}
// A scene: what is on screen (left) and what to say (right).
function scene(rows) {
  return new Table({
    width: { size: W[0] + W[1], type: WidthType.DXA }, columnWidths: W,
    rows: [new TableRow({ tableHeader: true, children: [cell("On screen", W[0], true), cell("Say", W[1], true)] }),
           ...rows.map(([show, say]) => new TableRow({ cantSplit: true, children: [cell(show, W[0]), cell(say, W[1])] }))],
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

const body = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
    children: [new TextRun({ text: "Video Script: Lisa Nyonyozi", bold: true, size: 40 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 },
    children: [new TextRun({ text: "Use cases, architecture and network, database, REST API, and how the ESP32's data is saved", italics: true })] }),

  H1("Before Recording"),
  bullet("Run **start.bat**, then **bridge.bat**. Keep both windows visible."),
  bullet("Have the entrance firmware ready to run in Wokwi. If Wokwi is not available, have **entrance_sim.bat** ready; it sends the same messages."),
  bullet("Open in the browser: **http://127.0.0.1:8000/dashboard/** (logged in, on the Database tab with access_events selected, auto-refresh on) and **http://127.0.0.1:8000/docs**."),
  bullet("Open the report at these figures: system use case diagram, final architecture, network view, the two MQTT sequence diagrams, and the ER diagram."),
  bullet("Open **bridge/mqtt_bridge.py** at the function **access_to_api**, **api/schemas.py** at **class EventBatch**, and **api/routes_device.py** at **def relay**."),
  bullet("For a clean demo, reset the database first (stop start.bat, run reset_db.bat, start again)."),
  bullet("Target length: about 12 minutes. Speak slowly; pause on each diagram."),

  H1("Scene 1: Introduction (0:00 to 0:40)"),
  scene([
    ["Report cover", "Hello, my name is Lisa Nyonyozi, registration number ________. In our group I was responsible for the use cases, the system architecture and network design, the central database, the REST API, and the bridge that connects our ESP32 controller to that database. I will explain each of these, and then show live how a card scan travels from the ESP32 to the database and the dashboard."],
  ]), gap(),

  H1("Scene 2: Use Cases (0:40 to 2:20)"),
  scene([
    ["System use case diagram", "We started with who uses the system. Building users tap RFID cards at the entrance. Room occupants are detected by motion sensors. Management viewers watch occupancy and reports, security officers can lock the entrance and override lights, and the administrator manages cards and the schedule. The roles build on each other, as the hollow arrows show."],
    ["Point to UC01 to UC03", "Enter Building and Exit Building both include Verify Access. The ESP32 checks that the card is authorised, that the time is inside the opening hours, and that the person is not already inside, then opens the right door."],
    ["Point to UC04 to UC06", "In the lecture rooms a PIR motion sensor detects people. Motion switches the light on, and after five seconds without motion it switches off."],
    ["Point to UC09 to UC13", "Configuration needs authentication: at the ESP32 console with the admin PIN, and on the dashboard with a staff login and role."],
    ["Controller, bridge and API use case diagram", "This diagram shows how data reaches the database. The ESP32 publishes its scans and room states over MQTT, UC14. The MQTT bridge relays them to the database, UC15, and every request includes device authentication and is stored only once. Each use case has a full specification in Chapter 2."],
  ]), gap(),

  H1("Scene 3: Architecture and Network (2:20 to 4:20)"),
  scene([
    ["Final architecture figure", "The architecture has four layers. On the left are the field devices: two MFRC522 RFID readers, two door servos, LEDs, a buzzer and an LCD at the entrance; a PIR sensor and a light in each lecture room; and an SD card."],
    ["Point to the ESP32 layer", "One ESP32 runs separate FreeRTOS tasks: the rfid task reads both readers and decides, the door task opens the servos, the room lights task reads the PIR sensors, the console task runs the menu, and the MQTT client handles the network. A mutex protects the shared state and a queue passes door requests."],
    ["Point to the decision rules table", "These are the rules the ESP32 applies, in order: lockdown, unknown card, entry outside the hours, already inside, not inside, otherwise open. Leaving after hours is allowed for safety but recorded as OK after hours."],
    ["Point to layers 3 and 4", "The ESP32 does not call the server directly. It publishes JSON messages to an MQTT broker, broker dot hivemq dot com. On the server, a bridge subscribes to those messages and calls our REST API, which saves them in the SQLite database. The dashboard reads the same API."],
    ["Network view figure", "A common question is whether the ESP32 must be on the same network as the database. It does not. The ESP32, on the Wokwi Wi-Fi, and our laptop each open an outgoing connection to the broker on the internet, and the broker passes messages between them. So no router setup, port forwarding or tunnel is needed, and the database is never exposed to the internet. The bridge talks to the API on the same laptop, at 127.0.0.1 port 8000. For a real deployment we would use a private broker with a password and TLS; only one address would change."],
  ]), gap(),

  H1("Scene 4: The Database (4:20 to 5:50)"),
  scene([
    ["ER diagram", "The database is SQLite, one file, with eleven tables. Users holds the card holders. Access events stores every scan, granted or denied, with its door, result, reason and source; scans from the ESP32 have source MQTT. Building visits pairs each entry with its exit, giving time in and time out."],
    ["Point to building_visits", "Who is inside right now is simply every visit with no time out; that is the view v_people_inside. A partial unique index means one person can never have two open visits."],
    ["Point to rooms and room_status_logs", "Rooms holds the live state of each lecture room, and room status logs keeps every change, with trigger MOTION or NO_MOTION from the PIR sensors. That history gives the energy report."],
    ["Point to the remaining tables", "The schedule, settings such as lockdown mode, staff accounts and sessions, the devices with their health, and an audit log of every change complete the design."],
    ["Data dictionary", "Two rules protect the data. Every event has an event_uuid, and that column is unique, so the same event can never be stored twice. And every write runs inside a transaction, so simultaneous requests cannot leave half-finished records."],
  ]), gap(),

  H1("Scene 5: The REST API, Endpoints and Models (5:50 to 8:20)"),
  scene([
    ["Swagger UI at /docs", "The API is written in Python with FastAPI, and Swagger UI documents every endpoint. There are two kinds of client. Devices, here the bridge, send a device key in the X-Device-Key header. Staff log in with a username and password and get a token that lasts eight hours; each endpoint checks the role: viewer, security or super admin."],
    ["Scroll the device endpoints", "The device endpoints are: relay, which stores events the controller has already decided; heartbeat, which reports the controller's health and returns the lockdown flag; and, for controllers that call the API directly, access check, room status, batch and config."],
    ["Scroll the management endpoints", "The management endpoints cover login, occupancy, the access log and visits, rooms and their history, light overrides, users, the schedule, emergency and lockdown settings, the daily report, devices, the audit log, and a read-only database viewer."],
    ["api/schemas.py, class EventBatch", "Every request body is a Pydantic model. EventBatch holds a list of access events and room events. Each access event must have a door of ENTRY or EXIT, a decision of GRANTED or DENIED, a known reason code and a valid time. FastAPI checks this before any of our code runs, so bad data is refused with status 422 and never reaches the database."],
    ["Open POST /device/relay, Try it out, Execute", "Here I send one relayed scan with the bridge's device key. The answer lists it as accepted. If I execute the same request again, it is listed under duplicates and not stored a second time."],
    ["Open GET /occupancy, Execute", "The occupancy endpoint shows who is inside and the state of each room. These are the same data the dashboard shows."],
  ]), gap(),

  H1("Scene 6: How the ESP32's Data Is Saved (8:20 to 11:20)"),
  scene([
    ["Sequence diagram: entrance scan", "Now the full path of one scan. A user taps a card. The rfid task reads the UID, the rules decide, and the door opens straight away, so the person never waits for the network. The scan is written to the SD card and published to the topic cocis slash event slash access, as JSON with the tag, the direction, the result and the time."],
    ["bridge/mqtt_bridge.py, access_to_api", "The bridge is subscribed to that topic. It turns the ESP32's result code into our database codes, for example OK becomes GRANTED with reason OK, and DENIED_UNKNOWN becomes DENIED with UNKNOWN_TAG. It builds a stable event id from the card, the direction and the ESP32's time."],
    ["Same file, the relay call", "Then it makes an HTTP POST to slash api slash v1 slash device slash relay on our own laptop, with the device key header and a JSON body. That is the whole request: method POST, the URL, two headers, and the JSON."],
    ["api/routes_device.py, def relay", "On the API, FastAPI validates the body against the model, checks the device key, and then, inside one transaction, checks whether the event id already exists, inserts the access event with source MQTT, and opens or closes the visit. It answers with the accepted ids."],
    ["Sequence diagram: rooms and lockdown", "Room changes follow the same path, to room status logs. And one message travels the other way: when security sets lockdown on the dashboard, the bridge publishes LOCKDOWN to the ESP32's command topic. In the current firmware this command is compared with 19 characters instead of 18, so changing that one number makes lockdown work."],
    ["Live: Wokwi (or entrance_sim.bat), bridge window and the dashboard Database tab side by side", "Let me show it live. I tap a card in Wokwi. In the bridge window the scan appears, stored in access events. In the dashboard's Database tab the new row appears within three seconds, highlighted in yellow, with source MQTT. Now I trigger the motion sensor in room one: the light comes on, and a MOTION row appears in room status logs. On the Overview, the person is listed as inside and the room shows occupied."],
  ]), gap(),

  H1("Scene 7: Closing (11:20 to 12:00)"),
  scene([
    ["Network view or architecture figure", "To summarise: I designed the use cases, the architecture and the network, built the database and the REST API, and built the bridge that saves every event from our ESP32 without changing its firmware, and without the controller and the database sharing a network. The details are in Chapters 2, 3, 6 and 7 of our report. Thank you."],
  ]), gap(),

  H1("Questions to Be Ready For"),
  scene([
    ["Does the ESP32 need the same network as the database?", "No. Both connect out to the broker over the internet. The database stays on the laptop, reached only by the bridge and the API on 127.0.0.1."],
    ["Why MQTT and a bridge instead of HTTP from the ESP32?", "Publishing never makes the door wait for the server, many subscribers can read the same messages, and the firmware did not need to change. The bridge does the HTTP side."],
    ["What stops duplicate records?", "A stable event_uuid built from card, direction and time, and a UNIQUE column. A second delivery is reported as a duplicate."],
    ["What are the models?", "Pydantic classes such as EventBatch, AccessCheck, RoomStatus, Login and ScheduleUpdate. FastAPI validates every request against them and refuses bad data with 422."],
    ["What if the internet goes down?", "The doors keep working because the ESP32 decides locally and logs to the SD card. Those scans reach the database only if the log is uploaded later, which is listed as future work."],
    ["Why PIR, and its weakness?", "Cheap and simple, but it detects movement, not people. A longer hold time, the light override, or counting people with infrared beams at the door solve it."],
    ["How is the schedule protected?", "The admin PIN at the ESP32 console; on the dashboard only a SUPER_ADMIN can change it, and every change is audited."],
  ]),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 24, color: "000000" } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 30, bold: true, color: "000000" }, paragraph: { spacing: { before: 300, after: 140 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 26, bold: true, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: body }],
});
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log("wrote", OUT); });
