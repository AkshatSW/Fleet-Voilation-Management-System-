from datetime import datetime, date
from enum import Enum

from pydantic import BaseModel, ConfigDict


class ReviewStatus(str, Enum):
    pending = "pending"
    under_review = "under_review"
    confirmed = "confirmed"
    dismissed = "dismissed"


class ViolationCreate(BaseModel):
    driver_id: int
    vehicle_id: int
    event_type: str
    severity: str
    penalty_points: int | None = None
    timestamp: datetime
    latitude: float | None = None
    longitude: float | None = None
    speed: int | None = None
    video_url: str | None = None


class ViolationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    driver_id: int
    vehicle_id: int
    driver_name: str | None = None
    vehicle_plate: str | None = None
    event_type: str
    severity: str
    penalty_points: int
    timestamp: datetime
    latitude: float | None = None
    longitude: float | None = None
    speed: int | None = None
    video_url: str | None = None
    snapshot_url: str | None = None
    clip_url: str | None = None
    review_status: str | None = "pending"
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    review_notes: str | None = None
    created_at: datetime | None = None


class ViolationListResponse(BaseModel):
    items: list[ViolationResponse]
    total: int
    page: int
    page_size: int
    pages: int


class ViolationReviewUpdate(BaseModel):
    review_status: ReviewStatus
    review_notes: str | None = None


class ViolationClipUpdate(BaseModel):
    clip_url: str


class WebhookPayload(BaseModel):
    driver_id: int
    vehicle_id: int
    event_type: str
    severity: str
    timestamp: datetime
    camera_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    speed: int | None = None
    video_url: str | None = None
    snapshot_url: str | None = None
    clip_url: str | None = None
