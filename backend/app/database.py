from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings


if not settings.DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. A PostgreSQL connection string is required "
        "(e.g. postgresql://user:password@host:port/dbname)."
    )

if not settings.DATABASE_URL.startswith(("postgresql://", "postgresql+psycopg2://")):
    raise RuntimeError(
        "Only PostgreSQL is supported. DATABASE_URL must start with "
        "'postgresql://' or 'postgresql+psycopg2://'."
    )

engine = create_engine(
    settings.DATABASE_URL,
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
