"""
Master Override Routes — /api/master-overrides/*

Allows user-editable overrides of per-item master data that persist
across re-imports and take precedence over XML/DB values.

Override fields per item (all optional):
  base_unit   — override unit (e.g. "PCS", "KG")
  pkg_factor  — override package conversion factor
  group       — override vendor group
  hsn_code    — override HSN/SAC code
  gst_rate    — override GST rate (%)
  notes       — free text notes for this item

Storage: backend/data/master_overrides.json
    { item_name: { base_unit?, pkg_factor?, group?, hsn_code?, gst_rate?, notes?,
                   last_modified } }
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, field_validator

master_override_router = APIRouter(prefix="/api/master-overrides", tags=["master-overrides"])

# ── Storage ───────────────────────────────────────────────────────────────────

_DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
_OVERRIDES_FILE = _DATA_DIR / "master_overrides.json"

_OVERRIDES_FILE.parent.mkdir(parents=True, exist_ok=True)


def _load() -> dict[str, dict]:
    if not _OVERRIDES_FILE.exists():
        return {}
    try:
        return json.loads(_OVERRIDES_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error(f"master_overrides: failed to load {_OVERRIDES_FILE}: {exc}")
        return {}


def _save(data: dict) -> None:
    try:
        _OVERRIDES_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception as exc:
        logger.error(f"master_overrides: failed to save {_OVERRIDES_FILE}: {exc}")
        raise


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class MasterOverrideIn(BaseModel):
    base_unit: Optional[str] = None
    pkg_factor: Optional[float] = None
    group: Optional[str] = None
    hsn_code: Optional[str] = None
    gst_rate: Optional[float] = None
    notes: Optional[str] = None

    @field_validator("pkg_factor")
    @classmethod
    def pkg_factor_positive(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            raise ValueError("pkg_factor must be > 0")
        return v

    @field_validator("gst_rate")
    @classmethod
    def gst_rate_range(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not (0 <= v <= 100):
            raise ValueError("gst_rate must be between 0 and 100")
        return v


class MasterOverrideOut(MasterOverrideIn):
    item_name: str
    last_modified: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def get_all_overrides() -> dict[str, dict]:
    """Return the full overrides dict. Used by order_routes to apply overrides."""
    return _load()


def get_override_for(item_name: str) -> dict:
    """Return override for a single item, or empty dict if none."""
    return _load().get(item_name, {})


def apply_overrides(
    item_name: str,
    pkg_factor: Optional[float],
    group: Optional[str],
    base_unit: Optional[str],
) -> tuple[Optional[float], Optional[str], Optional[str]]:
    """
    Apply stored overrides to (pkg_factor, group, base_unit).
    Returns (pkg_factor, group, base_unit) with overrides applied.
    """
    override = get_override_for(item_name)
    if override.get("pkg_factor") is not None:
        pkg_factor = override["pkg_factor"]
    if override.get("group") is not None:
        group = override["group"]
    if override.get("base_unit") is not None:
        base_unit = override["base_unit"]
    return pkg_factor, group, base_unit


# ── Routes ────────────────────────────────────────────────────────────────────


@master_override_router.get("/")
def list_overrides() -> list[MasterOverrideOut]:
    """List all item master overrides."""
    data = _load()
    return [
        MasterOverrideOut(item_name=name, **{k: v for k, v in ov.items()})
        for name, ov in data.items()
    ]


@master_override_router.get("/{item_name}")
def get_override(item_name: str) -> MasterOverrideOut:
    """Get the override for a specific item. Returns empty override if none set."""
    data = _load()
    ov = data.get(item_name, {})
    return MasterOverrideOut(item_name=item_name, **{k: v for k, v in ov.items()})


@master_override_router.post("/{item_name}")
def set_override(item_name: str, body: MasterOverrideIn) -> MasterOverrideOut:
    """Save / update an override for an item. Only non-None fields are stored."""
    data = _load()
    existing = data.get(item_name, {})

    # Merge: only update fields that are explicitly provided
    update = body.model_dump(exclude_none=True)
    if not update:
        raise HTTPException(status_code=422, detail="No fields to update")

    merged = {**existing, **update}
    merged["last_modified"] = datetime.utcnow().isoformat()
    data[item_name] = merged
    _save(data)

    logger.info(f"master_overrides: saved override for '{item_name}': {update}")
    return MasterOverrideOut(item_name=item_name, **{k: v for k, v in merged.items()})


@master_override_router.delete("/{item_name}")
def delete_override(item_name: str) -> dict:
    """Remove all overrides for an item."""
    data = _load()
    if item_name not in data:
        raise HTTPException(status_code=404, detail=f"No override found for '{item_name}'")
    del data[item_name]
    _save(data)
    logger.info(f"master_overrides: deleted override for '{item_name}'")
    return {"status": "deleted", "item_name": item_name}


@master_override_router.delete("/")
def clear_all_overrides() -> dict:
    """Remove ALL overrides. Use with caution."""
    data = _load()
    count = len(data)
    _save({})
    logger.warning(f"master_overrides: cleared all {count} overrides")
    return {"status": "cleared", "count": count}
