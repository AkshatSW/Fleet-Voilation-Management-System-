#!/usr/bin/env bash
# One-click launcher for Fleet Violation Monitoring (Linux / macOS).
# - Bootstraps backend venv + pip install on first run
# - Bootstraps frontend node_modules on first run
# - Seeds the PostgreSQL database if missing
# - Starts FastAPI (uvicorn) on :8000 and Vite on :5176
# - Ctrl+C stops both.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"

# --- pick python ---
if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "ERROR: python3 not found on PATH." >&2
  exit 1
fi

# --- pick npm ---
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found on PATH. Install Node.js 18+ first." >&2
  exit 1
fi

echo "==> Project root: $ROOT_DIR"

# --- backend bootstrap ---
cd "$BACKEND_DIR"

if [ ! -d "$VENV_DIR" ]; then
  echo "==> Creating Python venv at backend/venv"
  "$PYTHON" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

REQ_STAMP="$VENV_DIR/.requirements.stamp"
if [ ! -f "$REQ_STAMP" ] || [ "$BACKEND_DIR/requirements.txt" -nt "$REQ_STAMP" ]; then
  echo "==> Installing backend dependencies"
  pip install --upgrade pip >/dev/null
  pip install -r requirements.txt
  touch "$REQ_STAMP"
else
  echo "==> Backend dependencies up to date"
fi

if [ ! -f "$BACKEND_DIR/fleet_violations.db" ]; then
  echo "==> Seeding database (fleet_violations.db not found)"
  python seed.py
else
  echo "==> Database already present, skipping seed"
fi

# --- frontend bootstrap ---
cd "$FRONTEND_DIR"
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "==> Installing frontend dependencies"
  npm install
else
  echo "==> Frontend dependencies already installed"
fi

# --- launch both ---
cd "$ROOT_DIR"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "==> Shutting down..."
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "==> Starting backend  (http://localhost:8000)"
(
  cd "$BACKEND_DIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  export WATCHFILES_IGNORE_PERMISSION_DENIED=true
  exec uvicorn app.main:app --reload --reload-dir app --reload-exclude "postgres-data/*" --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "==> Starting frontend (http://localhost:5176)"
(
  cd "$FRONTEND_DIR"
  exec npm run dev
) &
FRONTEND_PID=$!

echo ""
echo "Backend  PID: $BACKEND_PID  -> http://localhost:8000"
echo "Frontend PID: $FRONTEND_PID  -> http://localhost:5176"
echo "Press Ctrl+C to stop both."

wait -n "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
