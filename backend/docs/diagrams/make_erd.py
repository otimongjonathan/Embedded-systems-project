"""Generates erd.svg from a compact description of the tables (run: python3 make_erd.py)."""
W, ROW, HEAD = 400, 26, 44
X = [40, 480, 920, 1360]

T = {  # name: (x, y, colour, [(column, type, key)])
    "users": (X[0], 110, "#2563eb", [
        ("id", "INTEGER", "PK"), ("rfid_uid", "TEXT", "UQ"), ("full_name", "TEXT", ""),
        ("reg_number", "TEXT", "UQ"), ("email", "TEXT", ""), ("phone", "TEXT", ""),
        ("role", "TEXT", ""), ("department", "TEXT", ""), ("is_active", "INTEGER", ""),
        ("created_at", "TEXT", ""), ("updated_at", "TEXT", "")]),
    "building_visits": (X[1], 110, "#2563eb", [
        ("id", "INTEGER", "PK"), ("user_id", "INTEGER", "FK"), ("entry_event_id", "INTEGER", "FK"),
        ("exit_event_id", "INTEGER", "FK"), ("time_in", "TEXT", ""), ("time_out", "TEXT", ""),
        ("visit_date", "TEXT (generated)", "")]),
    "access_events": (X[2], 110, "#2563eb", [
        ("id", "INTEGER", "PK"), ("event_uuid", "TEXT", "UQ"), ("rfid_uid", "TEXT", ""),
        ("user_id", "INTEGER", "FK"), ("door", "ENTRY | EXIT", ""), ("decision", "GRANTED | DENIED", ""),
        ("reason", "TEXT", ""), ("source", "ONLINE | OFFLINE_SYNC", ""), ("occurred_at", "TEXT", ""),
        ("received_at", "TEXT", "")]),
    "rooms": (X[3], 110, "#16a34a", [
        ("id", "INTEGER", "PK"), ("code", "TEXT", "UQ"), ("name", "TEXT", ""), ("room_type", "TEXT", ""),
        ("capacity", "INTEGER", ""), ("light_watts", "INTEGER", ""), ("occupant_count", "INTEGER", ""), ("is_occupied", "INTEGER", ""),
        ("light_on", "INTEGER", ""), ("light_mode", "AUTO | FORCE_ON | FORCE_OFF", ""),
        ("last_activity_at", "TEXT", ""), ("updated_at", "TEXT", "")]),
    "admins": (X[0], 560, "#7c3aed", [
        ("id", "INTEGER", "PK"), ("username", "TEXT", "UQ"), ("full_name", "TEXT", ""),
        ("password_hash", "TEXT", ""), ("role", "SUPER_ADMIN | SECURITY | VIEWER", ""),
        ("is_active", "INTEGER", ""), ("created_at", "TEXT", "")]),
    "admin_sessions": (X[1], 560, "#7c3aed", [
        ("token_hash", "TEXT", "PK"), ("admin_id", "INTEGER", "FK"), ("created_at", "TEXT", ""),
        ("expires_at", "TEXT", "")]),
    "access_schedule": (X[2], 560, "#d97706", [
        ("day_of_week", "INTEGER 0-6", "PK"), ("is_open", "INTEGER", ""), ("open_time", "HH:MM", ""),
        ("close_time", "HH:MM", ""), ("updated_by", "INTEGER", "FK"), ("updated_at", "TEXT", "")]),
    "room_status_logs": (X[3], 560, "#16a34a", [
        ("id", "INTEGER", "PK"), ("event_uuid", "TEXT", "UQ"), ("room_id", "INTEGER", "FK"),
        ("occupant_count", "INTEGER", ""), ("is_occupied", "INTEGER", ""), ("light_on", "INTEGER", ""), ("trigger", "TEXT", ""),
        ("occurred_at", "TEXT", ""), ("received_at", "TEXT", "")]),
    "devices": (X[0], 900, "#64748b", [
        ("id", "INTEGER", "PK"), ("device_code", "TEXT", "UQ"), ("api_key_hash", "TEXT", ""),
        ("firmware_version", "TEXT", ""), ("ip_address", "TEXT", ""), ("free_heap", "INTEGER", ""),
        ("sd_free_kb", "INTEGER", ""), ("pending_events", "INTEGER", ""), ("last_seen_at", "TEXT", "")]),
    "audit_log": (X[1], 900, "#64748b", [
        ("id", "INTEGER", "PK"), ("actor_type", "ADMIN | DEVICE | SYSTEM", ""), ("actor_id", "INTEGER", ""),
        ("action", "TEXT", ""), ("details", "JSON text", ""), ("created_at", "TEXT", "")]),
    "system_settings": (X[2], 900, "#d97706", [
        ("key", "TEXT", "PK"), ("value", "TEXT", ""), ("description", "TEXT", ""), ("updated_at", "TEXT", "")]),
}


def box(name):
    x, y, col, cols = T[name]
    h = HEAD + ROW * len(cols) + 8
    out = [f'<rect x="{x}" y="{y}" width="{W}" height="{h}" rx="10" fill="#fff" stroke="{col}" stroke-width="2"/>',
           f'<path d="M{x},{y + 10} a10,10 0 0 1 10,-10 h{W - 20} a10,10 0 0 1 10,10 v{HEAD - 10} h-{W} z" fill="{col}"/>',
           f'<text x="{x + W / 2}" y="{y + 29}" text-anchor="middle" class="th">{name}</text>']
    for i, (c, t, k) in enumerate(cols):
        cy = y + HEAD + ROW * i + 20
        if i % 2:
            out.append(f'<rect x="{x + 1}" y="{cy - 18}" width="{W - 2}" height="{ROW}" fill="#f8fafc"/>')
        kc = {"PK": "#b91c1c", "FK": "#1d4ed8", "UQ": "#047857"}.get(k, "")
        if k:
            out.append(f'<text x="{x + 12}" y="{cy}" class="k" fill="{kc}">{k}</text>')
        weight = ' font-weight="700"' if k == "PK" else ""
        out.append(f'<text x="{x + 48}" y="{cy}" class="c"{weight}>{c}</text>')
        out.append(f'<text x="{x + W - 12}" y="{cy}" text-anchor="end" class="ty">{t}</text>')
    return "\n".join(out)


def row_y(name, col):
    x, y, _, cols = T[name]
    i = [c[0] for c in cols].index(col)
    return y + HEAD + ROW * i + 14


def rel(path, l1, p1, l2, p2):
    return (f'<path d="{path}" class="r"/>'
            f'<text x="{p1[0]}" y="{p1[1]}" class="card">{l1}</text>'
            f'<text x="{p2[0]}" y="{p2[1]}" class="card">{l2}</text>')


R = X[0] + W  # users right edge
rels = [
    # users.id 1 to N building_visits.user_id
    rel(f"M{R},{row_y('users','id')} H{X[1]}", "1", (R + 6, row_y('users', 'id') - 6),
        "N", (X[1] - 16, row_y('users', 'id') - 6)),
    # building_visits entry/exit -> access_events.id
    rel(f"M{X[1] + W},{row_y('building_visits','entry_event_id')} H{X[2] - 20} V{row_y('access_events','id')} H{X[2]}",
        "1", (X[1] + W + 6, row_y('building_visits', 'entry_event_id') - 6),
        "1", (X[2] - 14, row_y('access_events', 'id') - 6)),
    f'<path d="M{X[1] + W},{row_y("building_visits","exit_event_id")} H{X[2] - 20}" class="r"/>',
    # users.id 1 to N access_events.user_id (routed over the top)
    rel(f"M{X[0] + 300},110 V80 H{X[2] + 300} V110", "1", (X[0] + 306, 98), "N", (X[2] + 306, 98)),
    # rooms 1 to N room_status_logs
    rel(f"M{X[3] + 200},{T['rooms'][1] + HEAD + ROW * 12 + 8} V560", "1",
        (X[3] + 208, T['rooms'][1] + HEAD + ROW * 12 + 26), "N", (X[3] + 208, 552)),
    # admins 1 to N admin_sessions
    rel(f"M{X[0] + W},{row_y('admins','id')} H{X[1]}", "1", (X[0] + W + 6, row_y('admins', 'id') - 6),
        "N", (X[1] - 16, row_y('admins', 'id') - 6)),
    # admins 1 to N access_schedule.updated_by (routed under admin_sessions)
    rel(f"M{X[0] + W},{row_y('admins','role')} H{X[1] - 20} V{T['admin_sessions'][1] + 190} H{X[2] - 20} "
        f"V{row_y('access_schedule','updated_by')} H{X[2]}",
        "1", (X[0] + W + 6, row_y('admins', 'role') - 6), "N", (X[2] - 16, row_y('access_schedule', 'updated_by') - 6)),
]

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1210" viewBox="0 0 1800 1210" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
<style>
 .th{{font-size:19px;font-weight:700;fill:#fff}} .c{{font-size:15px;fill:#0f172a}} .ty{{font-size:13px;fill:#64748b}}
 .k{{font-size:12px;font-weight:700}} .r{{stroke:#334155;stroke-width:2;fill:none}} .card{{font-size:15px;font-weight:700;fill:#b91c1c}}
</style>
<rect width="1800" height="1210" fill="#fff"/>
<text x="900" y="44" text-anchor="middle" style="font-size:28px;font-weight:700;fill:#0f172a">Entity-Relationship Diagram: cocis.db (SQLite)</text>
{"".join(rels)}
{"".join(box(n) for n in T)}
<g transform="translate(1360,900)">
 <rect width="400" height="250" rx="10" fill="#f8fafc" stroke="#cbd5e1"/>
 <text x="20" y="34" style="font-size:18px;font-weight:700;fill:#0f172a">Key</text>
 <text x="20" y="66" class="k" fill="#b91c1c">PK</text><text x="60" y="66" class="c">primary key</text>
 <text x="20" y="94" class="k" fill="#1d4ed8">FK</text><text x="60" y="94" class="c">foreign key</text>
 <text x="20" y="122" class="k" fill="#047857">UQ</text><text x="60" y="122" class="c">unique (no duplicates)</text>
 <text x="20" y="154" class="c">1 to N : one-to-many relationship</text>
 <text x="20" y="186" class="ty">Partial unique index: one open visit</text>
 <text x="20" y="206" class="ty">(time_out IS NULL) per user.</text>
 <text x="20" y="232" class="ty">Views: v_people_inside, v_daily_access_summary</text>
</g>
</svg>'''
open("erd.svg", "w").write(svg)
