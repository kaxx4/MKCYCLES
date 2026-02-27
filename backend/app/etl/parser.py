"""
Tally XML Parser.

Parses sanitised Tally XML bytes and returns structured Python dicts
ready for DB insertion. Handles both Master.xml and Transactions.xml.

Canonical Tally XML structure assumed:
  <ENVELOPE>
    <HEADER>...</HEADER>
    <BODY>
      <IMPORTDATA>
        <REQUESTDATA>
          <TALLYMESSAGE xmlns:UDF="TallyUDF">
            <COMPANY>...</COMPANY>         (Master)
            <LEDGER NAME="...">...</LEDGER> (Master)
            <UNIT NAME="...">...</UNIT>     (Master)
            <STOCKITEM NAME="...">...</STOCKITEM> (Master)
            <VOUCHER ...>...</VOUCHER>      (Transactions)
          </TALLYMESSAGE>
          ...
        </REQUESTDATA>
      </IMPORTDATA>
    </BODY>
  </ENVELOPE>
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime
from typing import Any, Optional
from xml.etree import ElementTree as ET

from loguru import logger

# ── helpers ──────────────────────────────────────────────────────────────────


def _txt(el: ET.Element, tag: str, default: str = "") -> str:
    """Return stripped text of first child with given tag, or default."""
    child = el.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return default


def _float(el: ET.Element, tag: str, default: float = 0.0) -> float:
    """Parse float from child tag text."""
    raw = _txt(el, tag)
    if not raw:
        return default
    # Tally sometimes writes amounts with trailing spaces or commas
    raw = raw.replace(",", "").strip()
    try:
        return float(raw)
    except ValueError:
        return default


def _date(raw: str) -> Optional[date]:
    """Parse Tally date formats: YYYYMMDD or YYYY-MM-DD or DD-MM-YYYY."""
    raw = raw.strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    logger.warning(f"Could not parse date: {raw!r}")
    return None


def _bool(el: ET.Element, tag: str) -> bool:
    """Return True if child tag text is 'Yes' or 'TRUE'."""
    val = _txt(el, tag).upper()
    return val in ("YES", "TRUE", "1")


def _el_to_xml_str(el: ET.Element) -> str:
    """Serialise an element back to a compact XML string."""
    return ET.tostring(el, encoding="unicode", xml_declaration=False)


def _parse_qty(raw: str) -> tuple[Optional[float], Optional[str]]:
    """
    Parse Tally quantity strings like '10 PC', ' 20 PC', '5.5 KGS'.
    Returns (quantity, unit).
    """
    raw = raw.strip()
    if not raw:
        return None, None
    # Match leading number (with optional sign/decimal) then optional unit
    m = re.match(r'^([+-]?\s*[\d.,]+)\s*([A-Za-z].*)?\s*$', raw)
    if m:
        num_str = m.group(1).replace(",", "").replace(" ", "")
        unit_str = (m.group(2) or "").strip() or None
        try:
            return float(num_str), unit_str
        except ValueError:
            pass
    return None, None


def _parse_rate(raw: str) -> Optional[float]:
    """
    Parse Tally rate strings like '1066.96/PC', '910.71/PC', '100'.
    Returns the numeric part only.
    """
    raw = raw.strip()
    if not raw:
        return None
    # Strip unit part after '/'
    if "/" in raw:
        raw = raw.split("/")[0].strip()
    raw = raw.replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


# Normalize Tally voucher type names to title case
_VOUCHER_TYPE_MAP: dict[str, str] = {
    "SALES": "Sales",
    "PURCHASE": "Purchase",
    "RECEIPT": "Receipt",
    "PAYMENT": "Payment",
    "JOURNAL": "Journal",
    "CONTRA": "Contra",
    "DEBIT NOTE": "Debit Note",
    "CREDIT NOTE": "Credit Note",
    "DEBITNOTE": "Debit Note",
    "CREDITNOTE": "Credit Note",
    "SALES ORDER": "Sales Order",
    "PURCHASE ORDER": "Purchase Order",
    "DELIVERY NOTE": "Delivery Note",
    "RECEIPT NOTE": "Receipt Note",
    "REJECTION IN": "Rejection In",
    "REJECTION OUT": "Rejection Out",
    "STOCK JOURNAL": "Stock Journal",
    "PAYROLL": "Payroll",
    "MEMORANDUM": "Memorandum",
}


def _normalize_voucher_type(raw: str) -> str:
    """Normalize voucher type to consistent title-case form."""
    if not raw:
        return "Unknown"
    return _VOUCHER_TYPE_MAP.get(raw.upper(), raw)


# ── Master parsers ────────────────────────────────────────────────────────────


def parse_company(el: ET.Element) -> dict[str, Any]:
    """Parse a <COMPANY> element from Master.xml."""
    name = el.get("NAME") or _txt(el, "NAME") or _txt(el, "BASICCOMPANYNAME")
    return {
        "name": name,
        "gstin": _txt(el, "GSTIN") or _txt(el, "GSTREGISTRATIONNUMBER"),
        "address": _txt(el, "ADDRESS") or _txt(el, "BASICCOMPANYFORMALNAME"),
        "state": _txt(el, "BASICCOMPANYSTATE") or _txt(el, "STATENAME"),
        "pincode": _txt(el, "PINCODE"),
        "email": _txt(el, "EMAIL"),
        "phone": _txt(el, "PHONE"),
    }


def parse_ledger(el: ET.Element) -> dict[str, Any]:
    """Parse a <LEDGER> element from Master.xml."""
    name = el.get("NAME") or _txt(el, "NAME")

    # Determine ledger type from parent group
    parent = _txt(el, "PARENT")
    ledger_type = _infer_ledger_type(parent)

    # Opening balance may be plain numeric or "9 PC" style - take first number
    opening_raw = _txt(el, "OPENINGBALANCE")
    if opening_raw:
        qty, _ = _parse_qty(opening_raw)
        opening_balance = qty if qty is not None else 0.0
    else:
        opening_balance = 0.0

    return {
        "name": name,
        "parent_group": parent,
        "mailing_name": _txt(el, "MAILINGNAME"),
        "gstin": _txt(el, "PARTYGSTIN") or _txt(el, "GSTIN"),
        "pan": _txt(el, "INCOMETAXNUMBER"),
        "email": _txt(el, "EMAIL"),
        "phone": _txt(el, "LEDPHONE"),
        "address": _txt(el, "ADDRESS"),
        "state": _txt(el, "STATENAME"),
        "pincode": _txt(el, "PINCODE"),
        "opening_balance": opening_balance,
        "ledger_type": ledger_type,
    }


def _infer_ledger_type(parent_group: str) -> str:
    """Infer a simplified ledger type from Tally's parent group."""
    pg = parent_group.lower()
    if "debtor" in pg:
        return "Debtor"
    if "creditor" in pg:
        return "Creditor"
    if "bank" in pg:
        return "Bank"
    if "cash" in pg:
        return "Cash"
    if "tax" in pg or "duties" in pg or "gst" in pg:
        return "Tax"
    if "sales" in pg:
        return "Sales"
    if "purchase" in pg:
        return "Purchase"
    if "capital" in pg or "equity" in pg:
        return "Capital"
    if "expense" in pg:
        return "Expense"
    if "income" in pg:
        return "Income"
    return "Other"


def parse_unit(el: ET.Element) -> dict[str, Any]:
    """Parse a <UNIT> element from Master.xml."""
    name = el.get("NAME") or _txt(el, "NAME")
    return {
        "name": name,
        "symbol": _txt(el, "ORIGINALNAME") or name,
        "formal_name": _txt(el, "FORMALNAME"),
        "is_simple_unit": _bool(el, "ISSIMPLEUNIT") if el.find("ISSIMPLEUNIT") is not None else True,
    }


_UNIT_NORMALISE: dict[str, str] = {
    "PC":   "PCS",
    "NOS":  "PCS",
    "NO":   "PCS",
    "UNIT": "PCS",
    "U":    "PCS",
    "KGS":  "KG",
    "MTR":  "MTR",
    "MTRS": "MTR",
    "M":    "MTR",
}


def _norm_unit(raw: str) -> str:
    """Normalise Tally unit abbreviations to a canonical form (PC→PCS, NOS→PCS, etc.)."""
    upper = raw.strip().upper()
    return _UNIT_NORMALISE.get(upper, upper)


def parse_stock_item(el: ET.Element) -> dict[str, Any]:
    """Parse a <STOCKITEM> element from Master.xml."""
    name = el.get("NAME") or _txt(el, "NAME")

    # GST details may be in GSTDETAILS.LIST or direct children
    gst_applicable = _bool(el, "GSTAPPLICABLE") or _txt(el, "ISGSTAPPLICABLE").upper() == "YES"
    hsn = _txt(el, "HSNCODE") or _txt(el, "HSN")
    gst_rate_raw = _txt(el, "TAXRATE") or _txt(el, "GSTRATE")
    try:
        gst_rate = float(gst_rate_raw) if gst_rate_raw else None
    except ValueError:
        gst_rate = None

    # Opening balance: Tally format is "9 PC" - extract numeric part
    opening_raw = _txt(el, "OPENINGBALANCE")
    if opening_raw:
        opening_qty, _ = _parse_qty(opening_raw)
        opening_balance = opening_qty if opening_qty is not None else 0.0
    else:
        opening_balance = 0.0

    # Opening value: may be negative in Tally (credit side) – take abs
    opening_value_raw = _txt(el, "OPENINGVALUE")
    try:
        opening_value = abs(float(opening_value_raw.replace(",", ""))) if opening_value_raw else 0.0
    except ValueError:
        opening_value = 0.0

    # Normalise base unit: "PC" → "PCS", "NOS" → "PCS" etc.
    raw_unit = _txt(el, "BASEUNITS") or _txt(el, "UNITS")
    norm_unit = _norm_unit(raw_unit) if raw_unit else "PCS"

    return {
        "name": name,
        "unit_name": norm_unit,
        "base_units": norm_unit,
        "category": _txt(el, "CATEGORY"),
        "gst_applicable": gst_applicable,
        "hsn_code": hsn,
        "gst_rate": gst_rate,
        "standard_rate": _parse_rate(_txt(el, "STANDARDRATE")) if _txt(el, "STANDARDRATE") else None,
        "opening_balance": opening_balance,
        "opening_value": opening_value,
    }


# ── Transaction parser ────────────────────────────────────────────────────────


def parse_voucher(el: ET.Element) -> dict[str, Any]:
    """
    Parse a <VOUCHER> element from Transactions.xml.

    Returns a dict with keys matching the Voucher model plus a
    'lines' key containing a list of VoucherLine dicts.
    """
    voucher_number = el.get("VOUCHERNUMBER") or _txt(el, "VOUCHERNUMBER")
    voucher_type_raw = el.get("VOUCHERTYPENAME") or _txt(el, "VOUCHERTYPENAME")
    voucher_type = _normalize_voucher_type(voucher_type_raw or "")

    date_raw = el.get("DATE") or _txt(el, "DATE")
    voucher_date = _date(date_raw) if date_raw else None

    party_name = _txt(el, "PARTYNAME") or el.get("PARTYNAME")
    party_ledger = _txt(el, "PARTYLEDGERNAME") or party_name

    irn = _txt(el, "IRN") or None
    ack_no = _txt(el, "IRNACKNO") or None
    ack_date = _txt(el, "IRNACKDATE") or None

    # Amount: use VOUCHERTOTAL, else compute from ledger entries later
    amount_raw = _txt(el, "VOUCHERTOTAL") or _txt(el, "AMOUNT")
    try:
        amount = float(amount_raw.replace(",", "")) if amount_raw else 0.0
    except ValueError:
        amount = 0.0

    # GST / registration
    gstin = (
        _txt(el, "GSTREGISTRATIONNUMBER")
        or _txt(el, "GSTNO")
        or _txt(el, "CMPGSTIN")
    )
    place_of_supply = _txt(el, "PLACEOFSUPPLY") or _txt(el, "DESTINATIONSTATE")
    billing_city = _txt(el, "BILLTOPLACE") or _txt(el, "SHIPCITY")

    # Reference
    ref_no = _txt(el, "REFERENCE") or _txt(el, "REFNO")
    due_date_raw = _txt(el, "DUEDATE") or _txt(el, "BILLDATE")
    due_date = _date(due_date_raw) if due_date_raw else None

    is_cancelled = el.get("ISCANCELLED", "").upper() in ("YES", "TRUE") or \
                   _bool(el, "ISCANCELLED")

    narration = _txt(el, "NARRATION")

    # Composite dedup key (used when IRN is absent)
    company_hint = _txt(el, "CMPNAME") or ""
    dedup_key = f"{voucher_type}|{voucher_number}|{company_hint}|{date_raw}"

    # --- Ledger lines ---
    lines = _parse_ledger_entries(el)

    # If amount is 0, compute from lines (max of debit/credit side)
    if amount == 0.0 and lines:
        debit_total = sum(l["amount"] for l in lines if l["amount"] > 0)
        credit_total = abs(sum(l["amount"] for l in lines if l["amount"] < 0))
        amount = max(debit_total, credit_total)

    # Raw XML for drilldown
    raw_xml = _el_to_xml_str(el)

    return {
        "voucher_number": voucher_number or "",
        "voucher_type": voucher_type,
        "voucher_date": voucher_date,
        "party_name": party_name,
        "party_ledger": party_ledger,
        "amount": amount,
        "narration": narration,
        "irn": irn,
        "ack_no": ack_no,
        "ack_date": ack_date,
        "gstin": gstin,
        "place_of_supply": place_of_supply,
        "billing_city": billing_city,
        "reference_number": ref_no,
        "due_date": due_date,
        "is_cancelled": is_cancelled,
        "raw_xml": raw_xml,
        "dedup_key": dedup_key,
        "lines": lines,
    }


_TAX_HEADS = {"cgst", "sgst", "igst", "cess", "tax", "gst", "tds", "tcs"}


def _parse_ledger_entries(voucher_el: ET.Element) -> list[dict[str, Any]]:
    """
    Extract all ledger entry lines from a voucher.

    Tally wraps these in several possible container tags:
      - ALLLEDGERENTRIES.LIST      (ledger/GST lines)
      - LEDGERENTRIES.LIST         (older format)
      - INVENTORYENTRIES.LIST      (sample data format)
      - ALLINVENTORYENTRIES.LIST   (real Tally export – stock item lines)
    """
    lines: list[dict[str, Any]] = []
    order = 0

    # Process ledger entry containers (financial lines)
    for container_tag in ("ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST"):
        for entry in voucher_el.findall(container_tag):
            ledger_name = _txt(entry, "LEDGERNAME")
            amount_raw = _txt(entry, "AMOUNT").replace(",", "")
            try:
                amount = float(amount_raw)
            except ValueError:
                amount = 0.0

            tax_head = _txt(entry, "TAXTYPE") or ""
            is_tax = any(t in ledger_name.lower() for t in _TAX_HEADS) or \
                     any(t in tax_head.lower() for t in _TAX_HEADS)

            # Tax rate – skip unit-qualified RATE for tax lines
            tax_rate_raw = _txt(entry, "TAXRATE")
            try:
                tax_rate = float(tax_rate_raw) if tax_rate_raw else None
            except ValueError:
                tax_rate = None

            lines.append({
                "ledger_name": ledger_name,
                "amount": amount,
                "is_tax_line": is_tax,
                "tax_head": tax_head or (ledger_name if is_tax else None),
                "tax_rate": tax_rate,
                "stock_item_name": None,
                "quantity": None,
                "unit": None,
                "rate": None,
                "discount": None,
                "gstin_of_party": _txt(entry, "GSTREGNO") or None,
                "order": order,
            })
            order += 1

    # Process inventory entry containers (stock movement lines)
    for container_tag in ("ALLINVENTORYENTRIES.LIST", "INVENTORYENTRIES.LIST"):
        for entry in voucher_el.findall(container_tag):
            stock_item = _txt(entry, "STOCKITEMNAME")
            if not stock_item:
                continue  # skip empty inventory placeholders

            # Amount: use first AMOUNT child (may be nested in sub-element)
            amount_raw = _txt(entry, "AMOUNT").replace(",", "")
            try:
                amount = abs(float(amount_raw))  # inventory amounts in sales are positive value
            except ValueError:
                amount = 0.0

            # Quantity: "10 PC" → (10.0, "PC")
            qty_raw = _txt(entry, "ACTUALQTY") or _txt(entry, "BILLEDQTY")
            quantity, unit_from_qty = _parse_qty(qty_raw)

            # Unit: explicit UNIT tag, fall back to unit embedded in qty string
            unit = _txt(entry, "UNIT") or unit_from_qty

            # Rate: "1066.96/PC" → 1066.96
            item_rate = _parse_rate(_txt(entry, "RATE"))

            # Discount
            discount_raw = _txt(entry, "DISCOUNT")
            try:
                discount = float(discount_raw) if discount_raw else None
            except ValueError:
                discount = None

            lines.append({
                "ledger_name": stock_item,  # use item name as ledger_name for consistency
                "amount": amount,
                "is_tax_line": False,
                "tax_head": None,
                "tax_rate": None,
                "stock_item_name": stock_item,
                "quantity": quantity,
                "unit": unit,
                "rate": item_rate,
                "discount": discount,
                "gstin_of_party": None,
                "order": order,
            })
            order += 1

    return lines


# ── Top-level XML parse ───────────────────────────────────────────────────────


def _process_tally_messages(tally_msgs, result: dict) -> None:
    """Shared logic: extract masters and vouchers from a list of TALLYMESSAGE elements."""
    for msg in tally_msgs:
        # Company
        for el in msg.findall("COMPANY") + msg.findall(".//COMPANY"):
            try:
                result["company"] = parse_company(el)
            except Exception as exc:
                logger.warning(f"Could not parse COMPANY: {exc}")

        # Ledgers
        for el in msg.findall("LEDGER"):
            try:
                result["ledgers"].append(parse_ledger(el))
            except Exception as exc:
                logger.warning(f"Could not parse LEDGER: {exc}")

        # Units
        for el in msg.findall("UNIT"):
            try:
                result["units"].append(parse_unit(el))
            except Exception as exc:
                logger.warning(f"Could not parse UNIT: {exc}")

        # Stock items
        for el in msg.findall("STOCKITEM"):
            try:
                result["stock_items"].append(parse_stock_item(el))
            except Exception as exc:
                logger.warning(f"Could not parse STOCKITEM: {exc}")

        # Vouchers
        for el in msg.findall("VOUCHER"):
            try:
                result["vouchers"].append(parse_voucher(el))
            except Exception as exc:
                logger.warning(f"Could not parse VOUCHER: {exc}")


def _set_file_type(result: dict) -> None:
    """Determine file type based on what data is present."""
    has_masters = bool(
        result["ledgers"] or result["units"] or result["stock_items"] or result["company"]
    )
    has_txns = bool(result["vouchers"])
    if has_masters and has_txns:
        result["file_type"] = "mixed"
    elif has_masters:
        result["file_type"] = "master"
    elif has_txns:
        result["file_type"] = "transaction"


def _parse_xml_dom(clean_bytes: bytes, result: dict) -> dict:
    """Original DOM parse for small files."""
    try:
        root = ET.fromstring(clean_bytes)
    except ET.ParseError as e:
        raise ValueError(f"XML parse error: {e}") from e

    # Extract SVCURRENTCOMPANY
    svc_company_name = None
    svc_gstin = None
    for el in root.findall(".//SVCURRENTCOMPANY"):
        if el.text and el.text.strip():
            svc_company_name = el.text.strip()
            break
    for el in root.findall(".//CMPGSTIN"):
        if el.text and el.text.strip():
            svc_gstin = el.text.strip()
            break

    tally_msgs = root.findall(".//TALLYMESSAGE")
    if not tally_msgs:
        tally_msgs = [root]

    _process_tally_messages(tally_msgs, result)

    if result["company"] is None and svc_company_name:
        result["company"] = {
            "name": svc_company_name, "gstin": svc_gstin,
            "address": None, "state": None, "pincode": None,
            "email": None, "phone": None,
        }

    _set_file_type(result)
    return result


def _parse_xml_streaming(clean_bytes: bytes, result: dict) -> dict:
    """
    Memory-efficient streaming parse using iterparse.
    Processes one TALLYMESSAGE at a time, clearing elements from memory.
    """
    logger.info(f"Using streaming parse for large file ({len(clean_bytes):,} bytes)")

    svc_company_name = None
    svc_gstin = None

    stream = io.BytesIO(clean_bytes)
    context = ET.iterparse(stream, events=("start", "end"))

    current_msg = None
    depth = 0

    for event, elem in context:
        if event == "start":
            if elem.tag == "SVCURRENTCOMPANY" and svc_company_name is None:
                pass  # will get text on "end"
            if elem.tag == "TALLYMESSAGE":
                current_msg = elem
                depth = 0
            elif current_msg is not None:
                depth += 1

        elif event == "end":
            if elem.tag == "SVCURRENTCOMPANY" and svc_company_name is None:
                if elem.text and elem.text.strip():
                    svc_company_name = elem.text.strip()
            elif elem.tag == "CMPGSTIN" and svc_gstin is None:
                if elem.text and elem.text.strip():
                    svc_gstin = elem.text.strip()

            if elem.tag == "TALLYMESSAGE" and current_msg is not None:
                # Process this message
                _process_tally_messages([current_msg], result)
                # Free memory
                current_msg.clear()
                current_msg = None
                depth = 0
                # Also clear the element from the parse tree
                elem.clear()

    if result["company"] is None and svc_company_name:
        result["company"] = {
            "name": svc_company_name, "gstin": svc_gstin,
            "address": None, "state": None, "pincode": None,
            "email": None, "phone": None,
        }

    _set_file_type(result)
    return result


def parse_xml_file(
    clean_bytes: bytes,
) -> dict[str, Any]:
    """
    Parse sanitised XML bytes. For large files (>50 MB), uses iterparse
    to avoid loading the entire DOM into RAM.

    Returns a dict:
    {
      "company": {...} | None,
      "ledgers": [...],
      "units": [...],
      "stock_items": [...],
      "vouchers": [...],
      "file_type": "master" | "transaction" | "mixed",
    }
    """
    result: dict[str, Any] = {
        "company": None,
        "ledgers": [],
        "units": [],
        "stock_items": [],
        "vouchers": [],
        "file_type": "unknown",
    }

    SIZE_THRESHOLD = 50 * 1024 * 1024  # 50 MB

    if len(clean_bytes) > SIZE_THRESHOLD:
        return _parse_xml_streaming(clean_bytes, result)
    else:
        return _parse_xml_dom(clean_bytes, result)
