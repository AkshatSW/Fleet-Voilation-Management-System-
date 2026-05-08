
"""Fine-tune YOLOv8n on a Roboflow seatbelt dataset — single-stage replacement
for the legacy YOLOv5 + Keras two-stage pipeline.

End-to-end:
  - Pulls a labeled seatbelt dataset from Roboflow Universe
  - Fine-tunes YOLOv8n (CPU-friendly nano model) for `epochs` epochs
  - Publishes best.pt to backend/models/seatbelt_yolov8n.pt
  - The seatbelt service auto-picks up the new model on next request

Run from the backend directory:

    # 1. Sign up at roboflow.com (free) and grab the API key from
    #    https://app.roboflow.com/settings/api
    export ROBOFLOW_API_KEY=xxxxxxxxxxxx

    # 2. Pick a seatbelt dataset on Roboflow Universe and copy its
    #    workspace / project / version slugs from the "Download Dataset"
    #    panel. Defaults below point to a public seatbelt project — change
    #    them to retrain on a different dataset.
    export ROBOFLOW_WORKSPACE=seat-belt-detection-public
    export ROBOFLOW_PROJECT=seat-belt
    export ROBOFLOW_VERSION=1

    # 3. Train (CPU: ~6-10 hours for 60 epochs; GPU: ~30-60 min)
    python training/train_seatbelt.py

Behavior matches training/train.py: retries on crash, resumes from last.pt
across reboots, publishes best.pt on completion or graceful shutdown.
"""

from __future__ import annotations

import os
import shutil
import signal
import sys
import time
from pathlib import Path

from ultralytics import YOLO

_HERE = Path(__file__).resolve().parent
_BACKEND = _HERE.parent
_DATASET_ROOT = _BACKEND / "datasets" / "seatbelt"
_RUNS = _HERE / "runs"
_RUN_NAME = "seatbelt"
_RUN_DIR = _RUNS / _RUN_NAME
_LAST_PT = _RUN_DIR / "weights" / "last.pt"
_PUBLISH = _BACKEND / "models" / "seatbelt_yolov8n.pt"

# Roboflow dataset slugs — override via env vars to point at any seatbelt
# project on Roboflow Universe.
_RF_WORKSPACE = os.environ.get("ROBOFLOW_WORKSPACE", "seat-belt-detection-public")
_RF_PROJECT = os.environ.get("ROBOFLOW_PROJECT", "seat-belt")
_RF_VERSION = int(os.environ.get("ROBOFLOW_VERSION", "1"))

# Augmentation recipe — adapted from training/train.py. Same philosophy:
# synthesize the viewpoint diversity the dataset doesn't naturally have.
# Notes specific to seatbelts:
#   degrees=15      smaller than stop-sign 30° — seatbelts have a fixed
#                   diagonal orientation (shoulder→hip), so heavy rotation
#                   teaches the model the wrong invariance.
#   fliplr=0.5      OK — left and right driver seats are both legitimate.
#   flipud=0.0      no upside-down seatbelts.
# Fast-path config: targets ~1-hour wall time on CPU by trading model
# accuracy for turnaround. Levers used:
#   imgsz=320      compute scales as imgsz^2, so 320 vs 640 is ~4x faster
#   batch=16       smaller imgsz frees memory; bigger batch = better CPU usage
#   epochs=10      yolov8n fine-tune from COCO converges fast on a focused
#                  2-class dataset (seatbelt vs no-seatbelt)
#   cache=ram      keep all training images in RAM after first epoch — kills
#                  the dominant cost (PIL decode + augment) on subsequent epochs
#   mosaic/mixup/cutmix/copy_paste = 0
#                  these heavy augs more than double per-iter cost on CPU and
#                  matter mostly for from-scratch / many-epoch runs
#   workers=4      Ryzen 5 5600H has 12 logical cores; 4 dataloader workers
#                  keeps the trainer fed without thrashing
AUGMENT = dict(
    hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
    degrees=10.0, translate=0.10, scale=0.5, shear=0.0,
    perspective=0.0, flipud=0.0, fliplr=0.5,
    mosaic=0.0, mixup=0.0, cutmix=0.0, copy_paste=0.0, erasing=0.2,
)

TRAIN_KWARGS = dict(
    epochs=10,
    imgsz=320,
    batch=16,
    device="cpu",
    project=str(_RUNS),
    name=_RUN_NAME,
    exist_ok=True,
    patience=10,
    optimizer="auto",
    lr0=0.005,
    lrf=0.01,
    cos_lr=True,
    close_mosaic=0,         # no mosaic to close
    # multi_scale=True triggers a known ultralytics 8.4.41 bug where the
    # random per-batch resize occasionally produces a 0x0 target and crashes.
    multi_scale=False,
    amp=False,
    workers=4,
    cache="ram",            # ~3500 imgs × 320×320×3 ≈ 1 GB — easily fits
    verbose=True,
)

_shutdown_requested = False


def _install_signal_handlers() -> None:
    def handler(signum, _frame):
        global _shutdown_requested
        if _shutdown_requested:
            print(f"\n[seatbelt-train] second signal {signum} — exiting now", flush=True)
            sys.exit(130)
        _shutdown_requested = True
        print(
            f"\n[seatbelt-train] received signal {signum}; will exit after current retry. "
            "Send again to force quit.",
            flush=True,
        )
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handler)
        except (ValueError, AttributeError):
            pass


def _download_dataset() -> Path:
    """Download the Roboflow dataset (idempotent — skipped if already present)."""
    data_yaml = _DATASET_ROOT / "data.yaml"
    if data_yaml.exists():
        print(f"[seatbelt-train] dataset already at {_DATASET_ROOT}, skipping download", flush=True)
        return data_yaml

    api_key = os.environ.get("ROBOFLOW_API_KEY")
    if not api_key:
        print(
            "ERROR: ROBOFLOW_API_KEY not set. Sign up at roboflow.com (free) and grab\n"
            "       your key from https://app.roboflow.com/settings/api, then:\n\n"
            "         export ROBOFLOW_API_KEY=xxxxxxxxxxxx        # macOS / Linux / Git Bash\n"
            "         set ROBOFLOW_API_KEY=xxxxxxxxxxxx           # Windows cmd\n"
            "         $env:ROBOFLOW_API_KEY=\"xxxxxxxxxxxx\"        # PowerShell",
            file=sys.stderr, flush=True,
        )
        sys.exit(2)

    print(
        f"[seatbelt-train] downloading {_RF_WORKSPACE}/{_RF_PROJECT}@v{_RF_VERSION} "
        f"into {_DATASET_ROOT} ...", flush=True,
    )
    try:
        from roboflow import Roboflow
    except ImportError:
        print("ERROR: roboflow package not installed. Run: pip install roboflow", file=sys.stderr)
        sys.exit(2)

    _DATASET_ROOT.mkdir(parents=True, exist_ok=True)
    rf = Roboflow(api_key=api_key)
    project = rf.workspace(_RF_WORKSPACE).project(_RF_PROJECT)
    version = project.version(_RF_VERSION)
    dataset = version.download("yolov8", location=str(_DATASET_ROOT))
    print(f"[seatbelt-train] dataset ready at {dataset.location}", flush=True)
    return Path(dataset.location) / "data.yaml"


def _patch_yaml_paths(data_yaml: Path) -> None:
    """Roboflow writes absolute paths into data.yaml that don't survive moves
    or rebuilds. Rewrite them relative to the dataset root."""
    import yaml
    with data_yaml.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    data["path"] = str(_DATASET_ROOT.resolve())
    if (_DATASET_ROOT / "train" / "images").exists():
        data["train"] = "train/images"
    if (_DATASET_ROOT / "valid" / "images").exists():
        data["val"] = "valid/images"
    if (_DATASET_ROOT / "test" / "images").exists():
        data["test"] = "test/images"
    data.pop("roboflow", None)
    with data_yaml.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)
    print(f"[seatbelt-train] patched data.yaml; classes={data.get('names')}", flush=True)


def _run_once(data_yaml: Path) -> bool:
    resume = _LAST_PT.exists()
    if resume:
        print(f"[seatbelt-train] resuming from {_LAST_PT}", flush=True)
        model = YOLO(str(_LAST_PT))
        kwargs = dict(TRAIN_KWARGS, resume=True)
    else:
        print("[seatbelt-train] fresh start from yolov8n.pt", flush=True)
        model = YOLO("yolov8n.pt")
        kwargs = dict(TRAIN_KWARGS, **AUGMENT)
    try:
        model.train(data=str(data_yaml), **kwargs)
        return True
    except KeyboardInterrupt:
        if _shutdown_requested:
            raise
        print("[seatbelt-train] caught KeyboardInterrupt mid-training, will resume", flush=True)
        return False
    except Exception as e:
        print(f"[seatbelt-train] training crashed: {type(e).__name__}: {e}", flush=True)
        import traceback
        traceback.print_exc()
        return False


def main() -> int:
    _install_signal_handlers()

    data_yaml = _download_dataset()
    _patch_yaml_paths(data_yaml)

    attempt = 0
    while not _shutdown_requested:
        attempt += 1
        print(f"\n[seatbelt-train] === attempt #{attempt} ===", flush=True)
        completed = _run_once(data_yaml)
        if completed:
            print("[seatbelt-train] training completed successfully", flush=True)
            break
        if _shutdown_requested:
            break
        print("[seatbelt-train] retrying in 15s...", flush=True)
        time.sleep(15)

    best = _RUN_DIR / "weights" / "best.pt"
    if best.exists():
        _PUBLISH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(best, _PUBLISH)
        print(f"[seatbelt-train] published best -> {_PUBLISH}", flush=True)
    else:
        print(f"[seatbelt-train] no best.pt to publish", flush=True)

    return 0 if not _shutdown_requested else 130


if __name__ == "__main__":
    raise SystemExit(main())
