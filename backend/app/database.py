from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings


database_url = settings.DATABASE_URL

if not database_url.startswith(("postgresql://", "postgresql+psycopg2://")):
    raise RuntimeError(
        f"Unsupported database URL: {database_url}. "
        "Must start with 'postgresql://' or 'postgresql+psycopg2://'"
    )

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
