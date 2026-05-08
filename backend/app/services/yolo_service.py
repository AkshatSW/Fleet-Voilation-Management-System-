"""Stop-sign detection — low-latency configuration for safety-critical use.

  Model : YOLOv8n (nano)     — ~3x faster than yolov8s on CPU
  Export: ONNX @ imgsz=480   — one-time ~20s export, cached
  Target: <100ms inference on modern CPUs

First request after a fresh model file: ~20s to export ONNX.
Every request after that: pure inference.
"""

import io
import os
import time
from pathlib import Path
from threading import Lock

from PIL import Image

_model = None
_lock = Lock()

STOP_SIGN_CLASS_ID = 11   
CONFIDENCE = 0.25
IMGSZ = 320               # aggressive: yolov8n @ 320 runs ~30-50ms on CPU, still recognizes stop signs fine
MODEL_NAME = "yolov8n.pt"   # nano — smaller/faster than yolov8s; plenty for stop signs

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_PT_PATH = _BACKEND_ROOT / MODEL_NAME
_MODEL_DIR = _BACKEND_ROOT / "models"
_MODEL_DIR.mkdir(exist_ok=True)
_ONNX_PATH = _MODEL_DIR / f"{Path(MODEL_NAME).stem}-{IMGSZ}.onnx"


def _export_onnx_if_needed() -> Path:
    """One-time export .pt -> .onnx. Runtime cost ~15-20s. Cached across boots."""
    if _ONNX_PATH.exists():
        return _ONNX_PATH
    from ultralytics import YOLO
    # Ultralytics auto-downloads yolov8n.pt from the hub if not on disk.
    pt = YOLO(str(_PT_PATH) if _PT_PATH.exists() else MODEL_NAME)
    exported = pt.export(format="onnx", imgsz=IMGSZ, simplify=True, dynamic=False, opset=12)
    exported_path = Path(exported)
    if exported_path != _ONNX_PATH:
        try:
            os.replace(exported_path, _ONNX_PATH)
        except OSError:
            return exported_path
    return _ONNX_PATH


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            from ultralytics import YOLO
            try:
                onnx_path = _export_onnx_if_needed()
                _model = YOLO(str(onnx_path))
                print(f"[yolo] loaded ONNX: {onnx_path.name}")
            except Exception as e:
                print(f"[yolo] ONNX path failed ({e}); falling back to .pt")
                _model = YOLO(str(_PT_PATH) if _PT_PATH.exists() else MODEL_NAME)
    return _model


def detect_stop_signs(image_bytes: bytes, confidence: float = CONFIDENCE, imgsz: int = IMGSZ) -> dict:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    t0 = time.perf_counter()
    results = _get_model().predict(
        source=img,
        conf=confidence,
        imgsz=imgsz,
        classes=[STOP_SIGN_CLASS_ID],
        verbose=False,
    )
    inference_ms = int((time.perf_counter() - t0) * 1000)

    detections = []
    if results:
        for box in results[0].boxes:
            conf = float(box.conf[0])
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
            detections.append({
                "class": "stop sign",
                "confidence": conf,
                "bbox": [x1, y1, x2 - x1, y2 - y1],
            })

    print(f"[yolo] {len(detections)} stop sign(s) in {inference_ms}ms, {img.width}x{img.height}")

    return {
        "detections": detections,
        "inference_ms": inference_ms,
        "image_size": [img.width, img.height],
    }


def warm_up() -> None:
    try:
        _get_model()
        print("[yolo] ready")
    except Exception as e:
        print(f"[yolo] warm-up failed: {e}")
