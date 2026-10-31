"""CoCIS Smart Control & Monitoring System: REST API.

Run:  .venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
Docs: http://localhost:8000/docs   (interactive Swagger UI)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import init_db, now_iso
from .routes_admin import router as admin_router
from .routes_device import router as device_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="CoCIS Smart Control & Monitoring API",
    version="1.0.0",
    description="Database API for the ESP32 access-control, occupancy and lighting system "
                "(Embedded Systems coursework, Makerere University, 2026/2027).",
    lifespan=lifespan,
)
app.include_router(device_router)
app.include_router(admin_router)


@app.get("/api/v1/health", tags=["Health"])
def health():
    return {"status": "ok", "time": now_iso()}
