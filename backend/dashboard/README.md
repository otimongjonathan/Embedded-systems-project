# Management Dashboard

Web page for staff, served by the API. Plain HTML, CSS and JavaScript: nothing to install.

## Open

1. Start the API (`start.bat`).
2. Go to **http://127.0.0.1:8000/dashboard/**.
3. Log in with `admin` / `Admin@CoCIS2026`.

## Tabs

| Tab | Shows and does |
|-----|----------------|
| Overview | People inside, LR1 and LR2 (count, light, AUTO / FORCE_ON / FORCE_OFF), emergency switch, controller health, latest scans. Refreshes every 3 s |
| Schedule | Opening hours per day; save (SUPER_ADMIN) |
| Users | Register a card holder; deactivate one |
| Reports | Daily totals, peak occupancy, lighting kWh with a chart |
| Audit log | Every login and change, with who did it |
| Database | The real rows of any table (scans, visits, room changes...), newest first. **Refresh** button and auto-refresh every 3 s; new rows flash yellow. Ideal for proving in the presentation that events are saved |

Run `demo.bat` while the dashboard is open to watch it update.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page layout |
| `app.js` | Login, API calls, refresh |
| `style.css` | Look, works on phones too |

The dashboard uses only the API, with the same role checks as Swagger UI.
