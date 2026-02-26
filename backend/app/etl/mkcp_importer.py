"""
Importer for MKCP Tally XML exports.

Calls mkcp_parser and upserts results into vendor_groups,
alternate_units, and item_group_mappings tables.

pkg_factor matching strategy (in order):
  1. Exact normalised match   (upper-case, whitespace-collapsed)
  2. Prefix match             — xlsx key is prefix of DB name or vice-versa
  3. Fuzzy Levenshtein        — edit distance ≤ max(2, len/10) with same first char
     Used for minor typo/punctuation variants. Capped to avoid false positives.
  Any item matched is recorded; unmatched items are logged for review.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from loguru import logger
from sqlmodel import Session, select

from app.etl.mkcp_parser import parse_mkcp_files
from app.models.order import AlternateUnit, ItemGroupMapping, VendorGroup
from app.models.master import StockItem

_WS_RE = re.compile(r"\s+")


def _norm(name: str) -> str:
    """Normalise item name: upper-case + collapsed whitespace."""
    return _WS_RE.sub(" ", name.strip()).upper()


def _levenshtein(a: str, b: str) -> int:
    """Compute Levenshtein edit distance between two strings."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    # Use two-row DP for O(min(la,lb)) space
    if la < lb:
        a, b = b, a
        la, lb = lb, la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * lb
        for j, cb in enumerate(b, 1):
            curr[j] = min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (0 if ca == cb else 1),
            )
        prev = curr
    return prev[lb]


def _fuzzy_match(
    norm_db: str,
    alt_units_normed: dict[str, float],
    max_dist_factor: float = 0.10,
    abs_max: int = 3,
) -> tuple[str, float] | None:
    """
    Find the best fuzzy match for norm_db in alt_units_normed.

    Only considers candidates whose first character matches (fast pre-filter).
    Threshold: min(abs_max, max(2, int(len(norm_db) * max_dist_factor)))

    Returns (matched_key, factor) or None.
    """
    if not norm_db:
        return None
    threshold = min(abs_max, max(2, int(len(norm_db) * max_dist_factor)))
    first_char = norm_db[0]
    best_key: str | None = None
    best_dist = threshold + 1

    for xlsx_key in alt_units_normed:
        if not xlsx_key or xlsx_key[0] != first_char:
            continue
        # Length gate: skip if length difference alone exceeds threshold
        if abs(len(xlsx_key) - len(norm_db)) > threshold:
            continue
        dist = _levenshtein(norm_db, xlsx_key)
        if dist < best_dist:
            best_dist = dist
            best_key = xlsx_key

    if best_key is not None and best_dist <= threshold:
        return best_key, alt_units_normed[best_key]
    return None


def _build_factor_map(
    alt_units_normed: dict[str, float],
    db_item_names: list[str],
) -> dict[str, float]:
    """
    Resolve pkg_factor for every DB item name.

    Matching priority:
      1. Exact normalised match.
      2. DB name STARTS WITH xlsx key (xlsx key is prefix of DB name).
      3. Xlsx key STARTS WITH DB name (DB name is prefix of xlsx key, rare).
      4. Fuzzy Levenshtein match (edit distance ≤ threshold).

    Returns {db_item_name → factor}
    """
    factor_map: dict[str, float] = {}
    unmatched_xlsx: set[str] = set(alt_units_normed.keys())
    fuzzy_matches: list[tuple[str, str, int]] = []

    for db_name in db_item_names:
        norm_db = _norm(db_name)

        # 1. Exact match
        if norm_db in alt_units_normed:
            factor_map[db_name] = alt_units_normed[norm_db]
            unmatched_xlsx.discard(norm_db)
            continue

        # 2. Prefix match
        prefix_matched = False
        for xlsx_key, factor in alt_units_normed.items():
            if norm_db.startswith(xlsx_key) or xlsx_key.startswith(norm_db):
                factor_map[db_name] = factor
                unmatched_xlsx.discard(xlsx_key)
                prefix_matched = True
                break
        if prefix_matched:
            continue

        # 3. Fuzzy match (Levenshtein)
        fuzzy = _fuzzy_match(norm_db, alt_units_normed)
        if fuzzy:
            xlsx_key, factor = fuzzy
            dist = _levenshtein(norm_db, xlsx_key)
            factor_map[db_name] = factor
            unmatched_xlsx.discard(xlsx_key)
            fuzzy_matches.append((db_name, xlsx_key, dist))

    if fuzzy_matches:
        logger.info(
            f"mkcp_importer: {len(fuzzy_matches)} items matched via fuzzy (Levenshtein): "
            + ", ".join(f"'{d}'→'{x}'(d={dist})" for d, x, dist in fuzzy_matches[:5])
            + ("…" if len(fuzzy_matches) > 5 else "")
        )

    if unmatched_xlsx:
        logger.debug(
            f"mkcp_importer: {len(unmatched_xlsx)} xlsx pkg_factor entries "
            f"had no matching DB item (will be stored by xlsx name)"
        )

    return factor_map


def import_mkcp(data_dir: str, session: Session) -> dict[str, Any]:
    """
    Parse MKCP data files from data_dir and upsert into DB tables.

    Returns counts: {
        groups_added, groups_updated,
        alt_units_added, alt_units_updated,
        item_groups_added, item_groups_updated,
        source_counts: {xlsx, price_list},
        unmatched_xlsx_items
    }
    """
    parsed = parse_mkcp_files(data_dir)
    alt_units_normed: dict[str, float] = parsed["alt_units"]  # UPPER-norm keys

    counts: dict[str, Any] = {
        "groups_added": 0,
        "groups_updated": 0,
        "alt_units_added": 0,
        "alt_units_updated": 0,
        "item_groups_added": 0,
        "item_groups_updated": 0,
        "source_counts": parsed.get("source_counts", {}),
        "unmatched_xlsx_items": 0,
    }

    # ── VendorGroups ──────────────────────────────────────────────────────────
    for g in parsed["groups"]:
        existing = session.exec(
            select(VendorGroup).where(VendorGroup.name == g["name"])
        ).first()
        if existing:
            existing.parent = g["parent"]
            existing.base_unit = g["base_unit"]
            existing.guid = g["guid"]
            session.add(existing)
            counts["groups_updated"] += 1
        else:
            session.add(VendorGroup(**g))
            counts["groups_added"] += 1

    session.commit()
    logger.info(
        f"VendorGroups: +{counts['groups_added']} new, "
        f"{counts['groups_updated']} updated"
    )

    # ── AlternateUnits — resolve against DB items ─────────────────────────────
    # Fetch all stock item names from DB for fuzzy matching
    db_item_names: list[str] = [
        row[0]
        for row in session.exec(select(StockItem.name)).all()
        if row[0]
    ]

    # Build resolved {db_item_name → factor} (handles prefix matching)
    if db_item_names and alt_units_normed:
        factor_map = _build_factor_map(alt_units_normed, db_item_names)
    else:
        factor_map = {}

    # Also directly store all xlsx-key → factor pairs (covers items not yet in DB)
    # These get stored verbatim so future DB imports can match them
    all_to_store: dict[str, float] = {}
    for normed_key, factor in alt_units_normed.items():
        # Store with the normed key (UPPER) as a fallback
        all_to_store[normed_key] = factor
    # Override with DB-matched names (better casing)
    for db_name, factor in factor_map.items():
        all_to_store[db_name] = factor

    unmatched_count = len(alt_units_normed) - len(factor_map)
    counts["unmatched_xlsx_items"] = max(0, unmatched_count)

    for item_name, factor in all_to_store.items():
        existing = session.exec(
            select(AlternateUnit).where(AlternateUnit.item_name == item_name)
        ).first()
        if existing:
            existing.pkg_factor = factor
            existing.updated_at = datetime.utcnow()
            session.add(existing)
            counts["alt_units_updated"] += 1
        else:
            session.add(AlternateUnit(item_name=item_name, pkg_factor=factor))
            counts["alt_units_added"] += 1

    session.commit()
    logger.info(
        f"AlternateUnits: +{counts['alt_units_added']} new, "
        f"{counts['alt_units_updated']} updated, "
        f"{counts['unmatched_xlsx_items']} xlsx entries without exact DB match"
    )

    # ── ItemGroupMappings ─────────────────────────────────────────────────────
    for item_name, group_name in parsed["item_groups"].items():
        existing = session.exec(
            select(ItemGroupMapping).where(ItemGroupMapping.item_name == item_name)
        ).first()
        if existing:
            existing.group_name = group_name
            existing.updated_at = datetime.utcnow()
            session.add(existing)
            counts["item_groups_updated"] += 1
        else:
            session.add(ItemGroupMapping(item_name=item_name, group_name=group_name))
            counts["item_groups_added"] += 1

    session.commit()
    logger.info(
        f"ItemGroupMappings: +{counts['item_groups_added']} new, "
        f"{counts['item_groups_updated']} updated"
    )

    return counts
