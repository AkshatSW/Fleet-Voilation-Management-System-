import os
import uuid
from datetime import datetime

from fastapi import APIRouter, UploadFile, File, Header, HTTPException, Depends
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.camera import Camera

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = settings.UPLOADS_DIR


def _validate_api_key(x_api_key: str, db=None):
    # Accept global webhook key or per-camera key
    if x_api_key == settings.WEBHOOK_API_KEY:
        return
    if db:
        camera = db.query(Camera).filter(Camera.api_key == x_api_key).first()
        if camera:
            return
    raise HTTPException(status_code=401, detail="Invalid API key")


def _save_file(upload_file: UploadFile, subfolder: str) -> str:
    folder = os.path.join(UPLOAD_DIR, subfolder)
    os.makedirs(folder, exist_ok=True)
    ext = os.path.splitext(upload_file.filename or "file")[1] or ".bin"
    filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(folder, filename)
    with open(filepath, "wb") as f:
        content = upload_file.file.read()
        f.write(content)
    return f"/uploads/{subfolder}/{filename}"


@router.post("/snapshot")
def upload_snapshot(
    file: UploadFile = File(...),
    x_api_key: str = Header(...),
    db: Session = Depends(get_db),
):
    _validate_api_key(x_api_key, db)
    url = _save_file(file, "snapshots")
    return {"url": url, "message": "Snapshot uploaded successfully"}


@router.post("/clip")
def upload_clip(
    file: UploadFile = File(...),
    x_api_key: str = Header(...),
    db: Session = Depends(get_db),
):
    _validate_api_key(x_api_key, db)
    url = _save_file(file, "clips")
    return {"url": url, "message": "Clip uploaded successfully"}
