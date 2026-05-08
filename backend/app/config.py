from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # PostgreSQL connection string. Must be provided via env in production.
    # Format: postgresql://<user>:<password>@<host>:<port>/<db>
    DATABASE_URL: str = ""
    SECRET_KEY: str = "fleet-monitoring-secret-key-change-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120
    # Comma-separated list of allowed origins for CORS (no trailing slash)
    CORS_ORIGINS: str = "http://localhost:5173"
    WEBHOOK_API_KEY: str = "dashcam-webhook-secret-key"
    FCM_SERVICE_ACCOUNT_PATH: str = ""
    # Directory for uploads. Use /tmp/uploads on serverless platforms.
    UPLOADS_DIR: str = "/tmp/uploads"
    # Backend public URL (used by simulators, webhook callbacks, etc.)
    BACKEND_BASE_URL: str = "http://localhost:8000"
    # Default camera simulator target URL
    SIMULATE_CAMERA_URL: str = "http://localhost:8000/api/webhook/violation"

    class Config:
        env_file = ".env"


settings = Settings()
