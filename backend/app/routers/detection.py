from fastapi import APIRouter, UploadFile, File, Depends, HTTPException

from app.dependencies import get_current_user
from app.models.user import User
from app.services import yolo_service, seatbelt_service

router = APIRouter(prefix="/api/detect", tags=["detection"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


def _validate_image_upload(file: UploadFile) -> None:
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {file.content_type}",
        )


@router.post("/stop-sign")
async def detect_stop_sign(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """YOLOv8 stop-sign / traffic-light detection on an uploaded frame."""
    _validate_image_upload(file)
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Frame too large")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    try:
        return yolo_service.detect_stop_signs(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {e}")


@router.post("/seatbelt")
async def detect_seatbelt(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Two-stage 3-point seatbelt detection: YOLOv5 (custom) + Keras MobileNetV2."""
    _validate_image_upload(file)
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Frame too large")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty upload")
    try:
        return seatbelt_service.detect_seatbelt(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Seatbelt detection failed: {e}")
