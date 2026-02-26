"""SQLModel database engine and session management."""
from sqlmodel import SQLModel, create_engine, Session
from app.core.config import settings

# Import models so SQLModel.metadata knows about all tables
import app.models.master  # noqa: F401
import app.models.transaction  # noqa: F401
import app.models.order  # noqa: F401

# connect_args for SQLite: enable WAL mode for concurrent reads while watcher writes
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


def create_db_and_tables() -> None:
    """Create all tables defined in SQLModel models."""
    SQLModel.metadata.create_all(engine)


def get_session():
    """FastAPI dependency: yields a SQLModel session."""
    with Session(engine) as session:
        yield session
