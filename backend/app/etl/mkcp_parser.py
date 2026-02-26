"""
Parser for MKCP Tally XML exports.

All five source files are UTF-16 LE encoded (BOM present).
Python's xml.etree.ElementTree handles the BOM automatically when
the file is opened in binary mode and bytes passed to fromstring().

Files expected in MKCP_DATA_DIR:
  STOCK GROUPS.xml        → VendorGroup rows
  STOCK ITEM.xml          → ItemGroupMapping rows (item → parent group)
  PRICE LIST ST.xml       → AlternateUnit rows (pkg_factor, secondary source)
  PKG CONVERSION.xlsx     → AlternateUnit rows (pkg_factor, PRIMARY source)

pkg_factor resolution priority (items per package):
  1. PKG CONVERSION.xlsx          ← MOST AUTHORITATIVE (explicit conversion table)
  2. PRICE LIST ST.xml Kona RATE  ← fills items not in xlsx
  3. NAME parenthetical suffix    ← last resort: "BELL CROWN MINI ( 300 PCS )" → 300

The PARENT field in STOCK ITEM.xml carries an HSN suffix that must be stripped:
  PARENT = "BICYCLE ( 87120010 )"  →  group = "BICYCLE"

Items with no group mapping fall under the virtual group "Togo Cycles".
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from loguru import logger

from app.etl.pkg_converter import load_pkg_conversion

# Illegal XML 1.0 character references (decimal &#N; and hex &#xN;)
_DECIMAL_REF_RE = re.compile(r"&#(\d+);")
_HEX_REF_RE = re.compile(r"&#x([0-9A-Fa-f]+);")
_RAW_CTRL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")

# Item name suffix pattern: "BELL CROWN MINI ( 300 PCS )" → ("BELL CROWN MINI", 300.0)
_PKG_FACTOR_RE = re.compile(
    r"^(.+?)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:PCS|PKG|PC|NOS|SET|PAIR|ROLL|MTR|KG|BOX)?\s*\)\s*$",
    re.IGNORECASE,
)

# HSN/rate suffix in PARENT field: "BICYCLE ( 87120010 )" → "BICYCLE"
_PARENT_SUFFIX_RE = re.compile(r"\s*\(.*?\)\s*$")

# Normalise whitespace for case-insensitive name lookup
_WS_RE = re.compile(r"\s+")


def _norm(name: str) -> str:
    """Normalise a name for fuzzy matching: upper-case, collapsed whitespace."""
    return _WS_RE.sub(" ", name.strip()).upper()


def _strip_invalid_xml(content: str) -> str:
    """Remove characters that are illegal in XML 1.0 before parsing."""
    _VALID = {0x09, 0x0A, 0x0D}  # TAB, LF, CR are the only allowed C0 controls

    def _dec(m: re.Match) -> str:
        code = int(m.group(1))
        if code in _VALID or code >= 0x20:
            return m.group(0)
        return ""

    def _hex(m: re.Match) -> str:
        code = int(m.group(1), 16)
        if code in _VALID or code >= 0x20:
            return m.group(0)
        return ""

    content = _DECIMAL_REF_RE.sub(_dec, content)
    content = _HEX_REF_RE.sub(_hex, content)
    content = _RAW_CTRL_RE.sub("", content)
    return content


# ── Low-level helpers ─────────────────────────────────────────────────────────


def parse_utf16_xml(path: str) -> ET.Element:
    """
    Parse a UTF-16 LE Tally XML file.
    - Decodes UTF-16 BOM automatically.
    - Strips XML-illegal control characters (Tally sometimes outputs &#x1B; etc.).
    - Falls back to UTF-8 if no BOM.
    """
    with open(path, "rb") as f:
        raw = f.read()

    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        content = raw.decode("utf-16")
    else:
        content = raw.decode("utf-8", errors="replace")

    # Strip XML declaration (ET.fromstring chokes on encoding="utf-16" in a str)
    if content.lstrip().startswith("<?xml"):
        end = content.index("?>") + 2
        content = content[end:].lstrip()

    # Remove illegal control characters before parsing
    content = _strip_invalid_xml(content)

    return ET.fromstring(content)


def _text(el: Optional[ET.Element]) -> str:
    """Return stripped text of an element, or ''."""
    if el is None:
        return ""
    return (el.text or "").strip()


# ── Stock groups ──────────────────────────────────────────────────────────────


def parse_stock_groups(root: ET.Element) -> list[dict]:
    """
    Extract VendorGroup records from all STOCKGROUP elements.
    Returns list of dicts: {name, parent, base_unit, guid}
    """
    groups: list[dict] = []
    seen: set[str] = set()

    for el in root.iter("STOCKGROUP"):
        name = (el.get("NAME") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)

        parent = _text(el.find("PARENT")) or None
        base_unit = _text(el.find("BASEUNITS")) or "PCS"
        guid = _text(el.find("GUID")) or None

        groups.append(
            {
                "name": name,
                "parent": parent,
                "base_unit": base_unit,
                "guid": guid,
            }
        )

    return groups


# ── Price list → alternate units (secondary source) ───────────────────────────


def parse_price_list(root: ET.Element) -> dict[str, float]:
    """
    Extract package factor (items per package) from PRICE LIST ST.xml.

    This is the SECONDARY source — PKG CONVERSION.xlsx takes priority.

    Resolution order per item within this file:
    1. FULLPRICELIST.LIST with PRICELEVEL="Kona", latest DATE entry.
       RATE field format: "300.00/PKG" → pkg_factor = 300.0
    2. NAME parenthetical: "BELL CROWN MINI ( 300 PCS )" → factor = 300.0

    Returns dict: {UPPER-normalised item_name → pkg_factor (float)}
    """
    alt_units: dict[str, float] = {}

    for item_el in root.iter("STOCKITEM"):
        raw_name = (item_el.get("NAME") or "").strip()
        if not raw_name:
            continue

        # ── Determine clean name and optional name-derived factor ──────────────
        m = _PKG_FACTOR_RE.match(raw_name)
        if m:
            clean_name = m.group(1).strip()
            try:
                name_factor: Optional[float] = float(m.group(2))
            except ValueError:
                name_factor = None
        else:
            clean_name = raw_name
            name_factor = None

        if not clean_name:
            continue

        # ── PRIMARY in this file: find latest Kona price level entry ──────────
        kona_factor: Optional[float] = None
        latest_date: str = ""

        for pl_el in item_el.findall("FULLPRICELIST.LIST"):
            pricelevel = _text(pl_el.find("PRICELEVEL"))
            if pricelevel.lower() != "kona":
                continue

            date_str = _text(pl_el.find("DATE"))
            rate_str = _text(pl_el.find("RATE"))

            if not rate_str:
                continue

            rate_numeric = rate_str.split("/")[0].strip()
            try:
                factor = float(rate_numeric)
            except ValueError:
                logger.debug(f"Could not parse Kona rate '{rate_str}' for '{raw_name}'")
                continue

            if factor > 0 and (not latest_date or date_str >= latest_date):
                latest_date = date_str
                kona_factor = factor

        factor = kona_factor if kona_factor is not None else name_factor

        if factor and factor > 0:
            # Store with normalised key so importer can do case-insensitive lookup
            alt_units[_norm(clean_name)] = factor

    return alt_units


# ── Item group mapping ────────────────────────────────────────────────────────


def parse_item_groups(root: ET.Element) -> dict[str, str]:
    """
    Build item_name → group_name mapping from STOCKITEM PARENT element.

    Tally appends an HSN code in parentheses to group names in the PARENT field:
        PARENT = "BICYCLE ( 87120010 )"  →  group = "BICYCLE"

    Returns dict: {item_name → group_name}
    """
    mapping: dict[str, str] = {}

    for item_el in root.iter("STOCKITEM"):
        name = (item_el.get("NAME") or "").strip()
        if not name:
            continue

        parent_el = item_el.find("PARENT")
        raw_group = _text(parent_el)
        if not raw_group:
            continue

        group = _PARENT_SUFFIX_RE.sub("", raw_group).strip()
        if group:
            mapping[name] = group

    return mapping


# ── Master entry point ────────────────────────────────────────────────────────


def parse_mkcp_files(data_dir: str) -> dict:
    """
    Parse all relevant MKCP data files and return structured data.

    pkg_factor resolution priority:
      1. PKG CONVERSION.xlsx   (explicit conversion table — most authoritative)
      2. PRICE LIST ST.xml     (Kona RATE, then name parenthetical — fills gaps)

    Returns:
        {
            'groups':      list[dict],          # VendorGroup rows
            'alt_units':   dict[str, float],    # UPPER-norm item_name → pkg_factor
            'item_groups': dict[str, str],      # item_name → group_name
            'source_counts': dict[str, int],    # diagnostic: how many from each source
        }
    """
    data_path = Path(data_dir)
    result: dict = {
        "groups": [],
        "alt_units": {},
        "item_groups": {},
        "source_counts": {"xlsx": 0, "price_list": 0},
    }

    # ── 1. PKG CONVERSION.xlsx — PRIMARY pkg_factor source ────────────────────
    xlsx_units = load_pkg_conversion(data_dir)   # returns {UPPER_NAME → factor}
    result["source_counts"]["xlsx"] = len(xlsx_units)
    logger.info(f"MKCP: {len(xlsx_units)} pkg_factors from PKG CONVERSION.xlsx")

    # ── 2. PRICE LIST ST.xml — SECONDARY pkg_factor source ────────────────────
    price_list_units: dict[str, float] = {}
    pl_file = data_path / "PRICE LIST ST.xml"
    if pl_file.exists():
        try:
            root = parse_utf16_xml(str(pl_file))
            price_list_units = parse_price_list(root)   # keys are UPPER-normed
            logger.info(
                f"MKCP: {len(price_list_units)} pkg_factors from {pl_file.name}"
            )
        except Exception as exc:
            logger.error(f"MKCP: failed to parse {pl_file.name}: {exc}")
    else:
        logger.warning(f"MKCP: {pl_file} not found — skipping secondary pkg_factor source")

    # Merge: xlsx wins; price_list fills gaps not covered by xlsx
    merged: dict[str, float] = {}
    merged.update(price_list_units)       # secondary first (lower priority)
    merged.update(xlsx_units)             # primary overrides
    result["alt_units"] = merged
    result["source_counts"]["price_list"] = len(price_list_units)
    logger.info(
        f"MKCP: merged pkg_factors: {len(xlsx_units)} from xlsx, "
        f"{len(price_list_units)} from price list → {len(merged)} total"
    )

    # ── Stock groups (STOCK GROUPS.xml) ──────────────────────────────────────
    sg_file = data_path / "STOCK GROUPS.xml"
    if sg_file.exists():
        try:
            root = parse_utf16_xml(str(sg_file))
            result["groups"] = parse_stock_groups(root)
            logger.info(
                f"MKCP: parsed {len(result['groups'])} stock groups from {sg_file.name}"
            )
        except Exception as exc:
            logger.error(f"MKCP: failed to parse {sg_file.name}: {exc}")
    else:
        logger.warning(f"MKCP: {sg_file} not found — skipping stock groups")

    # ── Item → group mapping (STOCK ITEM.xml) ─────────────────────────────────
    si_file = data_path / "STOCK ITEM.xml"
    if si_file.exists():
        try:
            root = parse_utf16_xml(str(si_file))
            result["item_groups"] = parse_item_groups(root)
            logger.info(
                f"MKCP: parsed {len(result['item_groups'])} item→group mappings "
                f"from {si_file.name}"
            )
        except Exception as exc:
            logger.error(f"MKCP: failed to parse {si_file.name}: {exc}")
    else:
        logger.warning(f"MKCP: {si_file} not found — skipping item-group mapping")

    return result
