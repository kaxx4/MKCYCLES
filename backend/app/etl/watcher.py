"""
File watcher using Watchdog.

Monitors TALLY_INBOX directory for new or modified .xml files and
triggers the ETL importer. Uses Observer with PollingObserver fallback
for cross-platform compatibility (especially Windows/Docker mounts).
"""
from __future__ import annotations

import threading
import time
from pathlib import Path

from loguru import logger
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer
from watchdog.observers.polling import PollingObserver

from app.core.config import settings
from app.etl.importer import import_file


class TallyXMLHandler(FileSystemEventHandler):
    """Handles file system events for XML files in the inbox directory."""

    def __init__(self) -> None:
        super().__init__()
        # Debounce: avoid re-processing a file multiple times due to
        # rapid successive events (e.g., file copy-in-progress)
        self._processing: set[str] = set()
        self._lock = threading.Lock()

    def _should_process(self, path: str) -> bool:
        p = Path(path)
        return p.suffix.lower() == ".xml" and p.is_file()

    def _process(self, path: str) -> None:
        with self._lock:
            if path in self._processing:
                return
            self._processing.add(path)

        try:
            # Small delay to ensure file write is complete
            time.sleep(0.5)
            logger.info(f"Watcher detected: {path}")
            import_file(path)
        except Exception as exc:
            logger.error(f"Watcher import error for {path}: {exc}")
        finally:
            with self._lock:
                self._processing.discard(path)

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._should_process(event.src_path):
            threading.Thread(
                target=self._process, args=(event.src_path,), daemon=True
            ).start()

    def on_modified(self, event: FileSystemEvent) -> None:
        if not event.is_directory and self._should_process(event.src_path):
            threading.Thread(
                target=self._process, args=(event.src_path,), daemon=True
            ).start()


class InboxWatcher:
    """Manages the Watchdog observer lifecycle."""

    def __init__(self, inbox_path: str | None = None) -> None:
        self.inbox = Path(inbox_path or settings.TALLY_INBOX)
        self.inbox.mkdir(parents=True, exist_ok=True)
        self._observer: Observer | None = None

    def start(self) -> None:
        handler = TallyXMLHandler()

        # Try inotify/kqueue first; fall back to polling (works on Windows + Docker)
        try:
            self._observer = Observer()
            self._observer.schedule(handler, str(self.inbox), recursive=False)
            self._observer.start()
            logger.info(f"File watcher started (inotify/kqueue) → {self.inbox}")
        except Exception:
            logger.warning("Native watcher unavailable, falling back to polling")
            self._observer = PollingObserver(timeout=settings.WATCHER_POLL_INTERVAL)
            self._observer.schedule(handler, str(self.inbox), recursive=False)
            self._observer.start()
            logger.info(
                f"File watcher started (polling, {settings.WATCHER_POLL_INTERVAL}s) → {self.inbox}"
            )

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join()
            logger.info("File watcher stopped")

    def scan_existing(self) -> None:
        """Process any XML files already in the inbox at startup."""
        xml_files = sorted(self.inbox.glob("*.xml"))
        if xml_files:
            logger.info(f"Processing {len(xml_files)} existing XML file(s) in inbox")
            for f in xml_files:
                try:
                    import_file(f)
                except Exception as exc:
                    logger.error(f"Failed to import {f.name}: {exc}")
        else:
            logger.info("No existing XML files in inbox")


# Module-level singleton
_watcher: InboxWatcher | None = None


def get_watcher() -> InboxWatcher:
    global _watcher
    if _watcher is None:
        _watcher = InboxWatcher()
    return _watcher


def start_watcher() -> None:
    w = get_watcher()
    w.scan_existing()
    w.start()


def stop_watcher() -> None:
    w = get_watcher()
    w.stop()
