"""Request/response bodies. Pydantic validates every field before our code runs."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
RFID = r"^[0-9A-Fa-f]{8,20}$"

Door = Literal["ENTRY", "EXIT"]
Decision = Literal["GRANTED", "DENIED"]
Reason = Literal["OK", "UNKNOWN_TAG", "INACTIVE_USER", "OUTSIDE_SCHEDULE",
                 "ALREADY_INSIDE", "NOT_INSIDE", "EMERGENCY_OPEN",
                 "OK_AFTER_HOURS"]                      # exit after hours: MQTT entrance controller
Role = Literal["STUDENT", "STAFF", "LECTURER", "SECURITY", "VISITOR"]
Trigger = Literal["PERSON_IN", "PERSON_OUT", "COUNT_RESET", "MANUAL_OVERRIDE", "SCHEDULE", "EMERGENCY",
                  "MOTION", "NO_MOTION"]               # last two: PIR rooms of the MQTT controller


class _Upper(BaseModel):
    @field_validator("rfid_uid", mode="before", check_fields=False)
    @classmethod
    def upper(cls, v):
        return v.upper() if isinstance(v, str) else v


# ---------- device (ESP32) bodies ----------------------------------------

class AccessCheck(_Upper):
    event_uuid: str = Field(..., min_length=8, max_length=64, examples=["01-000123"])
    rfid_uid: str = Field(..., pattern=RFID, examples=["A1B2C3D4"])
    door: Door = Field(..., examples=["ENTRY"])
    occurred_at: datetime = Field(..., examples=["2026-10-30T09:00:00"],
                                  description="Must fall inside the schedule, e.g. a weekday at 09:00")


class OfflineAccessEvent(AccessCheck):
    decision: Decision = Field(..., examples=["GRANTED"])
    reason: Reason = Field(..., examples=["OK"])


class RoomStatus(BaseModel):
    event_uuid: str = Field(..., min_length=8, max_length=64, examples=["01-R00001"])
    room_code: Literal["LR1", "LR2"] = Field(..., examples=["LR1"])
    occupant_count: int = Field(..., ge=0, le=1000, examples=[12],
                                description="People in the room, from the IR beam counter")
    light_on: bool = Field(..., examples=[True])
    trigger: Trigger = Field(..., examples=["PERSON_IN"])
    occurred_at: datetime = Field(..., examples=["2026-10-30T09:05:00"])


class EventBatch(BaseModel):
    access_events: list[OfflineAccessEvent] = Field(default_factory=list, max_length=200)
    room_events: list[RoomStatus] = Field(default_factory=list, max_length=200)


class Heartbeat(BaseModel):
    firmware_version: Optional[str] = Field(None, examples=["1.0.0"])
    ip_address: Optional[str] = Field(None, examples=["10.13.37.2"])
    free_heap: Optional[int] = Field(None, examples=[182000])
    sd_free_kb: Optional[int] = Field(None, examples=[950000])
    pending_events: Optional[int] = Field(0, examples=[0])


# ---------- management bodies ---------------------------------------------

class Login(BaseModel):
    username: str = Field(..., examples=["admin"])
    password: str = Field(..., examples=["Admin@CoCIS2026"])


class UserCreate(_Upper):
    rfid_uid: str = Field(..., pattern=RFID, examples=["99AA88BB"])
    full_name: str = Field(..., min_length=2, max_length=100, examples=["Test Student"])
    reg_number: Optional[str] = Field(None, examples=["24/U/0001"])
    email: Optional[str] = Field(None, examples=["test.student@students.mak.ac.ug"])
    phone: Optional[str] = None
    role: Role = "STUDENT"
    department: Optional[str] = Field(None, examples=["Computer Science"])


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
    day_of_week: int = Field(..., ge=0, le=6, examples=[1], description="0 = Sunday to 6 = Saturday")
    is_open: bool = Field(..., examples=[True])
    open_time: str = Field(..., pattern=HHMM, examples=["07:00"])
    close_time: str = Field(..., pattern=HHMM, examples=["22:00"])


class ScheduleUpdate(BaseModel):
    days: list[ScheduleDay] = Field(..., min_length=1, max_length=7)


class EmergencyUpdate(BaseModel):
    enabled: bool = Field(..., examples=[True])
    reason: str = Field(..., min_length=3, max_length=200, examples=["Fire drill"])


class SettingsUpdate(BaseModel):
    light_off_delay_s: Optional[int] = Field(None, ge=10, le=3600, examples=[30])
    heartbeat_interval_s: Optional[int] = Field(None, ge=10, le=3600, examples=[60])


class LightMode(BaseModel):
    mode: Literal["AUTO", "FORCE_ON", "FORCE_OFF"] = Field(..., examples=["AUTO"])
