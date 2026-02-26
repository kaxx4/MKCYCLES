"""
Item Rate Override API.

Stores pkg_rate (rate per package) and unit_rate (rate per piece) per item
in a local JSON file.  These overrides ALWAYS take precedence over Tally XML-
derived rates so the business owner can correct/update prices without touching
the original Tally data.

Endpoints:
  GET    /api/rates                 – list all saved overrides
  GET    /api/rates/{item_name}     – get override for one item
  POST   /api/rates/{item_name}     – save/update override for one item
  DELETE /api/rates/{item_name}     – remove override (revert to Tally rate)
  GET    /api/rates/log/changes     – audit log of rate changes

Data files (created automatically on first use):
  backend/data/item_rate_overrides.json
  backend/data/rate_change_log.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

rate_router = APIRouter(prefix="/api/rates", tags=["rates"])

# ── File paths (relative to this file → backend/data/) ────────────────────────
_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_OVERRIDES_FILE = _DATA_DIR / "item_rate_overrides.json"
_CHANGELOG_FILE = _DATA_DIR / "rate_change_log.json"

# Warn when a single save changes a rate by more than this fraction
_CHANGE_THRESHOLD = 0.30   # 30 %


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class RateOverrideIn(BaseModel):
    """Body for POST /api/rates/{item_name}."""
    pkg_rate: Optional[float] = None    # price per package (PKG)
    unit_rate: Optional[float] = None   # price per individual unit (PCS)


class RateOverrideRead(BaseModel):
    item_name: str
    pkg_rate: Optional[float] = None
    unit_rate: Optional[float] = None
    last_modified: Optional[str] = None
    warnings: list[str] = []


class ChangeLogEntry(BaseModel):
    item: str
    field: str          # "pkg_rate" | "unit_rate"
    old_value: Optional[float]
    new_value: float
    timestamp: str


# ── Low-level JSON helpers ────────────────────────────────────────────────────


def _load_overrides() -> dict:
    """Load the overrides dict from disk, returning {} if file absent."""
    if _OVERRIDES_FILE.exists():
        with open(_OVERRIDES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_overrides(data: dict) -> None:
    """Persist the overrides dict to disk, creating the data dir if needed."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(_OVERRIDES_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _load_changelog() -> list:
    if _CHANGELOG_FILE.exists():
        with open(_CHANGELOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _append_changelog(entries: list[dict]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    log = _load_changelog()
    log.extend(entries)
    # Rolling window — keep only the most recent 1 000 entries
    if len(log) > 1000:
        log = log[-1000:]
    with open(_CHANGELOG_FILE, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)


# ── Public helper: called by other route modules ──────────────────────────────


def get_effective_rate(item_name: str, tally_rate: Optional[float] = None) -> Optional[float]:
    """
    Return the effective unit_rate for an item.
    Override (if saved) always wins over the tally_rate argument.
    Use this single function everywhere — never hard-code rate lookups.
    """
    overrides = _load_overrides()
    entry = overrides.get(item_name)
    if entry and entry.get("unit_rate") is not None:
        return float(entry["unit_rate"])
    return tally_rate


def get_effective_pkg_rate(item_name: str, tally_pkg_rate: Optional[float] = None) -> Optional[float]:
    """
    Return the effective pkg_rate for an item.
    Override (if saved) always wins over the tally_pkg_rate argument.
    """
    overrides = _load_overrides()
    entry = overrides.get(item_name)
    if entry and entry.get("pkg_rate") is not None:
        return float(entry["pkg_rate"])
    return tally_pkg_rate


# ── Endpoints ─────────────────────────────────────────────────────────────────


@rate_router.get("/log/changes", response_model=list[ChangeLogEntry])
def get_change_log(limit: int = 100):
    """Return the most recent rate-change audit log entries (newest first)."""
    log = _load_changelog()
    return list(reversed(log))[:limit]


@rate_router.get("/", response_model=list[RateOverrideRead])
def list_rate_overrides():
    """Return all items that have a saved rate override."""
    overrides = _load_overrides()
    return [
        RateOverrideRead(
            item_name=name,
            pkg_rate=entry.get("pkg_rate"),
            unit_rate=entry.get("unit_rate"),
            last_modified=entry.get("last_modified"),
        )
        for name, entry in sorted(overrides.items())
    ]


@rate_router.get("/{item_name}", response_model=RateOverrideRead)
def get_rate_override(item_name: str):
    """Return the rate override for a specific item (empty if none saved)."""
    overrides = _load_overrides()
    entry = overrides.get(item_name)
    if not entry:
        return RateOverrideRead(item_name=item_name)
    return RateOverrideRead(
        item_name=item_name,
        pkg_rate=entry.get("pkg_rate"),
        unit_rate=entry.get("unit_rate"),
        last_modified=entry.get("last_modified"),
    )


@rate_router.post("/{item_name}", response_model=RateOverrideRead)
def save_rate_override(item_name: str, body: RateOverrideIn):
    """
    Save pkg_rate and/or unit_rate override for an item.

    Rules:
    - Rates must be ≥ 0 (zero is allowed; negative is rejected).
    - A ±30 % change from the previous saved rate triggers a warning in the
      response (data is still saved — the warning is advisory).
    - Every change is appended to the audit log.
    """
    # Validate: no negative rates
    if body.pkg_rate is not None and body.pkg_rate < 0:
        raise HTTPException(status_code=422, detail="pkg_rate cannot be negative")
    if body.unit_rate is not None and body.unit_rate < 0:
        raise HTTPException(status_code=422, detail="unit_rate cannot be negative")

    overrides = _load_overrides()
    old_entry = overrides.get(item_name, {})
    now_iso = datetime.now(timezone.utc).isoformat()

    warnings: list[str] = []
    changelog_entries: list[dict] = []

    for field, new_val in [("pkg_rate", body.pkg_rate), ("unit_rate", body.unit_rate)]:
        if new_val is None:
            continue
        old_val: Optional[float] = old_entry.get(field)

        # Threshold check
        if old_val and old_val > 0:
            pct = abs(new_val - old_val) / old_val
            if pct > _CHANGE_THRESHOLD:
                warnings.append(
                    f"{field} changed by {pct * 100:.1f}% "
                    f"(threshold is {_CHANGE_THRESHOLD * 100:.0f}%)"
                )

        changelog_entries.append(
            {
                "item": item_name,
                "field": field,
                "old_value": old_val,
                "new_value": new_val,
                "timestamp": now_iso,
            }
        )

    if changelog_entries:
        _append_changelog(changelog_entries)

    # Merge with existing entry so a partial update doesn't erase the other field
    new_entry = {
        "pkg_rate": body.pkg_rate if body.pkg_rate is not None else old_entry.get("pkg_rate"),
        "unit_rate": body.unit_rate if body.unit_rate is not None else old_entry.get("unit_rate"),
        "last_modified": now_iso,
    }
    overrides[item_name] = new_entry
    _save_overrides(overrides)

    return RateOverrideRead(
        item_name=item_name,
        pkg_rate=new_entry["pkg_rate"],
        unit_rate=new_entry["unit_rate"],
        last_modified=now_iso,
        warnings=warnings,
    )


@rate_router.delete("/{item_name}")
def delete_rate_override(item_name: str):
    """
    Remove the rate override for an item, reverting it to Tally XML rates.
    """
    overrides = _load_overrides()
    if item_name not in overrides:
        raise HTTPException(
            status_code=404,
            detail=f"No override found for '{item_name}'",
        )
    del overrides[item_name]
    _save_overrides(overrides)
    return {"status": "deleted", "item": item_name}
