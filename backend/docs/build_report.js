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
const NAVY = "1F3864";

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

function figure(file, text, key, widthPx = 600) {
  const buf = fs.readFileSync(path.join(D, file));
  const isPng = file.endsWith(".png");
  const w = isPng ? buf.readUInt32BE(16) : 1350;
  const h = isPng ? buf.readUInt32BE(20) : 1800;
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

const border = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };
const borders = { top: border, bottom: border, left: border, right: border };

function cellParas(text, head) {
  return String(text).split("\n").map((line) => new Paragraph({
    spacing: { after: 0, line: 260 },
    children: head ? [new TextRun({ text: line, bold: true, color: "FFFFFF", size: 21 })] : runs(line, { size: 21 }),
  }));
}
function table(headers, rows, widths, title, key) {
  const cell = (text, i, head, shade) => new TableCell({
    borders, width: { size: widths[i], type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER,
    shading: head ? { fill: NAVY, type: ShadingType.CLEAR, color: "auto" } : shade ? { fill: "EEF2F8", type: ShadingType.CLEAR, color: "auto" } : undefined,
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

// Use case specification: two-column table with a shaded label column.
function ucSpec(id, name, rows) {
  const W = [2100, 6926];
  const pad = { top: 50, bottom: 50, left: 90, right: 90 };
  const labelCell = (t) => new TableCell({
    borders, width: { size: W[0], type: WidthType.DXA }, shading: { fill: "E8EDF7", type: ShadingType.CLEAR, color: "auto" }, margins: pad,
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
    shading: { fill: NAVY, type: ShadingType.CLEAR, color: "auto" }, margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: `${id}: ${name}`, bold: true, color: "FFFFFF", size: 22 })] })],
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
      shading: { fill: "E7E6E6", type: ShadingType.CLEAR, color: "auto" },
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
    placeholder("Summarise the CoCIS context: valuable equipment that needs protecting, and high electricity bills caused by lights left on in empty rooms."),
    H2("Problem Statement"),
    placeholder("State the problem in two or three sentences."),
    H2("Objectives"),
    placeholder("Main objective plus specific objectives (access control, occupancy, lighting, storage, schedule, synchronisation)."),
    H2("Scope of the Pilot"),
    placeholder("Main entrance (entry and exit lanes), Lecture Room 1 and Lecture Room 2; Wokwi free tier; ESP-IDF."),
  ];

  // ---------- Use cases (Lisa) ----------
  const uc = [
    H1("Requirements and Use Case Analysis", "uc"),
    P("Before designing the hardware, database and API, we identified **who** uses the system and **what** each of them needs it to do. These are captured as UML use cases. Each use case is traced to the tables and API endpoints that implement it, so every part of the design can be explained by the need it serves."),
    H2("Actors", "actors"),
    ...table(["Actor", "Type", "Description"], [
      ["Building User", "Person", "Any student, staff member, lecturer or visitor who holds an RFID tag and passes through the main entrance."],
      ["Room Occupant", "Person", "Anyone entering or leaving Lecture Room 1 or 2. Counted by the infrared beams at the room door; needs no tag."],
      ["Management Viewer", "Person (role VIEWER)", "College management or reception staff who monitor occupancy, logs and reports."],
      ["Security Officer", "Person (role SECURITY)", "Inherits everything a Viewer can do, and can also trigger emergency mode and override room lights."],
      ["System Administrator", "Person (role SUPER_ADMIN)", "Inherits everything a Security Officer can do, and can also manage users, the access schedule and settings."],
      ["Time", "Timer", "The clock. Triggers the end-of-day reset at closing time and the periodic heartbeat."],
      ["ESP32 Controller", "External system", "Actor of the Database and API subsystem: requests access decisions, reports events and downloads its configuration."],
    ], [2100, 2000, 4926], "Actors of the system", "actors"),
    H2("System Use Case Diagram", "ucsys"),
    P(`Figure ${F("ucsys")} shows the use cases of the whole system. Use cases on the left are carried out by people moving through the building; those on the right are management functions. Dashed arrows show «include» relationships (a step that is always performed, such as verifying a tag) and «extend» relationships (optional behaviour, such as a manual lighting override). The hollow-headed arrows between the staff actors show that their roles build on each other.`),
    ...figure("usecase_system.png", "System use case diagram", "ucsys", 610),
    H2("Database and API Use Case Diagram", "ucdev"),
    P(`Figure ${F("ucdev")} zooms in on the subsystem built in this part of the project. Here the ESP32 controller is the actor. Every request it makes includes device authentication, and every event it sends is stored exactly once, however many times it is retried.`),
    ...figure("usecase_device.png", "Use case diagram of the ESP32 controller and the Database API", "ucdev", 560),
    H2("Use Case Specifications", "ucspec"),
    P("Each use case is specified below. *Main flow* is the normal sequence of steps; *Alternative flows* cover errors and exceptions (step 3a means an alternative to step 3)."),
    ...ucSpec("UC01", "Enter Building", [
      ["Primary actor", "Building User"],
      ["Goal", "Enter CoCIS through the ENTRY lane of the main entrance."],
      ["Preconditions", "The user holds an RFID tag. The ESP32 is running."],
      ["Main flow", ["The user taps the tag on the ENTRY reader.", "The system reads the tag UID and timestamps the scan.", "The system verifies access (UC03).", "The system unlocks the ENTRY door for 3 seconds and shows the user's name and the number of people inside on the LCD.", "The system records the event and opens a visit (time in)."]],
      ["Alternative flows", ["3a. Access is DENIED: the door stays locked, the buzzer sounds and the LCD shows the reason. The refused attempt is still recorded.", "3b. The server does not answer within 3 s: the ESP32 decides using the rules cached on the SD card and queues the event for upload (UC14)."]],
      ["Postconditions", "A row exists in `access_events`. If granted, the user has an open row in `building_visits`."],
      ["Implemented by", "`POST /device/access/check`; tables `access_events`, `building_visits`"],
    ]),
    ...ucSpec("UC02", "Exit Building", [
      ["Primary actor", "Building User"],
      ["Goal", "Leave CoCIS through the EXIT lane."],
      ["Preconditions", "The user is recorded as inside the building."],
      ["Main flow", ["The user taps the tag on the EXIT reader.", "The system reads the UID and timestamps the scan.", "The system verifies access (UC03).", "The system unlocks the EXIT door for 3 seconds.", "The system records the event and closes the visit (time out)."]],
      ["Alternative flows", ["3a. Outside the permitted period: exit is refused (brief Section 2.6). The user contacts security; in an emergency all doors open (UC12).", "3b. The user is not recorded as inside: refused with reason NOT_INSIDE."]],
      ["Postconditions", "The visit has a `time_out`; the person no longer appears in `v_people_inside`."],
      ["Implemented by", "`POST /device/access/check`; tables `access_events`, `building_visits`"],
    ]),
    ...ucSpec("UC03", "Verify Access", [
      ["Primary actor", "None (included by UC01 and UC02; requested by the ESP32 Controller)"],
      ["Goal", "Decide whether a scanned tag may pass, and give a reason."],
      ["Preconditions", "A tag UID, door and time have been received."],
      ["Main flow", ["Check whether emergency mode is on.", "Check that the tag is registered.", "Check that the user is active.", "Check that the time is inside today's access window.", "Check that the person is outside (for ENTRY) or inside (for EXIT).", "Return GRANTED or DENIED with a reason code, and record the result in one transaction."]],
      ["Alternative flows", [`1a. Any check fails: return DENIED with the matching reason (Table ${T("rules")}). Emergency mode returns GRANTED immediately.`]],
      ["Postconditions", "Decision and reason are stored; occupancy is consistent with the decision."],
      ["Implemented by", "`access_logic.decide()` and `record_access()`; tables `users`, `access_schedule`, `building_visits`, `system_settings`"],
    ]),
    ...ucSpec("UC04", "Enter or Leave Lecture Room", [
      ["Primary actor", "Room Occupant"],
      ["Goal", "Have the room's occupancy updated automatically when walking through its door."],
      ["Preconditions", "IR beams A (corridor side) and B (room side) are aligned and working."],
      ["Main flow", ["The person walks through the doorway.", "The beams are broken in order A then B (entering) or B then A (leaving).", "The system adds or subtracts one from the room's count.", "The system updates the lights (UC05).", "The system reports the new count to the API."]],
      ["Alternative flows", ["2a. Only one beam is broken, or the second beam is not broken within 1.5 s: the crossing is ignored (debounce).", "3a. A PERSON_OUT would make the count negative: the count stays at 0."]],
      ["Postconditions", "`rooms.occupant_count` is current; a row is added to `room_status_logs`."],
      ["Implemented by", "`POST /device/rooms/status`; tables `rooms`, `room_status_logs`"],
    ]),
    ...ucSpec("UC05", "Control Room Lighting", [
      ["Primary actor", "None (included by UC04 and UC06; extended by UC13)"],
      ["Goal", "Keep lights on only while a lecture room is occupied."],
      ["Preconditions", "The room's count and light mode are known."],
      ["Main flow", ["If the light mode is FORCE_ON or FORCE_OFF, apply it and stop.", "If the count is above 0, switch the lights on.", "If the count has been 0 for `light_off_delay_s` seconds (30 s by default), switch the lights off.", "Report every change with its trigger."]],
      ["Alternative flows", ["3a. Someone re-enters during the delay: the timer is cancelled and the lights stay on."]],
      ["Postconditions", "The light state matches occupancy; the change is logged for the energy report."],
      ["Implemented by", "ESP32 Lighting task; `rooms.light_on`, `room_status_logs`; `GET /reports/daily`"],
    ]),
    ...ucSpec("UC06", "Reset Room Counts", [
      ["Primary actor", "Time"],
      ["Goal", "Correct any counting drift so lights are never left on overnight."],
      ["Preconditions", "None."],
      ["Main flow", ["The closing time in today's schedule is reached, or the main entrance shows nobody inside the building.", "The system sets both lecture-room counts to 0.", "The system switches the lights off (UC05).", "The system reports the change with trigger COUNT_RESET."]],
      ["Alternative flows", ["3a. A room is in FORCE_ON mode: the count is reset but the lights obey the override."]],
      ["Postconditions", "Both rooms show 0 occupants."],
      ["Implemented by", "ESP32 Lighting task; trigger `COUNT_RESET` in `room_status_logs`"],
    ]),
    ...ucSpec("UC07", "View Occupancy", [
      ["Primary actor", "Management Viewer (and, by inheritance, Security Officer and System Administrator)"],
      ["Goal", "See who is in the building now and the state of each lecture room."],
      ["Preconditions", "The viewer is logged in (UC09)."],
      ["Main flow", ["The viewer opens the occupancy view (dashboard, Swagger UI or the serial menu).", "The system returns everyone inside with their time in, the total count, each room's occupant count and light state, and whether emergency mode is on."]],
      ["Alternative flows", ["1a. The token has expired: the system returns 401 and the viewer logs in again."]],
      ["Postconditions", "None (read only)."],
      ["Implemented by", "`GET /occupancy`; view `v_people_inside`; table `rooms`"],
    ]),
    ...ucSpec("UC08", "View Logs and Reports", [
      ["Primary actor", "Management Viewer"],
      ["Goal", "Review access history, visits, room history and daily summaries."],
      ["Preconditions", "The viewer is logged in (UC09)."],
      ["Main flow", ["The viewer chooses a report and filters (date, door, decision, person).", "The system returns the matching records, newest first, page by page.", "For a daily report the system calculates entries, exits, refusals by reason, unique visitors, peak occupancy and lighting energy."]],
      ["Alternative flows", ["2a. No records match: an empty list is returned."]],
      ["Postconditions", "None (read only)."],
      ["Implemented by", "`GET /access-events`, `/visits`, `/rooms/{code}/history`, `/reports/daily`"],
    ]),
    ...ucSpec("UC09", "Log In", [
      ["Primary actor", "Any staff actor"],
      ["Goal", "Prove identity before viewing or changing anything."],
      ["Preconditions", "The person has an active staff account."],
      ["Main flow", ["The person enters a username and password (in a client or the ESP32 serial menu).", "The system checks the password against the stored PBKDF2 hash.", "The system issues a random token valid for 8 hours and records the login in the audit log."]],
      ["Alternative flows", ["2a. Wrong username or password, or disabled account: 401 is returned and LOGIN_FAILED is audited."]],
      ["Postconditions", "A row exists in `admin_sessions`."],
      ["Implemented by", "`POST /auth/login`, `/auth/logout`, `/auth/me`; tables `admins`, `admin_sessions`, `audit_log`"],
    ]),
    ...ucSpec("UC10", "Manage Users", [
      ["Primary actor", "System Administrator"],
      ["Goal", "Register tag holders, update their details, re-issue lost tags and deactivate them."],
      ["Preconditions", "Logged in as SUPER_ADMIN."],
      ["Main flow", ["The administrator enters the user's tag UID, name, registration number and role.", "The system validates the data and saves it.", "The system increases `config_version` and writes an audit record.", "At its next heartbeat the ESP32 downloads the new tag list (UC15)."]],
      ["Alternative flows", ["1a. Deactivation keeps the user's history but the tag stops working.", "2a. The tag or registration number already exists: 409 Conflict.", "2b. Invalid UID or role: 422."]],
      ["Postconditions", "`users` is updated; the change is audited."],
      ["Implemented by", "`GET/POST /users`, `GET/PATCH/DELETE /users/{id}`"],
    ]),
    ...ucSpec("UC11", "Configure Access Schedule", [
      ["Primary actor", "System Administrator"],
      ["Goal", "Set the hours during which the building may be entered and exited."],
      ["Preconditions", "Logged in as SUPER_ADMIN."],
      ["Main flow", ["The administrator chooses one or more days and sets open or closed, the opening time and the closing time.", "The system checks that each time is HH:MM and opening is before closing.", "The system saves the schedule, records who changed it, increases `config_version` and audits the change.", "The ESP32 picks up the new schedule within one heartbeat and enforces it on both doors."]],
      ["Alternative flows", ["1a. A Viewer or Security Officer tries: 403 Forbidden.", "2a. Invalid times: 422 and nothing is saved."]],
      ["Postconditions", "`access_schedule` holds the new window."],
      ["Implemented by", "`GET/PUT /schedule`; tables `access_schedule`, `audit_log`"],
    ]),
    ...ucSpec("UC12", "Activate Emergency Mode", [
      ["Primary actor", "Security Officer"],
      ["Goal", "Unlock every door at once during a fire or evacuation."],
      ["Preconditions", "Logged in as SECURITY or SUPER_ADMIN."],
      ["Main flow", ["The officer switches emergency mode on and gives a reason.", "The system saves the setting, increases `config_version` and audits EMERGENCY_ON.", "The next heartbeat reply tells the ESP32, which grants every scan (including unknown tags) with reason EMERGENCY_OPEN.", "When it is safe, the officer switches it off (EMERGENCY_OFF)."]],
      ["Alternative flows", ["1a. No reason given: 422."]],
      ["Postconditions", "Doors follow the emergency state; every action is audited."],
      ["Implemented by", "`PUT /settings/emergency`; `system_settings`, `audit_log`"],
    ]),
    ...ucSpec("UC13", "Override Room Lights", [
      ["Primary actor", "Security Officer"],
      ["Goal", "Force a lecture room's lights on (for example for cleaning) or off (for a power-saving period), or return them to automatic."],
      ["Preconditions", "Logged in as SECURITY or SUPER_ADMIN."],
      ["Main flow", ["The officer chooses the room and the mode AUTO, FORCE_ON or FORCE_OFF.", "The system saves the mode, increases `config_version` and audits the change.", "The ESP32 applies the mode at its next heartbeat (extends UC05)."]],
      ["Alternative flows", ["1a. Unknown room code: 404."]],
      ["Postconditions", "`rooms.light_mode` is updated."],
      ["Implemented by", "`PUT /rooms/{code}/light-mode`"],
    ]),
    ...ucSpec("UC14", "Synchronise Offline Records", [
      ["Primary actor", "ESP32 Controller"],
      ["Goal", "Deliver every record made while offline to the central database exactly once."],
      ["Preconditions", "The network is back and `outbox.csv` holds records."],
      ["Main flow", ["The ESP32 reads up to 200 lines from `outbox.csv` and checks each line's CRC.", "It sends them to the API in one batch.", "The API sorts them by time and stores them in one transaction, skipping any event_uuid it already has.", "The API returns the accepted and duplicate uuids.", "The ESP32 removes those lines from `outbox.csv` and repeats until the outbox is empty."]],
      ["Alternative flows", ["1a. A line fails its CRC check (power was lost while writing): it is skipped and reported on the serial console.", "2a. The connection drops mid-upload: nothing is removed; the batch is re-sent later and duplicates are ignored."]],
      ["Postconditions", "The central database matches the SD card; the outbox is empty."],
      ["Implemented by", "`POST /device/events/batch`"],
    ]),
    ...ucSpec("UC15", "Refresh Device Configuration", [
      ["Primary actor", "ESP32 Controller (triggered by Time)"],
      ["Goal", "Keep the ESP32's cached tags, schedule and settings up to date for offline use."],
      ["Preconditions", "The ESP32 is online."],
      ["Main flow", ["Every `heartbeat_interval_s` seconds the ESP32 sends a heartbeat with its health (UC15a).", "The reply contains the current `config_version` and emergency flag.", "If the version differs from the one on the SD card, the ESP32 downloads the full configuration.", "It writes the new files to temporary names, swaps them in, and updates its in-memory copy under `state_mutex`."]],
      ["Alternative flows", ["3a. The download fails: the old configuration stays in use and the ESP32 tries again at the next heartbeat."]],
      ["Postconditions", "The SD card and memory hold the latest configuration."],
      ["Implemented by", "`POST /device/heartbeat`, `GET /device/config`; table `devices`"],
    ]),
  ];

  // ---------- Architecture (Lisa) ----------
  const arch = [
    H1("System Architecture", "arch"),
    P("This chapter explains how the whole system fits together: the devices in the building, the single ESP32 controller that runs them, the SD card that stores data locally, and the central REST API and database that keep the official records and let management monitor and configure the system. It also records the main design decisions and the reasons for them."),
    H2("Design Decision: One ESP32 Controller", "one"),
    P("The coursework brief (Section 2.3) describes three control terminals (Lecture Room 1, Lecture Room 2 and the main entrance), each of which *may* use its own ESP32. The free version of the Wokwi simulator only supports one microcontroller per project, and the course lecturer confirmed by email that groups should use one. Our design therefore uses **one ESP32 that serves all three terminals**."),
    P(`The three terminals still exist logically: each is handled by its own FreeRTOS task on the ESP32 (Section ${S("esp")}). This keeps the design modular. If CoCIS later moves to one ESP32 per terminal, each task becomes a separate board and the REST API and database stay exactly the same, because they already treat every reading as an event from a device identified by its \`device_code\`.`),
    H2("From the Initial Draft to the Final Architecture", "draft"),
    P(`Figure ${F("sketch")} is the group's first hand-drawn sketch. It identified the main ideas that the final design keeps: users carrying RFID tags, a main entrance split into an *Entrance* lane and an *Exit* lane, a scanner that opens the door, a server, a memory card, and database tables for users, events (RFID, time in, time out, date), rooms and room status.`),
    ...figure("original_sketch.jpg", "Initial hand-drawn architecture draft prepared by the group", "sketch", 330),
    P("While refining the sketch we made the following changes:"),
    bullet("**Two separate server boxes became one REST API.** A single API with clear endpoints is easier to secure, test and explain than two separate services."),
    bullet(`**The memory card and the database now have distinct jobs.** The SD card is the ESP32's local store and offline buffer; the SQLite database behind the API is the central, authoritative record (Section ${S("sd")}).`),
    bullet("**The Events table was split into `access_events` and `building_visits`.** Every scan (granted or denied) is an access event; a visit pairs a person's entry with their exit, giving the *time in*, *time out* and *date* columns from the sketch."),
    bullet(`**Room occupancy is counted with infrared beams instead of motion sensing** (Section ${S("ir")}).`),
    bullet("**New tables were added** for the access schedule, staff accounts and sessions, devices, settings and an audit log, so that configuration is authenticated and every change is traceable."),
    H2("Final System Architecture", "final"),
    P(`Figure ${F("arch")} shows the final architecture. It has three layers, read from left to right.`),
    ...figure("architecture.png", "Final system architecture of the CoCIS Smart Control and Monitoring System", "arch", 610),
    H3("Layer 1: Field devices"),
    bullet("**Main entrance:** an RFID reader and a door servo for each lane (entry and exit), plus an LCD, LEDs and a buzzer for feedback."),
    bullet("**Lecture Rooms 1 and 2:** an infrared beam pair at each door, and the room lights."),
    bullet("**Storage and console:** a microSD card and the serial monitor."),
    H3("Layer 2: The ESP32 controller", "esp"),
    P("One ESP32 runs four FreeRTOS tasks at the same time:"),
    bullet("**Access Control:** checks each tag and opens the right door."),
    bullet("**Lighting Control:** counts people at each room door and switches the lights."),
    bullet("**Serial Menu:** shows status and lets staff change settings."),
    bullet("**Network and Sync:** keeps Wi-Fi and the clock, uploads records and downloads settings."),
    P(`The tasks share data safely using two mutexes and a queue (Section ${S("sync")}), and all doors follow the same six access rules (Table ${T("rules")}).`),
    H3("Layer 3: Server with REST API and database"),
    P(`A FastAPI REST API stores everything in one SQLite database. The ESP32 uses the device endpoints with a device key; staff use the management endpoints with a login token. Details are in Chapters ${S("db")} and ${S("api")}.`),

    H2("Design Decision: Infrared Break-Beam Counting instead of PIR Motion Sensors", "ir"),
    P("The obvious sensor for automatic lighting is a PIR (passive infrared) motion sensor, and our first draft used one in each lecture room. On closer study we rejected it as the main occupancy sensor."),
    H3("The problem with motion sensors"),
    P("A PIR sensor does not detect people; it detects *changes* in infrared heat as warm bodies move across its field of view. A person who sits still produces no change, so to the sensor a room full of students writing an exam looks exactly like an empty room. Once the sensor's timeout expires, the lights go off on an occupied class. This is a well-documented weakness: occupancy-sensor company Butlr notes that a student taking an exam may barely move for 60 to 75 minutes, and a 1996 ACEEE study of classroom lighting controls reported that early occupancy sensors regularly turned lights off in occupied classrooms, frustrating users and creating maintenance work. Lecture rooms are the worst case for PIR, because people sit still for long periods."),
    H3("Options considered"),
    ...table(["Sensor", "How it detects people", "Still occupants", "Counts people", "Wokwi", "Verdict"], [
      ["PIR motion sensor (passive infrared)", "Changes in infrared heat as people move", "Missed: lights switch off during exams and lectures", "No", "Yes (PIR part)", "Rejected as main sensor"],
      ["**Active IR break-beam pair at the door**", "An infrared emitter shines on a receiver; a person crossing breaks the beam. The order in which two beams break gives the direction", "Not affected: people are counted at the door, so the room stays occupied until they leave", "Yes", "Simulated with two pushbuttons or switches per door (pressed = beam broken)", "**Chosen**"],
      ["Thermopile IR array (e.g. Panasonic AMG8833, 8x8 pixels)", "Measures the absolute heat of each pixel, so it sees still bodies", "Detected", "Roughly", "No part available", "Future option: short range (about 2 m reported), costly for a large room"],
      ["Ultrasonic or mmWave radar", "Reflections from small movements, even breathing", "Detected", "No", "Ultrasonic only", "Not chosen: not infrared, and needs careful tuning"],
    ], [1700, 2100, 1700, 900, 1300, 1326], "Comparison of occupancy sensors for the lecture rooms", "sensors"),
    H3("How the infrared counter works"),
    P(`Two infrared beams cross each lecture-room doorway a few centimetres apart (Figure ${F("ir")}). Beam A is on the corridor side and beam B on the room side. If A breaks and then B, a person has walked **in** and the count goes up by one. If B breaks and then A, a person has walked **out** and the count goes down by one. While the count is above zero the lights stay on, however still people are. When it reaches zero, the lights go off after a short delay (30 seconds by default) so they do not flicker if someone steps out and straight back in. This direction-sensing technique is widely used in bidirectional visitor counters, including ESP32-based room monitors.`),
    ...figure("ir_counter.png", "Infrared break-beam people counter at a lecture-room door", "ir", 600),
    H3("Safeguards against counting errors"),
    P("A counter can drift, for example if two people pass side by side. The design limits the effect:"),
    bullet("The count never goes below zero."),
    bullet("Both beams must break in the correct order within 1.5 seconds, or the crossing is ignored (debounce)."),
    bullet("At closing time (from the access schedule) both counts reset to zero and the lights go off (UC06)."),
    bullet("Whenever the main entrance shows **nobody inside the building**, both room counts reset to zero. This cross-check is only possible because a single ESP32 sees both the entrance and the rooms."),
    bullet("Security can override a room's lights from the API (UC13)."),
    P("Because each change is stored with its count and trigger (`PERSON_IN`, `PERSON_OUT`, `COUNT_RESET` and so on), management can see exactly how each room was used and how long its lights were on."),

    H2("Design Decision: What to Store on the Memory Card", "sd"),
    P("Section 2.4 of the brief proposes an SD card to hold the large volume of data the system produces. We investigated whether the SD card should hold a full database on the ESP32, and how it should fit into the architecture."),
    H3("Is it right to include the memory card?"),
    P("Yes. The memory card is essential to the design, for three reasons. First, it lets the doors and lights keep working when Wi-Fi or the server is down, because the ESP32 keeps its own copy of the tag list, the schedule and who is inside. Second, it holds every record made while offline until it can be uploaded, so nothing is lost. Third, it gives a local audit trail that can be read in a spreadsheet straight from the card. Wokwi provides a microSD card part that appears to the ESP32 as a FAT16 file system, and the standard ESP-IDF SD card driver has been used with it in published Wokwi projects, so it fits the simulation platform. The firmware team should test the card mount early, as one user has reported an initialisation error in the simulator."),
    H3("Why not a full SQLite database on the SD card?"),
    P("SQLite can be compiled for the ESP32 and run on an SD card (for example the `esp32-idf-sqlite3` component). We decided against it:"),
    ...table(["Concern", "What we found", "Effect on our design"], [
      ["Concurrency", "The ESP32 SQLite port does not implement file locking, so it is only reliable from one thread, or for read-only use.", "We have four tasks that write data; a database shared between them would need its own locking layer."],
      ["Memory", "The ESP32 has about 320 KB of usable RAM; SQLite's page cache competes with Wi-Fi, TLS and FreeRTOS. Developers recommend boards with extra PSRAM.", "Risk of running out of memory on a standard ESP32 in Wokwi."],
      ["Power loss", "FAT file systems on SD cards are commonly corrupted when power is cut during a write. A database rewrites pages in place and keeps a journal, so more data is at risk.", "Append-only writes are far safer: at worst the last line is incomplete."],
      ["Card wear", "Flash cells survive a limited number of write cycles. Database updates rewrite the same pages repeatedly.", "Appending to a file spreads writes along the card."],
      ["Duplication of work", "The server already runs a full SQLite database with constraints, indexes and reports.", "The ESP32 only needs fast lookups and a reliable log, not queries."],
    ], [1500, 4300, 3226], "Findings on running a database on the ESP32 memory card", "sdfind"),
    H3("Chosen approach: a two-tier data store"),
    P("The system uses **two tiers of storage**, each doing what it is best at:"),
    bullet("**Tier 1, the SD card (local, on the ESP32):** simple CSV files. Configuration files (tag list, schedule, settings) are small and are loaded into RAM at start-up for instant lookups. Logs are **append-only**, rotated daily, and every line ends with a **CRC-32 checksum** so a line damaged by a power cut is detected and skipped. Configuration files are written to a temporary file first and then swapped in, so a power cut never leaves a half-written configuration. Only one task writes to the card at a time (`sd_mutex`)."),
    bullet(`**Tier 2, SQLite on the server (central):** the authoritative database with relationships, constraints, indexes, reports and secure configuration (Chapter ${S("db")}).`),
    P(`The two tiers are joined by the \`event_uuid\`: every record created on the ESP32 carries the same unique id on the SD card and in the database, which is how the server recognises records it already has. The file layout is given in Table ${T("sdfiles")}.`),
    ...table(["Option", "Works offline", "Safe on power loss", "Fits ESP32 memory", "Central reports", "Decision"], [
      ["No local storage (server only)", "No", "n/a", "Yes", "Yes", "Rejected"],
      ["Full SQLite database on the SD card", "Yes", "Weak", "Tight", "No", "Rejected"],
      ["Internal flash only (NVS or LittleFS, about 1 to 2 MB free)", "Yes", "Good", "Yes", "No", "Too small for logs; used only for the event counter"],
      ["**CSV on SD card + SQLite on server**", "Yes", "Good (append-only + CRC)", "Yes", "Yes", "**Chosen**"],
    ], [2700, 1100, 1500, 1200, 1100, 1426], "Storage options compared", "sdopts"),

    H2("How Data Flows Through the System", "flow"),
    H3("Online access request"),
    P(`Figure ${F("online")} follows one scan from tag to door when Wi-Fi is available. The decision and the record are made **in one database transaction**, so the person's visit, the access log and the people-inside count can never disagree.`),
    ...figure("seq_online.png", "Sequence of an online access request (tag scanned while Wi-Fi is up)", "online", 610),
    ...steps([
      "The user taps a tag on the ENTRY reader; the Access task reads the UID.",
      "The ESP32 gives the scan a unique `event_uuid` (device number plus a counter kept in non-volatile storage, e.g. `01-000123`) and the current NTP time.",
      `It sends \`POST /api/v1/device/access/check\`. The API locks the database for writing, applies the decision rules (Table ${T("rules")}), records the event and the visit, then commits.`,
      "The ESP32 receives GRANTED or DENIED, appends the result to the access log on the SD card, and opens the door or sounds the buzzer.",
    ]),
    H3("Offline operation and store-and-forward"),
    P(`If the API does not answer within 3 seconds, the ESP32 does not leave people stuck at the door. It applies the **same rules** using the configuration on its SD card, writes the event to \`outbox.csv\`, and uploads it later (Figure ${F("offline")}). Because each record carries its \`event_uuid\`, uploading the same record twice is harmless: the API simply reports it as a duplicate.`),
    ...figure("seq_offline.png", "Offline operation and store-and-forward synchronisation", "offline", 520),
    H2("Access Decision Rules", "rulesec"),
    P("Both the API and the ESP32 firmware apply the rules below in the same order. The first rule that matches decides the outcome. The *reason* code is saved with every event, so management can see why someone was refused."),
    ...table(["#", "Condition", "Decision", "Reason code"], [
      ["1", "Emergency mode is ON (fire or evacuation)", "GRANTED", "`EMERGENCY_OPEN`"],
      ["2", "Tag UID is not registered", "DENIED", "`UNKNOWN_TAG`"],
      ["3", "User has been deactivated", "DENIED", "`INACTIVE_USER`"],
      ["4", "Current time is outside today's access window (applies to ENTRY **and** EXIT)", "DENIED", "`OUTSIDE_SCHEDULE`"],
      ["5a", "ENTRY scanned but the person is already inside (anti-passback)", "DENIED", "`ALREADY_INSIDE`"],
      ["5b", "EXIT scanned but the person is not recorded as inside", "DENIED", "`NOT_INSIDE`"],
      ["6", "None of the above", "GRANTED", "`OK`"],
    ], [500, 4900, 1300, 2326], "Access decision rules, in the order they are evaluated", "rules"),
    P("Rule 4 implements the requirement in Section 2.6 of the brief that people may not leave the building outside the authorised period. Rule 1 is a deliberate safety exception: in an emergency, security can unlock every door so that nobody is trapped."),
    H2("Synchronisation and Reliability", "sync"),
    P(`Section 2.7 of the brief asks for mechanisms that prevent conflicts, inconsistent records and race conditions. With one ESP32 there are still several tasks sharing resources, and on the server several requests can arrive at the same time. Table ${T("sync")} lists each shared resource and how it is protected.`),
    ...table(["Where", "Shared resource or risk", "Mechanism used"], [
      ["ESP32", "People-inside list, room counts and cached configuration, read and written by several tasks", "`state_mutex` (FreeRTOS mutex): a task must take it before reading or changing shared state"],
      ["ESP32", "SD card on a shared SPI bus; two tasks writing at once would corrupt it", "`sd_mutex`: only one task writes to the SD card at a time"],
      ["ESP32", "Handing events from the Access and Lighting tasks to the network", "`event_queue` (FreeRTOS queue): events are written to SD first, then queued, so none are lost"],
      ["SD card", "Power cut while writing", "Append-only logs with a CRC per line; configuration written to a temporary file then swapped in"],
      ["API / DB", "Two requests for the same person at the same moment (e.g. a scan and an offline upload)", "`BEGIN IMMEDIATE` transactions: SQLite gives the write lock to one request at a time; the other waits"],
      ["API / DB", "A person being recorded inside twice", "Partial unique index `uq_one_open_visit`: at most one open visit (no `time_out`) per user"],
      ["API / DB", "The ESP32 retrying after a timeout, or re-uploading a batch", "`event_uuid` is UNIQUE: duplicates are detected and the original answer is returned"],
      ["API / DB", "Offline events arriving late or out of order", "Batches are sorted by `occurred_at`; a room's live state is only replaced by a newer report"],
      ["API and ESP32", "ESP32 using an out-of-date schedule or tag list", "`config_version` is increased on every change; the heartbeat reply tells the ESP32 to download the new configuration"],
    ], [1300, 3700, 4026], "Synchronisation mechanisms and the problem each one solves", "sync"),
    P(`The server-side protection was tested by firing eight simultaneous ENTRY requests for the same tag at the API: exactly one was granted and only one visit was created (Section ${S("apitests")}).`),
    H2("How the Architecture Meets the Requirements", "trace"),
    ...table(["Brief section", "Requirement", "Use cases", "Where it is handled in this design"], [
      ["2.1", "RFID access at entry and exit; know who is inside", "UC01 to UC03, UC07", "Two RFID lanes; `access_events`, `building_visits`, view `v_people_inside`; `GET /occupancy`"],
      ["2.2", "Lights follow room occupancy", "UC04 to UC06, UC13", "IR break-beam counter + Lighting task; `rooms`, `room_status_logs`; overrides; energy report"],
      ["2.3", "Three terminals working as one system", "All", "One ESP32 (per lecturer's email) with one task per terminal; API as the coordination point"],
      ["2.4", "Store large volumes of data", "UC14", "Append-only CSV on the SD card + central SQLite database"],
      ["2.5", "Serial menus and useful information", "UC07 to UC09", "Serial Menu task; the same information is available through the API"],
      ["2.6", "Configurable schedule, changed only by authorised staff", "UC09, UC11", "`access_schedule`; `PUT /schedule` needs SUPER_ADMIN; enforced on both doors; audited"],
      ["2.7", "Synchronisation and reliability", "UC14, UC15", `Mutexes and queue on the ESP32; CRC logs; transactions, unique keys, idempotent uploads and config versioning (Table ${T("sync")})`],
    ], [1100, 2500, 1400, 4026], "Traceability from coursework requirements to use cases and design", "trace"),
  ];

  // ---------- Hardware and firmware (group) ----------
  const hw = [
    H1("Hardware Design", "hw"),
    H2("Components Used"),
    placeholder("List each Wokwi part (ESP32 DevKit, RFID readers or their substitute, door servos, IR break-beam pairs simulated with pushbuttons or switches, LEDs, LCD, buzzer, microSD module) and what it does."),
    H2("Pin Assignment"),
    placeholder("Table of ESP32 GPIO pins used by each component (SPI bus shared by RFID readers and SD card, I2C for the LCD, PWM for the servos, four GPIO inputs for the beams)."),
    H2("Wokwi Circuit Diagram"),
    placeholder("Insert a screenshot of the Wokwi circuit and explain the wiring."),
  ];
  const fw = [
    H1("Firmware and Software Design", "fw"),
    H2("Task Structure and Start-up Sequence"),
    placeholder("How app_main creates the four FreeRTOS tasks, their priorities and stack sizes, and the start-up steps (SD mount, Wi-Fi, NTP, config load)."),
    H2("RFID Access Control Module"),
    placeholder(`Reading the tag, calling the API (see Section ${S("idf")}), offline decision using cached config, door servo timing.`),
    H2("Infrared Occupancy Counting and Lighting Module"),
    placeholder("Beam sequence detection (A then B, B then A), the 1.5 s debounce, the room counters, the light-off delay, overrides, and reporting to POST /device/rooms/status."),
    H2("SD Card Storage Module"),
    placeholder(`Mounting the card, the file layout (Table ${T("sdfiles")}), appending CRC-protected lines under sd_mutex, managing outbox.csv.`),
    H2("Serial Interface and Management Menus"),
    placeholder("The menu tree, the commands, sample output, and how administrator login is forwarded to POST /auth/login."),
    H2("Synchronisation in the Firmware"),
    placeholder(`Code that takes state_mutex and sd_mutex and uses event_queue (design in Section ${S("sync")}).`),
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
      ["occupant_count", "INTEGER", "NOT NULL, >= 0", "People in the room, from the IR beam counter"],
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
      ["reason", "TEXT", `one of the codes in Table ${T("rules")}`, "Why"],
      ["source", "TEXT", "ONLINE or OFFLINE_SYNC", "Decided by the API, or by the ESP32 while offline"],
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
      ["trigger", "TEXT", "PERSON_IN, PERSON_OUT, COUNT_RESET, MANUAL_OVERRIDE, SCHEDULE or EMERGENCY", "What caused the change"],
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
      ["key", "TEXT", "PK", "`emergency_mode`, `light_off_delay_s`, `timezone`, `config_version`, `heartbeat_interval_s`"],
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
      ["device_code", "TEXT", "NOT NULL, UNIQUE", "e.g. `ESP32-CTRL-01`"],
      ["api_key_hash", "TEXT", "NOT NULL", "SHA-256 of the device key"],
      ["firmware_version, ip_address", "TEXT", "", "From the heartbeat"],
      ["free_heap, sd_free_kb", "INTEGER", "", "Memory and SD space left"],
      ["pending_events", "INTEGER", "", "Records waiting in outbox.csv"],
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
    H2("Local Storage on the SD Card", "sdlayout"),
    P(`The SD card mirrors the parts of the database that the ESP32 needs in order to work on its own (design in Section ${S("sd")}). Files are plain CSV so they can be opened in a spreadsheet straight from the card. Every log line ends with a CRC-32 of the rest of the line (\`esp_rom_crc32_le\` in ESP-IDF). Long file names must be enabled in menuconfig (\`CONFIG_FATFS_LFN_HEAP\`), or short 8.3 names used instead.`),
    ...table(["File", "Columns", "Written when", "Purpose"], [
      ["users.csv", "rfid_uid, full_name, role", "Config downloaded (temp file, then swapped in)", "Authorised tags for offline decisions"],
      ["schedule.csv", "day_of_week, is_open, open_time, close_time", "Config downloaded", "Offline schedule check"],
      ["config.csv", "key, value", "Config downloaded", "config_version, emergency_mode, light_off_delay_s, light modes"],
      ["inside.csv", "rfid_uid, time_in", "Every granted entry or exit", "Who is inside (survives a reboot)"],
      ["access_YYYYMMDD.csv", "event_uuid, rfid_uid, door, decision, reason, occurred_at, crc", "Every scan (append only)", "Daily local access log"],
      ["rooms_YYYYMMDD.csv", "event_uuid, room_code, occupant_count, light_on, trigger, occurred_at, crc", "Every room change (append only)", "Daily local lighting log"],
      ["outbox.csv", "kind (A or R), then the access or room columns, crc", "Event not yet confirmed by the API", "Upload queue; lines are removed once the API accepts them"],
    ], [1700, 3100, 2000, 2226], "SD card file layout", "sdfiles"),
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
      ["Staff authentication", "Header `Authorization: Bearer <token>` (token from `POST /auth/login`)"],
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
      ["POST", "/device/access/check", "Device", "UC01 to UC03", "Decide and record an RFID scan (online path)"],
      ["POST", "/device/rooms/status", "Device", "UC04 to UC06", "Report a lecture-room count or light change"],
      ["POST", "/device/events/batch", "Device", "UC14", "Upload records stored while offline"],
      ["GET", "/device/config", "Device", "UC15", "Download schedule, tags and settings for offline use"],
      ["POST", "/device/heartbeat", "Device", "UC15", "Report health; learn the current config_version"],
      ["POST", "/auth/login", "none", "UC09", "Log in, receive a bearer token"],
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
      ["PUT", "/settings/emergency", "SECURITY", "UC12", "Turn emergency mode (all doors open) on or off"],
      ["GET", "/reports/daily", "VIEWER", "UC08", "Daily totals, peak occupancy and lighting energy"],
      ["GET", "/devices", "VIEWER", "", "ESP32 health and online status"],
      ["GET", "/audit-log", "SUPER_ADMIN", "", "Recent configuration changes and logins"],
    ], [1050, 2450, 1500, 1100, 2926], "Summary of all API endpoints", "endpoints"),
    H2("Device Endpoints (used by the ESP32)"),
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
    H2("Access Decision Reason Codes"),
    P(`The \`reason\` field returned by \`/device/access/check\` and stored in \`access_events\` takes the values in Table ${T("rules")}. The firmware can map each code to an LCD message, for example \`OUTSIDE_SCHEDULE\` shows "Building closed" and \`ALREADY_INSIDE\` shows "Already checked in".`),
    H2("Running the API"),
    P("From the project folder:"),
    ...code(`python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
# then open http://localhost:8000/docs`),
    P("The database file `data/cocis.db` is created automatically on first start. To run the automated tests:"),
    ...code(`.venv/bin/python -m pytest -q tests`),
    H3("Connecting the Wokwi ESP32 to the API"),
    P("In Wokwi the ESP32 joins the open Wi-Fi network `Wokwi-GUEST` and can reach servers on the internet. The API must therefore be reachable from the internet, for example deployed to a free hosting service, or run on a laptop and exposed through a tunnelling tool such as ngrok or Cloudflare Tunnel. When using the Wokwi extension for VS Code, the host computer can also be reached from the simulated ESP32 at `host.wokwi.internal`. The base URL is a single constant in the firmware."),
    H2("Demonstration Credentials", "creds"),
    ...table(["Credential", "Value", "Used by"], [
      ["Administrator", "username `admin`, password `Admin@CoCIS2026` (SUPER_ADMIN)", "Swagger UI, Postman, serial menu"],
      ["Device key", "`esp32-demo-key-change-me` for device `ESP32-CTRL-01`", "ESP32 firmware (`X-Device-Key`)"],
      ["Demo tags", "`A1B2C3D4` Lisa (student), `11223344` lecturer, `DEADBEEF` security, `CAFEBABE` visitor", "Wokwi simulation"],
    ], [1900, 4600, 2526], "Demonstration credentials (change before real deployment)"),
    H2("Example: Calling the API from ESP-IDF", "idf"),
    P("The firmware uses the ESP-IDF `esp_http_client` component. The sketch below shows the online access check; if the request fails or times out, the firmware falls back to the offline rules and writes the event to `outbox.csv`. The response body is read in the HTTP event handler and parsed with cJSON."),
    ...code(`esp_http_client_config_t cfg = {
    .url        = API_BASE "/api/v1/device/access/check",
    .method     = HTTP_METHOD_POST,
    .timeout_ms = 3000,
    .event_handler = http_event_handler,      // collects the JSON reply
};
esp_http_client_handle_t client = esp_http_client_init(&cfg);
esp_http_client_set_header(client, "Content-Type", "application/json");
esp_http_client_set_header(client, "X-Device-Key", DEVICE_KEY);

char body[192];
snprintf(body, sizeof body,
    "{\\"event_uuid\\":\\"%s\\",\\"rfid_uid\\":\\"%s\\",\\"door\\":\\"%s\\",\\"occurred_at\\":\\"%s\\"}",
    uuid, uid, door, iso_time);
esp_http_client_set_post_field(client, body, strlen(body));

if (esp_http_client_perform(client) == ESP_OK &&
    esp_http_client_get_status_code(client) == 200) {
    // parse "decision" with cJSON and open the door if GRANTED
} else {
    // offline: decide with cached rules, append to outbox.csv
}
esp_http_client_cleanup(client);`),
  ];

  // ---------- Features ----------
  const feat = [
    H1("Implemented Features and Innovations", "feat"),
    H2("Core Features"),
    placeholder("Describe each core feature as demonstrated in Wokwi: RFID entry and exit, occupancy, automatic lighting, SD logging, serial menus, schedule enforcement."),
    H2("Innovations in the Architecture, Data and API Layer"),
    P("The brief places particular emphasis on innovation. The architecture, database and API add the following beyond the basic requirements:"),
    bullet("**Lights that stay on for still occupants.** Infrared break-beam counting at the door replaces motion sensing, so lights no longer switch off during exams and lectures, while still switching off as soon as the last person leaves."),
    bullet("**Self-correcting room counts.** Counts reset at closing time and whenever the entrance shows the building is empty, using the fact that one controller sees both."),
    bullet("**Offline-first operation with store-and-forward.** Doors and lights keep working when Wi-Fi or the server is down; no record is lost and none is duplicated when the connection returns."),
    bullet("**Power-cut-safe local storage.** Append-only logs with a CRC on every line, and configuration swapped in only after it is completely written."),
    bullet("**Anti-passback.** A tag cannot be used to enter twice without leaving, which stops one card being passed back to let a second person in."),
    bullet("**Emergency evacuation mode.** Security staff can unlock every door with one request; the change reaches the ESP32 within one heartbeat and is audited with a reason."),
    bullet("**Manual lighting override** (`FORCE_ON` / `FORCE_OFF`) without disabling automatic control elsewhere."),
    bullet("**Energy report.** Lights-on hours and kWh per room per day, so management can measure the savings the system was built to achieve."),
    bullet("**Peak-occupancy report:** the busiest moment of the day, useful for safety and room planning."),
    bullet("**Role-based access and a full audit trail:** three permission levels, hashed passwords and tokens, and a record of every configuration change and failed login."),
    bullet("**Device health monitoring:** free memory, SD space and the size of the upload queue are visible to management, and the controller is shown as offline if heartbeats stop."),
    bullet("**Configuration versioning:** the ESP32 downloads settings only when they have changed."),
    bullet("**Self-documenting API:** Swagger UI lets anyone explore and test every endpoint from a browser."),
    H2("Other Innovations"),
    placeholder("Hardware or firmware innovations added by other members."),
  ];

  // ---------- Testing ----------
  const test = [
    H1("Testing and Results", "test"),
    H2("Database and API Tests", "apitests"),
    P("The API is covered by an automated test suite (`tests/test_api.py`, run with pytest) that starts the API on a fresh, empty database and exercises it exactly as the ESP32 and a staff member would. All 14 tests pass."),
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
    ], [450, 2100, 1300, 4200, 976], "Automated database and API test results"),
    H2("Simulation Testing in Wokwi"),
    placeholder("Test cases run in the Wokwi simulation with screenshots of serial output and LCD."),
  ];

  // ---------- Group sections and back matter ----------
  const tail = [
    H1("Wokwi Simulation Link", "wokwi"),
    placeholder("Paste the public Wokwi project link here."),
    H1("Individual Contributions", "contrib"),
    P("Each member's tasks and responsibilities (Deliverable 4)."),
    ...table(["Member", "Tasks and responsibilities"], [
      ["Lisa Nyonyozi", `Carried out the use case analysis and wrote the use case specifications (Chapter ${S("uc")}); designed the overall system architecture and redrew it from the group's draft, including the infrared occupancy and memory-card design decisions (Chapter ${S("arch")}); designed and implemented the SQLite database: schema, constraints, indexes, views and seed data (Chapter ${S("db")}); designed, implemented and tested the REST API that connects the ESP32 to the database, including authentication, roles, offline synchronisation and reports (Chapter ${S("api")}); wrote the API documentation and the automated test suite (Section ${S("apitests")}); defined the SD card file formats agreed with the firmware team.`],
      ["", ""], ["", ""], ["", ""], ["", ""],
    ], [2200, 6826], "Individual contributions of group members"),
    H1("Individual Video Demonstrations", "videos"),
    ...table(["Member", "Feature(s) demonstrated", "Video link"], [
      ["Lisa Nyonyozi", "Use cases and architecture walkthrough; database schema; API demo in Swagger UI (scan, occupancy, schedule change, offline upload, daily report)", ""],
      ["", "", ""], ["", "", ""], ["", "", ""], ["", "", ""],
    ], [2000, 4400, 2626], "Links to individual video demonstrations"),
    H1("Conclusion and Recommendations", "concl"),
    H2("Conclusion"),
    placeholder("Summarise what was achieved against the objectives."),
    H2("Limitations and Future Work"),
    placeholder("For example: real RFID and IR hardware, HTTPS certificates on the ESP32, one ESP32 per terminal, thermal-array sensors as a second check, a web dashboard."),
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
    placeholder("Add any further references used by other sections."),
    H1u("Appendix A: Project Files (Database and API)"),
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
      ["tests/test_api.py", "14 automated tests"],
      ["docs/openapi.json", "Machine-readable API specification (importable into Postman)"],
      ["docs/diagrams/", "Use case, architecture, infrared counter, ER and sequence diagrams (SVG and PNG)"],
    ], [3000, 6026], "Database and API project files"),
    H1u("Appendix B: Explaining the System (Likely Questions)"),
    P("Short answers prepared so that every member can explain the use cases, architecture, database and API during the presentation."),
    ...[
      ["Why only one ESP32 when the brief mentions three terminals?", "The free Wokwi plan supports one microcontroller and the lecturer confirmed one should be used. Each terminal is a separate FreeRTOS task, so the design stays modular."],
      ["Why infrared beams and not a motion sensor in the lecture rooms?", "A PIR motion sensor only notices movement. Students sitting still in an exam look like an empty room, so the lights would go off on them. The beams count people in and out at the door, so the room stays occupied until the count returns to zero."],
      ["What if the beam counter gets the count wrong?", "The count cannot go below zero, crossings must break both beams in order within 1.5 s, counts reset at closing time and whenever the building is empty, and security can override the lights."],
      ["Is the memory card the database?", "No. The SD card is local storage for the ESP32: its copy of the configuration, its logs and its upload queue. The real database is SQLite on the server. A full database on the ESP32 was rejected because the ESP32 SQLite port has no locking (we have four tasks), memory is tight, and SD cards on FAT are easily corrupted by power cuts."],
      ["If there is an SD card, why do we need a central database and an API?", "Management cannot query an SD card remotely, and it can be lost or fill up. The central database gives one authoritative record, fast searches and reports, and a secure way to change settings. The SD card keeps the doors working when the network is down."],
      ["What happens when Wi-Fi goes down?", `The ESP32 decides using the copy of the tags and schedule on its SD card, writes each event to outbox.csv, and uploads the batch when the connection returns (Figure ${F("offline")}).`],
      ["How do you avoid duplicate records?", "Every event has an event_uuid created on the ESP32, and the database column is UNIQUE. A retried or re-uploaded event is recognised and skipped."],
      ["How do you prevent race conditions?", "On the ESP32: mutexes around shared state and the SD card, and a queue between tasks. On the server: each write runs in a BEGIN IMMEDIATE transaction, and a partial unique index guarantees a person can only be inside once. We tested 8 simultaneous scans: only one was granted."],
      ["How does the system know who is inside?", "Each granted entry opens a row in building_visits and each granted exit closes it. People with an open visit (time_out empty) are inside: that is the v_people_inside view."],
      ["Who can change the schedule, and how is it protected?", "Only a SUPER_ADMIN, after logging in. Passwords are stored as salted PBKDF2 hashes, tokens expire after 8 hours, and every change is written to the audit log."],
      ["Isn't stopping people leaving after hours dangerous?", "The brief requires it, so rule 4 enforces it, but emergency mode (rule 1) lets security open every door instantly, and that is audited."],
      ["How is energy saving measured?", "Every light change is logged with its time. The daily report adds up the hours each room's lights were on and multiplies by the room's lamp power to get kWh."],
      ["What is the difference between «include» and «extend» in the use case diagram?", "«include» is a step that always happens as part of another use case (entering the building always verifies access). «extend» is optional extra behaviour (a manual override only changes lighting when security chooses to use it)."],
    ].flatMap(([q, a]) => [P(`**Q: ${q}**`, { keepNext: true, spacing: { after: 40 } }), P(`A: ${a}`)]),
  ];

  return { cover, front, main: [...intro, ...uc, ...arch, ...hw, ...fw, ...db, ...api, ...feat, ...test, ...tail] };
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
