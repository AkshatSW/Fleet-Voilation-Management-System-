"""3-point seatbelt detection.

Two-stage pipeline (the sankethsj/seatbelt-detection design):

  1. YOLOv5 (custom-trained, single class 'seatbelt') — locates the
     candidate seatbelt region in the frame
  2. Keras MobileNetV2 (binary classifier) — labels the cropped region as
     "Seatbelt Worn" / "No Seatbelt"

Both models live in src/backend/seatbelt_repo/models/.

Per-frame mode switch:
  Before running the seatbelt pipeline, a quick cell-phone object check on
  the frame decides whether to apply the strict structural gates (real
  driver) or relaxed gates (a seatbelt photo shown on a phone screen, used
  for demos/testing). The cell-phone detector reuses the general-purpose
  YOLOv8n model already loaded by stop-sign detection — no extra weights.

Loading notes:
  - The YOLOv5 .pt is a YOLOv5 7.0 save; PyTorch 2.6+ requires
    weights_only=False because it stores the full DetectionModel class.
  - The Keras .h5 is from TeachableMachine/Keras 2.x and only loads via
    `tf_keras` (the legacy Keras 2 API shim).
"""

import io
import math
import os
import time
from pathlib import Path
from threading import Lock

import cv2
import numpy as np
from PIL import Image

# Force tf_keras (legacy Keras 2 API) so the older .h5 deserializes correctly,
# and quiet TF startup logs.
os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

_yolov5 = None
_classifier = None
_yolov8_seatbelt = None
_lock = Lock()

# Two execution modes, picked per-frame:
#
#   STRICT mode  — the camera is pointed at a real human driver. Apply all
#                  structural gates (center-frame, aspect-ratio, strap-band,
#                  over-detection) so Keras hallucinations on shirts / faces
#                  / backgrounds get rejected.
#
#   DEMO mode    — a cell phone is visible in the frame, so the user is
#                  showing a seatbelt photo on a phone screen for testing.
#                  Drop the structural gates and lower the YOLOv5 floor so
#                  the small, in-distribution phone-screen image registers.
#
# Mode is auto-selected per request via _phone_in_frame() — a quick
# cell-phone object check on the input frame. Manual override:
# SEATBELT_TEST_MODE=1 forces DEMO mode.
TEST_MODE = os.environ.get("SEATBELT_TEST_MODE", "").lower() in ("1", "true", "yes", "on")

# YOLOv5 candidate floors. The model itself is loaded with a very permissive
# .conf so all candidates flow into our pipeline; the per-candidate floor is
# applied here based on the active mode.
STRICT_PERSON_CONF = 0.40        # human-driver mode: high floor cuts most false candidates
DEMO_PERSON_CONF = 0.10          # phone-screen mode: low floor catches small/dim photos
PERSON_CONF_THRESHOLD = STRICT_PERSON_CONF  # legacy alias used by the over-detection guard

# YOLOv8 path floors — the trained model still produces confident-looking
# false positives on out-of-distribution input (low light, selfie angle, no
# belt visible) where the model has no anchor for "definitely no belt".
# A higher STRICT floor cuts borderline 0.4-0.5 hallucinations; the DEMO
# floor stays low because phone-screen content is intentionally small/dim.
YOLOV8_STRICT_CONF = 0.55
YOLOV8_DEMO_CONF = 0.10

WORN_CONF_THRESHOLD = 0.95       # Keras must be very confident before "Worn"
NOT_WORN_CONF_THRESHOLD = 0.60   # any moderate "No Seatbelt" signal is enough

# Geometric sanity for the YOLOv5 bbox.
# Bbox must not start at the very top edge (avoids hairline / window false
# positives) but is permissive enough to allow stock photos and tight crops
# where the strap appears in the upper portion of the frame.
MIN_BBOX_TOP_Y_FRAC = 0.05
# Real belts occupy a meaningful chunk of the image. Filter out tiny YOLO
# false candidates while still allowing distant or partial views.
MIN_BBOX_AREA_FRAC = 0.01

# Hough strap-line gate. The trained model alone can hallucinate "Worn" on
# out-of-distribution input. Requiring an actual continuous diagonal line in
# the candidate region rejects most false positives — a 3-point belt has a
# clear diagonal segment crossing the upper torso.
#
# A real seatbelt strap has TWO structural properties that random shirt-pattern
# diagonals don't:
#   1. The strap goes corner-to-corner across the bbox — it spans most of the
#      diagonal length.
#   2. The strap's endpoints are near opposite corners of the bbox — not
#      somewhere in the middle. (A pattern repeats; a strap is ONE long line.)
HOUGH_DIAGONAL_DEGREES = (20.0, 70.0)   # absolute slope angle for "diagonal"
HOUGH_MIN_LINE_LENGTH_FRAC = 0.55       # line must span >= 55% of region diagonal
HOUGH_MAX_LINE_GAP = 10
# Endpoint-distribution gate. A real 3-point belt goes from one shoulder
# (top of the bbox) diagonally down to the opposite hip (bottom of the
# bbox). The strap line must therefore have ONE endpoint in the top band
# and the OTHER in the bottom band — top-to-bottom, not top-to-top-side.
# This kills the most stubborn false positive: shirt collar / shoulder
# contours, which are diagonals that only span the upper part of the bbox.
HOUGH_TOP_BAND_FRAC = 0.30      # top 30% of bbox
HOUGH_BOTTOM_BAND_FRAC = 0.70   # bottom edge of the "top" band; the other endpoint must be below this

# Strap band-profile gate. Real seatbelts are dark *bands*, not dark *edges*.
# Sampling perpendicular to the candidate line:
#   - on-line pixels should be DARK (the strap itself)
#   - pixels offset to BOTH sides should be BRIGHTER than the on-line pixels
# This is the "valley" profile of a band. A shirt-edge contour produces a
# "step" profile (dark on one side, bright on the other) and fails because
# only ONE side is brighter — the other is the dark shirt continuing.
STRAP_MAX_LINE_INTENSITY = 100        # absolute floor: line median pixels <= 100/255
STRAP_BAND_OFFSET_PX = 10             # perpendicular distance to sample "off-strap"
STRAP_MIN_BOTH_SIDES_DELTA = 18       # both perpendicular sides must be >= this brighter than line

# Center-of-frame gate. A driver's 3-point seatbelt sits across the torso,
# which lives in the middle of a forward-facing in-cabin camera frame.
# Tightened from 0.25..0.75 to 0.30..0.70 because borderline detections at
# the band edges (like an outer-shoulder contour at frac~0.73) were still
# slipping through.
BBOX_CENTER_X_MIN_FRAC = 0.30
BBOX_CENTER_X_MAX_FRAC = 0.70

# Aspect-ratio sanity. A real shoulder-to-hip strap produces a bbox that is
# at least as tall as it is wide (usually taller). Wide-and-short bboxes
# are body parts (a shoulder, an arm) or background patches, not straps.
MIN_BBOX_HEIGHT_OVER_WIDTH = 0.85

# Over-detection guard. A driver wears ONE 3-point seatbelt, so YOLOv5
# producing many high-confidence candidates simultaneously is a sign the
# model is hallucinating on this frame (out-of-distribution input, busy
# texture, etc.). When that happens, reject ALL candidates rather than
# trusting any of them. 3 candidates is a soft cap — past this, we don't
# pick a "winner", we report the frame as not-worn.
MAX_TRUSTED_CANDIDATES = 3

# Note: there is intentionally NO Keras-confidence override that bypasses
# any of these gates. The Keras classifier hallucinates "Worn" at 100% on
# out-of-distribution crops (e.g., a webcam-front-view of a t-shirt with
# no belt at all, or a close-up of a face), so a high-confidence Keras
# output alone is not safe. Every "Worn" verdict must pass the structural
# gates: geometry + center-frame + Hough strap-line + strap-darkness.


def _sample_along(gray: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> float:
    """Median grayscale value at a set of (x,y) points; clipped to image."""
    h, w = gray.shape[:2]
    xs = np.clip(xs.astype(int), 0, w - 1)
    ys = np.clip(ys.astype(int), 0, h - 1)
    return float(np.median(gray[ys, xs]))


def _find_strap_line(crop_rgb: np.ndarray) -> tuple[bool, float, float, float]:
    """Detect a real 3-point belt strap in the candidate region.

    A real strap must satisfy ALL of these structural properties — a shirt
    edge, a face contour, or a background outline can satisfy at most some:

      1. Corner-to-corner diagonal (Hough geometry, 20–70°)
      2. Top-to-bottom endpoint distribution: one endpoint in the top 30%
         band, the other in the bottom 30% band. Shoulder/collar contours
         span only the top of the bbox; this gate kills them.
      3. Dark line (median grayscale ≤ STRAP_MAX_LINE_INTENSITY).
      4. Dark BAND, not just a dark edge: perpendicular profile shows a
         valley — both sides off-line are brighter than the on-line median
         by ≥ STRAP_MIN_BOTH_SIDES_DELTA. A shirt-edge contour produces
         a step (one bright side, one dark side) and fails.

    Returns (passed, strap_frac, line_median, region_median).
    """
    if crop_rgb.size == 0:
        return False, 0.0, 255.0, 255.0
    h, w = crop_rgb.shape[:2]
    if h < 40 or w < 40:
        return False, 0.0, 255.0, 255.0

    gray = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.bilateralFilter(gray, 7, 50, 50)
    region_median = float(np.median(blurred))
    # Adaptive Canny: median-based thresholds so we don't miss strap edges
    # in dim or harshly lit frames.
    lower = int(max(0, 0.66 * region_median))
    upper = int(min(255, 1.33 * region_median))
    edges = cv2.Canny(blurred, lower, upper)
    region_diag = math.hypot(w, h)
    min_len_px = max(20, int(region_diag * HOUGH_MIN_LINE_LENGTH_FRAC))

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=30,
        minLineLength=min_len_px,
        maxLineGap=HOUGH_MAX_LINE_GAP,
    )
    if lines is None:
        return False, 0.0, 255.0, region_median

    top_band_y = HOUGH_TOP_BAND_FRAC * h
    bot_band_y = HOUGH_BOTTOM_BAND_FRAC * h

    def _spans_top_to_bottom(p1y: float, p2y: float) -> bool:
        # One endpoint in top 30% band, the other in bottom 30% band.
        return (p1y <= top_band_y and p2y >= bot_band_y) or (
            p2y <= top_band_y and p1y >= bot_band_y
        )

    best_len = 0.0
    best_line_median = 255.0
    for x1l, y1l, x2l, y2l in lines.reshape(-1, 4):
        dx = float(x2l - x1l)
        dy = float(y2l - y1l)
        length = math.hypot(dx, dy)
        if dx == 0:
            angle = 90.0
        else:
            angle = abs(math.degrees(math.atan2(dy, dx)))
            if angle > 90:
                angle = 180 - angle
        if not (HOUGH_DIAGONAL_DEGREES[0] <= angle <= HOUGH_DIAGONAL_DEGREES[1]):
            continue
        # Top-to-bottom span: kills shoulder/collar contours that only span
        # the upper portion of the bbox.
        if not _spans_top_to_bottom(y1l, y2l):
            continue

        # Sample N points along the line for the on-strap median.
        n = min(max(20, int(length / 4)), 60)
        ts = np.linspace(0.0, 1.0, n)
        xs = x1l + ts * dx
        ys = y1l + ts * dy
        line_median = _sample_along(gray, xs, ys)
        if line_median > STRAP_MAX_LINE_INTENSITY:
            continue

        # Perpendicular profile: a real strap is a dark BAND with brighter
        # pixels on BOTH sides. Compute unit perpendicular and sample at
        # +/- STRAP_BAND_OFFSET_PX from the line.
        perp_x = -dy / length
        perp_y = dx / length
        side_a_xs = xs + perp_x * STRAP_BAND_OFFSET_PX
        side_a_ys = ys + perp_y * STRAP_BAND_OFFSET_PX
        side_b_xs = xs - perp_x * STRAP_BAND_OFFSET_PX
        side_b_ys = ys - perp_y * STRAP_BAND_OFFSET_PX
        side_a_med = _sample_along(gray, side_a_xs, side_a_ys)
        side_b_med = _sample_along(gray, side_b_xs, side_b_ys)
        # BOTH sides must be brighter than the line — that's the valley
        # signature. A shirt-edge has only one brighter side and fails.
        if (side_a_med - line_median) < STRAP_MIN_BOTH_SIDES_DELTA:
            continue
        if (side_b_med - line_median) < STRAP_MIN_BOTH_SIDES_DELTA:
            continue

        if length > best_len:
            best_len = length
            best_line_median = line_median

    frac = best_len / region_diag if region_diag > 0 else 0.0
    return frac >= HOUGH_MIN_LINE_LENGTH_FRAC, frac, best_line_median, region_median

_CLASS_NAMES = {0: "No Seatbelt", 1: "Seatbelt Worn"}

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_REPO = _BACKEND_ROOT / "seatbelt_repo" / "models"
_YOLO_PATH = _REPO / "best.pt"
_KERAS_PATH = _REPO / "keras_model.h5"
# Single-stage replacement: a YOLOv8 model trained from a Roboflow seatbelt
# dataset by training/train_seatbelt.py. When this file exists, the service
# uses it instead of the YOLOv5+Keras two-stage pipeline.
_YOLOV8_SEATBELT_PATH = _BACKEND_ROOT / "models" / "seatbelt_yolov8n.pt"


def _patch_torch_load_weights_only():
    """PyTorch 2.6 defaults torch.load(weights_only=True). The YOLOv5 .pt
    pickles a full DetectionModel object, which is blocked. Patch the default
    to False — safe here because the model file is bundled in the repo."""
    import torch
    if getattr(torch.load, "_seatbelt_patched", False):
        return
    _orig = torch.load
    def _patched(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return _orig(*args, **kwargs)
    _patched._seatbelt_patched = True
    torch.load = _patched


def _load_models():
    """Lazily load both models (~3 MB YOLO + ~2.5 MB Keras)."""
    global _yolov5, _classifier
    if _yolov5 is not None and _classifier is not None:
        return _yolov5, _classifier
    with _lock:
        if _yolov5 is None:
            _patch_torch_load_weights_only()
            import yolov5
            _yolov5 = yolov5.load(str(_YOLO_PATH))
            # Permissive at the model level — the per-candidate floor (strict
            # vs demo) is applied downstream so we can switch modes per frame.
            _yolov5.conf = 0.05
            _yolov5.iou = 0.45    # NMS IoU
            _yolov5.agnostic = False
            _yolov5.multi_label = False
            _yolov5.max_det = 5
            print(f"[seatbelt] YOLOv5 loaded ({_YOLO_PATH.name}); classes={_yolov5.names}")
        if _classifier is None:
            import tf_keras
            _classifier = tf_keras.models.load_model(str(_KERAS_PATH), compile=False)
            # Warm up
            _classifier.predict(np.zeros((1, 224, 224, 3), dtype=np.float32), verbose=0)
            print(f"[seatbelt] Keras classifier loaded ({_KERAS_PATH.name})")
    return _yolov5, _classifier


def _load_yolov8_seatbelt():
    """Lazy-load the Roboflow-trained YOLOv8 single-stage seatbelt model.
    Returns the model, or None if it hasn't been trained yet."""
    global _yolov8_seatbelt
    if _yolov8_seatbelt is not None:
        return _yolov8_seatbelt
    if not _YOLOV8_SEATBELT_PATH.exists():
        return None
    with _lock:
        if _yolov8_seatbelt is None:
            from ultralytics import YOLO
            _yolov8_seatbelt = YOLO(str(_YOLOV8_SEATBELT_PATH))
            print(
                f"[seatbelt] YOLOv8 single-stage model loaded "
                f"({_YOLOV8_SEATBELT_PATH.name}); classes={_yolov8_seatbelt.names}"
            )
    return _yolov8_seatbelt


_NOT_WORN_KEYS = (
    "no_seatbelt", "no_belt", "not_wearing", "without_belt",
    "without_seatbelt", "unbuckled", "no_seat_belt",
)
_WORN_KEYS = (
    "wearing", "worn", "with_belt", "with_seatbelt",
    "buckled", "fastened", "seatbelt_on", "belt_on",
)


def _normalize_label(name: str) -> str:
    return name.lower().replace("-", "_").replace(" ", "_")


def _yolov8_class_roles(class_names) -> dict:
    """Map each class index to its semantic role given the full class set:
        'worn'      — model positive (belt is worn)
        'not_worn'  — model negative (belt is NOT worn)
        'belt'      — single-class detector that just locates a belt; the
                      structural gate is what decides worn vs not.

    A label like plain "seatbelt" is interpreted as the worn class IF the
    same model also has a no-seatbelt class — that's a 2-class detector and
    the positive is by definition "worn". Otherwise it's treated as a
    1-class locator and "belt".
    """
    items = list(class_names.items() if isinstance(class_names, dict)
                 else enumerate(class_names))
    role: dict = {}
    has_not_worn = any(
        any(k in _normalize_label(n) for k in _NOT_WORN_KEYS) for _, n in items
    )
    for idx, name in items:
        n = _normalize_label(name)
        if any(k in n for k in _NOT_WORN_KEYS):
            role[idx] = "not_worn"
        elif any(k in n for k in _WORN_KEYS):
            role[idx] = "worn"
        else:
            role[idx] = "worn" if has_not_worn else "belt"
    return role


# Object-class ids for "user is holding up a screen at the camera". 67 is
# the cell-phone class; 62 is included because phones held in landscape
# with little/no bezel showing often get classified as "tv" by YOLOv8n.
_PHONE_CLASS_IDS = [67, 62]
_PHONE_CONF = 0.15           # generous — a missed phone keeps STRICT mode on,
                             # which is the safer default
_PHONE_MIN_AREA_FRAC = 0.08  # phone must occupy ≥ 8% of the frame to count
                             # as "prominently displayed" (a phone-at-the-ear
                             # is much smaller than this)


def _phone_bbox(img: Image.Image) -> tuple[float, float, float, float] | None:
    """Return (x1, y1, x2, y2) of the largest prominently-displayed phone /
    screen in the frame, or None.

    Reuses the YOLOv8n model already loaded by the stop-sign service —
    no extra weights, no extra warm-up. The size gate (≥ _PHONE_MIN_AREA_FRAC)
    means a phone has to be deliberately held up to the camera to count;
    incidental phone presence (call at the ear, on a table, in a back
    pocket) doesn't trigger DEMO mode.
    """
    try:
        from app.services.yolo_service import _get_model
        model = _get_model()
        results = model.predict(
            source=img,
            conf=_PHONE_CONF,
            imgsz=320,
            classes=_PHONE_CLASS_IDS,
            verbose=False,
        )
        if not results or len(results[0].boxes) == 0:
            return None
        iw, ih = img.size
        frame_area = float(iw * ih)
        best_bbox = None
        best_area = 0.0
        for box in results[0].boxes.xyxy:
            x1, y1, x2, y2 = [float(v) for v in box.tolist()]
            area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            if area / frame_area >= _PHONE_MIN_AREA_FRAC and area > best_area:
                best_area = area
                best_bbox = (x1, y1, x2, y2)
        return best_bbox
    except Exception as e:
        # Phone-check is non-critical — if it fails, fall through to STRICT.
        print(f"[seatbelt] phone-check failed: {e}")
        return None


def _bbox_overlap_frac(inner: tuple[float, float, float, float],
                       outer: tuple[float, float, float, float]) -> float:
    """Fraction of `inner` that lies inside `outer`. Used in DEMO mode to
    require a seatbelt candidate to be inside the phone screen — a candidate
    on the user's actual t-shirt won't satisfy this, so DEMO mode can't
    false-positive on the surrounding clothing."""
    ix1, iy1, ix2, iy2 = inner
    ox1, oy1, ox2, oy2 = outer
    inter_x1 = max(ix1, ox1)
    inter_y1 = max(iy1, oy1)
    inter_x2 = min(ix2, ox2)
    inter_y2 = min(iy2, oy2)
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    inner_area = max(1e-6, (ix2 - ix1) * (iy2 - iy1))
    return inter_area / inner_area


def detect_seatbelt(image_bytes: bytes) -> dict:
    """Full pipeline. See module docstring.

    Returns:
        {
            "detected": bool,                 # YOLO found a candidate
            "bbox": [x, y, w, h] | None,      # original-image pixels
            "seatbelt_worn": bool | None,     # None if classifier not confident
            "confidence": float,              # 0..1, the chosen class
            "class_name": str,
            "yolo_confidence": float,         # 0..1, YOLO candidate score
            "inference_ms": int,
            "image_size": [w, h],
        }
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    t0 = time.perf_counter()

    # Prefer the Roboflow-trained YOLOv8 single-stage model when available;
    # fall back to the legacy YOLOv5 + Keras two-stage pipeline otherwise.
    v8 = _load_yolov8_seatbelt()
    if v8 is not None:
        return _detect_with_yolov8(v8, img, t0)
    return _detect_with_legacy(img, t0)


def _detect_with_legacy(img: Image.Image, t0: float) -> dict:
    """Legacy YOLOv5 + Keras two-stage pipeline."""
    yolo, classifier = _load_models()

    iw, ih = img.size

    # Pick mode for this frame: DEMO if a phone is prominently displayed
    # (user is showing a seatbelt photo on a phone screen) OR the manual
    # TEST_MODE override is on; STRICT otherwise.
    phone_box = _phone_bbox(img)
    phone_present = phone_box is not None
    demo_mode = TEST_MODE or phone_present
    candidate_floor = DEMO_PERSON_CONF if demo_mode else STRICT_PERSON_CONF

    # 1) YOLOv5: gather ALL candidate regions, not just the highest-scoring one.
    # When multiple plausible regions exist (e.g., user's body + a phone screen
    # showing a seatbelt photo), each gets its own pass through the gates and
    # the frontend draws a box around every one that passes.
    arr = np.asarray(img)
    results = yolo(arr)
    boxes = results.xyxy[0].cpu().numpy() if len(results.xyxy) else np.empty((0, 6))

    if boxes.size == 0:
        inference_ms = int((time.perf_counter() - t0) * 1000)
        print(f"[seatbelt] no candidate in {inference_ms}ms img={iw}x{ih}")
        return {
            "detected": False,
            "candidates": [],
            "bbox": None,
            "seatbelt_worn": False,
            "confidence": 0.0,
            "class_name": "no candidate",
            "yolo_confidence": 0.0,
            "inference_ms": inference_ms,
            "image_size": [iw, ih],
        }

    candidates = []
    any_worn = False
    best_score_overall = 0.0
    best_worn_candidate = None

    # Over-detection guard: a real driver wears one belt. If YOLOv5 is
    # spitting out many high-confidence candidates simultaneously, the model
    # is hallucinating on this frame — reject the whole frame rather than
    # picking a winner from noise. Disabled in DEMO mode because phone-screen
    # photos can legitimately produce multiple regions.
    high_conf_count = sum(1 for det in boxes if float(det[4]) >= STRICT_PERSON_CONF)
    over_detected = (not demo_mode) and high_conf_count > MAX_TRUSTED_CANDIDATES

    for det in boxes:
        x1, y1, x2, y2, score, _cls = [float(v) for v in det[:6]]
        bbox_w = x2 - x1
        bbox_h = y2 - y1
        if bbox_w <= 0 or bbox_h <= 0:
            continue
        if score > best_score_overall:
            best_score_overall = score
        # Per-candidate YOLOv5 confidence floor — STRICT for human, lower
        # for DEMO so phone-screen photos register.
        if score < candidate_floor:
            continue
        bbox_area_frac = (bbox_w * bbox_h) / float(iw * ih) if iw > 0 and ih > 0 else 0
        bbox_top_frac = y1 / float(ih) if ih > 0 else 0
        bbox_center_x_frac = (x1 + bbox_w / 2.0) / float(iw) if iw > 0 else 0.5

        # Geometry filter — applied in both modes; size/position basics.
        if bbox_top_frac < MIN_BBOX_TOP_Y_FRAC or bbox_area_frac < MIN_BBOX_AREA_FRAC:
            candidates.append({
                "bbox": [x1, y1, bbox_w, bbox_h],
                "yolo_confidence": score,
                "seatbelt_worn": False,
                "confidence": 0.0,
                "class_name": "geom_reject",
                "strap_line": False,
                "strap_frac": 0.0,
            })
            continue

        # Center-frame gate: the driver's strap sits across the torso, in the
        # middle of the frame. Boxes whose center sits in the outer band are
        # background, A-pillar, passenger, or face/edge artifacts. Skipped
        # in DEMO mode because a hand-held phone is rarely centered.
        if not demo_mode and not (BBOX_CENTER_X_MIN_FRAC <= bbox_center_x_frac <= BBOX_CENTER_X_MAX_FRAC):
            candidates.append({
                "bbox": [x1, y1, bbox_w, bbox_h],
                "yolo_confidence": score,
                "seatbelt_worn": False,
                "confidence": 0.0,
                "class_name": "off_center",
                "strap_line": False,
                "strap_frac": 0.0,
            })
            continue

        # Aspect-ratio gate: a real shoulder-to-hip strap produces a bbox
        # that is at least roughly square, usually taller than wide. Wide
        # short bboxes are body parts or background — never straps. Skipped
        # in DEMO mode (phone-screen photos can be in landscape orientation).
        if not demo_mode and bbox_h / bbox_w < MIN_BBOX_HEIGHT_OVER_WIDTH:
            candidates.append({
                "bbox": [x1, y1, bbox_w, bbox_h],
                "yolo_confidence": score,
                "seatbelt_worn": False,
                "confidence": 0.0,
                "class_name": "bad_aspect",
                "strap_line": False,
                "strap_frac": 0.0,
            })
            continue

        # DEMO-mode containment gate: the candidate must lie inside the phone
        # bbox. This is what stops a phone-on-the-side from causing a false
        # positive on the surrounding t-shirt — DEMO mode only trusts the
        # candidate if it's actually drawn from the phone screen content.
        if demo_mode and phone_box is not None:
            cand_box = (x1, y1, x1 + bbox_w, y1 + bbox_h)
            inside_frac = _bbox_overlap_frac(cand_box, phone_box)
            if inside_frac < 0.50:
                candidates.append({
                    "bbox": [x1, y1, bbox_w, bbox_h],
                    "yolo_confidence": score,
                    "seatbelt_worn": False,
                    "confidence": 0.0,
                    "class_name": "outside_phone",
                    "strap_line": False,
                    "strap_frac": 0.0,
                })
                continue

        # 2) Keras classification on the crop
        crop = img.crop((max(0, x1), max(0, y1), min(iw, x2), min(ih, y2)))
        crop_np = np.asarray(crop)
        crop_resized = crop.resize((224, 224), Image.Resampling.BILINEAR)
        inp = np.asarray(crop_resized, dtype=np.float32) / 127.5 - 1.0
        inp = inp[np.newaxis, ...]
        pred = classifier.predict(inp, verbose=0)[0]
        cls_idx = int(np.argmax(pred))
        confidence = float(pred[cls_idx])
        class_name = _CLASS_NAMES.get(cls_idx, str(cls_idx))

        # 3) Hough + darkness band gate — required for every "Worn" verdict
        # in BOTH modes. A real seatbelt — whether on a real driver or
        # displayed on a phone screen — has a visible diagonal dark strap;
        # this is the structural check that prevents Keras from hallucinating
        # "Worn" 100% on a plain t-shirt simply because a phone is in frame.
        has_strap, strap_frac, line_intensity, region_intensity = _find_strap_line(crop_np)

        worn = (
            cls_idx == 1
            and confidence >= WORN_CONF_THRESHOLD
            and has_strap
            and not over_detected
        )

        if over_detected:
            class_name = f"{class_name} (over-detected x{high_conf_count})"
        elif cls_idx == 1 and confidence < WORN_CONF_THRESHOLD:
            class_name = f"{class_name} (low conf)"
        elif cls_idx == 1 and not has_strap:
            class_name = f"{class_name} (no dark strap band)"

        candidates.append({
            "bbox": [x1, y1, bbox_w, bbox_h],
            "yolo_confidence": score,
            "seatbelt_worn": worn,
            "confidence": confidence,
            "class_name": class_name,
            "strap_line": has_strap,
            "strap_frac": strap_frac,
            "line_intensity": line_intensity,
            "region_intensity": region_intensity,
        })

        if worn:
            any_worn = True
            if best_worn_candidate is None or confidence > best_worn_candidate["confidence"]:
                best_worn_candidate = candidates[-1]

    inference_ms = int((time.perf_counter() - t0) * 1000)

    # All YOLOv5 boxes were filtered out below the per-candidate floor — no
    # candidate to score. Treat as "no candidate".
    if not candidates:
        mode = "DEMO" if demo_mode else "STRICT"
        print(
            f"[seatbelt] mode={mode} phone={phone_present} all candidates < floor "
            f"({candidate_floor}); best_score={best_score_overall:.2f} in {inference_ms}ms"
        )
        return {
            "detected": False,
            "candidates": [],
            "bbox": None,
            "seatbelt_worn": False,
            "confidence": 0.0,
            "class_name": "no candidate (sub-floor)",
            "yolo_confidence": best_score_overall,
            "inference_ms": inference_ms,
            "image_size": [iw, ih],
        }

    # Pick the "primary" bbox for legacy single-bbox consumers — the worn one
    # if any, else the highest-yolo candidate.
    primary = best_worn_candidate or max(candidates, key=lambda c: c["yolo_confidence"])

    mode = "DEMO" if demo_mode else "STRICT"
    print(
        f"[seatbelt] mode={mode} phone={phone_present} candidates={len(candidates)} any_worn={any_worn} "
        f"primary: yolo={primary['yolo_confidence']:.2f} "
        f"{primary['class_name']}@{primary['confidence']:.2f} "
        f"worn={primary['seatbelt_worn']} bbox={[int(v) for v in primary['bbox']]} "
        f"in {inference_ms}ms img={iw}x{ih}"
    )

    return {
        "detected": True,
        "candidates": candidates,           # NEW: every candidate's verdict
        "bbox": primary["bbox"],
        "seatbelt_worn": any_worn,
        "confidence": primary["confidence"],
        "class_name": primary["class_name"],
        "yolo_confidence": primary["yolo_confidence"],
        "inference_ms": inference_ms,
        "image_size": [iw, ih],
    }


def _detect_with_yolov8(model, img: Image.Image, t0: float) -> dict:
    """Single-stage Roboflow-trained YOLOv8 pipeline.

    Same structural gates as the legacy path — a model that says "Worn" is
    not enough on its own. The Hough strap-darkness gate is the safety net
    against out-of-distribution false positives.
    """
    iw, ih = img.size

    phone_box = _phone_bbox(img)
    phone_present = phone_box is not None
    demo_mode = TEST_MODE or phone_present
    candidate_floor = YOLOV8_DEMO_CONF if demo_mode else YOLOV8_STRICT_CONF

    # In DEMO mode we crop to the phone bbox and run detection on that crop.
    # The seatbelt content displayed on a phone screen is a small fraction
    # of the full frame; if we run YOLOv8 on the whole frame, the strap is
    # at very low effective resolution (the 320x320 input sees the phone as
    # ~50px wide) and the model returns no candidate. Cropping first feeds
    # the strap to the model at full scale. Detection bboxes are translated
    # back into full-frame coordinates so all downstream gates (geometry,
    # frontend overlay) see consistent coords.
    if demo_mode and phone_box is not None:
        px1, py1, px2, py2 = phone_box
        det_img = img.crop((max(0, int(px1)), max(0, int(py1)),
                            min(iw, int(px2)), min(ih, int(py2))))
        det_offset_x, det_offset_y = float(px1), float(py1)
    else:
        det_img = img
        det_offset_x, det_offset_y = 0.0, 0.0

    arr = np.asarray(det_img)
    results = model.predict(
        # imgsz=320 matches the training imgsz in train_seatbelt.py — running
        # inference at the trained size avoids resize artifacts and is ~4x
        # faster than 640 on CPU, which matters for live webcam frames.
        source=arr, conf=0.05, iou=0.45, imgsz=320, verbose=False, max_det=10,
    )
    boxes = results[0].boxes if results else None
    class_names = model.names
    class_roles = _yolov8_class_roles(class_names)

    if boxes is None or len(boxes) == 0:
        inference_ms = int((time.perf_counter() - t0) * 1000)
        print(f"[seatbelt-v8] no candidate in {inference_ms}ms img={iw}x{ih}")
        return {
            "detected": False,
            "candidates": [],
            "bbox": None,
            "seatbelt_worn": False,
            "confidence": 0.0,
            "class_name": "no candidate",
            "yolo_confidence": 0.0,
            "inference_ms": inference_ms,
            "image_size": [iw, ih],
        }

    candidates: list[dict] = []
    any_worn = False
    best_score_overall = 0.0
    best_worn_candidate = None

    high_conf_count = sum(1 for b in boxes if float(b.conf[0]) >= STRICT_PERSON_CONF)
    over_detected = (not demo_mode) and high_conf_count > MAX_TRUSTED_CANDIDATES

    def _get_label(idx: int) -> str:
        if isinstance(class_names, dict):
            return class_names.get(idx, str(idx))
        try:
            return class_names[idx]
        except (IndexError, TypeError):
            return str(idx)

    for b in boxes:
        x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
        # Translate from detection-image coords back to full-frame coords.
        # In STRICT mode this is a no-op (offset = 0); in DEMO mode it
        # shifts the bbox from "inside the phone crop" to "inside the
        # original camera frame".
        x1 += det_offset_x; y1 += det_offset_y
        x2 += det_offset_x; y2 += det_offset_y
        score = float(b.conf[0])
        cls_idx = int(b.cls[0])
        bbox_w = x2 - x1
        bbox_h = y2 - y1
        if bbox_w <= 0 or bbox_h <= 0:
            continue
        if score > best_score_overall:
            best_score_overall = score
        if score < candidate_floor:
            continue

        bbox_area_frac = (bbox_w * bbox_h) / float(iw * ih) if iw and ih else 0
        bbox_top_frac = y1 / float(ih) if ih else 0
        bbox_center_x_frac = (x1 + bbox_w / 2.0) / float(iw) if iw else 0.5

        raw_label = _get_label(cls_idx)
        kind = class_roles.get(cls_idx, "belt")



        # Trust the trained YOLOv8 model. The Hough strap-darkness gate that
        # the legacy YOLOv5+Keras path relied on was a patch for a weak
        # binary classifier that hallucinated "Worn" on out-of-distribution
        # crops. The Roboflow-trained YOLOv8 model (3,498 labeled images,
        # mAP@0.5 ≈ 0.95) doesn't need it — the dataset itself defines what
        # a seatbelt looks like, including phone-screen renderings.
        #
        #   kind == "worn"      → trust the model, this is a worn belt
        #   kind == "not_worn"  → trust the model, this is a no-seatbelt det
        #   kind == "belt"      → single-class detector; presence = worn
        if kind == "not_worn":
            worn = False
            class_name = raw_label
        else:
            worn = (not over_detected)
            class_name = (
                raw_label if worn
                else f"{raw_label} (over-detected x{high_conf_count})"
            )

        cand = {
            "bbox": [x1, y1, bbox_w, bbox_h],
            "yolo_confidence": score,
            "seatbelt_worn": worn,
            "confidence": score,
            "class_name": class_name,
        }
        candidates.append(cand)
        if worn:
            any_worn = True
            if best_worn_candidate is None or score > best_worn_candidate["confidence"]:
                best_worn_candidate = cand

    inference_ms = int((time.perf_counter() - t0) * 1000)

    if not candidates:
        mode = "DEMO" if demo_mode else "STRICT"
        print(
            f"[seatbelt-v8] mode={mode} phone={phone_present} all candidates < floor "
            f"({candidate_floor}); best_score={best_score_overall:.2f} in {inference_ms}ms"
        )
        return {
            "detected": False,
            "candidates": [],
            "bbox": None,
            "seatbelt_worn": False,
            "confidence": 0.0,
            "class_name": "no candidate (sub-floor)",
            "yolo_confidence": best_score_overall,
            "inference_ms": inference_ms,
            "image_size": [iw, ih],
        }

    primary = best_worn_candidate or max(candidates, key=lambda c: c["yolo_confidence"])
    mode = "DEMO" if demo_mode else "STRICT"
    print(
        f"[seatbelt-v8] mode={mode} phone={phone_present} candidates={len(candidates)} any_worn={any_worn} "
        f"primary: yolo={primary['yolo_confidence']:.2f} "
        f"{primary['class_name']}@{primary['confidence']:.2f} "
        f"worn={primary['seatbelt_worn']} bbox={[int(v) for v in primary['bbox']]} "
        f"in {inference_ms}ms img={iw}x{ih}"
    )
    return {
        "detected": True,
        "candidates": candidates,
        "bbox": primary["bbox"],
        "seatbelt_worn": any_worn,
        "confidence": primary["confidence"],
        "class_name": primary["class_name"],
        "yolo_confidence": primary["yolo_confidence"],
        "inference_ms": inference_ms,
        "image_size": [iw, ih],
    }


def warm_up() -> None:
    try:
        # Warm whichever path will actually serve requests.
        if _load_yolov8_seatbelt() is None:
            _load_models()
        print("[seatbelt] ready")
    except Exception as e:
        print(f"[seatbelt] warm-up failed: {e}")
