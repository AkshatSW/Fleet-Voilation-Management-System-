"""Fine-tune YOLOv8n on the Roboflow Self-Driving Cars dataset — unkillable.

Behavior:
  - Fresh run: starts from yolov8n.pt (COCO pretrained).
  - Crash / Ctrl+C / system reboot: every restart picks up where it left off
    via Ultralytics' `resume=True` against last.pt in the run dir.
  - Wraps training in a retry loop: on any exception we log it, sleep 15s,
    and continue. The process only exits on successful completion.
  - On completion, best.pt is published to models/ for the service to pick up.

Run from the backend directory:
    python training/train.py

To truly detach (survive terminal close), launch via `nohup` on Linux or with
`START /B pythonw …` on Windows.
"""

from __future__ import annotations

import shutil
import signal
import sys
import time
from pathlib import Path

from ultralytics import YOLO

_HERE = Path(__file__).resolve().parent
_BACKEND = _HERE.parent
_DATASET_ROOT = _BACKEND / "datasets" / "self_driving_cars"
_DATA_YAML = _DATASET_ROOT / "data.yaml"
_RUNS = _HERE / "runs"
_RUN_NAME = "finetune"
_RUN_DIR = _RUNS / _RUN_NAME
_LAST_PT = _RUN_DIR / "weights" / "last.pt"
_PUBLISH = _BACKEND / "models" / "traffic_sign_yolo8n_finetuned.pt"

# Aggressive "any-angle" augmentation recipe.
#
# Goal: detect stop signs from oblique / tilted / distant / partially-occluded
# viewpoints, not just the clean front-facing dashcam shots the Roboflow
# dataset has. Each knob here synthesizes a family of viewpoints the dataset
# doesn't naturally contain:
#
#   degrees=30       rotation ±30° — accounts for camera tilt, mounting angle
#   translate=0.20   shift sign up to 20% of image size in either axis
#   scale=0.9        0.1x–1.9x zoom — covers very-far and very-close signs
#   shear=10.0       shear transform — simulates off-axis (left/right) viewing
#   perspective=5e-4 mild 3D perspective warp — side views, low/high angles
#                    (higher values distort the octagonal shape unrealistically)
#   fliplr=0.5       horizontal flip — free 2x data (stop signs are ~symmetric)
#   flipud=0.0       NO vertical flip — upside-down stop signs don't exist
#   mosaic=1.0       4-way image mosaic — small-object recall booster
#   mixup=0.25       blend two images — regularization + occlusion
#   cutmix=0.20      paste patches between images — occlusion robustness
#   copy_paste=0.30  paste sign instances into other images — multi-instance +
#                    new backgrounds
#   erasing=0.5      random erase rectangles — trees/mirrors/dirty windshield
#   hsv_h/s/v        color jitter — sunrise/sunset/overcast/night robustness
AUGMENT = dict(
    hsv_h=0.02, hsv_s=0.80, hsv_v=0.50,
    degrees=30.0, translate=0.20, scale=0.9, shear=10.0,
    perspective=0.0005, flipud=0.0, fliplr=0.5,
    mosaic=1.0, mixup=0.25, cutmix=0.20, copy_paste=0.30, erasing=0.5,
)

TRAIN_KWARGS = dict(
    epochs=60,              # doubled: aggressive aug needs more epochs to stabilize
    imgsz=640,
    batch=8,
    device="cpu",
    project=str(_RUNS),
    name=_RUN_NAME,
    exist_ok=True,
    patience=20,            # longer patience — aggressive aug loss curves are noisier
    optimizer="auto",
    lr0=0.005,              # slightly lower LR: preserves COCO pretraining (which
                            # already knows stop signs from varied angles) while
                            # adapting to the Roboflow distribution
    lrf=0.01,
    cos_lr=True,
    close_mosaic=10,        # disable mosaic for last 10 epochs — stabilizes val mAP
    multi_scale=True,       # train at [0.5x, 1.5x] of imgsz → scale robustness
    amp=False,              # CPU
    workers=2,
    verbose=True,
)

_shutdown_requested = False


def _install_signal_handlers() -> None:
    """Make the retry loop ignore SIGTERM/SIGINT once and only exit on the
    second interrupt. First Ctrl+C -> note it and let the current epoch
    finish its checkpoint write. Second Ctrl+C -> actually exit."""
    def handler(signum, _frame):
        global _shutdown_requested
        if _shutdown_requested:
            print(f"\n[train] second signal {signum} — exiting now", flush=True)
            sys.exit(130)
        _shutdown_requested = True
        print(
            f"\n[train] received signal {signum}; will exit after current retry. "
            "Send again to force quit.",
            flush=True,
        )
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handler)
        except (ValueError, AttributeError):
            # Windows has limited signal support; best effort
            pass


def _run_once() -> bool:
    """One attempt at training. Returns True if training completed normally
    (so the outer loop can exit); False if we should retry."""
    resume = _LAST_PT.exists()
    if resume:
        print(f"[train] resuming from {_LAST_PT}", flush=True)
        model = YOLO(str(_LAST_PT))
        kwargs = dict(TRAIN_KWARGS, resume=True)
    else:
        print("[train] fresh start from yolov8n.pt (COCO pretrained)", flush=True)
        model = YOLO("yolov8n.pt")
        kwargs = dict(TRAIN_KWARGS, **AUGMENT)

    try:
        model.train(data=str(_DATA_YAML), **kwargs)
        return True
    except KeyboardInterrupt:
        # Let the signal handler decide whether to continue or exit
        if _shutdown_requested:
            raise
        print("[train] caught KeyboardInterrupt mid-training, will resume", flush=True)
        return False
    except Exception as e:
        print(f"[train] training crashed: {type(e).__name__}: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return False


def main() -> int:
    if not _DATA_YAML.exists():
        print(f"ERROR: {_DATA_YAML} not found. Run the dataset download first.", file=sys.stderr)
        return 2

    _install_signal_handlers()
    _patch_yaml_paths()

    attempt = 0
    while not _shutdown_requested:
        attempt += 1
        print(f"\n[train] === attempt #{attempt} ===", flush=True)
        completed = _run_once()
        if completed:
            print("[train] training completed successfully", flush=True)
            break
        if _shutdown_requested:
            break
        print("[train] retrying in 15s…", flush=True)
        time.sleep(15)

    # Publish best.pt regardless of how we exit — even a partial fine-tune is
    # better than the untrained starting point if the user chose to stop.
    best = _RUN_DIR / "weights" / "best.pt"
    if best.exists():
        _PUBLISH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, _PUBLISH)
        print(f"[train] published best -> {_PUBLISH}", flush=True)
    else:
        print(f"[train] no best.pt to publish", flush=True)

    return 0 if not _shutdown_requested else 130


def _patch_yaml_paths() -> None:
    import yaml
    with _DATA_YAML.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    data["path"] = str(_DATASET_ROOT.resolve())
    data["train"] = "train/images"
    data["val"] = "valid/images"
    if (_DATASET_ROOT / "test" / "images").exists():
        data["test"] = "test/images"
    data.pop("roboflow", None)
    with _DATA_YAML.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)
    print(f"[train] patched data.yaml paths", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
