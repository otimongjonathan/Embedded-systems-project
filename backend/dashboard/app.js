/* CoCIS staff dashboard. Plain JavaScript, no libraries.
   Talks to the same API that serves this page, under /api/v1. */
"use strict";

const API = "/api/v1";
const REFRESH_MS = 3000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MODES = ["AUTO", "FORCE_ON", "FORCE_OFF"];

let token = null;
let timer = null;
let busy = false;           // stops overlapping refreshes on a slow network
let currentTab = "overview";
let emergencyOn = false;

const $ = (id) => document.getElementById(id);

// ---------- small helpers ----------

function store(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch (e) { /* storage blocked: the login just lasts until the page closes */ }
}

function load(key) {
  try { return sessionStorage.getItem(key); } catch (e) { return null; }
}

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTime(iso) {
  return iso ? String(iso).replace("T", " ") : "";
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function showMsg(el, text, kind) {
  if (!text) { el.hidden = true; return; }
  el.textContent = text;
  el.className = "msg " + (kind || "error");
  el.hidden = false;
}

function emptyRow(cols, text) {
  return `<tr><td class="empty" colspan="${cols}">${esc(text)}</td></tr>`;
}

/** Turn FastAPI's error body into one readable line. */
function errorText(status, body) {
  const detail = body && body.detail;
  let text;
  if (Array.isArray(detail)) {
    // 422 validation errors: a list of {loc, msg}
    text = detail.map((d) => `${(d.loc || []).filter((p) => p !== "body").join(" > ")}: ${d.msg}`).join("; ");
  } else if (detail) {
    text = String(detail);
  } else {
    text = "Request failed";
  }
  return `Error ${status}: ${text}`;
}

/** Call the API. Throws an Error with a readable message on failure. */
async function api(method, path, body) {
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(API + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error("Cannot reach the server. Is the API still running?");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty or non JSON body */ }
  if (res.status === 401 && path !== "/auth/login") {
    toLogin("Your session has ended. Please log in again.");
    throw new Error("Not logged in");
  }
  if (!res.ok) throw new Error(errorText(res.status, data));
  return data;
}

// ---------- login and logout ----------

function toLogin(message) {
  token = null;
  store("cocis_token", null);
  store("cocis_name", null);
  store("cocis_role", null);
  stopRefresh();
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  showMsg($("login-error"), message || "");
  $("login-user").focus();
}

function toApp(name, role) {
  $("who-name").textContent = name || "";
  $("who-role").textContent = role || "";
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  showTab("overview");
}

$("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  showMsg($("login-error"), "");
  const btn = ev.submitter || ev.target.querySelector("button");
  btn.disabled = true;
  try {
    const data = await api("POST", "/auth/login", {
      username: $("login-user").value.trim(), password: $("login-pass").value,
    });
    token = data.access_token;
    store("cocis_token", token);
    store("cocis_name", data.full_name);
    store("cocis_role", data.role);
    $("login-pass").value = "";
    toApp(data.full_name, data.role);
  } catch (e) {
    showMsg($("login-error"), e.message);
  } finally {
    btn.disabled = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  try { await api("POST", "/auth/logout"); } catch (e) { /* log out locally anyway */ }
  toLogin("You have logged out.");
  $("login-error").className = "msg ok";
});

// ---------- tabs ----------

function showTab(name) {
  currentTab = name;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((s) => { s.hidden = s.id !== "tab-" + name; });
  showMsg($("global-msg"), "");
  stopRefresh();
  if (name === "overview") startRefresh();
  else refreshStatus();      // keep the emergency banner correct on other tabs
  if (name === "schedule") loadSchedule();
  if (name === "users") loadUsers();
  if (name === "reports") loadReport();
  if (name === "audit") loadAudit();
  if (name === "database") startDbRefresh();
}

$("tabs").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-tab]");
  if (btn) showTab(btn.dataset.tab);
});

function startRefresh() {
  refreshOverview();
  timer = setInterval(refreshOverview, REFRESH_MS);
}

function stopRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------- overview ----------

function setEmergency(on) {
  emergencyOn = on;
  $("emergency-banner").hidden = !on;
  $("emergency-state").textContent = on ? "ON" : "OFF";
  const btn = $("emergency-btn");
  btn.textContent = on ? "Turn emergency OFF" : "Turn emergency ON";
  btn.className = on ? "btn primary" : "btn danger";
}

async function refreshStatus() {
  try {
    const occ = await api("GET", "/occupancy");
    setEmergency(occ.emergency_mode);
  } catch (e) { /* the banner is a nice to have here */ }
}

async function refreshOverview() {
  if (busy || !token) return;
  busy = true;
  try {
    const [occ, devices, events] = await Promise.all([
      api("GET", "/occupancy"), api("GET", "/devices"), api("GET", "/access-events?limit=20"),
    ]);
    renderOccupancy(occ);
    renderDevices(devices);
    renderEvents(events.items);
    $("as-of").textContent = fmtTime(occ.as_of);
    if ($("global-msg").dataset.from === "refresh") showMsg($("global-msg"), "");
  } catch (e) {
    if (token) {
      showMsg($("global-msg"), e.message);
      $("global-msg").dataset.from = "refresh";
    }
  } finally {
    busy = false;
  }
}

function renderOccupancy(occ) {
  setEmergency(occ.emergency_mode);
  $("people-count").textContent = occ.people_inside_count;
  $("people-body").innerHTML = occ.people_inside.length
    ? occ.people_inside.map((p) =>
        `<tr><td>${esc(p.full_name)}</td><td>${esc(p.role)}</td><td class="time">${esc(fmtTime(p.time_in))}</td></tr>`).join("")
    : emptyRow(3, "Nobody is inside.");

  $("rooms").innerHTML = occ.rooms.map((r) => {
    const occupied = r.is_occupied
      ? '<span class="badge amber">Occupied</span>' : '<span class="badge">Empty</span>';
    const light = r.light_on
      ? '<span class="badge green">Light ON</span>' : '<span class="badge">Light OFF</span>';
    const buttons = MODES.map((m) =>
      `<button class="btn small${m === r.light_mode ? " selected" : ""}" data-room="${esc(r.code)}"
        data-mode="${m}">${m}</button>`).join("");
    return `<div class="card">
      <div class="room-head"><h3>${esc(r.code)}</h3>${occupied}</div>
      <div class="room-lines">
        <p class="muted small">${esc(r.name)}</p>
        <p><span class="room-count">${esc(r.occupant_count)}</span> people</p>
        <p>${light} Mode: <strong>${esc(r.light_mode)}</strong></p>
        <p class="muted small">Last activity: ${esc(fmtTime(r.last_activity_at) || "none")}</p>
      </div>
      <div class="mode-buttons">${buttons}</div>
    </div>`;
  }).join("");
}

function renderDevices(devices) {
  $("devices-body").innerHTML = devices.length
    ? devices.map((d) => `<tr>
        <td>${esc(d.device_code)}</td>
        <td>${d.online ? '<span class="badge green">Online</span>' : '<span class="badge red">Offline</span>'}</td>
        <td class="time">${esc(fmtTime(d.last_seen_at) || "never")}</td>
        <td>${esc(d.pending_events)}</td>
        <td>${esc(d.firmware_version || "unknown")}</td>
        <td>${esc(d.ip_address || "")}</td></tr>`).join("")
    : emptyRow(6, "No controllers registered.");
}

function renderEvents(items) {
  $("events-body").innerHTML = items.length
    ? items.map((e) => `<tr>
        <td class="time">${esc(fmtTime(e.occurred_at))}</td>
        <td>${esc(e.full_name || "Unknown tag")}</td>
        <td>${esc(e.rfid_uid)}</td>
        <td>${esc(e.door)}</td>
        <td><span class="badge ${e.decision === "GRANTED" ? "green" : "red"}">${esc(e.decision)}</span></td>
        <td>${esc(e.reason)}</td>
        <td>${esc(e.source)}</td></tr>`).join("")
    : emptyRow(7, "No access events yet.");
}

$("rooms").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-mode]");
  if (!btn) return;
  btn.disabled = true;
  try {
    const r = await api("PUT", `/rooms/${encodeURIComponent(btn.dataset.room)}/light-mode`, { mode: btn.dataset.mode });
    showMsg($("global-msg"), `${r.room} light mode set to ${r.light_mode}.`, "ok");
    $("global-msg").dataset.from = "action";
    refreshOverview();
  } catch (e) {
    showMsg($("global-msg"), e.message);
    $("global-msg").dataset.from = "action";
    btn.disabled = false;
  }
});

$("emergency-btn").addEventListener("click", async () => {
  const turnOn = !emergencyOn;
  const reason = window.prompt(turnOn
    ? "Reason for turning emergency mode ON (all doors unlock):"
    : "Reason for turning emergency mode OFF:", turnOn ? "Fire drill" : "Drill over");
  if (reason === null) return;
  if (reason.trim().length < 3) {
    showMsg($("global-msg"), "Please give a reason of at least 3 characters.");
    return;
  }
  try {
    const r = await api("PUT", "/settings/emergency", { enabled: turnOn, reason: reason.trim() });
    setEmergency(r.emergency_mode);
    showMsg($("global-msg"), `Emergency mode is now ${r.emergency_mode ? "ON" : "OFF"}.`, "ok");
    $("global-msg").dataset.from = "action";
  } catch (e) {
    showMsg($("global-msg"), e.message);
    $("global-msg").dataset.from = "action";
  }
});

// ---------- schedule ----------

async function loadSchedule() {
  showMsg($("schedule-msg"), "");
  try {
    const days = await api("GET", "/schedule");
    $("schedule-body").innerHTML = days.map((d) => `<tr data-day="${d.day_of_week}">
      <td>${DAYS[d.day_of_week]}</td>
      <td><input type="checkbox" class="s-open" ${d.is_open ? "checked" : ""} aria-label="Open on ${DAYS[d.day_of_week]}"></td>
      <td><input type="time" class="s-from" value="${esc(d.open_time)}" required></td>
      <td><input type="time" class="s-to" value="${esc(d.close_time)}" required></td></tr>`).join("");
  } catch (e) {
    showMsg($("schedule-msg"), e.message);
  }
}

$("schedule-reload").addEventListener("click", loadSchedule);

$("schedule-save").addEventListener("click", async () => {
  const days = [...document.querySelectorAll("#schedule-body tr")].map((tr) => ({
    day_of_week: Number(tr.dataset.day),
    is_open: tr.querySelector(".s-open").checked,
    open_time: tr.querySelector(".s-from").value,
    close_time: tr.querySelector(".s-to").value,
  }));
  try {
    const r = await api("PUT", "/schedule", { days });
    showMsg($("schedule-msg"), `Schedule saved. The controller will pick it up (config version ${r.config_version}).`, "ok");
  } catch (e) {
    showMsg($("schedule-msg"), e.message);
  }
});

// ---------- users ----------

async function loadUsers() {
  try {
    const users = await api("GET", "/users");
    $("users-body").innerHTML = users.length
      ? users.map((u) => `<tr class="${u.is_active ? "" : "inactive"}">
          <td>${esc(u.full_name)}</td><td>${esc(u.rfid_uid)}</td><td>${esc(u.reg_number)}</td>
          <td>${esc(u.role)}</td><td>${esc(u.department)}</td>
          <td>${u.is_active ? '<span class="badge green">Active</span>' : '<span class="badge">Inactive</span>'}</td>
          <td>${u.is_active ? `<button class="btn small" data-deactivate="${u.id}" data-name="${esc(u.full_name)}">Deactivate</button>` : ""}</td>
        </tr>`).join("")
      : emptyRow(7, "No tag holders registered.");
  } catch (e) {
    showMsg($("user-msg"), e.message);
  }
}

$("user-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const body = {};
  new FormData(ev.target).forEach((v, k) => {
    v = String(v).trim();
    if (v) body[k] = v;        // leave empty optional fields out
  });
  try {
    const u = await api("POST", "/users", body);
    showMsg($("user-msg"), `${u.full_name} registered with tag ${u.rfid_uid}.`, "ok");
    ev.target.reset();
    loadUsers();
  } catch (e) {
    showMsg($("user-msg"), e.message);
  }
});

$("users-body").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-deactivate]");
  if (!btn) return;
  if (!window.confirm(`Deactivate ${btn.dataset.name}? Their tag will stop working. History is kept.`)) return;
  try {
    await api("DELETE", `/users/${btn.dataset.deactivate}`);
    showMsg($("user-msg"), `${btn.dataset.name} has been deactivated.`, "ok");
    loadUsers();
  } catch (e) {
    showMsg($("user-msg"), e.message);
  }
});

// ---------- reports ----------

$("report-date").value = today();
$("report-load").addEventListener("click", loadReport);

async function loadReport() {
  showMsg($("report-msg"), "");
  const day = $("report-date").value || today();
  try {
    const r = await api("GET", `/reports/daily?date=${encodeURIComponent(day)}`);
    $("r-entries").textContent = r.entries;
    $("r-exits").textContent = r.exits;
    $("r-denied").textContent = r.denied;
    $("r-unique").textContent = r.unique_visitors;
    $("r-peak").textContent = r.peak_occupancy.count;
    $("r-peak-at").textContent = r.peak_occupancy.at ? "at " + fmtTime(r.peak_occupancy.at) : "";
    const reasons = Object.entries(r.denied_by_reason || {});
    $("r-denied-body").innerHTML = reasons.length
      ? reasons.map(([k, n]) => `<tr><td>${esc(k)}</td><td>${esc(n)}</td></tr>`).join("")
      : emptyRow(2, "No denied scans on this day.");
    $("r-light-body").innerHTML = r.lighting.length
      ? r.lighting.map((l) => `<tr><td>${esc(l.room)}</td><td>${esc(l.lights_on_hours)}</td><td>${esc(l.energy_kwh)}</td></tr>`).join("")
      : emptyRow(3, "No lecture rooms.");
    $("r-chart").innerHTML = barChart(r.lighting.map((l) => [l.room, l.energy_kwh]), "kWh");
    $("report-out").hidden = false;
  } catch (e) {
    $("report-out").hidden = true;
    showMsg($("report-msg"), e.message);
  }
}

/** A simple horizontal bar chart as an SVG string. data: [[label, value], ...] */
function barChart(data, unit) {
  if (!data.length) return '<p class="muted">No data.</p>';
  const width = 520, barH = 28, gap = 14, left = 60, right = 90;
  const height = data.length * (barH + gap) + gap;
  const max = Math.max(...data.map((d) => d[1]), 0);
  const plotW = width - left - right;
  const bars = data.map(([label, value], i) => {
    const y = gap + i * (barH + gap);
    const w = max > 0 ? Math.max((value / max) * plotW, 2) : 2;
    return `<text x="${left - 10}" y="${y + barH / 2 + 5}" text-anchor="end" font-size="14" fill="#1f2933">${esc(label)}</text>
      <rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="4" fill="#2f5d8a"></rect>
      <text x="${left + w + 8}" y="${y + barH / 2 + 5}" font-size="13" fill="#616e7c">${esc(value)} ${esc(unit)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Energy used per room in ${esc(unit)}">
    <line x1="${left}" y1="0" x2="${left}" y2="${height}" stroke="#d9dee4"></line>${bars}</svg>`;
}

// ---------- audit log ----------

$("audit-reload").addEventListener("click", loadAudit);

async function loadAudit() {
  showMsg($("audit-msg"), "");
  try {
    const rows = await api("GET", "/audit-log?limit=50");
    $("audit-body").innerHTML = rows.length
      ? rows.map((a) => `<tr>
          <td class="time">${esc(fmtTime(a.created_at))}</td>
          <td>${esc(a.actor_type)}${a.actor_id !== null ? " #" + esc(a.actor_id) : ""}</td>
          <td>${esc(a.action)}</td>
          <td class="details">${esc(a.details || "")}</td></tr>`).join("")
      : emptyRow(4, "The audit log is empty.");
  } catch (e) {
    $("audit-body").innerHTML = "";
    showMsg($("audit-msg"), e.message);
  }
}

// ---------- database viewer ----------

const dbSeen = {};          // table name -> keys of rows already shown, to highlight new ones

async function loadDbTables() {
  const sel = $("db-table");
  const chosen = sel.value || "access_events";
  const tables = await api("GET", "/db/tables");
  sel.innerHTML = tables.map((t) =>
    `<option value="${esc(t.name)}">${esc(t.name)} (${esc(t.rows)} rows)</option>`).join("");
  sel.value = chosen;
}

async function loadDb() {
  showMsg($("db-msg"), "");
  const table = $("db-table").value || "access_events";
  try {
    const data = await api("GET", `/db/${encodeURIComponent(table)}?limit=20`);
    const first = !dbSeen[table];
    const seen = dbSeen[table] || new Set();
    $("db-head").innerHTML = "<tr>" + data.columns.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr>";
    $("db-body").innerHTML = data.rows.length
      ? data.rows.map((row) => {
          const key = JSON.stringify(row);
          const fresh = !first && !seen.has(key);
          seen.add(key);
          return `<tr class="${fresh ? "new-row" : ""}">` + row.map((v) => `<td>${v === null ? "" : esc(v)}</td>`).join("") + "</tr>";
        }).join("")
      : emptyRow(data.columns.length, "This table is empty.");
    dbSeen[table] = seen;
    $("db-info").textContent = `${data.total} rows in the table. Last refreshed ${new Date().toLocaleTimeString()}.`;
    loadDbTables().catch(() => {});   // keep the row counts in the picker current
  } catch (e) {
    showMsg($("db-msg"), e.message);
  }
}

async function startDbRefresh() {
  try { await loadDbTables(); } catch (e) { showMsg($("db-msg"), e.message); return; }
  loadDb();
  if ($("db-auto").checked) timer = setInterval(loadDb, REFRESH_MS);
}

$("db-refresh").addEventListener("click", loadDb);
$("db-table").addEventListener("change", loadDb);
$("db-auto").addEventListener("change", () => {
  stopRefresh();
  if ($("db-auto").checked && currentTab === "database") timer = setInterval(loadDb, REFRESH_MS);
});

// ---------- start ----------

(async function start() {
  token = load("cocis_token");
  if (!token) { toLogin(); return; }
  try {
    const me = await api("GET", "/auth/me");   // checks the saved token is still valid
    toApp(me.full_name, me.role);
  } catch (e) {
    if (token) toLogin(e.message);
  }
})();
