## Production Deployment: Render (Backend) & Vercel (Frontend)

### Backend (Render)
1. Create a new Web Service on Render and connect your repo.
2. Set environment variables in the Render dashboard (see `backend/.env.example`).
  - Use a managed PostgreSQL database (update `DATABASE_URL`).
  - Set `CORS_ORIGINS` to your Vercel frontend URL (e.g., `https://your-frontend.vercel.app`).
3. Set the start command to:
  ```
  uvicorn app.main:app --host 0.0.0.0 --port 8000
  ```
4. (Optional) Configure persistent storage or use cloud storage for uploads.

### Frontend (Vercel)
1. Import your frontend repo into Vercel.
2. In Vercel dashboard, set the environment variable:
  - `VITE_API_BASE_URL=https://your-backend.onrender.com/api`
3. Deploy. Vercel will build and host your React app.

### Notes
- All API calls from the frontend will use the backend URL set in `VITE_API_BASE_URL`.
- Backend CORS must allow the exact Vercel frontend domain.
- Never commit real secrets to git. Use `.env.example` as a template only.
- **Uploads Directory:**
  - On Vercel/static hosts, uploads are stored in `/tmp/uploads` (ephemeral, resets on redeploy).
  - For persistent uploads, use S3 or similar in production and update backend logic.
  - See [DEPLOYMENT.md](./DEPLOYMENT.md) for details on configuring `UPLOADS_DIR`.
# Fleet Violation Monitoring System

AI-powered fleet safety monitoring and violation tracking system with real-time browser-based face detection, live WebRTC video streaming, automated evidence capture, and role-based dashboards.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Demo Credentials](#demo-credentials)
- [User Roles & Access Control](#user-roles--access-control)
- [Features](#features)
  - [Dashboard & Analytics](#dashboard--analytics)
  - [Driver Camera & AI Detection](#driver-camera--ai-detection)
  - [Stop Sign Detection (Visual + GPS Fusion)](#stop-sign-detection-visual--gps-fusion)
  - [Live Monitoring via WebRTC](#live-monitoring-via-webrtc)
  - [Violation Management & Review](#violation-management--review)
  - [Safety Scoring Engine](#safety-scoring-engine)
  - [Evidence Capture (Snapshots & Clips)](#evidence-capture-snapshots--clips)
  - [Camera Management & Webhooks](#camera-management--webhooks)
  - [Reports](#reports)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [WebRTC Streaming Architecture](#webrtc-streaming-architecture)
- [MediaPipe Face Detection](#mediapipe-face-detection)
- [Stop Sign Object Detection](#stop-sign-object-detection)
- [Frontend Architecture](#frontend-architecture)
- [Configuration](#configuration)
- [Internal Developer Guide](#internal-developer-guide)

---

## Overview

This system monitors fleet driver behavior in real-time using browser-based AI face detection (MediaPipe FaceLandmarker). When a driver starts their camera, the system detects drowsiness, yawning, and distraction. Violations are automatically logged with snapshot and video clip evidence. Managers can watch live camera feeds via peer-to-peer WebRTC streaming and review flagged violations. Safety scores are calculated monthly per driver, enabling fleet-wide risk assessment.

**Key capabilities:**

- **Browser-based AI detection** -- No server-side GPU needed. MediaPipe (face) and TensorFlow.js COCO-SSD (stop signs) run entirely in the browser using WebGL/GPU acceleration
- **Peer-to-peer video streaming** -- WebRTC connects driver cameras directly to manager monitoring screens, with WebSocket signaling through the backend
- **Automated evidence capture** -- Rolling 20-second video buffer captures 5 seconds before and 10 seconds after each violation, plus instant JPEG snapshots
- **Stop sign detection with sensor fusion** -- Visual COCO-SSD detection is fused with GPS speed and OpenStreetMap sign data. An on-screen alert + siren (`frontend/public/siren.mp3`) fires on approach, and a `stop_sign_violation` is recorded if the vehicle runs the sign at speed
- **Monthly safety scoring** -- 100-point scale with automatic penalty calculation and risk level classification (Low/Moderate/High/Critical)
- **Role-based access** -- Four roles (Admin, Manager, Viewer, Driver) with tailored navigation and permissions
- **Simulated vehicle sensors** -- Speed, harsh braking, and sudden acceleration events for demo purposes
- **Camera webhook simulator** -- `backend/simulate_camera.py` replays realistic dashcam events against the live backend for load testing and dashboard demos

---

## Architecture

```
                        +------------------+
                        |   React Frontend |
                        |   (Vite + Antd)  |
                        +--------+---------+
                                 |
                    Vite Dev Proxy (port 5173)
                    /api -> :8000   /api/ws -> ws://:8000
                                 |
                        +--------+---------+
                        |  FastAPI Backend  |
                        |   (Uvicorn)      |
                        +--------+---------+
                                 |
              +------------------+------------------+
              |                  |                  |
      +-------+------+  +-------+------+  +-------+--------+
      | SQLite DB     |  | File Storage |  | WebSocket      |
      | (SQLAlchemy)  |  | /uploads/    |  | Signaling      |
      +---------------+  +--------------+  | (per-camera    |
                                           |  rooms)        |
                                           +----------------+

    Driver Browser                    Manager Browser
    +--------------+                  +--------------+
    | getUserMedia  |   WebRTC P2P    | <video> tag  |
    | MediaPipe AI  | =============> | Live feed    |
    | MediaRecorder |                 | Camera cards |
    +--------------+                  +--------------+
```

---

## Tech Stack

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.11+ | Runtime |
| FastAPI | 0.115.0 | Web framework & REST API |
| Uvicorn | 0.32.0 | ASGI server |
| SQLAlchemy | 2.0.36 | ORM & database models |
| Pydantic | 2.10.0 | Request/response validation |
| python-jose | 3.3.0 | JWT token creation & verification |
| passlib + bcrypt | 1.7.4 / 4.0.1 | Password hashing |
| aiofiles | 24.1.0 | Async file I/O for uploads |
| websockets | 14.1 | WebSocket signaling for WebRTC |
| SQLite | -- | Database (file-based, zero config) |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.2.0 | UI framework |
| Vite | 7.3.1 | Build tool & dev server |
| Ant Design | 6.3.0 | UI component library |
| Ant Design Charts | 2.6.7 | Data visualization (Line, Pie, Column charts) |
| Axios | 1.13.5 | HTTP client |
| React Router | 7.13.0 | Client-side routing |
| Day.js | 1.11.19 | Date formatting |
| MediaPipe Tasks Vision | 0.10.32 | Browser-based face detection (FaceLandmarker) |
| TensorFlow.js + COCO-SSD | latest | Browser-based object detection (stop signs, traffic lights) |

---

## Project Structure

```
Fleet_Violation_Monitoring/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── security.py          # JWT creation, password hashing
│   │   │   └── permissions.py       # Role-based access decorators
│   │   ├── models/
│   │   │   ├── company.py           # Company model
│   │   │   ├── user.py              # User model (auth + roles)
│   │   │   ├── vehicle.py           # Vehicle model
│   │   │   ├── driver.py            # Driver model (linked to User)
│   │   │   ├── violation.py         # Violation model (events + evidence)
│   │   │   ├── safety_score.py      # Monthly safety score model
│   │   │   └── camera.py            # Camera model (API keys, heartbeat)
│   │   ├── routers/
│   │   │   ├── auth.py              # Login, register, /me, /me/driver
│   │   │   ├── companies.py         # Company CRUD
│   │   │   ├── vehicles.py          # Vehicle CRUD
│   │   │   ├── drivers.py           # Driver CRUD + auto user creation
│   │   │   ├── violations.py        # Violation CRUD + review workflow
│   │   │   ├── webhook.py           # Ingest violations from cameras
│   │   │   ├── cameras.py           # Camera CRUD + heartbeat
│   │   │   ├── uploads.py           # Snapshot & clip file uploads
│   │   │   ├── dashboard.py         # Dashboard aggregation
│   │   │   ├── reports.py           # Weekly/monthly report generation
│   │   │   ├── safety_scores.py     # Score queries + recalculation
│   │   │   └── signaling.py         # WebSocket signaling for WebRTC
│   │   ├── schemas/
│   │   │   ├── auth.py              # Login/Register/User schemas
│   │   │   ├── company.py           # Company schemas
│   │   │   ├── vehicle.py           # Vehicle schemas
│   │   │   ├── driver.py            # Driver schemas (+ optional credentials)
│   │   │   ├── violation.py         # Violation + Webhook schemas
│   │   │   ├── safety_score.py      # Score + fleet average schemas
│   │   │   └── camera.py            # Camera schemas
│   │   ├── services/
│   │   │   ├── scoring_engine.py    # Penalty calculation + risk levels
│   │   │   ├── dashboard_service.py # Dashboard data aggregation
│   │   │   └── report_service.py    # Report generation logic
│   │   ├── database.py              # SQLAlchemy engine + session
│   │   ├── config.py                # Environment settings
│   │   ├── dependencies.py          # Auth dependency (get_current_user)
│   │   └── main.py                  # FastAPI app, CORS, routers, static files
│   ├── uploads/                     # Stored snapshots & clips
│   │   ├── snapshots/
│   │   └── clips/
│   ├── seed.py                      # Demo data seeder
│   ├── requirements.txt
│   └── venv/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   └── AppLayout.jsx    # Sidebar + header (role-based menu)
│   │   │   ├── common/
│   │   │   │   ├── ProtectedRoute.jsx  # Auth + role guard
│   │   │   │   ├── EventTypeTag.jsx    # Colored violation type tag
│   │   │   │   ├── SeverityTag.jsx     # Colored severity tag
│   │   │   │   ├── RiskBadge.jsx       # Risk level badge
│   │   │   │   └── StatCard.jsx        # Metric card with trend
│   │   │   └── charts/
│   │   │       ├── ViolationTrendChart.jsx   # 30-day line chart
│   │   │       ├── ViolationTypeChart.jsx    # Donut pie chart
│   │   │       ├── RiskDistributionChart.jsx # Column chart
│   │   │       └── ScoreTrendChart.jsx       # Driver score line chart
│   │   ├── pages/
│   │   │   ├── auth/Login.jsx             # Login page
│   │   │   ├── dashboard/Dashboard.jsx    # Fleet overview
│   │   │   ├── violations/
│   │   │   │   ├── ViolationList.jsx      # Filterable violation table
│   │   │   │   └── ViolationDetail.jsx    # Detail + evidence + review
│   │   │   ├── drivers/
│   │   │   │   ├── DriverList.jsx         # Driver table + registration
│   │   │   │   └── DriverDetail.jsx       # Profile + score trend
│   │   │   ├── vehicles/VehicleList.jsx   # Vehicle table
│   │   │   ├── cameras/
│   │   │   │   ├── CameraList.jsx         # Camera management
│   │   │   │   └── DriverCamera.jsx       # AI detection + streaming
│   │   │   ├── monitoring/
│   │   │   │   └── ManagerMonitoring.jsx  # Live camera grid
│   │   │   └── reports/Reports.jsx        # Analytics reports
│   │   ├── hooks/
│   │   │   ├── useWebRTCPublisher.js      # Stream camera to viewers
│   │   │   ├── useWebRTCViewer.js         # Receive live stream
│   │   │   ├── useMediaRecorderBuffer.js  # Rolling buffer + evidence
│   │   │   ├── useViolationAlerts.js      # Audio + visual + haptic
│   │   │   └── usePermission.js           # Role-based feature flags
│   │   ├── services/index.js              # Axios API client
│   │   ├── context/AuthContext.jsx         # Auth state management
│   │   ├── constants/index.js             # Shared constants
│   │   └── routes/index.jsx               # Route definitions
│   ├── vite.config.js
│   └── package.json
│
└── README.md
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 19+
- npm 9+

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt

# Seed demo data (creates SQLite DB + demo users/vehicles/cameras)
python seed.py

# Start the API server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (proxies API to backend on port 8000)
npm run dev
```

Open http://localhost:5173 in your browser.

### Production Build

```bash
cd frontend
npm run build    # Outputs to frontend/dist/
```

### Re-seeding the Database

Since this project uses SQLite for development, to reset all data:

```bash
cd backend
rm fleet_violations.db
python seed.py
```

### Replaying Dashcam Events (Simulator)

`backend/simulate_camera.py` posts weighted-random violations to `/api/webhook/violation` with realistic drivers, routes, speeds, and timestamps. Useful for populating dashboards without a live camera.

```bash
cd backend
source venv/bin/activate
python simulate_camera.py                      # 1 event every 5 s (default)
python simulate_camera.py --interval 3 --burst 5  # 5 events every 3 s
python simulate_camera.py --count 50           # send 50 and exit
python simulate_camera.py --url http://remote.example.com/api/webhook/violation
```

The simulator uses the global webhook key (`dashcam-webhook-secret-key`) and the driver/vehicle IDs created by `seed.py`.

---

## Demo Credentials

| Username | Password | Role | Description |
|----------|----------|------|-------------|
| `admin` | `admin123` | ADMIN | Full system access -- manage everything |
| `manager` | `manager123` | MANAGER | View data, review violations, monitoring, reports |
| `viewer` | `viewer123` | VIEWER | Read-only access to dashboards and data |
| `driver1` | `driver123` | DRIVER | Driver camera page only, identity auto-selected |

---

## User Roles & Access Control

### Role Permissions Matrix

| Feature | ADMIN | MANAGER | VIEWER | DRIVER |
|---------|-------|---------|--------|--------|
| Dashboard | Yes | Yes | Yes | -- |
| Violation list & detail | Yes | Yes | Yes | -- |
| Review violations | Yes | Yes | Yes | -- |
| Driver management | CRUD | Read | Read | -- |
| Vehicle management | CRUD | Read | Read | -- |
| Camera management | CRUD | Read | Read | -- |
| Register users | Yes | -- | -- | -- |
| Generate reports | Yes | Yes | -- | -- |
| Live monitoring | Yes | Yes | -- | -- |
| Driver camera | Yes | Yes | Yes | Yes |
| Recalculate scores | Yes | -- | -- | -- |

### Role-Based Navigation

- **ADMIN/MANAGER/VIEWER**: Full sidebar with Dashboard, Violations, Drivers, Vehicles, Cameras, Monitoring, Reports
- **DRIVER**: Simplified sidebar with only Driver Camera and Logout

### Authentication

- JWT tokens (HS256 algorithm) with 120-minute expiration
- Token stored in `localStorage` and sent as `Authorization: Bearer {token}`
- Auto-logout on 401 responses

---

## Features

### Dashboard & Analytics

**Route:** `/dashboard`

The dashboard provides a fleet-wide overview with real-time data:

- **Overview cards** -- Violations this month (with % change from last month), active drivers, fleet average safety score, critical-risk driver count
- **30-day violation trend** -- Line chart showing daily violation counts
- **Violations by type** -- Donut chart breaking down event types with percentages
- **Risk distribution** -- Column chart showing driver counts per risk level
- **Top violators** -- Table of the 5 drivers with the most violations this month
- **Recent violations** -- Last 50 violations with live polling (5-second refresh toggle)

### Driver Camera & AI Detection

**Route:** `/cameras/driver`

The core detection component runs entirely in the browser:

1. **Camera access** -- Uses `getUserMedia` to access the device webcam (640x480, front-facing)
2. **MediaPipe FaceLandmarker** -- Loads a GPU-accelerated face detection model that outputs 468 facial landmarks and blend shapes per frame
3. **Detection loop** -- Runs at `requestAnimationFrame` rate (~60fps), analyzing each video frame for:
   - **Drowsiness** -- Eye blink blend shapes (`eyeBlinkLeft` + `eyeBlinkRight`) averaged; triggers when score > 0.55 for 15+ consecutive frames
   - **Yawning** -- Jaw open blend shape (`jawOpen`); triggers when score > 0.6 for 30+ consecutive frames
   - **Distraction** -- Face not detected for 45+ consecutive frames (driver looking away)
4. **Canvas overlay** -- Draws eye and mouth contours on a canvas layer over the video, color-coded green (normal) or red/orange (alert active)
5. **Simulated vehicle sensors** -- Speed fluctuates randomly; harsh braking and sudden acceleration events fire probabilistically
6. **Violation cooldown** -- 10-second cooldown per violation type to prevent duplicate alerts
7. **Manual triggers** -- Buttons to manually report phone usage or no seatbelt violations

**For DRIVER role users:**
- Driver identity is auto-selected from their linked profile (no dropdown)
- They only need to select a vehicle and click Start Camera

### Stop Sign Detection (Visual + GPS Fusion)

Running in parallel with the face pipeline, the Driver Camera uses TensorFlow.js COCO-SSD (MobileNet v2) to spot stop signs and traffic lights in the video feed. Detections are then fused with GPS speed and nearby OpenStreetMap signs before an alert or violation is recorded:

1. **Visual detection** -- `useStopSignCamera` polls the video element every 250 ms. A sign is confirmed after 2 consecutive frames above threshold (0.28 normal / 0.22 on a zoomed center crop).
2. **Sensor fusion** -- `useStopSignFusion` combines detection + GPS + OSM signs and picks an alert priority:
   - `INFO` at <=150 m, `WARNING` at <=100 m, `URGENT` at <=50 m
   - `VIOLATION` if <50 m *and* speed >30 km/h -- recorded as `stop_sign_violation` (25 penalty points)
   - Approach-only hits are recorded as `stop_sign_detected` (0 penalty points) for analytics
3. **Driver feedback** -- Siren (`/siren.mp3`) plays, the alert banner flashes, and a spoken message is generated via the Web Speech API.
4. **Cooldowns** -- 5 s per-sign alert cooldown and 10 s violation cooldown prevent spam.

### Live Monitoring via WebRTC

**Route:** `/monitoring`

Managers see a grid of all registered cameras with real-time status:

- **Camera cards** show name, status badge (Online/Offline), driver name, vehicle plate, and last heartbeat time
- **Staleness detection** -- Cameras are shown as offline if the last heartbeat is older than 60 seconds
- **Click to connect** -- Opens a WebRTC viewer that receives the live peer-to-peer video stream from the driver's camera
- **Recent violations** panel shows the latest 20 violations with auto-refresh

### Violation Management & Review

**Route:** `/violations` and `/violations/:id`

**List view:**
- Filterable by event type, severity, review status, date range
- Sortable columns: timestamp, driver, vehicle, event type, severity, penalty points, speed
- Live polling with 5-second auto-refresh (toggleable)
- Paginated (20 per page)

**Detail view:**
- Full violation data (driver, vehicle, event type, severity, penalty points, speed, timestamp, location)
- Evidence display: snapshot image and video clip player
- Review workflow state machine:
  - `pending` -> `under_review` -> `confirmed` or `dismissed`
  - Confirmed/dismissed violations can be reopened
  - Notes field for reviewer comments
  - Tracks reviewer identity and timestamp
- Dismissing a violation recalculates the driver's monthly safety score (dismissed violations don't count)

### Safety Scoring Engine

Each driver receives a monthly safety score calculated as:

```
final_score = max(0, 100 - total_penalty_points)
```

**Penalty points by violation type:**

| Event Type | Penalty Points |
|------------|---------------|
| Stop Sign Violation (ran at speed) | 25 |
| Drowsiness | 20 |
| Phone Usage | 15 |
| Distracted | 15 |
| No Seatbelt | 10 |
| Overspeed | 7 |
| Harsh Braking | 5 |
| Yawning | 5 |
| Sudden Acceleration | 5 |
| Stop Sign Detected (informational) | 0 |

**Risk levels based on score:**

| Score Range | Risk Level |
|-------------|------------|
| 90 -- 100 | Low |
| 75 -- 89 | Moderate |
| 60 -- 74 | High |
| 0 -- 59 | Critical |

- Scores are recalculated automatically when violations are created or reviewed
- Dismissed violations are excluded from penalty calculation
- Admins can trigger a manual recalculation for any month via the API

### Evidence Capture (Snapshots & Clips)

When a violation is detected, evidence is captured automatically:

1. **Snapshot** -- Immediate JPEG capture from the video element (640x480, 85% quality). Uploaded to `/api/uploads/snapshot` and URL stored on the violation record.

2. **Video clip** -- Uses a rolling 20-second `MediaRecorder` buffer:
   - Pre-event: Last 5 seconds from the rolling buffer
   - Post-event: 10 seconds of continued recording after detection
   - Result: ~15-second WebM video clip
   - Uploaded asynchronously to `/api/uploads/clip`
   - Violation record is PATCHed with the clip URL once upload completes

Evidence files are stored on disk under `backend/uploads/snapshots/` and `backend/uploads/clips/`, served as static files at `/uploads/`.

### Camera Management & Webhooks

**Route:** `/cameras`

- Register cameras with name, type (dashcam/cabin/external/webcam), location, and optional vehicle assignment
- Each camera gets a unique 64-character API key (auto-generated via `secrets.token_hex(32)`)
- Camera status tracked via heartbeat endpoint (called every 15 seconds from the driver camera page)
- Heartbeat carries current driver ID and vehicle ID for monitoring enrichment
- API keys can be regenerated; expandable rows show cURL and Python webhook examples

**Webhook endpoint:** `POST /api/webhook/violation`
- External camera systems can POST violations using `X-API-Key` header authentication
- Accepts either the global webhook API key or a per-camera API key
- Auto-calculates penalty points and updates the driver's monthly safety score

### Reports

**Route:** `/reports`

Generate weekly or monthly analytics reports containing:

- Total violation count for the period
- Breakdown by violation type (count + percentage)
- Breakdown by severity level
- Average fleet safety score
- Top 5 worst drivers (lowest scores) with violation counts
- Top 5 best drivers (highest scores) with violation counts
- Print-friendly layout

---

## API Reference

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | None | Login, returns JWT token + user info |
| POST | `/api/auth/register` | ADMIN | Create user account |
| GET | `/api/auth/me` | Required | Get current user profile |
| GET | `/api/auth/me/driver` | Required | Get linked driver profile (for DRIVER role) |

### Dashboard

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dashboard` | Required | Full dashboard data (overview, trends, charts) |
| GET | `/api/dashboard/overview` | Required | Fleet overview stats only |

### Companies

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/companies` | Required | List companies with vehicle/driver counts |
| GET | `/api/companies/{id}` | Required | Get company details |
| POST | `/api/companies` | ADMIN | Create company |
| PUT | `/api/companies/{id}` | ADMIN | Update company |

### Vehicles

| Method | Endpoint | Auth | Query Params | Description |
|--------|----------|------|--------------|-------------|
| GET | `/api/vehicles` | Required | `company_id`, `status` | List vehicles |
| GET | `/api/vehicles/{id}` | Required | | Get vehicle details |
| POST | `/api/vehicles` | ADMIN | | Create vehicle |
| PUT | `/api/vehicles/{id}` | ADMIN | | Update vehicle |

### Drivers

| Method | Endpoint | Auth | Query Params | Description |
|--------|----------|------|--------------|-------------|
| GET | `/api/drivers` | Required | `company_id`, `risk_level`, `active` | List drivers |
| GET | `/api/drivers/{id}` | Required | | Get driver with score + violations |
| POST | `/api/drivers` | ADMIN | | Create driver (optional: `username`/`password` to auto-create login) |
| PUT | `/api/drivers/{id}` | ADMIN | | Update driver |
| GET | `/api/drivers/{id}/violations` | Required | `page`, `page_size` | Paginated violation history |
| GET | `/api/drivers/{id}/scores` | Required | | Monthly safety score history |

### Violations

| Method | Endpoint | Auth | Query Params | Description |
|--------|----------|------|--------------|-------------|
| GET | `/api/violations` | Required | `page`, `page_size`, `event_type`, `severity`, `driver_id`, `review_status`, `date_from`, `date_to`, `sort_by`, `sort_order` | List violations (paginated, filterable) |
| GET | `/api/violations/{id}` | Required | | Get violation details |
| GET | `/api/violations/stats` | Required | | Current month stats by type |
| POST | `/api/violations` | ADMIN | | Create violation manually |
| PATCH | `/api/violations/{id}/review` | Required | | Update review status + notes |
| PATCH | `/api/violations/{id}/clip` | API Key | | Attach clip URL to violation |

### Webhook

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/webhook/violation` | API Key (`X-API-Key` header) | Ingest violation from camera system |

**Webhook payload:**
```json
{
  "driver_id": 1,
  "vehicle_id": 1,
  "event_type": "drowsiness",
  "severity": "high",
  "timestamp": "2025-02-20T14:30:00",
  "camera_id": 5,
  "speed": 85,
  "latitude": 25.2048,
  "longitude": 55.2708,
  "snapshot_url": "/uploads/snapshots/20250220_143000_abc123.jpg",
  "clip_url": null
}
```

### Cameras

| Method | Endpoint | Auth | Query Params | Description |
|--------|----------|------|--------------|-------------|
| GET | `/api/cameras` | Required | `status`, `vehicle_id` | List cameras |
| GET | `/api/cameras/{id}` | Required | | Get camera details |
| POST | `/api/cameras` | ADMIN | | Register camera (auto-generates API key) |
| PUT | `/api/cameras/{id}` | ADMIN | | Update camera |
| DELETE | `/api/cameras/{id}` | ADMIN | | Delete camera |
| POST | `/api/cameras/{id}/regenerate-key` | ADMIN | | Generate new API key |
| POST | `/api/cameras/heartbeat` | API Key | `driver_id`, `vehicle_id` | Camera heartbeat (updates status + session) |

### Uploads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/uploads/snapshot` | API Key | Upload JPEG snapshot (multipart form) |
| POST | `/api/uploads/clip` | API Key | Upload WebM video clip (multipart form) |

### Safety Scores

| Method | Endpoint | Auth | Query Params | Description |
|--------|----------|------|--------------|-------------|
| GET | `/api/safety-scores` | Required | `driver_id`, `month`, `risk_level` | List safety scores |
| GET | `/api/safety-scores/fleet-average` | Required | `month` | Fleet average for month |
| GET | `/api/safety-scores/{driver_id}/latest` | Required | | Driver's latest score |
| POST | `/api/safety-scores/recalculate` | ADMIN | `month` | Recalculate all scores for month |

### Reports

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/reports/generate` | MANAGER+ | Generate custom date range report |
| GET | `/api/reports/weekly` | MANAGER+ | Last 7 days report |
| GET | `/api/reports/monthly` | MANAGER+ | Last 30 days report |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `ws://host/api/ws/signaling/{camera_id}` | WebRTC signaling channel (publisher/viewer roles) |

### Health Check

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | None | Returns `{"status": "ok"}` |

---

## Database Schema

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  companies   │     │    users     │     │   vehicles   │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (PK)      │◄────│ company_id   │     │ id (PK)      │
│ name         │     │ id (PK)      │     │ plate_number │
│ country      │     │ username     │     │ model        │
│ created_at   │     │ password_hash│  ┌──│ company_id   │
│              │◄────│ full_name    │  │  │ status       │
│              │     │ role         │  │  └──────────────┘
│              │     │ created_at   │  │         │
└──────────────┘     └──────────────┘  │         │ 1:1
                            │ 1:1      │  ┌──────┴───────┐
                     ┌──────┴───────┐  │  │   drivers    │
                     │   drivers    │  │  ├──────────────┤
                     ├──────────────┤  │  │ id (PK)      │
                     │ id (PK)      │  │  │ name         │
                     │ name         │  │  │ employee_id  │
                     │ employee_id  │──┘  │ vehicle_id   │
                     │ vehicle_id   │     │ country      │
                     │ country      │     │ active       │
                     │ active       │     │ user_id (FK) │
                     │ user_id (FK) │     └──────────────┘
                     └──────────────┘            │
                            │                    │ 1:many
                     ┌──────┴───────┐     ┌──────┴───────┐
                     │  violations  │     │safety_scores │
                     ├──────────────┤     ├──────────────┤
                     │ id (PK)      │     │ id (PK)      │
                     │ driver_id    │     │ driver_id    │
                     │ vehicle_id   │     │ month        │
                     │ event_type   │     │ total_penalty│
                     │ severity     │     │ final_score  │
                     │ penalty_pts  │     │ risk_level   │
                     │ timestamp    │     │ created_at   │
                     │ lat/lng      │     └──────────────┘
                     │ speed        │
                     │ video_url    │     ┌──────────────┐
                     │ snapshot_url │     │   cameras    │
                     │ clip_url     │     ├──────────────┤
                     │ review_status│     │ id (PK)      │
                     │ reviewed_by  │     │ name         │
                     │ reviewed_at  │     │ camera_type  │
                     │ review_notes │     │ location     │
                     │ created_at   │     │ vehicle_id   │
                     └──────────────┘     │ api_key      │
                                          │ status       │
                                          │ last_heartbeat│
                                          │ stream_url   │
                                          │ current_driver_id │
                                          │ current_vehicle_id│
                                          │ created_at   │
                                          │ updated_at   │
                                          └──────────────┘
```

### Seed Data

The `seed.py` script creates:

- **2 companies**: Al-Futtaim Logistics (UAE), Aramex Fleet Services (Saudi Arabia)
- **15 vehicles**: 10 for Al-Futtaim (`DXB-A-10000` through `DXB-J-19999`), 5 for Aramex (`RUH-A-20000` through `RUH-E-28888`)
- **4 user accounts**: admin, manager, viewer, driver1
- **1 driver**: Ahmed Khan (EMP-001), linked to the `driver1` user account
- **5 cameras**: 2 dashcams, 1 cabin cam, 1 warehouse external cam, 1 demo webcam

---

## WebRTC Streaming Architecture

The system uses peer-to-peer WebRTC streaming with a lightweight WebSocket signaling server on the backend.

### Signaling Flow

```
  Driver Camera (Publisher)              Backend                Manager (Viewer)
  ━━━━━━━━━━━━━━━━━━━━━━━              ━━━━━━━                ━━━━━━━━━━━━━━━━━
         │                                  │                         │
         │──── WS connect ────────────────►│                         │
         │──── { role: "publisher" } ─────►│                         │
         │                                  │                         │
         │                                  │◄──── WS connect ────────│
         │                                  │◄──── { role: "viewer" } │
         │                                  │                         │
         │                                  │── publisher-available ──►│
         │                                  │                         │
         │◄──── offer (from viewer) ────────│◄──── SDP offer ─────────│
         │                                  │                         │
         │  [Create PeerConnection]         │                         │
         │  [Add local tracks]              │                         │
         │  [Set remote description]        │                         │
         │  [Create answer]                 │                         │
         │                                  │                         │
         │──── SDP answer ─────────────────►│──── answer ────────────►│
         │                                  │                         │
         │◄─── ICE candidates ──────────────│◄──── ICE candidates ────│
         │──── ICE candidates ─────────────►│──── ICE candidates ────►│
         │                                  │                         │
         │══════════════ P2P Video Stream (direct) ══════════════════│
```

### Publisher (useWebRTCPublisher)

- Connects to `ws://{host}/api/ws/signaling/{cameraId}` and registers as publisher
- Supports multiple simultaneous viewers
- Creates a separate `RTCPeerConnection` for each viewer
- Adds the local camera MediaStream tracks to each peer connection
- Monitors connection state and auto-cleans disconnected peers
- Exposes `peerCount` state showing how many managers are watching

### Viewer (useWebRTCViewer)

- Connects to the same signaling endpoint and registers as viewer
- Adds `recvonly` transceivers for video and audio
- Creates an SDP offer and sends it to the publisher via signaling
- Receives the SDP answer and ICE candidates
- The `remoteStream` state provides the video for a `<video>` element

### ICE Configuration

- Uses Google's public STUN server (`stun:stun.l.google.com:19302`)
- No TURN relay configured (designed for same-network / local deployment)

---

## MediaPipe Face Detection

### Model

**FaceLandmarker** -- A GPU-accelerated model that detects 468 facial landmarks and 52 blend shapes per face. Runs in-browser using WebGL via the MediaPipe Tasks Vision WASM runtime.

```
Model: face_landmarker (float16)
Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/
WASM:   https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm
Mode:   VIDEO (per-frame analysis)
Faces:  1 (single face detection)
GPU:    Preferred (delegate: 'GPU')
```

### Detection Thresholds

| Detection | Blend Shape | Threshold | Consecutive Frames | Cooldown |
|-----------|-------------|-----------|-------------------|----------|
| Drowsiness | `(eyeBlinkLeft + eyeBlinkRight) / 2` | > 0.55 | 15 frames | 10s |
| Yawning | `jawOpen` | > 0.6 | 30 frames | 10s |
| Distraction | Face not detected | N/A | 45 frames | 10s |

### Visualization Layer

A transparent canvas overlays the video feed and draws:

- **Eye contours** (16 landmark indices per eye) -- Green when normal, red when drowsy
- **Mouth contour** (20 landmark indices) -- Green when normal, orange when yawning
- **Real-time metrics** -- EAR (Eye Aspect Ratio), MAR (Mouth Aspect Ratio), speed
- **Warning text** -- "FACE NOT DETECTED" when face is absent

### Alert System

Violations trigger a multi-sensory alert:

- **Audio** -- Web Audio API generates oscillating tones (sawtooth wave for high severity, sine wave for low/medium). Stop sign detections additionally play `frontend/public/siren.mp3`
- **Voice** -- Web Speech API (`speechSynthesis`) announces the violation type
- **Visual** -- Red flash overlay pulses 3 times over 1.5 seconds
- **Haptic** -- Device vibration pattern `[200ms, 100ms, 200ms, 100ms, 200ms]` (if supported)

---

## Stop Sign Object Detection

### Model

**COCO-SSD (MobileNet v2)** via `@tensorflow-models/coco-ssd` on top of `@tensorflow/tfjs-backend-webgl`. Detects 80 COCO classes; this project uses the `stop sign` and `traffic light` classes only.

### Detection Loop

| Setting | Value |
|---------|-------|
| Polling interval | 250 ms |
| Base confidence threshold | 0.28 |
| Zoom-retry threshold (center 2x crop) | 0.22 |
| Consecutive-frame confirmation | 2 frames |
| Max detections per frame | 12 |

### Fusion Engine

`useStopSignFusion` maps `(distance, speed)` -> `{NONE, INFO, WARNING, URGENT, VIOLATION}` priority. Camera detections are cross-checked against nearby OSM signs (within 50 m) before promoting to an alert. See the "Stop Sign Detection" feature section above for the full decision table.

---

## Frontend Architecture

### State Management

- **AuthContext** -- Manages user authentication state (token, user profile, login/logout)
- **Component-level state** -- Each page manages its own data fetching via `useState` + `useEffect`
- **Polling** -- Dashboard and violation list use `setInterval` for live data refresh (5-10 second intervals)

### API Layer

All API calls go through an Axios instance (`/api` base URL) configured with:

- Automatic `Authorization: Bearer {token}` header injection
- 401 response interceptor that clears auth and redirects to login
- Vite dev server proxies `/api` to the backend at `localhost:8000`

### Custom Hooks

| Hook | Purpose |
|------|---------|
| `useWebRTCPublisher` | Manage WebRTC publishing (driver -> manager streaming) |
| `useWebRTCViewer` | Manage WebRTC viewing (manager receives stream) |
| `useMediaRecorderBuffer` | Rolling 20s video buffer + snapshot/clip capture |
| `useViolationAlerts` | Audio siren + voice announcement + visual flash + haptic vibration on violations |
| `useStopSignCamera` | Loads COCO-SSD, runs the 250 ms detection loop on the video element |
| `useStopSignFusion` | Fuses camera detection + GPS + OSM signs into prioritized alerts and violations |
| `usePermission` | Role-based feature flags (canEditDrivers, canGenerateReports, etc.) |

### Key Constants

```javascript
DEMO_WEBCAM_KEY   // API key for the demo webcam camera
ICE_SERVERS       // WebRTC STUN server configuration
EVENT_TYPES       // 8 violation types with labels, colors, penalty points
RISK_LEVELS       // 4 risk levels with color codes and score thresholds
SEVERITY_COLORS   // Color mapping for low/medium/high/critical
CAMERA_TYPES      // dashcam, cabin, external, webcam
CAMERA_STATUSES   // online, offline, error
REVIEW_STATUSES   // pending, under_review, confirmed, dismissed
ROLES             // ADMIN, MANAGER, VIEWER, DRIVER
```

---

## Configuration


### Backend Environment Variables

Copy `.env.example` to `.env` and set values for deployment:

```
cp backend/.env.example backend/.env
# Edit backend/.env for production
```

**Important:** Set `CORS_ORIGINS` to your deployed frontend URL (e.g., `https://your-frontend-domain.com`).

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./fleet_violations.db` | Database connection string |
| `SECRET_KEY` | (set in config) | JWT signing secret |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `120` | JWT token expiration |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `WEBHOOK_API_KEY` | (set in config) | Global webhook authentication key |

### Frontend Proxy (vite.config.js)

| Path | Target | Description |
|------|--------|-------------|
| `/api/ws` | `ws://127.0.0.1:8000` | WebSocket signaling |
| `/api` | `http://127.0.0.1:8000` | REST API |
| `/uploads` | `http://127.0.0.1:8000` | Static file serving |

---

## Internal Developer Guide

Deeper implementation notes -- module-by-module walkthroughs, the detection pipelines, extension playbooks (adding a new violation type, a new detector, a new role), gotchas, and troubleshooting -- live in [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md). Keep that file updated alongside code changes so new teammates can onboard without pulling the full repo into their head first.
