// Builds docs/CoCIS_Smart_System_Report.docx
// Run: NODE_PATH=$(npm root -g) node docs/build_report.js && python3 docs/postprocess_report.py
//
// Section, figure and table numbers are generated automatically. Content is
// built twice: the first pass records every number under its key, the second
// pass uses them, so cross-references like S("sync") are always correct.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, ImageRun, PageBreak, TableOfContents, SequentialIdentifier,
  Footer, Header, PageNumber, LevelFormat, VerticalAlign, NumberFormat,
} = require("docx");

const D = path.join(__dirname, "diagrams");
const FONT = "Garamond";
const MONO = "Consolas";

// ---------------------------------------------------------------- numbering
const REG = {};
let cnt;
const S = (k) => REG["s:" + k] || "?";   // section number
const F = (k) => REG["f:" + k] || "?";   // figure number
const T = (k) => REG["t:" + k] || "?";   // table number

// ---------------------------------------------------------------- helpers
function runs(text, base = {}) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/).filter(Boolean).map((t) => {
    if (t.startsWith("**")) return new TextRun({ ...base, text: t.slice(2, -2).replace(/`/g, ""), bold: true });
    if (t.startsWith("`")) return new TextRun({ ...base, text: t.slice(1, -1), font: MONO, size: 19 });
    if (t.startsWith("*") && t.length > 2) return new TextRun({ ...base, text: t.slice(1, -1), italics: true });
    return new TextRun({ ...base, text: t });
  });
}
const P = (text, opts = {}) => new Paragraph({ children: runs(text), spacing: { after: 120, line: 300 }, alignment: AlignmentType.JUSTIFIED, ...opts });
function heading(text, level, breakBefore) {
  const lv = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][level - 1];
  return new Paragraph({ heading: lv, children: [new TextRun(text)], pageBreakBefore: !!breakBefore });
}
function H1(t, key) { cnt.h1++; cnt.h2 = 0; cnt.h3 = 0; if (key) REG["s:" + key] = `${cnt.h1}`; return heading(`${cnt.h1}. ${t}`, 1, true); }
function H2(t, key) { cnt.h2++; cnt.h3 = 0; const n = `${cnt.h1}.${cnt.h2}`; if (key) REG["s:" + key] = n; return heading(`${n} ${t}`, 2); }
function H3(t, key) { cnt.h3++; const n = `${cnt.h1}.${cnt.h2}.${cnt.h3}`; if (key) REG["s:" + key] = n; return heading(`${n} ${t}`, 3); }
const H1u = (t) => heading(t, 1, true); // unnumbered (back matter)
const bullet = (t, level = 0) => new Paragraph({ numbering: { reference: "bullets", level }, children: runs(t), spacing: { after: 60, line: 290 } });
let listNo = 0;
const steps = (items) => { listNo++; return items.map((t) => new Paragraph({ numbering: { reference: "steps", level: 0, instance: listNo }, children: runs(t), spacing: { after: 60, line: 290 } })); };
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

function caption(kind, text, key) {
  cnt[kind]++;
  if (key) REG[(kind === "Figure" ? "f:" : "t:") + key] = cnt[kind];
  return new Paragraph({
    style: "Caption", alignment: AlignmentType.CENTER, keepNext: kind === "Table",
    children: [new TextRun(`${kind} `), new SequentialIdentifier(kind), new TextRun(`: ${text}`)],
  });
}

// Width and height of a JPEG, read from its start-of-frame marker.
function jpegSize(buf) {
  for (let i = 2; i < buf.length;) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [1350, 1800];
}

function figure(file, text, key, widthPx = 600) {
  const buf = fs.readFileSync(path.join(D, file));
  const isPng = file.endsWith(".png");
  const [w, h] = isPng ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : jpegSize(buf);
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 },
      children: [new ImageRun({ type: isPng ? "png" : "jpg", data: buf,
        transformation: { width: widthPx, height: Math.round((widthPx * h) / w) },
        altText: { title: text, description: text, name: file } })],
    }),
    caption("Figure", text, key),
  ];
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const borders = { top: border, bottom: border, left: border, right: border };

function cellParas(text, head) {
  return String(text).split("\n").map((line) => new Paragraph({
    spacing: { after: 0, line: 260 },
    children: head ? [new TextRun({ text: line, bold: true, color: "000000", size: 21 })] : runs(line, { size: 21 }),
  }));
}
function table(headers, rows, widths, title, key) {
  const cell = (text, i, head, shade) => new TableCell({
    borders, width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: cellParas(text, head),
  });
  return [
    caption("Table", title, key),
    new Table({
      width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
      rows: [
        new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
        ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false, ri % 2 === 1)) })),
      ],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
}

// Use case specification: two-column table with a bold label column.
function ucSpec(id, name, rows) {
  const W = [2100, 6926];
  const pad = { top: 50, bottom: 50, left: 90, right: 90 };
  const labelCell = (t) => new TableCell({
    borders, width: { size: W[0], type: WidthType.DXA }, margins: pad,
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: t, bold: true, size: 21 })] })],
  });
  const valueCell = (v) => new TableCell({
    borders, width: { size: W[1], type: WidthType.DXA }, margins: pad,
    children: Array.isArray(v)
      ? v.map((line, i) => new Paragraph({ spacing: { after: 20, line: 260 }, indent: { left: 340, hanging: 340 },
          children: runs(/^[0-9]+[a-z]\. /.test(line) ? line : `${i + 1}. ${line}`, { size: 21 }) }))
      : cellParas(v),
  });
  const head = new TableRow({ tableHeader: true, children: [new TableCell({
    borders, columnSpan: 2, width: { size: W[0] + W[1], type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: `${id}: ${name}`, bold: true, color: "000000", size: 22 })] })],
  })] });
  return [
    caption("Table", `Use case specification ${id}: ${name}`, id),
    new Table({ width: { size: W[0] + W[1], type: WidthType.DXA }, columnWidths: W,
      rows: [head, ...rows.map(([l, v]) => new TableRow({ cantSplit: true, children: [labelCell(l), valueCell(v)] }))] }),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  ];
}

function code(text) {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.map((line, i) => new Paragraph({
    shading: { fill: "F4F6F9", type: ShadingType.CLEAR, color: "auto" },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: "808080", space: 6 } },
    spacing: { after: i === lines.length - 1 ? 160 : 0, line: 240 },
    indent: { left: 120 },
    children: [new TextRun({ text: line || " ", font: MONO, size: 17 })],
  }));
}

function placeholder(hint) {
  return new Paragraph({
    border: { top: border, bottom: border, left: border, right: border },
    shading: { fill: "FFF8E1", type: ShadingType.CLEAR, color: "auto" },
    spacing: { before: 60, after: 200, line: 300 },
    children: [
      new TextRun({ text: "[To be completed by: ______________________]  ", bold: true }),
      new TextRun({ text: hint, italics: true }),
    ],
  });
}

function endpoint(method, url, auth, purpose, parts) {
  const out = [
    new Paragraph({
      keepNext: true, spacing: { before: 220, after: 80 },
      children: [
        new TextRun({ text: `${method}`, bold: true, font: MONO, size: 20 }),
        new TextRun({ text: `  ${url}`, bold: true, font: MONO, size: 20 }),
      ],
    }),
    P(`**Authentication:** ${auth}`, { spacing: { after: 40 } }),
    P(`**Purpose:** ${purpose}`),
  ];
  for (const [label, body, isCode] of parts) {
    out.push(P(`**${label}**`, { keepNext: true, spacing: { after: 40 } }));
    out.push(...(isCode ? code(body) : [P(body)]));
  }
  return out;
}

// ================================================================ CONTENT
function content() {
  cnt = { h1: 0, h2: 0, h3: 0, Figure: 0, Table: 0 };
  listNo = 0;

  const cover = [
    new Paragraph({ spacing: { before: 1400, after: 120 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "MAKERERE UNIVERSITY", bold: true, size: 32, color: "000000" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "College of Computing and Information Sciences (CoCIS)", size: 26 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: "Embedded Systems Coursework  |  BSE III and CS II  |  Academic Year 2026/2027", size: 24, italics: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 12 }, bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 12 } }, spacing: { after: 200 },
      children: [new TextRun({ text: "Smart Control and Monitoring System", bold: true, size: 48, color: "000000" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 900 }, children: [new TextRun({ text: "RFID Access Control, Occupancy Monitoring and Automated Lighting using an ESP32, an SD Card and a Central Database API", size: 26, italics: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "System Operation Report", bold: true, size: 28 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Group: ____________", size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Course Lecturer: ____________________", size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Submission date: 2nd November 2026", size: 24 })] }),
  ];

  const front = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Group Member Details")] }),
    P("The table below lists all members of the group, as required by Deliverable 5 of the coursework brief."),
    ...table(["#", "Full name", "Registration No.", "Student No.", "Programme", "Main responsibility"], [
      ["1", "Lisa Nyonyozi", "", "", "", "Use cases, architecture, database, REST API"],
      ["2", "", "", "", "", ""], ["3", "", "", "", "", ""], ["4", "", "", "", "", ""], ["5", "", "", "", "", ""],
    ], [400, 2000, 1600, 1400, 1100, 2526], "Group member details"),
    pageBreak(),
    new Paragraph({ children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, color: "000000" })], spacing: { after: 200 } }),
    new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
    pageBreak(),
    new Paragraph({ children: [new TextRun({ text: "List of Figures", bold: true, size: 32, color: "000000" })], spacing: { after: 200 } }),
    new TableOfContents("List of Figures", { hyperlink: true, captionLabelIncludingNumbers: "Figure" }),
    pageBreak(),
    new Paragraph({ children: [new TextRun({ text: "List of Tables", bold: true, size: 32, color: "000000" })], spacing: { after: 200 } }),
    new TableOfContents("List of Tables", { hyperlink: true, captionLabelIncludingNumbers: "Table" }),
    new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: "Note: if a list above is empty, click inside it and press F9 (Mac: Fn + F9), or right-click and choose Update Field, then Update entire table.", italics: true, size: 20 })] }),
  ];

  // ---------- Introduction (group) ----------
  const intro = [
    H1("Introduction", "intro"),
    H2("Background"),
    P("The College of Computing and Information Sciences (CoCIS) at Makerere University houses computers, networking equipment and laboratory hardware that must be protected from unauthorised access. The college also pays high electricity bills, partly because lights are left on in lecture rooms that nobody is using. At a management meeting in October 2026 it was agreed to build an automated system that controls who enters the building and switches lecture-room lights according to whether the rooms are occupied. The system starts as a pilot covering the main entrance and two lecture rooms."),
    H2("Problem Statement"),
    P("Access to the CoCIS building is not recorded, so management cannot tell who is inside at any moment, and the building cannot be closed reliably outside working hours. Lecture-room lights depend on people remembering to switch them off, which wastes energy. A solution is needed that identifies every person at the entrance, enforces a configurable schedule, knows how many people are in each lecture room, and keeps working when the network fails."),
    H2("Objectives"),
    H3("Main Objective"),
    P("To design and implement, on the Wokwi simulator with ESP-IDF, a smart control and monitoring system for the CoCIS main entrance and two lecture rooms."),
    H3("Specific Objectives"),
    bullet("Identify every person with an RFID tag at separate entry and exit doors, and open the right door only for valid tags."),
    bullet("Keep a record of every entry and exit so that management can see who is inside at any time."),
    bullet("Detect whether each lecture room is occupied and switch its lights automatically."),
    bullet("Store logs, configuration and unsent records on a memory card."),
    bullet("Provide serial-monitor menus for monitoring and configuration."),
    bullet("Enforce a configurable access schedule that only authenticated, authorised staff can change, and that also stops people leaving outside the permitted period."),
    bullet("Prevent conflicts and race conditions where tasks or requests share data."),
    H2("Scope of the Pilot"),
    P("The pilot covers the main entrance (one entry lane and one exit lane) and Lecture Rooms 1 and 2. Following the lecturer's guidance that the free Wokwi plan simulates one microcontroller, a single ESP32 runs all three terminals as separate FreeRTOS tasks (Section " + S("arch") + "). The firmware is written in C with ESP-IDF: two MFRC522 RFID readers control the entry and exit doors, and a PIR motion sensor switches the lights in each lecture room. The ESP32 publishes every event over MQTT. On the server side, an MQTT bridge, a REST API, a SQLite database and a web dashboard store the records and let management monitor and configure the building (Section " + S("net") + ")."),
  ];

  // ---------- Use cases (Lisa) ----------
  const uc = [
    H1("Requirements and Use Case Analysis", "uc"),
    P("Before designing the hardware, database and API, we identified **who** uses the system and **what** each of them needs it to do. These are captured as UML use cases. Each use case is traced to the tables and API endpoints that implement it, so every part of the design can be explained by the need it serves."),
    H2("Actors", "actors"),
    ...table(["Actor", "Type", "Description"], [
      ["Building User", "Person", "Any student, staff member, lecturer or visitor who holds an RFID card and passes through the main entrance."],
      ["Room Occupant", "Person", "Anyone in Lecture Room 1 or 2. Detected by the room's PIR motion sensor; needs no card."],
      ["Management Viewer", "Person (role VIEWER)", "College management or reception staff who monitor occupancy, logs and reports on the dashboard."],
      ["Security Officer", "Person (role SECURITY)", "Everything a Viewer can do, plus lockdown of the entrance and light overrides."],
      ["System Administrator", "Person (role SUPER_ADMIN; admin PIN on the ESP32)", "Everything a Security Officer can do, plus managing authorised cards, the access schedule and settings."],
      ["Time", "Timer", "The 5 second motion timeout that switches a room's lights off."],
      ["Entrance ESP32", "External system", "The controller: decides every scan and publishes events over MQTT."],
      ["MQTT Bridge", "External system", "Program on the server that relays the ESP32's messages to the REST API and forwards lockdown commands back."],
    ], [2100, 2400, 4526], "Actors of the system", "actors"),
    H2("System Use Case Diagram", "ucsys"),
    P(`Figure ${F("ucsys")} shows the use cases of the whole system. Use cases on the left are carried out by people in the building; those on the right are management functions. Dashed arrows show «include» relationships (a step that is always performed, such as verifying a card) and «extend» relationships (optional behaviour, such as a manual lighting override). The hollow-headed arrows between the staff actors show that their roles build on each other.`),
    ...figure("usecase_system.png", "System use case diagram", "ucsys", 610),
    H2("Controller, Bridge and API Use Case Diagram", "ucdev"),
    P(`Figure ${F("ucdev")} shows how the controller's data reaches the database. The ESP32 never calls the API itself: it publishes to the MQTT broker, and the bridge makes the API requests. Every request the bridge makes includes device authentication, and every event is stored exactly once, however many times it is delivered.`),
    ...figure("usecase_device.png", "Use case diagram of the entrance ESP32, the MQTT bridge and the Database API", "ucdev", 560),
    H2("Use Case Specifications", "ucspec"),
    P("Each use case is specified below. *Main flow* is the normal sequence of steps; *Alternative flows* cover errors and exceptions (step 3a means an alternative to step 3)."),
    ...ucSpec("UC01", "Enter Building", [
      ["Primary actor", "Building User"],
      ["Goal", "Enter CoCIS through the ENTRY lane of the main entrance."],
      ["Preconditions", "The user holds an RFID card. The ESP32 is running."],
      ["Main flow", ["The user taps the card on the ENTRY reader (MFRC522).", "The rfid task reads the 4-byte UID and the time.", "The ESP32 verifies access (UC03).", "The ESP32 opens the ENTRY door servo for 3 seconds, lights the green LED, beeps briefly and shows ACCESS GRANTED and the UID on the LCD.", "The ESP32 adds the person to its people-inside list, appends the scan to `access.csv` on the SD card and publishes it over MQTT (UC14).", "The bridge stores the scan and opens a visit in the database (UC15)."]],
      ["Alternative flows", ["3a. Access is DENIED: the door stays shut, the red LED lights, the buzzer sounds for 0.5 s and the LCD shows ACCESS DENIED. The refused scan is still logged and published.", "5a. The broker cannot be reached: the scan is still decided, logged on the SD card and shown on the LCD; it does not reach the database."]],
      ["Postconditions", "A row exists in `access_events` (source MQTT). If granted, the user has an open row in `building_visits`."],
      ["Implemented by", "`rfid.c` (`rfid_trigger_scan`), `state.c`; bridge `POST /device/relay`; tables `access_events`, `building_visits`"],
    ]),
    ...ucSpec("UC02", "Exit Building", [
      ["Primary actor", "Building User"],
      ["Goal", "Leave CoCIS through the EXIT lane."],
      ["Preconditions", "The user is recorded as inside the building."],
      ["Main flow", ["The user taps the card on the EXIT reader.", "The ESP32 verifies access (UC03).", "The ESP32 opens the EXIT door for 3 seconds and removes the person from the people-inside list.", "The scan is logged, published and stored; the visit gets its time out."]],
      ["Alternative flows", ["2a. The person is not recorded as inside: refused (`DENIED_NOT_IN`).", "2b. Outside the opening hours: the exit door still opens, so nobody is trapped inside, but the result is `OK_AFTER_HOURS` with a longer beep, and it is stored as such so security can follow up."]],
      ["Postconditions", "The visit has a `time_out`; the person no longer appears in `v_people_inside`."],
      ["Implemented by", "`state_evaluate()`; bridge `POST /device/relay`; tables `access_events`, `building_visits`"],
    ]),
    ...ucSpec("UC03", "Verify Access", [
      ["Primary actor", "None (included by UC01 and UC02)"],
      ["Goal", "Decide on the ESP32 whether a scanned card may pass, and give a result code."],
      ["Preconditions", "A card UID, door and time have been read."],
      ["Main flow", ["Take the state mutex.", "If lockdown is active, refuse.", "Check that the card is in the authorised list.", "For ENTRY: check the time is inside the daily window and the person is not already inside.", "For EXIT: check the person is inside.", "Return the result code (Table " + T("rules") + ") and update the people-inside list; release the mutex."]],
      ["Alternative flows", ["1a. Any check fails: return the matching DENIED code; nothing else changes."]],
      ["Postconditions", "The decision is made locally, so doors work even without a network."],
      ["Implemented by", "`state_evaluate()` in `state.c`"],
    ]),
    ...ucSpec("UC04", "Detect Motion in Lecture Room", [
      ["Primary actor", "Room Occupant"],
      ["Goal", "Have the room marked occupied when someone is moving in it."],
      ["Preconditions", "The room's PIR sensor is connected (GPIO 34 for Room 1, GPIO 35 for Room 2)."],
      ["Main flow", ["The room_lights task reads both PIR outputs every 100 ms.", "Motion resets the room's hold timer.", "The room is occupied while there was motion in the last 5 seconds.", "The lights are updated (UC05)."]],
      ["Alternative flows", ["2a. A light override is active: the sensor is still read but the override decides the light (UC13)."]],
      ["Postconditions", "The room's state is current on the ESP32."],
      ["Implemented by", "`rooms.c` (`room_lighting_task`)"],
    ]),
    ...ucSpec("UC05", "Control Room Lighting", [
      ["Primary actor", "None (included by UC04 and UC06; extended by UC13)"],
      ["Goal", "Keep the lights on only while a lecture room is in use."],
      ["Preconditions", "The room's motion state and override are known."],
      ["Main flow", ["If an override is set (ON or OFF), use it; otherwise use the motion state.", "When the state changes, switch the light output.", "Publish the new state to `cocis/state/roomN` (retained).", "The bridge stores it in `rooms` and `room_status_logs` with trigger MOTION or NO_MOTION."]],
      ["Alternative flows", ["3a. No broker: the light still switches; only the database is not updated."]],
      ["Postconditions", "The light matches the room's use; the change is logged for the energy report."],
      ["Implemented by", "`rooms.c`, `comms_publish_room()`; bridge; `room_status_logs`, `GET /reports/daily`"],
    ]),
    ...ucSpec("UC06", "Switch Lights Off When Vacant", [
      ["Primary actor", "Time"],
      ["Goal", "Save energy when a room is no longer in use."],
      ["Preconditions", "The room is in automatic mode and its light is on."],
      ["Main flow", ["Five seconds pass with no motion.", "The room becomes vacant and the light switches off (UC05).", "The change is published and stored with trigger NO_MOTION."]],
      ["Alternative flows", ["1a. Motion returns before the 5 s end: the timer restarts and the light stays on."]],
      ["Postconditions", "The light is off and the room shows as vacant on the dashboard."],
      ["Implemented by", "`HOLD_TICKS` in `rooms.c`"],
    ]),
    ...ucSpec("UC07", "View Occupancy", [
      ["Primary actor", "Management Viewer (and, by inheritance, Security Officer and System Administrator)"],
      ["Goal", "See who is in the building now and the state of each lecture room."],
      ["Preconditions", "Logged in to the dashboard (UC09), or at the ESP32 console."],
      ["Main flow", ["The viewer opens the dashboard Overview (or types `status`, `who` or `occupancy` at the console).", "The system shows everyone inside with their time in, the total, and each room's state and light."]],
      ["Alternative flows", ["1a. The token has expired: 401, and the viewer logs in again."]],
      ["Postconditions", "None (read only)."],
      ["Implemented by", "`GET /occupancy`; view `v_people_inside`; table `rooms`; console `cmd_status()`"],
    ]),
    ...ucSpec("UC08", "View Logs and Reports", [
      ["Primary actor", "Management Viewer"],
      ["Goal", "Review access history, visits, room history and daily summaries."],
      ["Preconditions", "Logged in (UC09)."],
      ["Main flow", ["The viewer opens Reports, the Database tab or the access log, and chooses a date or filter.", "The system returns the matching records, newest first.", "For a daily report it calculates entries, exits, refusals by reason, unique visitors, peak occupancy and lighting energy."]],
      ["Alternative flows", ["2a. No records match: an empty list. 2b. At the ESP32, `logs <n>` and `sd dump <n>` read the SD card log."]],
      ["Postconditions", "None (read only)."],
      ["Implemented by", "`GET /access-events`, `/visits`, `/rooms/{code}/history`, `/reports/daily`, `/db/{table}`"],
    ]),
    ...ucSpec("UC09", "Log In", [
      ["Primary actor", "Any staff actor"],
      ["Goal", "Prove identity before viewing or changing anything."],
      ["Preconditions", "The person has a staff account (dashboard) or the admin PIN (ESP32 console)."],
      ["Main flow", ["Dashboard: the person enters a username and password; the API checks the PBKDF2 hash and issues a token valid for 8 hours, recorded in the audit log.", "ESP32 console: `login <user> <pin>` starts an admin session that expires after 5 minutes."]],
      ["Alternative flows", ["1a. Wrong password: 401 and LOGIN_FAILED is audited. 2a. Wrong PIN: `ERR: bad pin`."]],
      ["Postconditions", "A row in `admin_sessions`, or an active admin session on the ESP32."],
      ["Implemented by", "`POST /auth/login`; `state_admin_login()`"],
    ]),
    ...ucSpec("UC10", "Manage Authorised Cards", [
      ["Primary actor", "System Administrator"],
      ["Goal", "Authorise new cards and remove lost ones."],
      ["Preconditions", "Admin session on the ESP32 (UC09)."],
      ["Main flow", ["The administrator types `user add <HEX>` or `user remove <HEX>` at the console.", "The ESP32 updates its list and saves it to NVS flash, so it survives a reboot.", "The first granted scan of a new card makes the bridge register it in `users` (`POST /users`), so it appears on the dashboard."]],
      ["Alternative flows", ["1a. No admin session: `ERR: admin required`. 2a. The list is full (64 cards) or the card exists: refused."]],
      ["Postconditions", "The card list on the ESP32 and the `users` table agree."],
      ["Implemented by", "`state_user_add()`, `storage_save_users()`; bridge `register()`"],
    ]),
    ...ucSpec("UC11", "Configure Access Schedule", [
      ["Primary actor", "System Administrator"],
      ["Goal", "Set the daily hours during which the building may be entered."],
      ["Preconditions", "Admin session on the ESP32."],
      ["Main flow", ["The administrator types `schedule set HH:MM HH:MM`.", "The ESP32 saves the window to NVS and enforces it from the next scan.", "It publishes the schedule (retained); the bridge copies it to `access_schedule` (`PUT /schedule`), so the dashboard shows the hours in use."]],
      ["Alternative flows", ["1a. No admin session: refused. 3a. A window that crosses midnight is enforced on the ESP32 but not copied, because the database stores one window per day."]],
      ["Postconditions", "The ESP32 and the database show the same hours."],
      ["Implemented by", "`console.c`, `state_set_schedule()`, `comms_publish_schedule()`; bridge `on_schedule()`"],
    ]),
    ...ucSpec("UC12", "Lock Down the Entrance", [
      ["Primary actor", "Security Officer"],
      ["Goal", "Refuse every card at once during a security threat."],
      ["Preconditions", "Logged in as SECURITY or SUPER_ADMIN."],
      ["Main flow", ["The officer sets lockdown on (`PUT /settings/lockdown`) with a reason; it is audited.", "Within 2 seconds the bridge publishes LOCKDOWN to `cocis/cmd/entrance` (retained).", "The ESP32 sets its lockdown flag and refuses every scan.", "UNLOCK ends it the same way."]],
      ["Alternative flows", ["3a. In the current firmware the topic check compares 19 characters instead of 18, so the command is ignored until that one value is corrected (Section " + S("limits") + ")."]],
      ["Postconditions", "Doors follow the lockdown state; every change is audited."],
      ["Implemented by", "`PUT /settings/lockdown`; bridge `watch_lockdown()`; `mqtt_cb()` in `comms.c`"],
    ]),
    ...ucSpec("UC13", "Override Room Lights", [
      ["Primary actor", "Security Officer or System Administrator"],
      ["Goal", "Force a lecture room's lights on (for example for cleaning) or off, or return them to automatic."],
      ["Preconditions", "Admin session on the ESP32."],
      ["Main flow", ["The administrator types `lights room1 on`, `off` or `auto`.", "The room_lights task applies the override at its next 100 ms cycle (extends UC05)."]],
      ["Alternative flows", ["1a. No admin session: refused."]],
      ["Postconditions", "The override stays until set back to auto."],
      ["Implemented by", "`rooms_set_override()` in `rooms.c`"],
    ]),
    ...ucSpec("UC14", "Publish Scan and Room State", [
      ["Primary actor", "Entrance ESP32"],
      ["Goal", "Make every event available to the rest of the system."],
      ["Preconditions", "Wi-Fi connected and the MQTT client started."],
      ["Main flow", ["After each scan, publish `{tag, dir, result, ts}` to `cocis/event/access` and the occupancy count to `cocis/state/occupancy`.", "After each room change, publish `{occupied, lights, ts}` to `cocis/state/roomN`.", "After a schedule change, publish it to `cocis/config/schedule`.", "State topics are retained, so a new subscriber immediately receives the latest values."]],
      ["Alternative flows", ["1a. Not connected: the publish is skipped; the SD log keeps the local record."]],
      ["Postconditions", "Messages are on the broker for every subscriber."],
      ["Implemented by", "`comms.c`"],
    ]),
    ...ucSpec("UC15", "Relay Messages to the Database", [
      ["Primary actor", "MQTT Bridge"],
      ["Goal", "Store every ESP32 message in the database exactly once."],
      ["Preconditions", "The API is running; the bridge is subscribed."],
      ["Main flow", ["The bridge receives a message and converts it (Table " + T("bridgemap") + ").", "It gives the event a stable `event_uuid` built from the card, direction and ESP32 time.", "It sends `POST /api/v1/device/relay` with its device key.", "The API stores it in one transaction and reports it as accepted (or as a duplicate).", "The bridge also sends a heartbeat (UC15a), so the dashboard shows the controller online."]],
      ["Alternative flows", ["1a. A retained message older than 10 minutes is ignored. 3a. The API is down: the error is shown and the message is lost; the ESP32's SD log still has it."]],
      ["Postconditions", "The database matches the ESP32's events; the dashboard updates within 3 seconds."],
      ["Implemented by", "`bridge/mqtt_bridge.py`; `POST /device/relay`, `POST /device/heartbeat`"],
    ]),
  ];

  // ---------- Architecture (Lisa) ----------
  const arch = [
    H1("System Architecture", "arch"),
    P("This chapter explains how the whole system fits together: the devices in the building, the single ESP32 controller that runs them, the MQTT broker that carries its messages, and the server side (bridge, REST API, database and dashboard) that keeps the official records. It also records the main design decisions and the reasons for them."),
    H2("Design Decision: One ESP32 Controller", "one"),
    P("The coursework brief (Section 2.3) describes three control terminals (Lecture Room 1, Lecture Room 2 and the main entrance), each of which *may* use its own ESP32. The free version of the Wokwi simulator only supports one microcontroller per project, and the course lecturer confirmed by email that groups should use one. Our design therefore uses **one ESP32 that serves all three terminals**."),
    P(`The terminals still exist logically: the entrance is handled by the rfid and door tasks and each lecture room by the room_lights task (Section ${S("esp")}). If CoCIS later moves to one ESP32 per terminal, each board can publish to the same MQTT topics, and the bridge, API and database stay exactly the same.`),
    H2("From the Initial Draft to the Final Architecture", "draft"),
    P(`Figure ${F("sketch")} is the group's first hand-drawn sketch. It identified the main ideas that the final design keeps: users carrying RFID tags, a main entrance split into an *Entrance* lane and an *Exit* lane, a scanner that opens the door, a server, a memory card, and database tables for users, events (RFID, time in, time out, date), rooms and room status.`),
    ...figure("original_sketch.jpg", "Initial hand-drawn architecture draft prepared by the group", "sketch", 330),
    P("While refining the sketch we made the following changes:"),
    bullet("**The ESP32 talks MQTT, not directly to the server.** It publishes small JSON messages to a broker; a bridge on the server turns them into API requests. The controller stays simple and never waits for the server."),
    bullet("**Two separate server boxes became one REST API.** A single API with clear endpoints is easier to secure, test and explain."),
    bullet(`**The memory card and the database have distinct jobs.** The ESP32 keeps its settings in NVS flash and a log on the SD card; the SQLite database behind the API is the central record (Section ${S("sd")}).`),
    bullet("**The Events table was split into `access_events` and `building_visits`.** Every scan is an access event; a visit pairs an entry with its exit, giving the *time in*, *time out* and *date* columns from the sketch."),
    bullet("**New tables were added** for the schedule, staff accounts and sessions, devices, settings and an audit log, so that configuration is authenticated and every change is traceable."),
    H2("Final System Architecture", "final"),
    P(`Figure ${F("arch")} shows the final architecture in four layers, read from left to right.`),
    ...figure("architecture.png", "Final system architecture of the CoCIS Smart Control and Monitoring System", "arch", 620),
    H3("Layer 1: Field devices"),
    bullet("**Main entrance:** an MFRC522 RFID reader and a door servo for each lane, a green and a red LED, a buzzer and a 16x2 LCD."),
    bullet("**Lecture Rooms 1 and 2:** a PIR motion sensor and the room light."),
    bullet("**Storage and console:** a microSD card for the access log, the ESP32's NVS flash for settings, and the serial monitor."),
    H3("Layer 2: The ESP32 controller", "esp"),
    P("One ESP32 runs these FreeRTOS tasks at the same time (details in Chapter " + S("fw") + "):"),
    bullet("**rfid** (priority 6): polls both readers, decides, logs and publishes each scan."),
    bullet("**door** (priority 4): opens a servo for 3 seconds when asked through the door queue."),
    bullet("**room_lights** (priority 4): reads the PIR sensors every 100 ms and switches the lights."),
    bullet("**console** (priority 3): the serial menu for staff."),
    bullet("**MQTT client**: the ESP-IDF esp-mqtt component, which runs its own task for the network."),
    P(`Shared data is protected by a state mutex and a storage mutex (Section ${S("sync")}), and every door follows the same six rules (Table ${T("rules")}).`),
    H3("Layer 3: The MQTT broker"),
    P("The public broker `broker.hivemq.com` on port 1883 passes messages between the ESP32 and the server. Neither side connects to the other directly."),
    H3("Layer 4: The server"),
    P(`The MQTT bridge, the FastAPI REST API and the SQLite database run on a laptop or college server, with the dashboard and Swagger UI in a browser. Details are in Section ${S("net")} and Chapters ${S("db")} and ${S("api")}.`),

    H2("Network Design: How the Controller Reaches the Database", "net"),
    P(`Figure ${F("network")} answers a common question: does the ESP32 need to be on the same network as the database? **No.** The ESP32 (in Wokwi, on the Wokwi-GUEST Wi-Fi) and the server each open an **outgoing** connection to the MQTT broker on the internet. The broker passes the messages between them. Because nobody needs to connect *into* the laptop, no router settings, port forwarding or tunnel are needed for MQTT, and the database never has to be exposed to the internet.`),
    ...figure("network.png", "Network view: where each part runs and how it connects", "network", 620),
    ...table(["Link", "Protocol", "Who connects", "Network needed"], [
      ["ESP32 to broker", "MQTT 3.1.1 over TCP, port 1883, JSON payloads", "ESP32 connects out", "Internet (Wi-Fi Wokwi-GUEST in the simulator)"],
      ["Broker to bridge", "MQTT subscription", "Bridge connects out", "Internet on the server"],
      ["Bridge to REST API", "HTTP, JSON, header X-Device-Key", "Bridge calls 127.0.0.1:8000", "Same computer"],
      ["API to database", "SQL through Python sqlite3", "Inside the API process", "Same computer (one file)"],
      ["Dashboard to API", "HTTP, JSON, bearer token", "The browser", "Same computer, or the college network with `start.bat --lan`"],
      ["Bridge to ESP32 (lockdown)", "MQTT publish to `cocis/cmd/entrance`", "Bridge publishes, ESP32 subscribed", "Internet"],
    ], [2200, 2600, 2000, 2226], "Connections between the parts of the system", "links"),
    P("For a real deployment the broker would be a private one (for example Mosquitto on the college server, with a username, password and TLS on port 8883). Only the broker address in the firmware's `config.h` and the bridge's `--broker` option would change."),

    H2("Design Decision: Room Occupancy Sensing", "ir"),
    P("Each lecture room has a **PIR (passive infrared) motion sensor**. The room is treated as occupied while there has been motion in the last 5 seconds; then the lights switch off. PIR sensors are cheap, simple and available in Wokwi, and they meet the brief's requirement that lights follow occupancy."),
    H3("The known weakness of motion sensing"),
    P("A PIR sensor does not detect people; it detects *changes* in infrared heat as warm bodies move. A person who sits still produces no change, so a room full of students writing an exam can look empty. Occupancy-sensor company Butlr notes that a student taking an exam may barely move for 60 to 75 minutes, and a 1996 ACEEE study of classroom lighting controls reported early occupancy sensors turning lights off in occupied rooms. With a 5 second hold, this happens quickly."),
    H3("Options considered"),
    ...table(["Sensor", "How it detects people", "Still occupants", "Counts people", "Wokwi", "Use"], [
      ["**PIR motion sensor**", "Changes in infrared heat as people move", "Missed after the hold time", "No", "Yes", "**Implemented** (with a hold timer)"],
      ["Active IR break-beam pair at the door", "Two beams at the door; the order they break gives the direction", "Not affected: people are counted in and out", "Yes", "Simulated with pushbuttons", "Recommended upgrade (demonstrated by the reference controller)"],
      ["Thermopile IR array (e.g. AMG8833)", "Absolute heat per pixel, so still bodies are seen", "Detected", "Roughly", "No part", "Future option"],
      ["Ultrasonic or mmWave radar", "Reflections of small movements", "Detected", "No", "Ultrasonic only", "Not chosen"],
    ], [1700, 2100, 1600, 900, 1200, 1526], "Comparison of occupancy sensors for the lecture rooms", "sensors"),
    H3("How the weakness is managed"),
    bullet("**Hold time.** Commercial classroom sensors use 15 to 30 minutes; the 5 seconds used here (`HOLD_TICKS`) keeps the Wokwi demonstration quick and is one constant to change."),
    bullet("**Manual override.** Staff can force a room's lights on with `lights room1 on` (UC13), for example during an exam."),
    bullet(`**Recorded for review.** Every switch is stored with trigger MOTION or NO_MOTION, so the energy report shows how long lights were on, and management can tune the hold time from real data.`),
    bullet(`**Upgrade path.** Counting people with two infrared beams at the door (Figure ${F("ir")}) keeps lights on for still occupants. The database and API already support counts (PERSON_IN and PERSON_OUT), and our reference controller demonstrates it (Appendix C).`),
    ...figure("ir_counter.png", "Recommended upgrade: infrared break-beam people counter at a lecture-room door", "ir", 560),

    H2("Design Decision: What to Store on the Memory Card", "sd"),
    P("Section 2.4 of the brief proposes an SD card to hold the large volume of data the system produces. We investigated whether the SD card should hold a full database, and how it fits into the architecture."),
    H3("How the controller stores data"),
    bullet("**NVS flash (non-volatile storage inside the ESP32):** the authorised card list, the people-inside list and the schedule. They are small, read on every scan and must survive a reboot. NVS writes are atomic, so a power cut never leaves half a value."),
    bullet("**microSD card:** `access.csv`, an append-only log of every scan (time, card, direction, result). It can be opened in a spreadsheet straight from the card and read with `sd dump <n>`."),
    bullet(`**Central SQLite database on the server:** the authoritative record with relationships, constraints, reports and the audit trail (Chapter ${S("db")}).`),
    H3("Why not a full SQLite database on the SD card?"),
    ...table(["Concern", "What we found", "Effect on the design"], [
      ["Concurrency", "The ESP32 SQLite port does not implement file locking, so it is only reliable from one thread.", "Several tasks write data; a shared database would need its own locking layer."],
      ["Memory", "About 320 KB of usable RAM; SQLite's page cache competes with Wi-Fi, TLS and FreeRTOS.", "Risk of running out of memory in Wokwi."],
      ["Power loss", "FAT file systems are commonly corrupted when power is cut mid-write; a database rewrites pages in place.", "Append-only logs are far safer."],
      ["Remote access", "Management cannot query an SD card from the office.", "The official record must be on the server."],
    ], [1500, 4300, 3226], "Findings on running a database on the ESP32 memory card", "sdfind"),
    ...table(["Option", "Works offline", "Safe on power loss", "Fits ESP32 memory", "Central reports", "Decision"], [
      ["No local storage (server only)", "No", "n/a", "Yes", "Yes", "Rejected"],
      ["Full SQLite database on the SD card", "Yes", "Weak", "Tight", "No", "Rejected"],
      ["**NVS for state + CSV log on SD + SQLite on the server**", "Yes", "Good", "Yes", "Yes", "**Chosen**"],
    ], [2900, 1100, 1500, 1200, 1100, 1226], "Storage options compared", "sdopts"),

    H2("How Data Flows Through the System", "flow"),
    H3("A card scan"),
    P(`Figure ${F("mqttscan")} follows one scan from the card to the dashboard. The ESP32 decides and opens the door at once, then logs and publishes; the bridge stores the event through the API in one database transaction.`),
    ...figure("seq_mqtt_scan.png", "Sequence of a card scan, from the reader to the database", "mqttscan", 620),
    ...steps([
      "The user taps a card; the rfid task reads the UID over SPI.",
      `\`state_evaluate()\` applies the rules (Table ${T("rules")}) under the state mutex.`,
      "The door task opens the servo for 3 seconds; LEDs, buzzer and LCD give feedback.",
      "The scan is appended to `access.csv` and published to `cocis/event/access` as `{\"tag\":\"11223344\",\"dir\":\"IN\",\"result\":\"OK\",\"ts\":1793636493}`.",
      "The bridge receives it, converts it and calls `POST /api/v1/device/relay` with its device key.",
      "The API stores the event and opens the visit in one transaction; the dashboard shows the change within 3 seconds.",
    ]),
    H3("Room lighting and lockdown"),
    P(`Figure ${F("mqttroom")} shows the room messages and the one command that travels the other way: a lockdown set on the dashboard reaches the ESP32 through the bridge and the broker.`),
    ...figure("seq_mqtt_room.png", "Room lighting messages and the lockdown command", "mqttroom", 600),
    H2("Access Decision Rules", "rulesec"),
    P("The ESP32 applies the rules below, in this order, in `state_evaluate()`. The first rule that matches decides. The result code is shown on the LCD, written to the SD log, published and stored in the database."),
    ...table(["#", "Condition", "Result code", "Stored as"], [
      ["1", "Lockdown is active", "`DENIED_SCHEDULE`", "DENIED, `OUTSIDE_SCHEDULE`"],
      ["2", "Card is not in the authorised list", "`DENIED_UNKNOWN`", "DENIED, `UNKNOWN_TAG`"],
      ["3", "ENTRY outside the daily window", "`DENIED_SCHEDULE`", "DENIED, `OUTSIDE_SCHEDULE`"],
      ["4", "ENTRY but already inside (anti-passback)", "`DENIED_ALREADY_IN`", "DENIED, `ALREADY_INSIDE`"],
      ["5", "EXIT but not recorded as inside", "`DENIED_NOT_IN`", "DENIED, `NOT_INSIDE`"],
      ["6a", "EXIT outside the daily window", "`OK_AFTER_HOURS`", "GRANTED, `OK_AFTER_HOURS`"],
      ["6", "Otherwise", "`OK`", "GRANTED, `OK`"],
    ], [500, 4200, 2000, 2326], "Access decision rules on the ESP32, in the order they are evaluated", "rules"),
    P("Rule 6a is a deliberate safety choice: Section 2.6 of the brief says people should not leave outside the authorised period, but locking someone inside is dangerous, so the exit door opens and the event is recorded as `OK_AFTER_HOURS` (with a different beep) for security to follow up. Entry outside the window is always refused."),
    H2("Synchronisation and Reliability", "sync"),
    P(`Section 2.7 of the brief asks for mechanisms that prevent conflicts, inconsistent records and race conditions. Table ${T("sync")} lists each shared resource and how it is protected, on the ESP32 and on the server.`),
    ...table(["Where", "Shared resource or risk", "Mechanism used"], [
      ["ESP32", "Card list, people-inside list, schedule and room states, used by the rfid, room_lights, console and MQTT tasks", "State mutex (`s.mtx` in `state.c`): every read or change takes it"],
      ["ESP32", "The SD log, written after each scan", "Storage mutex (`s_mtx` in `storage.c`)"],
      ["ESP32", "Opening a door without blocking the reader", "Door queue: the rfid task sends a request and the door task holds the servo for 3 s"],
      ["ESP32", "One card held over a reader", "1.5 s cooldown for the same card (`SCAN_COOLDOWN_MS`)"],
      ["ESP32 flash", "Power cut while saving state", "NVS commits are atomic"],
      ["Bridge", "A message delivered twice, or retained messages replayed on reconnect", "Stable `event_uuid` from card, direction and ESP32 time; stale retained messages ignored"],
      ["API / DB", "Two requests at the same moment (e.g. the bridge and a dashboard change)", "`BEGIN IMMEDIATE` transactions: one writer at a time"],
      ["API / DB", "A person recorded inside twice", "Partial unique index `uq_one_open_visit`"],
      ["API / DB", "The same event stored twice", "`event_uuid` is UNIQUE; duplicates are reported, not stored"],
    ], [1300, 3700, 4026], "Synchronisation mechanisms and the problem each one solves", "sync"),
    P(`The server-side protection was tested by firing eight simultaneous ENTRY requests for the same card at the API: exactly one was granted and only one visit was created (Section ${S("apitests")}).`),
    H2("How the Architecture Meets the Requirements", "trace"),
    ...table(["Brief section", "Requirement", "Use cases", "Where it is handled"], [
      ["2.1", "RFID access at entry and exit; know who is inside", "UC01 to UC03, UC07", "Two MFRC522 readers and servos; people-inside list on the ESP32; `access_events`, `building_visits`, `v_people_inside`"],
      ["2.2", "Lights follow room occupancy", "UC04 to UC06, UC13", "PIR sensors and the room_lights task; overrides; `room_status_logs` and the energy report"],
      ["2.3", "Three terminals working as one system", "All", "One ESP32 (per the lecturer's email) with tasks per terminal; MQTT topics per terminal"],
      ["2.4", "Store large volumes of data", "UC01, UC15", "SD card `access.csv`, NVS, and the central SQLite database"],
      ["2.5", "Serial menus and useful information", "UC07 to UC11", "Console task with status, who, logs, user, schedule and lights commands; dashboard as an additional interface"],
      ["2.6", "Configurable schedule, changed only by authorised staff", "UC09, UC11", "`schedule set` needs the admin PIN; copied to `access_schedule`; entry refused outside the window"],
      ["2.7", "Synchronisation and reliability", "UC14, UC15", `Mutexes and a queue on the ESP32; transactions, unique keys and idempotent relay on the server (Table ${T("sync")})`],
    ], [1100, 2500, 1400, 4026], "Traceability from coursework requirements to use cases and design", "trace"),
  ];

  // ---------- Hardware and firmware (group) ----------
  const hw = [
    H1("Hardware Design", "hw"),
    P("The whole circuit is built in the Wokwi simulator (`diagram.json` of the entrance firmware), so no physical parts are needed. Wokwi provides working models of the MFRC522 RFID reader, servo, PIR sensor, LCD and microSD card, so the firmware drives them exactly as it would drive real hardware."),
    H2("Components Used"),
    ...table(["Wokwi part", "Quantity", "Role in the system"], [
      ["ESP32 DevKitC V4", "1", "Runs every task for the entrance and both lecture rooms"],
      ["MFRC522 RFID reader (`board-mfrc522`)", "2", "Entry lane and exit lane readers on the shared SPI bus"],
      ["Servo motor", "2", "Entry door and exit door: opened for 3 seconds on GRANTED"],
      ["Green and red LED", "2", "Access granted or refused"],
      ["Buzzer", "1", "80 ms beep when granted, 200 ms after hours, 500 ms when refused"],
      ["LCD 16x2 with I2C backpack", "1", "Idle: CoCIS Security and the occupancy; after a scan: ACCESS GRANTED or DENIED and the card"],
      ["PIR motion sensor", "2", "One per lecture room"],
      ["LED (room light)", "2", "The lights of Lecture Rooms 1 and 2"],
      ["microSD card", "1", "`access.csv` log of every scan"],
    ], [3400, 1100, 4526], "Wokwi parts used", "parts"),
    H2("Pin Assignment"),
    ...table(["Component", "ESP32 pin", "Signal type"], [
      ["SPI bus (both readers and the SD card)", "SCK 18, MISO 19, MOSI 23", "SPI2, 1 MHz for the readers"],
      ["Entry reader: chip select, reset", "GPIO 5, GPIO 4", "SPI chip select, digital output"],
      ["Exit reader: chip select, reset", "GPIO 15, GPIO 2", "SPI chip select, digital output"],
      ["microSD card: chip select", "GPIO 16", "SPI chip select"],
      ["Entry servo, exit servo", "GPIO 13, GPIO 33", "PWM 50 Hz, 16-bit (LEDC channels 0 and 1)"],
      ["Green LED, red LED, buzzer", "GPIO 12, GPIO 14, GPIO 27", "Digital output"],
      ["LCD (I2C address 0x27)", "SDA GPIO 21, SCL GPIO 22", "I2C at 100 kHz (new ESP-IDF I2C master driver)"],
      ["PIR Room 1, light Room 1", "GPIO 34, GPIO 26", "Digital input (input-only pin), digital output"],
      ["PIR Room 2, light Room 2", "GPIO 35, GPIO 25", "Digital input (input-only pin), digital output"],
      ["Serial monitor", "UART0", "115200 baud"],
    ], [3500, 2900, 2626], "ESP32 pin assignment (from main/config.h)", "pins"),
    P("Sharing one SPI bus between three devices saves pins; each device has its own chip-select line, and only one transaction runs at a time. GPIO 34 and 35 are input-only pins, which suits the PIR outputs."),
    H2("Circuit Diagram"),
    ...figure("wiring.png", "Every part and the ESP32 pin it uses", "wiring", 610),
    placeholder("Insert a screenshot of the entrance circuit running in Wokwi (the diagram.json of the group's firmware), showing the LCD after a scan."),
  ];
  const fw = [
    H1("Firmware and Software Design", "fw"),
    P("The firmware is an ESP-IDF project in C (`main/` of the entrance firmware), built with `idf.py` and run in Wokwi through `wokwi.toml`. It uses two managed components, `espressif/mqtt` and `espressif/cjson`. Each concern is in its own source file."),
    ...table(["File", "Responsibility"], [
      ["`main.c`", "Start-up: SPI bus, LCD, state, storage, door, RFID, rooms, Wi-Fi, console; then the tasks, MQTT and NTP"],
      ["`config.h`", "Pins, Wi-Fi and broker settings, topics, default cards, limits"],
      ["`rfid.c`", "MFRC522 driver over SPI, the rfid task, the feedback and logging after each scan"],
      ["`state.c`", "The rules (`state_evaluate`), people inside, cards, schedule, admin session, room states, under one mutex"],
      ["`door.c`", "Servo PWM and the door task fed by a queue"],
      ["`rooms.c`", "PIR sensing, 5 s hold timer, light outputs and overrides"],
      ["`storage.c`", "NVS for cards, people inside and schedule; SD card log `access.csv`"],
      ["`comms.c`", "Wi-Fi, the MQTT client, topics and JSON messages, the lockdown command"],
      ["`console.c`", "Serial menu and admin commands"],
      ["`lcd.c`", "16x2 LCD driver over I2C"],
    ], [2000, 7026], "Source files of the entrance firmware", "fwfiles"),
    H2("Task Structure and Start-up Sequence"),
    P("`app_main()` initialises the SPI bus and the LCD (which shows the welcome screen at once), then the state (restored from NVS), storage (NVS and SD card), doors, RFID readers, rooms, Wi-Fi and console. It starts the rfid and room tasks, waits 3 seconds for Wi-Fi, starts MQTT and the console, and finally starts NTP with the time zone EAT-3."),
    ...table(["Task", "Priority", "Stack", "What it does"], [
      ["rfid", "6 (highest)", "8 KB", "Polls both readers every 150 ms, applies the rules, drives feedback, logs and publishes"],
      ["door", "4", "2 KB", "Waits on the door queue; opens the requested servo for 3 s"],
      ["room_lights", "4", "4 KB", "Reads the PIR sensors every 100 ms; switches and publishes the lights"],
      ["console", "3", "4 KB", "Reads the serial monitor and runs commands"],
      ["MQTT (esp-mqtt)", "set by the component", "own", "Keeps the broker connection, publishes and receives"],
    ], [1800, 1500, 900, 4826], "FreeRTOS tasks in the entrance firmware", "tasks"),
    P("Card reading has the highest priority because a person is waiting at the door; the console has the lowest because a person typing can wait a few milliseconds."),
    H2("RFID Access Control Module"),
    P("Both MFRC522 readers share the SPI bus at 1 MHz (chosen for stable simulation). The rfid task polls each reader in turn: it sends REQA, runs anticollision to read the 4-byte UID and checks its XOR checksum. A card held on a reader is only processed once every 1.5 seconds. `rfid_trigger_scan()` then calls `state_evaluate()`, opens the door through the door queue, gives LED and buzzer feedback, shows the result on the LCD, appends to the SD log, publishes the event and the occupancy, and saves the state to NVS."),
    H2("PIR Occupancy and Lighting Module"),
    P("The room_lights task reads both PIR outputs every 100 ms. Motion resets a hold counter; the room is occupied while the counter is below 50 cycles (5 seconds). An override from the console (`lights roomN on|off|auto`) takes priority. Only when a room's light state changes does the task switch the output, update the shared state and publish `cocis/state/roomN`, so the broker and database are not flooded."),
    H2("Storage Module"),
    P("`storage.c` keeps three small values in NVS under the namespace `cocis`: `sched_start` and `sched_end` (minutes since midnight), and the blobs `inside` and `users` (count plus card UIDs). At start-up the default schedule is 07:00 to 21:00 and the default cards are 11223344 and 01020304. The SD card is mounted at `/sdcard` and `access.csv` is opened in append mode with the header `epoch,iso8601,tag_hex,dir,result`; each scan adds one line under the storage mutex and is flushed immediately."),
    H2("Communication Module (Wi-Fi and MQTT)", "comms"),
    P("`comms.c` joins the Wokwi-GUEST network and starts the esp-mqtt client with the broker in `config.h`. It publishes JSON built with `snprintf` or cJSON (Table " + T("topics") + "). On connecting it subscribes to the command topic and republishes the occupancy and schedule, so a new subscriber has the current values."),
    ...table(["Topic", "Direction", "Payload example", "Retained", "QoS"], [
      ["`cocis/event/access`", "ESP32 to server", "`{\"tag\":\"11223344\",\"dir\":\"IN\",\"result\":\"OK\",\"ts\":1793636493}`", "No", "0"],
      ["`cocis/state/occupancy`", "ESP32 to server", "`{\"count\":2,\"ts\":1793636493}`", "Yes", "1"],
      ["`cocis/state/room1`, `room2`", "ESP32 to server", "`{\"occupied\":true,\"lights\":true,\"ts\":...}`", "Yes", "1"],
      ["`cocis/config/schedule`", "ESP32 to server", "`{\"start\":\"07:00\",\"end\":\"21:00\",\"version\":...}`", "Yes", "1"],
      ["`cocis/cmd/entrance`", "Server to ESP32", "`LOCKDOWN` or `UNLOCK`", "Yes (bridge)", "1"],
    ], [2400, 1600, 3426, 900, 700], "MQTT topics and messages", "topics"),
    H2("Serial Interface and Management Menus"),
    ...table(["Command", "Purpose"], [
      ["`help`, `status`", "Menu; time, schedule, occupancy, admin session, card count, both rooms with their mode"],
      ["`occupancy`, `who`", "Number of people inside; list of cards inside"],
      ["`logs <n>`, `sd dump <n>`", "Recent scans from the SD card log"],
      ["`scan in|out <HEX>`", "Simulate a card at the entry or exit reader"],
      ["`login <user> <pin>`, `logout`", "Admin session (5 minutes)"],
      ["`user list | add <HEX> | remove <HEX>`", "Authorised cards (admin)"],
      ["`schedule show | set HH:MM HH:MM`", "Access window (admin)"],
      ["`lights room1|room2 on|off|auto`", "Light override (admin)"],
      ["`config save`, `reboot`", "Save state; restart"],
    ], [3400, 5626], "Serial menu commands of the entrance firmware", "menu"),
    H2("Synchronisation in the Firmware"),
    P(`All shared state lives in one structure in \`state.c\` protected by a FreeRTOS mutex; every function that reads or writes it takes the mutex first, and slow work (SD and NVS writes, MQTT) is done after releasing it. The SD log has its own mutex. The door queue lets the rfid task carry on scanning while a door is open. Table ${T("sync")} summarises these mechanisms with the server-side ones.`),
    H2("MQTT Bridge", "bridgesec"),
    P(`The bridge (\`bridge/mqtt_bridge.py\`, started with \`bridge.bat\`) connects the firmware to the database without any change to the firmware. It uses the Python paho-mqtt library to subscribe to the ESP32's topics and the standard library to call the API. Messages are handled one at a time by a worker thread, so the database receives them in order. Table ${T("bridgemap")} shows what it does with each message.`),
    ...table(["ESP32 message", "Bridge action", "API request", "Stored in"], [
      ["Scan on `cocis/event/access`", "Convert the result code, build a stable `event_uuid` (`MQ-11223344-IN-1793636493`)", "`POST /device/relay`", "`access_events` (source MQTT), `building_visits`"],
      ["Room on `cocis/state/roomN`", "Occupied becomes count 1 and trigger MOTION; vacant becomes 0 and NO_MOTION", "`POST /device/relay`", "`rooms`, `room_status_logs`"],
      ["Count on `cocis/state/occupancy`", "Compare with the database", "`GET /occupancy`", "Shown in the bridge window"],
      ["Window on `cocis/config/schedule`", "Copy to all seven days if different", "`PUT /schedule`", "`access_schedule`"],
      ["First granted scan of a new card", "Register the card", "`POST /users`", "`users`"],
      ["Any message", "Mark the controller online", "`POST /device/heartbeat`", "`devices`"],
      ["Lockdown changed on the server", "Publish LOCKDOWN or UNLOCK (retained)", "`GET /occupancy` every 2 s", "Reaches the ESP32"],
    ], [2300, 3300, 1700, 1726], "What the bridge does with each message", "bridgemap"),
    P("Three safeguards keep the database correct: the stable `event_uuid` means a message delivered twice is stored once; retained messages older than 10 minutes (left over from earlier runs) are ignored; and before NTP has set the ESP32's clock (a timestamp from 1970) the bridge uses its own time."),
    H2("Management Dashboard"),
    P("Management use a web dashboard served by the API itself at `/dashboard/` (plain HTML, CSS and JavaScript, no installation). It calls only the API, with the same login and role checks as Swagger UI. Its Database tab shows the real rows of each table with a Refresh button and auto-refresh, which makes it easy to show that every event reaches the database. The screens are shown in Section " + S("opsdash") + "."),
    H2("Testing Tools Without Hardware", "virtual"),
    P("Two tools let anyone test the server side on a laptop. `entrance_sim.bat` publishes exactly the messages the entrance firmware publishes (same topics, same JSON, same rules), so the bridge, database and dashboard can be tested without running Wokwi. `simulate.bat` and `demo.bat` run a virtual HTTP controller that calls the API directly (Appendix C)."),
  ];

  // ---------- Database (Lisa) ----------
  const dd = (name, purpose, rows) => [
    H3(name),
    P(purpose),
    ...table(["Column", "Type", "Constraints", "Description"], rows, [1900, 1300, 2200, 3626], `Data dictionary: ${name}`),
  ];

  const db = [
    H1("Database Design", "db"),
    P("The database is the system's long-term memory. It answers the questions management cares about: *who is in the building now?*, *who came in yesterday and when did they leave?*, *were the lecture-room lights left on?*, *who changed the schedule?* It also holds the configuration that the ESP32 downloads."),
    H2("Choice of Database Engine"),
    P(`We chose **SQLite 3** for the central database. It stores the whole database in one file, needs no separate database server, is built into Python, and fully supports transactions, foreign keys, unique and partial indexes, generated columns and views, all of which this design relies on. Its single-writer locking model makes the concurrency guarantees in Section ${S("sync")} simple to reason about. Write-Ahead Logging (WAL) mode is enabled so that read requests (for example, a dashboard showing occupancy) never wait for a write. Because the API only uses standard SQL, the same schema can move to PostgreSQL or MySQL if CoCIS rolls the system out to the whole college.`),
    P(`On the ESP32 itself, data is kept in CSV files on the SD card rather than in a database, for the reasons given in Section ${S("sd")}.`),
    H2("Entity-Relationship Diagram"),
    P(`Figure ${F("erd")} shows the eleven tables and how they are related. Blue tables hold people and their movements, green tables hold rooms and lighting, purple tables hold staff accounts, orange tables hold configuration and grey tables hold device health and the audit trail.`),
    ...figure("erd.png", "Entity-relationship diagram of the cocis.db database", "erd", 610),
    H3("Relationships"),
    bullet("**users to access_events (one to many):** one person can scan many times. `user_id` is NULL for unknown tags, but the raw `rfid_uid` is always stored so intruder attempts are still logged."),
    bullet("**users to building_visits (one to many):** one row per stay in the building."),
    bullet("**access_events to building_visits (one to one):** each visit points at the event that opened it (`entry_event_id`) and the event that closed it (`exit_event_id`)."),
    bullet("**rooms to room_status_logs (one to many):** every change of occupant count or light state is logged."),
    bullet("**admins to admin_sessions (one to many)** and **admins to access_schedule (one to many, via `updated_by`)**: who is logged in and who last changed each day's schedule."),
    H2("Data Dictionary"),
    P("This section describes every table and column. Time values are stored as ISO-8601 text in East Africa Time, for example `2026-10-30T08:15:02`, which sorts correctly as text and is easy to produce on the ESP32 with `strftime`."),
    ...dd("users", "Every person who has been issued an RFID tag.", [
      ["id", "INTEGER", "PK, auto-increment", "Internal identifier"],
      ["rfid_uid", "TEXT", "NOT NULL, UNIQUE", "Tag UID in upper-case hex, e.g. `A1B2C3D4`"],
      ["full_name", "TEXT", "NOT NULL", "Name shown on the LCD and in reports"],
      ["reg_number", "TEXT", "UNIQUE", "Student or staff number"],
      ["email, phone", "TEXT", "", "Contact details"],
      ["role", "TEXT", "STUDENT, STAFF, LECTURER, SECURITY or VISITOR", "Category of user"],
      ["department", "TEXT", "", "Department"],
      ["is_active", "INTEGER", "0 or 1, default 1", "0 = tag disabled (lost card, left the college); history is kept"],
      ["created_at, updated_at", "TEXT", "default now", "Record timestamps"],
    ]),
    ...dd("rooms", "The three controlled zones, with each lecture room's live state.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["code", "TEXT", "NOT NULL, UNIQUE", "`MAIN`, `LR1` or `LR2`"],
      ["name", "TEXT", "NOT NULL", "Display name"],
      ["room_type", "TEXT", "ENTRANCE or LECTURE_ROOM", "Kind of zone"],
      ["capacity", "INTEGER", "", "Seats"],
      ["light_watts", "INTEGER", "default 0", "Total lamp power, used to estimate energy"],
      ["occupant_count", "INTEGER", "NOT NULL, >= 0", "People in the room (beam counter), or 1 and 0 for occupied and vacant (PIR room)"],
      ["is_occupied", "INTEGER", "0 or 1", "1 when occupant_count > 0"],
      ["light_on", "INTEGER", "0 or 1", "Current light state"],
      ["light_mode", "TEXT", "AUTO, FORCE_ON or FORCE_OFF", "AUTO = the counter decides; otherwise a manual override"],
      ["last_activity_at", "TEXT", "", "Last time someone crossed the doorway"],
      ["updated_at", "TEXT", "NULL until first report", "Device time of the last reported change"],
    ]),
    ...dd("access_events", "Every RFID scan at the main entrance, whether granted or denied.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["event_uuid", "TEXT", "NOT NULL, UNIQUE", "Id generated by the ESP32; stops duplicates"],
      ["rfid_uid", "TEXT", "NOT NULL", "UID that was scanned (even if unknown)"],
      ["user_id", "INTEGER", "FK to users.id, nullable", "The matching user, if any"],
      ["door", "TEXT", "ENTRY or EXIT", "Which lane was used"],
      ["decision", "TEXT", "GRANTED or DENIED", "Outcome"],
      ["reason", "TEXT", `OK, OK_AFTER_HOURS, UNKNOWN_TAG, INACTIVE_USER, OUTSIDE_SCHEDULE, ALREADY_INSIDE, NOT_INSIDE or EMERGENCY_OPEN (Table ${T("rules")})`, "Why"],
      ["source", "TEXT", "ONLINE, OFFLINE_SYNC or MQTT", "Decided by the API; by an HTTP controller while offline; or by the MQTT entrance controller and relayed by the bridge"],
      ["occurred_at", "TEXT", "NOT NULL, indexed", "Time of the scan (ESP32 clock)"],
      ["received_at", "TEXT", "default now", "Time the server stored it"],
    ]),
    ...dd("building_visits", "One row for each stay in the building. If `time_out` is empty, the person is inside now.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["user_id", "INTEGER", "FK to users.id", "Who"],
      ["entry_event_id", "INTEGER", "FK to access_events.id", "The scan that opened the visit"],
      ["exit_event_id", "INTEGER", "FK to access_events.id, nullable", "The scan that closed it"],
      ["time_in", "TEXT", "NOT NULL", "Entry time"],
      ["time_out", "TEXT", "nullable", "Exit time; NULL = still inside"],
      ["visit_date", "TEXT", "generated from time_in", "Date part, indexed for daily reports"],
    ]),
    ...dd("room_status_logs", "History of occupancy and lighting changes in each lecture room.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["event_uuid", "TEXT", "NOT NULL, UNIQUE", "Id generated by the ESP32"],
      ["room_id", "INTEGER", "FK to rooms.id", "Which room"],
      ["occupant_count", "INTEGER", ">= 0", "Count after this change"],
      ["is_occupied, light_on", "INTEGER", "0 or 1", "New state"],
      ["trigger", "TEXT", "MOTION, NO_MOTION (PIR rooms), PERSON_IN, PERSON_OUT, COUNT_RESET (beam counters), MANUAL_OVERRIDE, SCHEDULE or EMERGENCY", "What caused the change"],
      ["occurred_at, received_at", "TEXT", "", "Device time and server time"],
    ]),
    ...dd("access_schedule", "The permitted access window for each day of the week (seven rows).", [
      ["day_of_week", "INTEGER", "PK, 0 to 6", "0 = Sunday ... 6 = Saturday (same as C's `tm_wday`)"],
      ["is_open", "INTEGER", "0 or 1", "0 = building closed all day"],
      ["open_time, close_time", "TEXT", "HH:MM, open < close", "Access allowed from open_time up to (not including) close_time"],
      ["updated_by", "INTEGER", "FK to admins.id", "Who last changed it"],
      ["updated_at", "TEXT", "", "When"],
    ]),
    ...dd("system_settings", "Small key/value settings that are sent to the ESP32.", [
      ["key", "TEXT", "PK", "`emergency_mode`, `lockdown_mode`, `light_off_delay_s`, `timezone`, `config_version`, `heartbeat_interval_s`"],
      ["value", "TEXT", "NOT NULL", "Value as text"],
      ["description", "TEXT", "", "What it means"],
      ["updated_at", "TEXT", "", "Last change"],
    ]),
    ...dd("admins", "Staff who can log in to manage the system.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["username", "TEXT", "NOT NULL, UNIQUE", "Login name"],
      ["full_name", "TEXT", "NOT NULL", "Display name"],
      ["password_hash", "TEXT", "NOT NULL", "PBKDF2-SHA256, 200,000 iterations, random salt; never the plain password"],
      ["role", "TEXT", "SUPER_ADMIN, SECURITY or VIEWER", `Permission level (Table ${T("roles")})`],
      ["is_active", "INTEGER", "0 or 1", "Disabled accounts cannot log in"],
      ["created_at", "TEXT", "", "When the account was created"],
    ]),
    ...dd("admin_sessions", "Login tokens currently issued. Only a SHA-256 hash of each token is stored.", [
      ["token_hash", "TEXT", "PK", "SHA-256 of the bearer token"],
      ["admin_id", "INTEGER", "FK to admins.id", "Owner"],
      ["created_at, expires_at", "TEXT", "", "Tokens expire after 8 hours"],
    ]),
    ...dd("devices", "The ESP32 controller(s) allowed to send data, and their latest health report.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["device_code", "TEXT", "NOT NULL, UNIQUE", "`ESP32-MQTT-ENTRANCE` (through the bridge) or `ESP32-CTRL-01` (HTTP controller)"],
      ["api_key_hash", "TEXT", "NOT NULL", "SHA-256 of the device key"],
      ["firmware_version, ip_address", "TEXT", "", "From the heartbeat"],
      ["free_heap, sd_free_kb", "INTEGER", "", "Memory and SD space left"],
      ["pending_events", "INTEGER", "", "Records waiting to be uploaded (0 for the MQTT controller)"],
      ["last_seen_at", "TEXT", "", "Used to show the device as online or offline"],
    ]),
    ...dd("audit_log", "A permanent record of every configuration change and login attempt.", [
      ["id", "INTEGER", "PK", "Internal identifier"],
      ["actor_type", "TEXT", "ADMIN, DEVICE or SYSTEM", "Who acted"],
      ["actor_id", "INTEGER", "", "admins.id or devices.id"],
      ["action", "TEXT", "NOT NULL", "e.g. `SCHEDULE_UPDATE`, `EMERGENCY_ON`, `LOGIN_FAILED`"],
      ["details", "TEXT (JSON)", "", "What exactly changed"],
      ["created_at", "TEXT", "indexed", "When"],
    ]),
    H2("Integrity Rules, Indexes and Views"),
    ...table(["Object", "Type", "Why it exists"], [
      ["Foreign keys (`PRAGMA foreign_keys = ON`)", "Constraint", "A visit cannot point at a user or event that does not exist"],
      ["CHECK constraints on role, door, decision, reason, light_mode, trigger, counts and 0/1 flags", "Constraint", "Invalid values are rejected by the database itself, not only by the API"],
      ["`CHECK (open_time < close_time)`", "Constraint", "A schedule cannot close before it opens"],
      ["`uq_one_open_visit` on building_visits(user_id) WHERE time_out IS NULL", "Partial unique index", "A person can only be inside once: the final safeguard against race conditions"],
      ["`idx_access_events_time`, `idx_access_events_user`", "Index", "Fast log searches by date and by person"],
      ["`idx_visits_date`, `idx_room_logs`, `idx_audit_time`", "Index", "Fast daily reports and history"],
      ["`v_people_inside`", "View", "Everyone with an open visit: answers \"who is inside now?\""],
      ["`v_daily_access_summary`", "View", "Entries, exits and refusals per day"],
    ], [3600, 1500, 3926], "Integrity constraints, indexes and views"),
    H2("Local Storage on the ESP32", "sdlayout"),
    P(`The controller keeps only what it needs to work on its own (design in Section ${S("sd")}).`),
    ...table(["Where", "Name", "Contents", "Written when"], [
      ["NVS flash", "`sched_start`, `sched_end`", "Access window in minutes since midnight", "`schedule set`"],
      ["NVS flash", "`users` (blob)", "Number of cards, then up to 64 UIDs", "`user add`, `user remove`"],
      ["NVS flash", "`inside` (blob)", "Number of people inside, then up to 16 UIDs", "After every scan"],
      ["microSD card", "`/sdcard/access.csv`", "`epoch, iso8601, tag_hex, dir, result`", "Every scan (append only)"],
    ], [1500, 2300, 3200, 2026], "Storage on the ESP32", "sdfiles"),
    P("A migration in `api/db.py` upgrades databases made before the bridge existed: the tables whose allowed values were widened (`access_events`, `room_status_logs`) are rebuilt from the current schema, keeping every row, with foreign keys switched off during the copy."),
    H2("Initial (Seed) Data"),
    P(`When the API starts for the first time it creates the database from \`database/schema.sql\` and loads \`database/seed.sql\`: the three rooms, a default schedule (Monday to Friday 07:00 to 22:00, Saturday 08:00 to 17:00, Sunday closed), the default settings, four demonstration users whose tag UIDs match the Wokwi simulation, one administrator account and one device key. The demonstration credentials are listed in Section ${S("creds")} and **must be changed before any real deployment**.`),
  ];

  // ---------- API (Lisa) ----------
  const api = [
    H1("REST API Design and Documentation", "api"),
    P("The API is the only way into the database. The ESP32 uses it to ask for access decisions and to report events; staff use it to monitor the building and to change settings. Interactive documentation, generated automatically from the code, is available at `/docs` (Swagger UI) whenever the API is running; this chapter is the written reference."),
    H2("General Conventions"),
    ...table(["Item", "Value"], [
      ["Base URL", "`http://<server>:8000/api/v1`"],
      ["Format", "JSON request and response bodies (`Content-Type: application/json`)"],
      ["Time format", "ISO-8601 local time (EAT), e.g. `2026-10-30T08:15:02`"],
      ["Device authentication", "Header `X-Device-Key: <device key>`"],
      ["Staff authentication", "Header `Authorization: Bearer <token>` (token from `POST /auth/login`, or from `POST /auth/token` when logging in through the Authorize button in Swagger UI)"],
      ["Interactive docs", "`/docs` (Swagger UI), `/redoc`; machine-readable spec at `/openapi.json` (also saved as `docs/openapi.json`)"],
      ["Technology", "Python 3, FastAPI, Pydantic (validation), Uvicorn (server), SQLite 3"],
    ], [2600, 6426], "General API conventions"),
    ...table(["Status", "Meaning in this API"], [
      ["200 OK", "Request succeeded"],
      ["201 Created", "A new user was registered"],
      ["400 Bad Request", "Request understood but nothing to do (e.g. empty update)"],
      ["401 Unauthorized", "Missing or wrong device key, wrong password, or expired token"],
      ["403 Forbidden", "Logged in, but the role is not allowed to do this"],
      ["404 Not Found", "User or room does not exist"],
      ["409 Conflict", "RFID tag or registration number is already registered"],
      ["422 Unprocessable Entity", "Validation failed (wrong field type, bad time format, negative count, opening after closing, ...)"],
    ], [2600, 6426], "HTTP status codes returned by the API"),
    P("Errors always have the same shape, so the ESP32 and any dashboard can handle them in one place:"),
    ...code(`{ "detail": "Requires role SUPER_ADMIN or higher" }`),
    H2("Security Model"),
    P(`There are two kinds of client, each with its own credential. The **ESP32** sends a secret device key on every request; the server stores only its SHA-256 hash. **Staff** log in with a username and password (stored as a salted PBKDF2 hash) and receive a random bearer token valid for 8 hours. Every management endpoint checks the token and the role in Table ${T("roles")}. All configuration changes, logins and failed logins are written to the audit log.`),
    ...table(["Role", "Intended for", "Allowed to"], [
      ["VIEWER", "Management, reception", "Read everything except the audit log: users, occupancy, logs, rooms, schedule, settings, reports"],
      ["SECURITY", "Security officers", "Everything VIEWER can, plus switch emergency mode and override room lights"],
      ["SUPER_ADMIN", "System administrator", "Everything, including registering and deactivating users, changing the schedule and settings, and reading the audit log"],
    ], [1700, 2200, 5126], "Staff roles and permissions", "roles"),
    H2("Endpoint Summary"),
    ...table(["Method", "Path (after /api/v1)", "Auth", "Use case", "Purpose"], [
      ["GET", "/health", "none", "", "Check that the API is running"],
      ["POST", "/device/access/check", "Device", "", "Decide and record a scan (HTTP controller)"],
      ["POST", "/device/rooms/status", "Device", "", "Report a room change (HTTP controller)"],
      ["POST", "/device/events/batch", "Device", "", "Upload records stored while offline (HTTP controller)"],
      ["POST", "/device/relay", "Device", "UC15", "Store events decided by the MQTT controller, relayed by the bridge"],
      ["GET", "/device/config", "Device", "", "Download schedule, tags and settings (HTTP controller)"],
      ["POST", "/device/heartbeat", "Device", "UC15a", "Report health; learn config_version and lockdown_mode"],
      ["POST", "/auth/login", "none", "UC09", "Log in, receive a bearer token"],
      ["POST", "/auth/token", "none", "UC09", "Same login as a form, used by the Authorize button in Swagger UI"],
      ["POST", "/auth/logout", "any role", "UC09", "Invalidate the token"],
      ["GET", "/auth/me", "any role", "UC09", "Who am I?"],
      ["GET", "/users", "VIEWER", "UC10", "List or search tag holders"],
      ["GET", "/users/{id}", "VIEWER", "UC10", "One user, including whether they are inside"],
      ["POST", "/users", "SUPER_ADMIN", "UC10", "Register a new tag holder"],
      ["PATCH", "/users/{id}", "SUPER_ADMIN", "UC10", "Change details, re-issue a tag, activate or deactivate"],
      ["DELETE", "/users/{id}", "SUPER_ADMIN", "UC10", "Deactivate (soft delete; history kept)"],
      ["GET", "/occupancy", "VIEWER", "UC07", "People inside now, and lecture-room status"],
      ["GET", "/access-events", "VIEWER", "UC08", "Search the access log (filters and paging)"],
      ["GET", "/visits", "VIEWER", "UC08", "Time in and time out per person per day"],
      ["GET", "/rooms", "VIEWER", "UC07", "All rooms with live state"],
      ["GET", "/rooms/{code}/history", "VIEWER", "UC08", "A room's changes on a given day"],
      ["PUT", "/rooms/{code}/light-mode", "SECURITY", "UC13", "AUTO, FORCE_ON or FORCE_OFF override"],
      ["GET", "/schedule", "VIEWER", "UC11", "Weekly access schedule"],
      ["PUT", "/schedule", "SUPER_ADMIN", "UC11", "Change one or more days of the schedule"],
      ["GET", "/settings", "VIEWER", "", "All system settings"],
      ["PATCH", "/settings", "SUPER_ADMIN", "", "Change light-off delay or heartbeat interval"],
      ["PUT", "/settings/emergency", "SECURITY", "", "Emergency mode (all doors open) for the HTTP controller"],
      ["PUT", "/settings/lockdown", "SECURITY", "UC12", "Lockdown on or off; forwarded to the ESP32 by the bridge"],
      ["GET", "/reports/daily", "VIEWER", "UC08", "Daily totals, peak occupancy and lighting energy"],
      ["GET", "/devices", "VIEWER", "", "ESP32 health and online status"],
      ["GET", "/audit-log", "SUPER_ADMIN", "", "Recent configuration changes and logins"],
      ["GET", "/db/tables", "SUPER_ADMIN", "UC08", "Tables and views with their row counts"],
      ["GET", "/db/{table}", "SUPER_ADMIN", "UC08", "Latest rows of one table (read-only, secrets hidden)"],
    ], [1050, 2450, 1500, 1100, 2926], "Summary of all API endpoints", "endpoints"),
    H2("Device Endpoints"),
    P("Device endpoints are authenticated with the `X-Device-Key` header. The MQTT bridge uses `/device/relay` and `/device/heartbeat` on behalf of the entrance ESP32 (Section " + S("connect") + "). The other device endpoints serve controllers that call the API directly, such as the reference HTTP controller and the virtual ESP32 (Appendix C)."),
    ...endpoint("POST", "/api/v1/device/access/check", "`X-Device-Key`", "Called by the Access Control task every time a tag is scanned while online (UC01 to UC03). The API decides, records the event and updates the visit in one transaction, and returns the decision. If the same `event_uuid` is sent again (e.g. the ESP32 retried after a timeout), the original answer is returned with `duplicate: true` and nothing new is stored.", [
      ["Request body", `{
  "event_uuid": "01-000123",
  "rfid_uid": "A1B2C3D4",
  "door": "ENTRY",
  "occurred_at": "2026-10-30T08:15:02"
}`, true],
      ["Response 200", `{
  "decision": "GRANTED",
  "reason": "OK",
  "event_id": 812,
  "user": { "id": 1, "full_name": "Lisa Nyonyozi", "role": "STUDENT" },
  "people_inside": 37,
  "duplicate": false
}`, true],
      ["Notes", "`rfid_uid` must be 8 to 20 hex characters (lower case is accepted and converted). `door` is `ENTRY` or `EXIT`. The ESP32 opens the door only when `decision` is `GRANTED`; it can show `user.full_name` and `people_inside` on the LCD. When `people_inside` is 0 the ESP32 resets both room counts (UC06)."],
    ]),
    ...endpoint("POST", "/api/v1/device/rooms/status", "`X-Device-Key`", "Called by the Lighting task whenever someone crosses a lecture-room doorway, a count is reset, or the lights change (UC04 to UC06).", [
      ["Request body", `{
  "event_uuid": "01-000124",
  "room_code": "LR1",
  "occupant_count": 14,
  "light_on": true,
  "trigger": "PERSON_IN",
  "occurred_at": "2026-10-30T08:16:40"
}`, true],
      ["Response 200", `{ "stored": true, "duplicate": false }`, true],
      ["Notes", "`room_code` is `LR1` or `LR2`. `occupant_count` must be 0 or more; the server sets `is_occupied` from it. `trigger` is one of PERSON_IN, PERSON_OUT, COUNT_RESET, MANUAL_OVERRIDE, SCHEDULE, EMERGENCY. The room's live state is only replaced if this report is newer than the one already held."],
    ]),
    ...endpoint("POST", "/api/v1/device/events/batch", "`X-Device-Key`", "Uploads up to 200 access events and 200 room events saved in `outbox.csv` while the ESP32 was offline (UC14). All of them are stored in one transaction, in time order. For access events the ESP32 includes the decision it made offline, which the server records as-is with `source = OFFLINE_SYNC`.", [
      ["Request body", `{
  "access_events": [
    { "event_uuid": "01-000130", "rfid_uid": "A1B2C3D4", "door": "EXIT",
      "occurred_at": "2026-10-30T16:00:00", "decision": "GRANTED", "reason": "OK" }
  ],
  "room_events": [
    { "event_uuid": "01-000131", "room_code": "LR1", "occupant_count": 0,
      "light_on": false, "trigger": "PERSON_OUT", "occurred_at": "2026-10-30T16:05:00" }
  ]
}`, true],
      ["Response 200", `{ "accepted": ["01-000130", "01-000131"], "duplicates": [] }`, true],
      ["Notes", "The ESP32 deletes every uuid in *accepted* **and** *duplicates* from outbox.csv. Sending the same batch twice is safe."],
    ]),
    ...endpoint("GET", "/api/v1/device/config", "`X-Device-Key`", "Returns everything the ESP32 needs to make decisions on its own (UC15). The ESP32 saves it to the SD card (users.csv, schedule.csv, config.csv, inside.csv).", [
      ["Response 200", `{
  "config_version": 9,
  "server_time": "2026-10-30T08:00:00",
  "timezone": "EAT-3",
  "emergency_mode": false,
  "light_off_delay_s": 30,
  "heartbeat_interval_s": 60,
  "schedule": [ { "day_of_week": 1, "is_open": 1, "open_time": "07:00", "close_time": "22:00" } ],
  "room_light_modes": { "LR1": "AUTO", "LR2": "AUTO" },
  "authorised_tags": [ { "rfid_uid": "A1B2C3D4", "full_name": "Lisa Nyonyozi", "role": "STUDENT" } ],
  "currently_inside": [ "A1B2C3D4" ]
}`, true],
      ["Notes", "Only active users are listed. `schedule` always contains all seven days (shortened above)."],
    ]),
    ...endpoint("POST", "/api/v1/device/heartbeat", "`X-Device-Key`", "Sent every `heartbeat_interval_s` seconds (UC15a). Lets management see that the controller is alive, and tells the ESP32 whether its cached configuration is out of date.", [
      ["Request body", `{ "firmware_version": "1.0.0", "ip_address": "10.10.0.2",
  "free_heap": 120000, "sd_free_kb": 31000, "pending_events": 0 }`, true],
      ["Response 200", `{ "server_time": "2026-10-30T08:01:00", "config_version": 9, "emergency_mode": false }`, true],
      ["Notes", "If `config_version` differs from the version on the SD card, the ESP32 calls `GET /device/config`. `emergency_mode` is included so that an emergency reaches the doors within one heartbeat."],
    ]),
    ...endpoint("POST", "/api/v1/device/relay", "`X-Device-Key`", "Called by the MQTT bridge for every message from the entrance controller (UC15). The controller has already decided, so the events are stored as they are, with source MQTT. The body has the same shape as a batch.", [
      ["Request body", `{ "access_events": [ { "event_uuid": "MQ-11223344-IN-1793636493", "rfid_uid": "11223344",
      "door": "ENTRY", "decision": "GRANTED", "reason": "OK", "occurred_at": "2026-11-02T19:21:33" } ],
  "room_events": [ { "event_uuid": "MQ-room1-1-1-1793636510", "room_code": "LR1",
      "occupant_count": 1, "light_on": true, "trigger": "MOTION", "occurred_at": "2026-11-02T19:21:50" } ] }`, true],
      ["Response 200", `{ "accepted": ["MQ-11223344-IN-1793636493", "MQ-room1-1-1-1793636510"], "duplicates": [] }`, true],
      ["Notes", "Events are sorted by time and stored in one transaction. An `event_uuid` that is already stored is listed under `duplicates` and not stored again, so a message delivered twice is harmless. A granted entry opens a visit; a granted exit closes it."],
    ]),
    H2("Management Endpoints"),
    ...endpoint("POST", "/api/v1/auth/login", "none", "Exchange a username and password for a bearer token (UC09). Failed attempts are written to the audit log.", [
      ["Request body", `{ "username": "admin", "password": "********" }`, true],
      ["Response 200", `{ "access_token": "q5k...Zt0", "token_type": "bearer",
  "expires_at": "2026-10-30T16:15:00", "role": "SUPER_ADMIN",
  "full_name": "System Administrator" }`, true],
      ["Errors", "401: wrong username or password, or account disabled."],
    ]),
    ...endpoint("POST", "/api/v1/users", "Bearer, SUPER_ADMIN", "Register a new tag holder (UC10). The configuration version is increased so the ESP32 learns about the new tag.", [
      ["Request body", `{ "rfid_uid": "0BADF00D", "full_name": "New Student", "reg_number": "24/U/0099",
  "email": "new@students.mak.ac.ug", "role": "STUDENT", "department": "Computer Science" }`, true],
      ["Response 201", "The stored user, plus `is_inside: false`."],
      ["Errors", "409: tag or registration number already registered. 422: invalid UID or role."],
    ]),
    ...endpoint("GET", "/api/v1/occupancy", "Bearer, any role", "Who is in the building right now, and the state of each lecture room (UC07).", [
      ["Response 200", `{
  "people_inside_count": 2,
  "people_inside": [
    { "user_id": 1, "rfid_uid": "A1B2C3D4", "full_name": "Lisa Nyonyozi",
      "role": "STUDENT", "time_in": "2026-10-30T08:15:02" }
  ],
  "rooms": [
    { "code": "LR1", "name": "Lecture Room 1", "occupant_count": 14, "is_occupied": 1,
      "light_on": 1, "light_mode": "AUTO", "last_activity_at": "2026-10-30T09:02:11",
      "updated_at": "2026-10-30T09:02:11" }
  ],
  "emergency_mode": false,
  "as_of": "2026-10-30T09:05:00"
}`, true],
    ]),
    ...endpoint("GET", "/api/v1/access-events", "Bearer, any role", "Search the access log, newest first (UC08).", [
      ["Query parameters", "`from`, `to` (dates, YYYY-MM-DD), `door` (ENTRY or EXIT), `decision` (GRANTED or DENIED), `user_id`, `limit` (default 50, max 500), `offset`. Example: `/access-events?from=2026-10-30&decision=DENIED`"],
      ["Response 200", `{ "total": 3, "limit": 50, "offset": 0,
  "items": [ { "id": 815, "event_uuid": "01-000140", "rfid_uid": "00000000",
    "user_id": null, "full_name": null, "door": "ENTRY", "decision": "DENIED",
    "reason": "UNKNOWN_TAG", "source": "ONLINE",
    "occurred_at": "2026-10-30T10:44:51", "received_at": "2026-10-30T10:44:51" } ] }`, true],
    ]),
    ...endpoint("GET", "/api/v1/visits", "Bearer, any role", "Time in and time out for each stay (UC08): the *Events* table from the original sketch.", [
      ["Query parameters", "`date` (YYYY-MM-DD), `user_id`"],
      ["Response 200", `[ { "id": 51, "user_id": 1, "full_name": "Lisa Nyonyozi", "rfid_uid": "A1B2C3D4",
    "visit_date": "2026-10-30", "time_in": "2026-10-30T08:15:02",
    "time_out": "2026-10-30T12:40:18" } ]`, true],
    ]),
    ...endpoint("PUT", "/api/v1/schedule", "Bearer, SUPER_ADMIN", "Change the access window for one or more days (UC11). The change is audited and the new `config_version` is returned; the ESP32 picks it up at its next heartbeat.", [
      ["Request body", `{ "days": [
  { "day_of_week": 6, "is_open": true, "open_time": "08:00", "close_time": "14:00" },
  { "day_of_week": 0, "is_open": false, "open_time": "08:00", "close_time": "17:00" }
] }`, true],
      ["Response 200", `{ "schedule": [ ...all seven days... ], "config_version": 10 }`, true],
      ["Errors", "403: role below SUPER_ADMIN. 422: time not HH:MM, or open_time not before close_time."],
    ]),
    ...endpoint("PUT", "/api/v1/settings/emergency", "Bearer, SECURITY or above", "Emergency evacuation (UC12): every door opens for every tag (and unknown tags) until it is switched off. A reason is required and is saved in the audit log.", [
      ["Request body", `{ "enabled": true, "reason": "Fire alarm in Block B" }`, true],
      ["Response 200", `{ "emergency_mode": true, "config_version": 11 }`, true],
    ]),
    ...endpoint("PUT", "/api/v1/rooms/{code}/light-mode", "Bearer, SECURITY or above", "Override automatic lighting (UC13), e.g. force LR1's lights on for cleaning staff, or off during a power-saving period. `AUTO` gives control back to the infrared counter.", [
      ["Request body", `{ "mode": "FORCE_ON" }`, true],
      ["Response 200", `{ "room": "LR1", "light_mode": "FORCE_ON", "config_version": 12 }`, true],
    ]),
    ...endpoint("GET", "/api/v1/reports/daily", "Bearer, any role", "A one-day management summary (UC08): traffic, refusals by reason, unique visitors, the busiest moment, and how long each room's lights were on with the energy used (hours multiplied by `light_watts`).", [
      ["Query parameters", "`date` (YYYY-MM-DD, default today)"],
      ["Response 200", `{
  "date": "2026-10-30", "entries": 142, "exits": 139, "denied": 6,
  "denied_by_reason": { "UNKNOWN_TAG": 2, "OUTSIDE_SCHEDULE": 3, "ALREADY_INSIDE": 1 },
  "unique_visitors": 118,
  "peak_occupancy": { "count": 64, "at": "2026-10-30T10:58:40" },
  "lighting": [ { "room": "LR1", "lights_on_hours": 6.25, "energy_kwh": 3.0 },
                { "room": "LR2", "lights_on_hours": 3.5,  "energy_kwh": 1.12 } ]
}`, true],
    ]),
    P(`The remaining endpoints in Table ${T("endpoints")} follow the same pattern; their full request and response schemas can be explored and tried in Swagger UI at \`/docs\`.`),
    ...endpoint("PUT", "/api/v1/settings/lockdown", "Bearer, SECURITY or higher", "Lock or unlock the entrance (UC12). The change is audited and raises the configuration version; the bridge sees it within 2 seconds and publishes LOCKDOWN or UNLOCK to the ESP32.", [
      ["Request body", `{ "enabled": true, "reason": "Security threat at the gate" }`, true],
      ["Response 200", `{ "lockdown_mode": true, "config_version": 14 }`, true],
    ]),
    H2("Access Decision Reason Codes"),
    P(`The \`reason\` field returned by \`/device/access/check\` and stored in \`access_events\` takes the values in Table ${T("rules")}. The firmware can map each code to an LCD message, for example \`OUTSIDE_SCHEDULE\` shows "Building closed" and \`ALREADY_INSIDE\` shows "Already checked in".`),
    H2("Running the API"),
    P("The project needs only Python 3.10 or newer. Ready-made scripts in the project folder do the setup and start-up on each operating system:"),
    ...table(["Step", "Windows", "macOS or Linux"], [
      ["Install the packages (once)", "double-click `setup.bat`", "`./setup.sh`"],
      ["Start the API and open the docs", "double-click `start.bat`", "`./start.sh`"],
      ["Run the automated tests", "double-click `test.bat`", "`./test.sh`"],
      ["Start again with a fresh database", "double-click `reset_db.bat`", "delete `data/cocis.db`"],
    ], [3000, 3013, 3013], "Scripts for installing, starting and testing the API"),
    P("The database file `data/cocis.db` is created automatically on first start, and the browser opens the interactive documentation at `http://127.0.0.1:8000/docs`. The README file gives the full installation steps, including installing Python on Windows."),
    H3("Testing the API in Swagger UI"),
    ...steps([
      "Click **Authorize** at the top of the page.",
      "Under **AdminLogin** enter `admin` and `Admin@CoCIS2026`, and click **Authorize**. Under **DeviceKey** enter `esp32-demo-key-change-me`, and click **Authorize**. Close the dialog.",
      "Open `POST /device/access/check`, click **Try it out**, then **Execute**. The prefilled example is a scan of Lisa Nyonyozi's tag on a weekday at 09:00, so the answer is `GRANTED`.",
      "Open `GET /occupancy` and execute it: Lisa is listed as inside. Every other endpoint can be tried the same way.",
    ]),
    H2("Connecting the Entrance Controller to the API", "connect"),
    P("The entrance ESP32 is connected through the MQTT bridge. To run the complete system:"),
    ...table(["Step", "Windows", "macOS or Linux", "What happens"], [
      ["1", "`start.bat`", "`./start.sh`", "API, database and dashboard on port 8000"],
      ["2", "`bridge.bat`", "`./bridge.sh`", "Bridge connects to broker.hivemq.com and to the API"],
      ["3", "Run the entrance firmware in Wokwi", "same", "ESP32 publishes to the same broker"],
      ["4", "Open `/dashboard/`", "same", "Scans, people inside and rooms update within 3 s"],
    ], [700, 2600, 2300, 3426], "Running the complete system", "runall"),
    P("Without Wokwi, step 3 can be replaced by `entrance_sim.bat`, which publishes the same messages. The laptop needs internet access for the bridge; it does not need to be on the same network as the ESP32 (Section " + S("net") + ")."),
    H2("Demonstration Credentials", "creds"),
    ...table(["Credential", "Value", "Used by"], [
      ["Administrator", "username `admin`, password `Admin@CoCIS2026` (SUPER_ADMIN)", "Swagger UI, Postman, serial menu"],
      ["Device key (bridge)", "`mqtt-bridge-key-change-me` for device `ESP32-MQTT-ENTRANCE`", "MQTT bridge (`X-Device-Key`)"],
      ["Device key (HTTP)", "`esp32-demo-key-change-me` for device `ESP32-CTRL-01`", "HTTP controller and virtual ESP32"],
      ["ESP32 admin PIN", "`login admin 1234`", "Entrance firmware console"],
      ["Demo cards", "`11223344` lecturer and `01020304` student (authorised on the ESP32); `A1B2C3D4`, `DEADBEEF`, `CAFEBABE` in the database", "Wokwi simulation, dashboard"],
    ], [1900, 4600, 2526], "Demonstration credentials (change before real deployment)"),
    H2("Example: How a Scan Is Sent and Saved", "idf"),
    P("**1. The ESP32 publishes the scan** (`comms_publish_event()` in `comms.c`, unchanged):"),
    ...code(`cJSON *o = cJSON_CreateObject();
char t[16]; snprintf(t, sizeof(t), "%08lX", (unsigned long)tag);
cJSON_AddStringToObject(o, "tag", t);
cJSON_AddStringToObject(o, "dir", is_in ? "IN" : "OUT");
cJSON_AddStringToObject(o, "result", result);          // e.g. "OK", "DENIED_UNKNOWN"
cJSON_AddNumberToObject(o, "ts", (double)time(NULL));
char *s = cJSON_PrintUnformatted(o);
esp_mqtt_client_publish(s_mqtt, TOPIC_EVENT, s, 0, 0, 0);   // cocis/event/access`),
    P("**2. The bridge converts it and calls the API** (`bridge/mqtt_bridge.py`):"),
    ...code(`decision, reason = RESULTS[msg["result"]]               # "OK" -> ("GRANTED", "OK")
event = {"event_uuid": f"MQ-{tag}-{direction}-{int(msg['ts'])}",   # stable: stored once
         "rfid_uid": tag, "door": "ENTRY" if direction == "IN" else "EXIT",
         "decision": decision, "reason": reason, "occurred_at": local_time(msg["ts"])}
POST  http://127.0.0.1:8000/api/v1/device/relay
      X-Device-Key: mqtt-bridge-key-change-me
      {"access_events": [event], "room_events": []}`),
    P("**3. The API validates and saves it.** FastAPI checks the body against the Pydantic model `EventBatch` (each event must have a known door, decision and reason, and a valid time), checks the device key, then stores it in one transaction:"),
    ...code(`with write_tx(conn):                                   # BEGIN IMMEDIATE ... COMMIT
    for ev in sorted(body.access_events, key=lambda e: e.occurred_at):
        if existing_event(conn, ev.event_uuid):            # already stored: skip
            duplicates.append(ev.event_uuid); continue
        record_access(conn, ..., source="MQTT")            # INSERT access_events, open/close visit
        accepted.append(ev.event_uuid)`),
    P("The HTTP reference controller (Appendix C) skips steps 1 and 2: it calls `POST /device/access/check` directly with `esp_http_client` and lets the API decide."),
  ];

  // ---------- Features ----------
  const feat = [
    H1("Implemented Features and Innovations", "feat"),
    H2("Core Features"),
    ...table(["Brief requirement", "How it is implemented and demonstrated"], [
      ["RFID entry and exit (2.1)", "Two MFRC522 readers; tap a card (or `scan in 11223344`): the entry servo opens, the green LED lights and the LCD shows ACCESS GRANTED"],
      ["Who is inside (2.1)", "People-inside list on the ESP32 (`who`), and `v_people_inside` on the dashboard"],
      ["Automatic lighting (2.2)", "PIR motion turns a room light on; 5 s without motion turns it off; `lights room1 on|off|auto` overrides"],
      ["Data storage (2.4)", "`access.csv` on the SD card, NVS for state, and the central database through the bridge"],
      ["Serial menus (2.5)", "`help`, `status`, `who`, `logs`, `user`, `schedule`, `lights` (Table " + T("menu") + ")"],
      ["Configurable schedule (2.6)", "`login`, then `schedule set 07:00 21:00`; entries outside the window are refused"],
      ["Synchronisation (2.7)", "Mutexes and a door queue on the ESP32; transactions and unique keys on the server (Table " + T("sync") + ")"],
    ], [2600, 6426], "Core features and how to show them"),
    H2("Innovations"),
    bullet("**Live database and dashboard without changing the firmware.** The MQTT bridge stores every scan and room change within a second; the dashboard updates every 3 seconds."),
    bullet("**No network setup.** The ESP32 and the server only connect out to the broker, so the database stays private and no tunnel is needed."),
    bullet("**Exactly-once storage.** Stable event ids, transactions and a unique key mean a repeated message never creates a duplicate record."),
    bullet("**Safe after-hours exit.** People are never locked inside; exits after hours are recorded separately for security."),
    bullet("**Two-way control.** Lockdown set on the dashboard is sent to the ESP32 as an MQTT command."),
    bullet("**Database tab.** The dashboard shows the real rows of every table, with new rows highlighted, so stored data can be checked live."),
    bullet("**Energy and occupancy reports.** Lights-on hours and kWh per room, entries, refusals by reason and peak occupancy per day."),
    bullet("**Role-based access and audit trail.** Three staff roles, hashed passwords, expiring tokens and a record of every change and failed login."),
    bullet("**Self-documenting API.** Swagger UI lets anyone explore and test every endpoint, with ready examples."),
    bullet("**Testing without hardware.** `entrance_sim.bat` reproduces the controller's messages; 22 automated tests cover the API, bridge and database."),
  ];

  // ---------- System operation and user guide ----------
  const ops = [
    H1("System Operation and User Guide", "ops"),
    P("This chapter shows each part of the finished system in use, with screenshots taken from the running software. Table " + T("apps") + " lists the parts, who uses each one and how it is started."),
    ...table(["Part", "Used by", "How to start it", "Section"], [
      ["Wokwi simulation (entrance firmware)", "Everyone: it is the controller at the doors and rooms", "Run the entrance project in Wokwi", S("opswokwi")],
      ["MQTT bridge", "Runs in the background on the server", "`bridge.bat` (Windows) or `./bridge.sh`", S("opsbridge")],
      ["REST API and database", "The ESP32, the dashboard, Swagger UI", "`start.bat` (Windows) or `./start.sh`", S("opsswagger")],
      ["Management dashboard", "Security staff and administrators", "http://127.0.0.1:8000/dashboard/ after `start.bat`", S("opsdash")],
      ["Swagger UI", "Developers and testers", "http://127.0.0.1:8000/docs after `start.bat`", S("opsswagger")],
      ["Entrance stand-in, virtual ESP32", "Testers, with no Wokwi or hardware", "`entrance_sim.bat`, `demo.bat`", S("opsvirtual")],
    ], [2300, 2700, 2700, 1326], "Parts of the system and how each is started", "apps"),
    H2("A Typical Day", "opsday"),
    ...steps([
      "In the morning the server runs `start.bat` and `bridge.bat`; the ESP32 joins Wi-Fi and the broker, and republishes its occupancy and schedule.",
      "A student taps a card at the entry reader. The ESP32 checks the rules, opens the door and publishes the scan; the bridge stores it and opens a visit.",
      "The student walks into Lecture Room 1. The PIR sensor detects motion and the light switches on; the change is stored.",
      "Security staff watch the dashboard: who is inside, both rooms, and the latest scans, refreshed every 3 seconds.",
      "If the network fails, the ESP32 keeps deciding and logging to its SD card; the database catches up from new messages when the link returns.",
      "The room empties; 5 seconds after the last motion the light switches off.",
      "Management read the daily report: entries, refusals, peak occupancy and the energy used by the lights.",
    ]),
    H2("Entrance Controller in Wokwi", "opswokwi"),
    P("The entrance firmware is built with `idf.py build` and run in Wokwi (`wokwi.toml`). In the simulation, a card is presented to a reader by clicking the MFRC522 part, or typed at the console with `scan in <HEX>`; the PIR sensors are triggered by clicking them."),
    placeholder("Insert screenshots of the entrance firmware in Wokwi: (1) the circuit after a granted scan, with the LCD showing ACCESS GRANTED; (2) the serial monitor after `help` and `status`; (3) a room light on after the PIR is triggered."),
    H3("Reading the LCD"),
    ...table(["When", "Line 1", "Line 2"], [
      ["Idle", "CoCIS Security", "Occupancy: 2"],
      ["After a granted scan (3 s)", "ACCESS GRANTED", "IN 11223344"],
      ["After a refused scan (3 s)", "ACCESS DENIED", "IN DEADBEEF"],
    ], [3000, 3013, 3013], "What the 16x2 LCD shows", "lcd"),
    H2("MQTT Bridge", "opsbridge"),
    P(`Figure ${F("bridgelog")} shows the bridge window while the entrance controller is used. Each line is one message: scans and room changes are stored, a new card authorised on the ESP32 is registered, and old retained messages from earlier runs are ignored.`),
    ...figure("../screenshots/bridge_log.png", "MQTT bridge: entrance ESP32 messages stored in the database", "bridgelog", 600),
    P(`The dashboard's Database tab proves that each message reached the database (Figures ${F("dbaccess")} and ${F("dbrooms")}): every scan has source MQTT and the bridge's stable event id, and each room change has trigger MOTION or NO_MOTION.`),
    ...figure("../screenshots/dashboard_db_access.png", "Database tab: access_events rows stored from MQTT", "dbaccess", 560),
    ...figure("../screenshots/dashboard_db_rooms.png", "Database tab: room_status_logs rows from the PIR rooms", "dbrooms", 560),
    H2("Management Dashboard", "opsdash"),
    P("The dashboard is a web page served by the API. Staff log in (Figure " + F("dlogin") + ") with an administrator account; the role decides what they may change (Table " + T("roles") + ")."),
    ...figure("../screenshots/dashboard_login.jpg", "Dashboard login", "dlogin", 260),
    H3("Overview"),
    P("The Overview tab (Figure " + F("doverview") + ") is the live view for security staff. It shows the number of people inside, the emergency switch, a card for each lecture room with its count, light state and light mode buttons, the controller's health (online, last seen, events waiting, firmware) and, below, the people inside and the latest scans with their decision and reason."),
    ...figure("../screenshots/dashboard_overview.jpg", "Dashboard Overview tab: occupancy, lecture rooms, controller status and recent scans", "doverview", 470),
    H3("Schedule"),
    P("The Schedule tab (Figure " + F("dschedule") + ") sets the opening hours for each day. Only a SUPER_ADMIN can save; the change raises the configuration version, so the ESP32 downloads it at its next heartbeat. A closing time before the opening time is refused with a clear message."),
    ...figure("../screenshots/dashboard_schedule.jpg", "Dashboard Schedule tab: opening hours per day", "dschedule", 470),
    H3("Users"),
    P("The Users tab (Figure " + F("dusers") + ") registers new card holders and deactivates lost or expired cards. A deactivated card is refused at the door at once, and its history is kept."),
    ...figure("../screenshots/dashboard_users.jpg", "Dashboard Users tab: registering and deactivating card holders", "dusers", 470),
    H3("Reports"),
    P("The Reports tab (Figure " + F("dreports") + ") gives the daily totals, the busiest moment of the day, refusals by reason and the hours and energy (kWh) used by each room's lights, with a bar chart. In the example the rooms were still occupied at the end of the demonstration, so their lights count as on until the end of the day."),
    ...figure("../screenshots/dashboard_reports.jpg", "Dashboard Reports tab: daily totals, peak occupancy and lighting energy", "dreports", 470),
    H3("Audit Log"),
    P("The Audit log tab (Figure " + F("daudit") + ") lists every login and change with the staff member and the reason, for example the emergency drill switched on and off from the serial menu."),
    ...figure("../screenshots/dashboard_audit.jpg", "Dashboard Audit log tab", "daudit", 470),
    H2("Swagger UI (API Documentation)", "opsswagger"),
    P("Swagger UI at `/docs` lists every endpoint and lets testers call them from the browser (Figure " + F("swtop") + "). The page starts with the steps and the demo logins."),
    ...figure("../screenshots/swagger_top.jpg", "Swagger UI: instructions, demo data and the device endpoints", "swtop", 600),
    P("The Authorize button opens the dialog in Figure " + F("swauth") + ": the device key for the ESP32 endpoints and the administrator login for staff endpoints."),
    ...figure("../screenshots/swagger_authorize.jpg", "Swagger UI: logging in with the Authorize dialog", "swauth", 300),
    P("Figure " + F("swexec") + " shows a scan sent as the ESP32 would send it: the lecturer's card at the entry door. The response says GRANTED, with the person's name and the new number of people inside."),
    ...figure("../screenshots/swagger_execute.jpg", "Swagger UI: an access check executed, with the server's answer", "swexec", 560),
    H2("Testing Without Wokwi", "opsvirtual"),
    P("`entrance_sim.bat` publishes the entrance controller's exact messages to the broker, so the bridge, database and dashboard behave as they do with Wokwi. Its `--demo` mode runs: a lecturer and a student enter, anti-passback, an unknown card, motion in Room 1, a new card authorised and used, the room emptying and the lecturer leaving."),
    P(`The virtual HTTP controller (\`demo.bat\`, \`simulate.bat\`) tests the API's own decision path (Figures ${F("vdemo1")} and ${F("vdemo2")}).`),
    ...figure("../screenshots/virtual_demo.png", "Virtual HTTP controller demonstration, steps 2 to 7", "vdemo1", 520),
    ...figure("../screenshots/virtual_demo2.png", "Virtual HTTP controller demonstration, steps 8 to 10", "vdemo2", 520),
  ];

  // ---------- Testing ----------
  const test = [
    H1("Testing and Results", "test"),
    H2("Database and API Tests", "apitests"),
    P("The API is covered by an automated test suite (`tests/test_api.py`, run with pytest) that starts the API on a fresh, empty database and exercises it exactly as the bridge, the ESP32 and a staff member would. All 21 tests pass."),
    ...table(["#", "Test", "Use case", "What it proves", "Result"], [
      ["1", "Health check", "", "API starts and creates the database", "Pass"],
      ["2", "Wrong device key", "", "Device endpoints reject unknown devices (401)", "Pass"],
      ["3", "Entry, exit and anti-passback", "UC01 to UC03", "Entry opens a visit; second entry refused; exit closes it; second exit refused", "Pass"],
      ["4", "Unknown tag and schedule", "UC03", "Unknown tags refused; access refused at 23:00 and on Sunday", "Pass"],
      ["5", "No exit outside schedule", "UC02", "A person inside cannot leave after closing time (brief Section 2.6)", "Pass"],
      ["6", "Retry is idempotent", "UC01", "Re-sending the same event_uuid returns the original decision, no duplicate", "Pass"],
      ["7", "Concurrent entries", "UC03", "8 simultaneous scans of one tag give exactly 1 granted and 1 visit", "Pass"],
      ["8", "Offline batch upload", "UC14", "Out-of-order offline events stored correctly; re-upload gives only duplicates; lighting energy computed (2 h, 0.96 kWh)", "Pass"],
      ["9", "Schedule change", "UC11, UC15", "Change raises config_version and reaches /device/config; opening after closing rejected (422)", "Pass"],
      ["10", "Viewer cannot change schedule", "UC09, UC11", "Role check (403); wrong password (401)", "Pass"],
      ["11", "User registration and deactivation", "UC10", "Duplicate tag rejected (409); deactivated tag refused", "Pass"],
      ["12", "Emergency mode", "UC12", "All doors open, even for unknown tags after hours; ON and OFF audited", "Pass"],
      ["13", "Heartbeat", "UC15", "Device health stored; controller shown online", "Pass"],
      ["14", "Still occupants keep lights on", "UC04, UC05", "Room stays occupied with lights on while the IR count is above 0, however long; goes empty at 0; negative counts rejected (422)", "Pass"],
      ["15", "Swagger UI login", "UC09", "The Authorize button's form login returns a working token; wrong password refused (401); both security schemes are published", "Pass"],
      ["16", "Dashboard served", "", "The dashboard page, script and style sheet are served by the API", "Pass"],
      ["17", "Database viewer", "UC08", "Rows are read-only, password and key hashes are never returned, unknown tables are refused", "Pass"],
      ["18", "Firmware results mapped", "UC15", "All six result codes of `state.c` are stored faithfully; a 1970 timestamp is replaced", "Pass"],
      ["19", "PIR rooms stored", "UC05", "Occupied and vacant become counts 1 and 0 with triggers MOTION and NO_MOTION", "Pass"],
      ["20", "Relay stores once", "UC15", "Events through `/device/relay` have source MQTT, open a visit, and a second delivery is a duplicate", "Pass"],
      ["21", "Lockdown reaches the bridge", "UC12", "Lockdown appears in the heartbeat reply and the occupancy view, and can be turned off", "Pass"],
    ], [450, 2100, 1300, 4200, 976], "Automated database and API test results"),
    H2("End-to-end Test Over the MQTT Broker"),
    P("The complete path was tested over the internet on 2 November 2026: the entrance stand-in published the firmware's messages to broker.hivemq.com, the bridge relayed them, and the database and dashboard were checked (Figures " + F("bridgelog") + " to " + F("dbrooms") + ")."),
    ...table(["#", "Message published", "Expected in the database", "Result"], [
      ["M1", "`scan in 11223344` (result OK)", "GRANTED entry, source MQTT, visit opened", "Pass"],
      ["M2", "`scan in 01020304` twice", "First GRANTED, second DENIED ALREADY_INSIDE", "Pass"],
      ["M3", "`scan in DEADBEEF` (not authorised on the ESP32)", "DENIED UNKNOWN_TAG", "Pass"],
      ["M4", "Room 1 motion, then vacant", "`room_status_logs` MOTION then NO_MOTION; LR1 light on then off", "Pass"],
      ["M5", "`user add AABBCCDD`, then `scan in AABBCCDD`", "Card registered in `users`, then GRANTED entry", "Pass"],
      ["M6", "`scan out 11223344`", "GRANTED exit, visit closed", "Pass"],
      ["M7", "Retained messages from an earlier run", "Ignored, nothing stored", "Pass"],
      ["M8", "Controller status", "`ESP32-MQTT-ENTRANCE` online on the dashboard", "Pass"],
    ], [600, 3200, 4300, 926], "End-to-end test over the MQTT broker", "mqtttests"),
    placeholder("Add the tests the group ran on the entrance firmware in Wokwi, with screenshots of the LCD and serial monitor."),
    H2("End-to-end Tests with the Virtual HTTP Controller"),
    P("An automated end-to-end test (`tests/test_simulator.py`) starts a real API server and drives the virtual ESP32 against it: online decisions, anti-passback, offline decisions while the network is down, an IR crossing, upload of the queue, and a second upload of the same queue plus a damaged line. The test checks that the server ends with exactly the right people inside and the right room count, with no duplicates. Together with the API and bridge tests this gives 22 automated tests, all passing. The scripted demonstration (`demo.bat`) runs the same story step by step for the presentation."),
  ];

  // ---------- Group sections and back matter ----------
  const tail = [
    H1("Wokwi Simulation Link", "wokwi"),
    P("**Entrance controller (group firmware):** ____________________________________________"),
    P("**Reference HTTP controller (Appendix C):** https://wokwi.com/projects/479503784454238209"),
    P("To run either project, open the link and press the green play button. The entrance controller connects to the broker by itself; start `start.bat` and `bridge.bat` on a laptop to see its events in the database and dashboard."),
    H1("Individual Contributions", "contrib"),
    P("Each member's tasks and responsibilities (Deliverable 4)."),
    ...table(["Member", "Tasks and responsibilities"], [
      ["Lisa Nyonyozi", `Carried out the use case analysis and wrote the use case specifications (Chapter ${S("uc")}); designed the overall system architecture and redrew it from the group's draft, including the infrared occupancy and memory-card design decisions (Chapter ${S("arch")}); designed and implemented the SQLite database: schema, constraints, indexes, views and seed data (Chapter ${S("db")}); designed, implemented and tested the REST API that connects the ESP32 to the database, including authentication, roles, offline synchronisation and reports (Chapter ${S("api")}); wrote the API documentation and the automated test suite (Section ${S("apitests")}); designed and built the MQTT bridge that connects the group's entrance firmware to the database and dashboard without changing the firmware, and the network design (Section ${S("net")}); built the management dashboard.`],
      ["", ""], ["", ""], ["", ""], ["", ""],
    ], [2200, 6826], "Individual contributions of group members"),
    H1("Individual Video Demonstrations", "videos"),
    ...table(["Member", "Feature(s) demonstrated", "Video link"], [
      ["Lisa Nyonyozi", "Use cases, architecture and network; database; REST API in Swagger UI; MQTT bridge with a live scan reaching the dashboard", ""],
      ["", "", ""], ["", "", ""], ["", "", ""], ["", "", ""],
    ], [2000, 4400, 2626], "Links to individual video demonstrations"),
    H1("Conclusion and Recommendations", "concl"),
    H2("Conclusion"),
    P("The system meets the brief on one simulated ESP32. Two RFID readers control separate entry and exit doors under a configurable schedule with anti-passback; PIR sensors switch the lecture-room lights; the SD card and NVS keep logs and state; the serial menu supports monitoring and authenticated configuration; and mutexes, a queue, transactions and unique keys keep the records consistent. Through MQTT and a bridge, every event reaches a central database and a live dashboard without changing the controller, and without the controller and the database sharing a network."),
    H2("Limitations and Future Work", "limits"),
    bullet("**Lockdown command ignored.** In `comms.c` line 75 the command topic is compared with 19 characters, but `cocis/cmd/entrance` has 18, so LOCKDOWN and UNLOCK never match. Changing both 19s to 18 makes the dashboard's lockdown work."),
    bullet("**Public broker.** Anyone using the same topics on broker.hivemq.com is also received. A private broker with a password and TLS should be used for real deployment."),
    bullet("**Still occupants.** PIR sensors miss people who sit still; a longer hold time, a manual override, or infrared beam counting at the door (Section " + S("ir") + ") solve this."),
    bullet("**One-way configuration.** Cards and schedule are changed on the ESP32 and copied to the database; changes made on the dashboard do not yet reach the ESP32."),
    bullet("**Lost messages while offline.** Events are published with QoS 0 and not queued, so the database misses scans made while the ESP32 is disconnected (they remain in `access.csv`). Uploading the SD log on reconnect, or QoS 1 with the client's outbox, would close this gap."),
    bullet("**Real hardware and one board per terminal** are the next steps; the topics, bridge, API and database already support them."),
    H1u("References"),
    P("ACEEE (1996) *Occupancy sensors in classrooms: field experience*. ACEEE Summer Study on Energy Efficiency in Buildings, Panel 4, Paper 10. Available at: https://www.aceee.org/files/proceedings/1996/data/papers/SS96_Panel4_Paper10.pdf"),
    P("Butlr (2025) *Common problems with PIR sensors* and *Occupancy sensors for classrooms*. Available at: https://www.butlr.com/blog/common-problems-pir-sensors and https://www.butlr.com/blog/occupancy-sensors-classrooms"),
    P("Espressif Systems (2026) *ESP-IDF Programming Guide: FAT Filesystem Support, SD SPI Host Driver, ESP HTTP Client, FreeRTOS*. Available at: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/storage/fatfs.html"),
    P("FastAPI (2026) *FastAPI documentation*. Available at: https://fastapi.tiangolo.com/"),
    P("Hackster.io (n.d.) *DIY bidirectional counter using Arduino and IR sensors*. Available at: https://www.hackster.io/its_me_yogesh/diy-bidirectional-counter-using-arduino-and-ir-sensors-36ba45"),
    P("Siara, A. (2019) *SQLite3 library for ESP32* (forum announcement and README, including notes on locking and flash wear). Available at: https://esp32.com/viewtopic.php?p=38285"),
    P("SQLite Consortium (2026) *SQLite documentation: transactions, WAL mode, partial indexes, generated columns*. Available at: https://www.sqlite.org/docs.html"),
    P("University Politehnica of Bucharest (2025) *ESP32 Smart Access Monitor* (IoT course project using two IR sensors for entry and exit counting). Available at: https://ocw.cs.pub.ro/courses/iothings/proiecte/2025sric/esp32-smart-access-monitor"),
    P("Wokwi (2026) *wokwi-microsd-card reference*. Available at: https://docs.wokwi.com/parts/wokwi-microsd-card"),
    P("Human occupancy monitoring and positioning with a speed-responsive adaptive sliding window using an infrared thermal array sensor (2024). *Sensors*, PMC11722904. Available at: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11722904/"),
    P("Makerere University, CoCIS (2026) *Smart Control and Monitoring System for CoCIS: Embedded Systems coursework brief*, BSE III and CS II."),
    P("OASIS (2014) *MQTT Version 3.1.1*, OASIS Standard. Available at: https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html"),
    P("Espressif Systems (2026) *ESP-MQTT component documentation*. Available at: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/protocols/mqtt.html"),
    P("HiveMQ (2026) *Public MQTT broker* (broker.hivemq.com). Available at: https://www.hivemq.com/mqtt/public-mqtt-broker/"),
    P("Eclipse Foundation (2026) *Eclipse Paho MQTT Python client*. Available at: https://eclipse.dev/paho/"),
    P("Espressif Systems (2026) *Arduino ESP32 core documentation*. Available at: https://docs.espressif.com/projects/arduino-esp32/"),
    P("Wokwi (2026) *ESP32 simulation guide* and *ESP32 WiFi networking*. Available at: https://docs.wokwi.com/guides/esp32"),
    H1u("Appendix A: Project Files"),
    ...table(["Path", "Contents"], [
      ["database/schema.sql", "All CREATE TABLE, INDEX and VIEW statements"],
      ["database/seed.sql", "Rooms, default schedule, settings and demo users"],
      ["api/main.py", "Application entry point; creates the database on start-up"],
      ["api/db.py", "Connections, `write_tx()` transactions, password hashing, settings, audit helper"],
      ["api/security.py", "Device-key and bearer-token checks; role enforcement"],
      ["api/access_logic.py", "The access rules, visit tracking, room-state updates"],
      ["api/schemas.py", "Request validation models (Pydantic)"],
      ["api/routes_device.py", "Endpoints used by the ESP32"],
      ["api/routes_admin.py", "Endpoints used by staff, including reports"],
      ["tests/test_api.py, tests/test_simulator.py", "16 API tests and 1 end-to-end test with the virtual ESP32"],
      ["reference-firmware/main/main.c", "Reference HTTP controller firmware (Appendix C)"],
      ["reference-firmware/diagram.json", "Wokwi circuit; reference-firmware/wokwi.toml and CMakeLists.txt for Wokwi in VS Code and idf.py"],
      ["dashboard/", "Management web dashboard (HTML, CSS, JavaScript), served at /dashboard/"],
      ["simulator/virtual_esp32.py", "Virtual ESP32 for testing without hardware; simulate.bat and demo.bat start it"],
      ["setup.bat, start.bat, test.bat, reset_db.bat", "Windows scripts: install, start (opens the docs), test, reset the database"],
      ["setup.sh, start.sh, test.sh", "The same scripts for macOS and Linux"],
      ["run.py", "Starts the API and opens the docs; used by both start scripts"],
      ["bridge/mqtt_bridge.py", "MQTT bridge between the entrance ESP32 and the API; started by bridge.bat"],
      ["bridge/entrance_sim.py", "Publishes the entrance ESP32's messages for testing; started by entrance_sim.bat"],
      ["README.md (in each folder)", "Short guide for each app: firmware, api, database, dashboard, simulator, docs"],
      ["docs/screenshots/", "Screenshots used in Chapter " + S("ops") + ", and the generator for the terminal images"],
      ["docs/openapi.json", "Machine-readable API specification (importable into Postman)"],
      ["docs/diagrams/", "Use case, architecture, infrared counter, ER and sequence diagrams (SVG and PNG)"],
    ], [3000, 6026], "Database and API project files"),
    H1u("Appendix B: Explaining the System (Likely Questions)"),
    P("Short answers prepared so that every member can explain the use cases, architecture, database and API during the presentation."),
    ...[
      ["Why only one ESP32 when the brief mentions three terminals?", "The free Wokwi plan supports one microcontroller and the lecturer confirmed one should be used. Each terminal is handled by its own task, so the design stays modular."],
      ["Does the ESP32 need to be on the same network as the database?", "No. The ESP32 and the server each connect out to the MQTT broker on the internet, and the broker passes messages between them. The database stays private on the server; no tunnel or port forwarding is needed."],
      ["How does a scan get into the database?", "The ESP32 decides, opens the door and publishes {tag, dir, result, ts} to cocis/event/access. The bridge receives it, converts the result code and calls POST /api/v1/device/relay with its device key. The API validates it with a Pydantic model and stores it in one transaction."],
      ["Why MQTT and not HTTP from the ESP32?", "Publishing is fast and does not wait for the server, so the door never waits. Many subscribers can read the same messages, retained messages give the latest state to anyone who connects, and the ESP32 does not need to know where the server is."],
      ["Why do you need a bridge?", "MQTT and HTTP are different protocols. The bridge subscribes to the broker and makes the REST calls, so the firmware did not have to change at all, and the API keeps one way of storing events."],
      ["What stops a message being stored twice?", "The bridge builds a stable event_uuid from the card, the direction and the ESP32's time. The event_uuid column is UNIQUE, so a second delivery is reported as a duplicate and not stored."],
      ["Why a PIR sensor, and what is its weakness?", "PIR sensors are cheap and available in Wokwi. They detect movement, not people, so a still class can look empty. A longer hold time, the manual override, or counting people with infrared beams at the door (Section " + S("ir") + ") handle this."],
      ["Is the memory card the database?", "No. The ESP32 keeps its card list, people inside and schedule in NVS flash and logs every scan to access.csv on the SD card. The official database is SQLite on the server, reached through the bridge and API."],
      ["What happens when Wi-Fi goes down?", "Doors keep working: the ESP32 decides on its own and logs to the SD card. Messages are not queued, so those scans reach the database only if the SD log is uploaded later; this is listed as future work."],
      ["How do you prevent race conditions?", "On the ESP32, one mutex protects the shared state and another the SD log, and a queue hands door requests to the door task. On the server, each write is a BEGIN IMMEDIATE transaction and a unique index allows only one open visit per person."],
      ["How does the system know who is inside?", "On the ESP32, the people-inside list. In the database, each granted entry opens a row in building_visits and each granted exit closes it; open visits are the view v_people_inside."],
      ["Why can people leave after hours?", "Locking someone inside is dangerous, so the exit door opens but the event is recorded as OK_AFTER_HOURS for security to follow up. Entry outside the hours is refused."],
      ["How is the schedule protected?", "On the ESP32, schedule set needs the admin PIN. On the dashboard, only a SUPER_ADMIN can change it, with hashed passwords, expiring tokens and an audit log."],
      ["What are the API's models?", "Pydantic classes in api/schemas.py, for example AccessCheck, EventBatch, RoomStatus and Login. FastAPI checks every request against them, so a wrong door, unknown reason or bad time is refused with 422 before any database code runs."],
      ["How can we test without Wokwi?", "Run start.bat, bridge.bat and entrance_sim.bat. The stand-in publishes the same messages as the firmware, so the database and dashboard update exactly as with the real controller."],
      ["How is energy saving measured?", "Every light change is stored with its time. The daily report adds up the hours each room's lights were on and multiplies by the room's lamp power."],
    ].flatMap(([q, a]) => [P(`**Q: ${q}**`, { keepNext: true, spacing: { after: 40 } }), P(`A: ${a}`)]),
    H1u("Appendix C: Reference HTTP Controller"),
    P("Before the group's firmware was integrated, a reference controller was built to develop and test the API (`reference-firmware/main/main.c`, Wokwi project https://wokwi.com/projects/479503784454238209). It calls the REST API directly over HTTP instead of MQTT, counts people with two infrared beams per room door (the recommended upgrade in Section " + S("ir") + "), and keeps an offline queue on the SD card that it uploads when the network returns. It is kept as a working demonstration of these features and of the API's own decision path."),
    ...figure("../screenshots/wokwi_circuit.jpg", "Reference controller running in Wokwi", "wcircuit", 480),
    ...figure("../screenshots/wokwi_serial.png", "Reference controller serial monitor: offline decisions and status", "wserial", 520),
    P(`Its online and offline paths are shown in Figures ${F("online")} and ${F("offline")}.`),
    ...figure("seq_online.png", "Reference controller: online access request over HTTP", "online", 600),
    ...figure("seq_offline.png", "Reference controller: offline operation and store-and-forward", "offline", 520),
  ];

  return { cover, front, main: [...intro, ...uc, ...arch, ...hw, ...fw, ...db, ...api, ...feat, ...ops, ...test, ...tail] };
}

// ================================================================ BUILD
content();            // pass 1: register numbers
const c = content();  // pass 2: resolve references

const margins = { top: 1440, bottom: 1440, left: 1440, right: 1440 };
const doc = new Document({
  creator: "Lisa Nyonyozi",
  title: "Smart Control and Monitoring System for CoCIS: System Operation Report",
  features: { updateFields: true },
  styles: {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 36, bold: true, color: "000000" },
        paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0, keepNext: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 4 } } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 30, bold: true, color: "000000" },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1, keepNext: true } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 26, bold: true, italics: true, color: "000000" },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2, keepNext: true } },
      { id: "Caption", name: "Caption", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: FONT, size: 21, italics: true, color: "000000" },
        paragraph: { spacing: { before: 60, after: 200 } } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } }] },
      { reference: "steps", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] },
    ],
  },
  sections: [
    { properties: { page: { margin: margins } }, children: c.cover },
    {
      properties: { page: { margin: margins, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })] }) },
      children: c.front,
    },
    {
      properties: { page: { margin: margins, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "CoCIS Smart Control and Monitoring System", italics: true, size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Page ", size: 20 }), new TextRun({ children: [PageNumber.CURRENT], size: 20 }), new TextRun({ text: " of ", size: 20 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 20 })] })] }) },
      children: c.main,
    },
  ],
});

const out = path.join(__dirname, "CoCIS_Smart_System_Report.docx");
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log("wrote", out, "| figures:", cnt.Figure, "tables:", cnt.Table); });
