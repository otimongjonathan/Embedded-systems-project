"""CoCIS Smart Control & Monitoring System: REST API.

Run (Windows):      start.bat
Run (macOS/Linux):  ./start.sh
Docs: http://localhost:8000/docs   (interactive Swagger UI)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from .db import init_db, now_iso
from .routes_admin import router as admin_router
from .routes_device import router as device_router

DESCRIPTION = """
Database API for the ESP32 access-control, occupancy and lighting system
(Embedded Systems coursework, Makerere University, 2026/2027).

## How to test it here

1. Click **Authorize** (top right, padlock icon).
2. Under **AdminLogin** enter username `admin` and password `Admin@CoCIS2026`
   (leave client_id and client_secret empty) and click **Authorize**.
3. Under **DeviceKey** enter `esp32-demo-key-change-me` and click **Authorize**. Close the dialog.
4. Open any endpoint, click **Try it out**, then **Execute**. The example bodies are ready to send.

A good first run: `POST /api/v1/device/access/check` (Lisa Nyonyozi scans in),
then `GET /api/v1/occupancy` (she is listed as inside).
Change `event_uuid` before sending a scan again: a repeated `event_uuid` is treated as a
duplicate upload and returns the first answer with `"duplicate": true`.

## Demo data

| What | Value |
|------|-------|
| Admin login (SUPER_ADMIN) | `admin` / `Admin@CoCIS2026` |
| ESP32 device key | `esp32-demo-key-change-me` |
| RFID tags | `A1B2C3D4` student, `11223344` lecturer, `DEADBEEF` security, `CAFEBABE` visitor |
| Opening hours | Mon to Fri 07:00 to 22:00, Sat 08:00 to 17:00, Sun closed |

Scans outside the opening hours are refused with `OUTSIDE_SCHEDULE`, so keep `occurred_at` on a weekday at 09:00.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="CoCIS Smart Control & Monitoring API",
    version="1.0.0",
    description=DESCRIPTION,
    lifespan=lifespan,
    # keep the login after a page refresh, and show how long each request took
    swagger_ui_parameters={"persistAuthorization": True, "displayRequestDuration": True},
)
app.include_router(device_router)
app.include_router(admin_router)


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/docs")


@app.get("/api/v1/health", tags=["Health"])
def health():
    return {"status": "ok", "time": now_iso()}
