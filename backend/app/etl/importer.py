"""
ETL Importer: orchestrates sanitise → parse → upsert into SQLite.

Idempotency strategy:
  - If voucher has IRN → use IRN as unique key.
  - Otherwise use composite: (voucher_type, voucher_number, company_name, voucher_date).
  - Existing records are UPDATEd (not re-inserted), and differences are logged.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from loguru import logger
from sqlmodel import Session, select

from app.core.config import settings
from app.core.database import engine
from app.etl.parser import parse_xml_file
from app.etl.sanitizer import sanitize_xml
from app.models.master import Company, Ledger, StockItem, Unit
from app.models.transaction import ImportLog, Voucher, VoucherLine


# ── helpers ──────────────────────────────────────────────────────────────────


def _upsert_company(session: Session, data: dict) -> Optional[Company]:
    if not data or not data.get("name"):
        return None
    stmt = select(Company).where(Company.name == data["name"])
    existing = session.exec(stmt).first()
    if existing:
        for k, v in data.items():
            if v:
                setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return existing
    company = Company(**data)
    session.add(company)
    session.flush()
    return company


def _upsert_ledger(session: Session, data: dict, company_id: Optional[int]) -> Ledger:
    stmt = select(Ledger).where(
        Ledger.name == data["name"],
        Ledger.company_id == company_id,
    )
    existing = session.exec(stmt).first()
    if existing:
        for k, v in data.items():
            if v is not None:
                setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return existing
    ledger = Ledger(**data, company_id=company_id)
    session.add(ledger)
    session.flush()
    return ledger


def _upsert_unit(session: Session, data: dict, company_id: Optional[int]) -> Unit:
    stmt = select(Unit).where(
        Unit.name == data["name"],
        Unit.company_id == company_id,
    )
    existing = session.exec(stmt).first()
    if existing:
        for k, v in data.items():
            if v is not None:
                setattr(existing, k, v)
        session.add(existing)
        return existing
    unit = Unit(**data, company_id=company_id)
    session.add(unit)
    session.flush()
    return unit


def _upsert_stock_item(session: Session, data: dict, company_id: Optional[int]) -> StockItem:
    stmt = select(StockItem).where(
        StockItem.name == data["name"],
        StockItem.company_id == company_id,
    )
    existing = session.exec(stmt).first()
    if existing:
        for k, v in data.items():
            if v is not None:
                setattr(existing, k, v)
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return existing
    item = StockItem(**data, company_id=company_id)
    session.add(item)
    session.flush()
    return item


def _upsert_voucher(
    session: Session,
    data: dict,
    company_id: Optional[int],
) -> tuple[Voucher, bool]:
    """
    Returns (voucher, was_inserted).
    was_inserted=False means it was updated.
    """
    lines_data = data.pop("lines", [])

    # Lookup key
    if data.get("irn"):
        stmt = select(Voucher).where(Voucher.irn == data["irn"])
    else:
        stmt = select(Voucher).where(Voucher.dedup_key == data["dedup_key"])

    existing = session.exec(stmt).first()
    inserted = False

    if existing:
        # Log differences
        diffs = []
        for k, v in data.items():
            old = getattr(existing, k, None)
            if old != v and v is not None:
                diffs.append(f"{k}: {old!r} → {v!r}")
        if diffs:
            logger.debug(f"Updating voucher {data.get('voucher_number')}: {', '.join(diffs[:5])}")

        for k, v in data.items():
            if v is not None:
                setattr(existing, k, v)
        existing.company_id = company_id
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        voucher = existing
    else:
        voucher = Voucher(**data, company_id=company_id)
        session.add(voucher)
        inserted = True

    session.flush()

    # Replace lines
    if lines_data:
        # Delete old lines
        old_lines = session.exec(
            select(VoucherLine).where(VoucherLine.voucher_id == voucher.id)
        ).all()
        for ol in old_lines:
            session.delete(ol)
        session.flush()

        for line_data in lines_data:
            line = VoucherLine(**line_data, voucher_id=voucher.id)
            session.add(line)

    return voucher, inserted


# ── main importer ─────────────────────────────────────────────────────────────


def import_file(file_path: str | Path) -> ImportLog:
    """
    Full ETL pipeline for a single Tally XML file.

    1. Read raw bytes.
    2. Sanitise.
    3. Parse.
    4. Upsert into DB.
    5. Return ImportLog record.
    """
    file_path = Path(file_path)
    log = ImportLog(
        file_path=str(file_path),
        file_name=file_path.name,
        file_type="unknown",
        status="error",
        started_at=datetime.utcnow(),
    )

    warnings: list[str] = []
    try:
        raw = file_path.read_bytes()
        logger.info(f"Importing {file_path.name} ({len(raw):,} bytes)")

        # --- Sanitise ---
        clean_bytes, san_warnings = sanitize_xml(
            raw,
            source_path=str(file_path),
            backup_dir=settings.RAW_BACKUP_DIR,
        )
        warnings.extend(san_warnings)

        # --- Parse ---
        parsed = parse_xml_file(clean_bytes)
        log.file_type = parsed["file_type"]

        # --- Upsert ---
        with Session(engine) as session:
            # Company
            company = None
            if parsed["company"]:
                company = _upsert_company(session, parsed["company"])
                log.masters_processed += 1

            company_id = company.id if company else None

            # Masters
            for led_data in parsed["ledgers"]:
                _upsert_ledger(session, led_data, company_id)
                log.masters_processed += 1

            for unit_data in parsed["units"]:
                _upsert_unit(session, unit_data, company_id)
                log.masters_processed += 1

            for item_data in parsed["stock_items"]:
                _upsert_stock_item(session, item_data, company_id)
                log.masters_processed += 1

            # Transactions
            for vdata in parsed["vouchers"]:
                log.vouchers_processed += 1
                if not vdata.get("voucher_date"):
                    warnings.append(
                        f"Skipped voucher {vdata.get('voucher_number')} – no date"
                    )
                    continue
                try:
                    _, inserted = _upsert_voucher(session, vdata, company_id)
                    if inserted:
                        log.vouchers_inserted += 1
                    else:
                        log.vouchers_updated += 1
                except Exception as exc:
                    warnings.append(f"Voucher error: {exc}")
                    logger.error(f"Voucher upsert failed: {exc}")

            session.commit()

        log.status = "success" if not warnings else "partial"
        logger.info(
            f"{file_path.name}: {log.vouchers_inserted} inserted, "
            f"{log.vouchers_updated} updated, "
            f"{log.masters_processed} masters processed"
        )

    except Exception as exc:
        log.status = "error"
        log.error_message = str(exc)
        logger.error(f"Import failed for {file_path.name}: {exc}")

    finally:
        log.warnings = json.dumps(warnings[:100]) if warnings else None
        log.finished_at = datetime.utcnow()

        # Persist log
        with Session(engine) as session:
            session.add(log)
            session.commit()
            session.refresh(log)

    return log
