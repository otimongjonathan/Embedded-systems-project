"""Request/response bodies. Pydantic validates every field before our code runs."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
RFID = r"^[0-9A-Fa-f]{8,20}$"

Door = Literal["ENTRY", "EXIT"]
Decision = Literal["GRANTED", "DENIED"]
Reason = Literal["OK", "UNKNOWN_TAG", "INACTIVE_USER", "OUTSIDE_SCHEDULE",
                 "ALREADY_INSIDE", "NOT_INSIDE", "EMERGENCY_OPEN"]
Role = Literal["STUDENT", "STAFF", "LECTURER", "SECURITY", "VISITOR"]
Trigger = Literal["PERSON_IN", "PERSON_OUT", "COUNT_RESET", "MANUAL_OVERRIDE", "SCHEDULE", "EMERGENCY"]


class _Upper(BaseModel):
    @field_validator("rfid_uid", mode="before", check_fields=False)
    @classmethod
    def upper(cls, v):
        return v.upper() if isinstance(v, str) else v


# ---------- device (ESP32) bodies ----------------------------------------

class AccessCheck(_Upper):
    event_uuid: str = Field(..., min_length=8, max_length=64, examples=["01-000123"])
    rfid_uid: str = Field(..., pattern=RFID, examples=["A1B2C3D4"])
    door: Door
    occurred_at: datetime = Field(..., examples=["2026-10-30T08:15:02"])


class OfflineAccessEvent(AccessCheck):
    decision: Decision
    reason: Reason


class RoomStatus(BaseModel):
    event_uuid: str = Field(..., min_length=8, max_length=64)
    room_code: Literal["LR1", "LR2"]
    occupant_count: int = Field(..., ge=0, le=1000, description="People in the room, from the IR beam counter")
    light_on: bool
    trigger: Trigger
    occurred_at: datetime


class EventBatch(BaseModel):
    access_events: list[OfflineAccessEvent] = Field(default_factory=list, max_length=200)
    room_events: list[RoomStatus] = Field(default_factory=list, max_length=200)


class Heartbeat(BaseModel):
    firmware_version: Optional[str] = None
    ip_address: Optional[str] = None
    free_heap: Optional[int] = None
    sd_free_kb: Optional[int] = None
    pending_events: Optional[int] = 0


# ---------- management bodies ---------------------------------------------

class Login(BaseModel):
    username: str
    password: str


class UserCreate(_Upper):
    rfid_uid: str = Field(..., pattern=RFID)
    full_name: str = Field(..., min_length=2, max_length=100)
    reg_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Role = "STUDENT"
    department: Optional[str] = None


class UserUpdate(_Upper):
    rfid_uid: Optional[str] = Field(None, pattern=RFID)
    full_name: Optional[str] = Field(None, min_length=2, max_length=100)
    reg_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[Role] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None


class ScheduleDay(BaseModel):
    day_of_week: int = Field(..., ge=0, le=6, description="0 = Sunday … 6 = Saturday")
    is_open: bool
    open_time: str = Field(..., pattern=HHMM)
    close_time: str = Field(..., pattern=HHMM)


class ScheduleUpdate(BaseModel):
    days: list[ScheduleDay] = Field(..., min_length=1, max_length=7)


class EmergencyUpdate(BaseModel):
    enabled: bool
    reason: str = Field(..., min_length=3, max_length=200)


class SettingsUpdate(BaseModel):
    light_off_delay_s: Optional[int] = Field(None, ge=10, le=3600)
    heartbeat_interval_s: Optional[int] = Field(None, ge=10, le=3600)


class LightMode(BaseModel):
    mode: Literal["AUTO", "FORCE_ON", "FORCE_OFF"]
