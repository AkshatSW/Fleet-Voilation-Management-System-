import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import engine, Base
from app.models import User, Company, Vehicle, Driver, Violation, SafetyScore, Camera
from app.routers import auth, companies, vehicles, drivers, violations, webhook, dashboard, reports, safety_scores, cameras, uploads, signaling, notifications, fcm, detection, phone_gps


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Warm up YOLO in the background so the first /api/detect/stop-sign
    # request doesn't pay the ONNX export + load cost (~10-30s).
    import threading
    from app.services import yolo_service, seatbelt_service
    threading.Thread(target=yolo_service.warm_up, daemon=True).start()
    threading.Thread(target=seatbelt_service.warm_up, daemon=True).start()
    yield


app = FastAPI(
    title="Fleet Violation Monitoring",
    description="AI-powered fleet safety monitoring and violation tracking system",
    version="1.0.0",
    lifespan=lifespan,
)

allowed_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "Origin",
        "X-Requested-With",
        "X-API-Key",
    ],
    expose_headers=["Content-Disposition"],
)

# Register routers
app.include_router(auth.router)
app.include_router(companies.router)
app.include_router(vehicles.router)
app.include_router(drivers.router)
app.include_router(violations.router)
app.include_router(webhook.router)
app.include_router(dashboard.router)
app.include_router(reports.router)
app.include_router(safety_scores.router)
app.include_router(cameras.router)
app.include_router(uploads.router)
app.include_router(signaling.router)
app.include_router(notifications.router)
app.include_router(fcm.router)
app.include_router(detection.router)
app.include_router(phone_gps.router)

# Mount static files for uploads (uses configurable UPLOADS_DIR)
uploads_dir = settings.UPLOADS_DIR
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Fleet Violation Monitoring API"}
