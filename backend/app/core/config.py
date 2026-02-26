"""Application configuration loaded from environment variables."""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings:
    # Inbox folder where Tally XML files are dropped
    TALLY_INBOX: str = os.getenv("TALLY_INBOX", str(BASE_DIR / "data" / "tally_inbox"))

    # SQLite DB URL
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'tally_dashboard.db'}"
    )

    # API server
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))

    # Auth
    AUTH_ENABLED: bool = os.getenv("AUTH_ENABLED", "false").lower() == "true"
    AUTH_USERNAME: str = os.getenv("AUTH_USERNAME", "admin")
    AUTH_PASSWORD: str = os.getenv("AUTH_PASSWORD", "changeme")

    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")

    # CORS
    CORS_ORIGINS: list[str] = [
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
        ).split(",")
    ]

    # Watcher poll interval (seconds) – used on platforms where inotify is unavailable
    WATCHER_POLL_INTERVAL: int = int(os.getenv("WATCHER_POLL_INTERVAL", "5"))

    # Directory for raw XML backups (relative to BASE_DIR)
    RAW_BACKUP_DIR: Path = BASE_DIR / "data" / "raw_backup"

    def __init__(self):
        # Ensure directories exist
        Path(self.TALLY_INBOX).mkdir(parents=True, exist_ok=True)
        self.RAW_BACKUP_DIR.mkdir(parents=True, exist_ok=True)


settings = Settings()
