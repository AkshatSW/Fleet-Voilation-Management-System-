from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings


# Temporarily commented out database validation
# if not settings.DATABASE_URL:
#     raise RuntimeError(
#         "DATABASE_URL is not set. A PostgreSQL connection string is required "
#         "(e.g. postgresql://user:password@host:port/dbname)."
#     )

# if not settings.DATABASE_URL.startswith(("postgresql://", "postgresql+psycopg2://")):
#     raise RuntimeError(
#         "Only PostgreSQL is supported. DATABASE_URL must start with "
#         "'postgresql://' or 'postgresql+psycopg2://'."
#     )

# Use SQLite for local development
database_url = settings.DATABASE_URL or "sqlite:///../fleet_violations.db"

if database_url.startswith("sqlite"):
    engine = create_engine(
        database_url,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        database_url,
        pool_pre_ping=True,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
