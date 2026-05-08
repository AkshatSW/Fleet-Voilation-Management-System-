import math
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from app.database import get_db
from app.dependencies import get_current_user
from app.core.permissions import require_admin
from app.config import settings
from app.models.violation import Violation
from app.models.driver import Driver
from app.models.vehicle import Vehicle
from app.models.user import User
from app.models.camera import Camera
from app.schemas.violation import (
    ViolationCreate, ViolationResponse, ViolationListResponse, ViolationReviewUpdate,
    ViolationClipUpdate, ViolationSnapshotUpdate,
)
from app.services.scoring_engine import get_penalty_points, calculate_monthly_score

router = APIRouter(prefix="/api/violations", tags=["violations"])


def _violation_to_response(v: Violation) -> ViolationResponse:
    return ViolationResponse(
        id=v.id,
        driver_id=v.driver_id,
        vehicle_id=v.vehicle_id,
        driver_name=v.driver.name if v.driver else None,
        vehicle_plate=v.vehicle.plate_number if v.vehicle else None,
        event_type=v.event_type,
        severity=v.severity,
        penalty_points=v.penalty_points,
        timestamp=v.timestamp,
        latitude=v.latitude,
        longitude=v.longitude,
        speed=v.speed,
        video_url=v.video_url,
        snapshot_url=v.snapshot_url,
        clip_url=v.clip_url,
        review_status=v.review_status,
        reviewed_by=v.reviewed_by,
        reviewed_at=v.reviewed_at,
        review_notes=v.review_notes,
        created_at=v.created_at,
    )


@router.get("/stats")
def get_violation_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    first_of_month = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total_this_month = (
        db.query(func.count(Violation.id))
        .filter(Violation.timestamp >= first_of_month)
        .scalar()
    )
    by_type = (
        db.query(Violation.event_type, func.count(Violation.id).label("count"))
        .filter(Violation.timestamp >= first_of_month)
        .group_by(Violation.event_type)
        .all()
    )
    return {
        "total_this_month": total_this_month,
        "by_type": {r.event_type: r.count for r in by_type},
    }


@router.get("", response_model=ViolationListResponse)
def list_violations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    event_type: str | None = Query(None),
    severity: str | None = Query(None),
    driver_id: int | None = Query(None),
    review_status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    sort_by: str = Query("timestamp"),
    sort_order: str = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Violation)
    if event_type:
        q = q.filter(Violation.event_type == event_type)
    if severity:
        q = q.filter(Violation.severity == severity)
    if driver_id:
        q = q.filter(Violation.driver_id == driver_id)
    if review_status:
        q = q.filter(Violation.review_status == review_status)
    if date_from:
        q = q.filter(Violation.timestamp >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.filter(Violation.timestamp <= datetime.combine(date_to, datetime.max.time()))

    total = q.count()

    sort_col = getattr(Violation, sort_by, Violation.timestamp)
    if sort_order == "asc":
        q = q.order_by(sort_col)
    else:
        q = q.order_by(desc(sort_col))

    violations = q.offset((page - 1) * page_size).limit(page_size).all()
    items = [_violation_to_response(v) for v in violations]
    return ViolationListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        pages=math.ceil(total / page_size) if total > 0 else 0,
    )


@router.get("/{violation_id}", response_model=ViolationResponse)
def get_violation(
    violation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    v = db.query(Violation).filter(Violation.id == violation_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found")
    return _violation_to_response(v)


@router.post("", response_model=ViolationResponse, status_code=201)
def create_violation(
    data: ViolationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    penalty = data.penalty_points if data.penalty_points else get_penalty_points(data.event_type)
    v = Violation(
        driver_id=data.driver_id,
        vehicle_id=data.vehicle_id,
        event_type=data.event_type,
        severity=data.severity,
        penalty_points=penalty,
        timestamp=data.timestamp,
        latitude=data.latitude,
        longitude=data.longitude,
        speed=data.speed,
        video_url=data.video_url,
        snapshot_url=data.snapshot_url,
        clip_url=data.clip_url,
    )
    db.add(v)
    db.commit()
    db.refresh(v)

    month_str = v.timestamp.strftime("%Y-%m")
    calculate_monthly_score(db, v.driver_id, month_str)

    return _violation_to_response(v)


@router.patch("/{violation_id}/review", response_model=ViolationResponse)
def review_violation(
    violation_id: int,
    data: ViolationReviewUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    v = db.query(Violation).filter(Violation.id == violation_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found")

    old_status = v.review_status
    v.review_status = data.review_status.value
    v.reviewed_by = current_user.id
    v.reviewed_at = datetime.now()
    if data.review_notes is not None:
        v.review_notes = data.review_notes

    db.commit()
    db.refresh(v)

    # Recalculate score if status changed to/from dismissed
    if old_status != v.review_status and ("dismissed" in [old_status, v.review_status]):
        month_str = v.timestamp.strftime("%Y-%m")
        calculate_monthly_score(db, v.driver_id, month_str)

    return _violation_to_response(v)


@router.patch("/{violation_id}/clip")
def update_violation_clip(
    violation_id: int,
    data: ViolationClipUpdate,
    x_api_key: str = Header(...),
    db: Session = Depends(get_db),
):
    # Accept global webhook key or per-camera key
    if x_api_key != settings.WEBHOOK_API_KEY:
        camera = db.query(Camera).filter(Camera.api_key == x_api_key).first()
        if not camera:
            raise HTTPException(status_code=401, detail="Invalid API key")
    violation = db.query(Violation).filter(Violation.id == violation_id).first()
    if not violation:
        raise HTTPException(status_code=404, detail="Violation not found")
    violation.clip_url = data.clip_url
    db.commit()
    return {"status": "ok"}


@router.patch("/{violation_id}/snapshot")
def update_violation_snapshot(
    violation_id: int,
    data: ViolationSnapshotUpdate,
    x_api_key: str = Header(...),
    db: Session = Depends(get_db),
):
    """Attach a snapshot URL to an existing violation.

    Lets the frontend POST the violation first (instant UI feedback) and
    upload the snapshot in parallel, PATCHing the URL in when ready.
    """
    if x_api_key != settings.WEBHOOK_API_KEY:
        camera = db.query(Camera).filter(Camera.api_key == x_api_key).first()
        if not camera:
            raise HTTPException(status_code=401, detail="Invalid API key")
    violation = db.query(Violation).filter(Violation.id == violation_id).first()
    if not violation:
        raise HTTPException(status_code=404, detail="Violation not found")
    violation.snapshot_url = data.snapshot_url
    db.commit()
    return {"status": "ok"}
