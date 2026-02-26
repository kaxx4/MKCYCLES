"""
All REST API routes for the Tally Dashboard backend.

Endpoints:
  GET  /api/health
  POST /api/import
  GET  /api/vouchers
  GET  /api/vouchers/{id}
  GET  /api/kpis
  GET  /api/kpis/monthly
  GET  /api/reports/top-customers
  GET  /api/reports/aging
  GET  /api/items/top
  GET  /api/items/inventory
  GET  /api/items/inventory/{item_name}
  GET  /api/export/csv
  GET  /api/ledgers
  GET  /api/items
  GET  /api/import-logs
  POST /api/settings/rescan
"""
from __future__ import annotations

import csv
import io
import json
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from loguru import logger
from sqlmodel import Session, col, func, select

from app.core.config import settings
from app.core.database import get_session
from app.etl.importer import import_file
from app.etl.watcher import get_watcher
from app.models.master import Ledger, StockItem
from app.models.transaction import ImportLog, Voucher, VoucherLine
from app.schemas.responses import (
    AgingBucket,
    AgingReport,
    HealthResponse,
    ImportLogRead,
    ImportResponse,
    ItemInventoryReport,
    ItemMonthlyData,
    KPIResponse,
    LedgerRead,
    MonthlyDataPoint,
    SettingsRead,
    StockItemRead,
    TopCustomer,
    TopItem,
    VoucherDetail,
    VoucherListResponse,
    VoucherRead,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _vtype_filter(stmt, field, vtype: str):
    """Case-insensitive voucher_type filter (handles SALES vs Sales)."""
    return stmt.where(func.upper(field) == vtype.upper())

router = APIRouter(prefix="/api")


# ── Health ────────────────────────────────────────────────────────────────────


@router.get("/health", response_model=HealthResponse)
def health(session: Session = Depends(get_session)):
    try:
        session.exec(select(Voucher).limit(1))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"
    return HealthResponse(
        status="ok",
        db=db_status,
        inbox=settings.TALLY_INBOX,
    )


# ── Import ────────────────────────────────────────────────────────────────────


@router.post("/import", response_model=ImportResponse)
async def manual_import(
    file: Optional[UploadFile] = File(default=None),
    path: Optional[str] = Query(default=None, description="Absolute path to XML file on server"),
    session: Session = Depends(get_session),
):
    """
    Manually trigger import of a Tally XML file.
    Either upload a file via multipart, or provide a server-side path.
    """
    if file is not None:
        # Save uploaded file to a temp location then import
        suffix = Path(file.filename or "upload.xml").suffix
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=suffix, dir=settings.TALLY_INBOX
        ) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        log = import_file(tmp_path)
    elif path:
        if not Path(path).exists():
            raise HTTPException(status_code=404, detail=f"File not found: {path}")
        log = import_file(path)
    else:
        raise HTTPException(
            status_code=400, detail="Provide either a file upload or a path parameter"
        )

    warnings = json.loads(log.warnings) if log.warnings else None
    return ImportResponse(
        id=log.id,
        file_name=log.file_name,
        status=log.status,
        vouchers_inserted=log.vouchers_inserted,
        vouchers_updated=log.vouchers_updated,
        masters_processed=log.masters_processed,
        error_message=log.error_message,
        warnings=warnings,
        started_at=log.started_at,
        finished_at=log.finished_at,
    )


# ── Vouchers ──────────────────────────────────────────────────────────────────


@router.get("/vouchers", response_model=VoucherListResponse)
def list_vouchers(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    voucher_type: Optional[str] = Query(default=None),
    ledger: Optional[str] = Query(default=None, description="Filter by party name or ledger"),
    search: Optional[str] = Query(default=None, description="Search voucher number or party"),
    company_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    session: Session = Depends(get_session),
):
    stmt = select(Voucher)

    if date_from:
        stmt = stmt.where(Voucher.voucher_date >= date_from)
    if date_to:
        stmt = stmt.where(Voucher.voucher_date <= date_to)
    if voucher_type:
        stmt = stmt.where(Voucher.voucher_type == voucher_type)
    if ledger:
        stmt = stmt.where(
            (col(Voucher.party_name).contains(ledger))
            | (col(Voucher.party_ledger).contains(ledger))
        )
    if search:
        stmt = stmt.where(
            (col(Voucher.voucher_number).contains(search))
            | (col(Voucher.party_name).contains(search))
        )
    if company_id:
        stmt = stmt.where(Voucher.company_id == company_id)

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = session.exec(total_stmt).one()

    stmt = stmt.order_by(col(Voucher.voucher_date).desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)
    items = session.exec(stmt).all()

    return VoucherListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[VoucherRead.model_validate(v) for v in items],
    )


@router.get("/vouchers/{voucher_id}", response_model=VoucherDetail)
def get_voucher(voucher_id: int, session: Session = Depends(get_session)):
    voucher = session.get(Voucher, voucher_id)
    if not voucher:
        raise HTTPException(status_code=404, detail="Voucher not found")

    lines = session.exec(
        select(VoucherLine)
        .where(VoucherLine.voucher_id == voucher_id)
        .order_by(VoucherLine.order)
    ).all()

    detail = VoucherDetail.model_validate(voucher)
    detail.lines = [
        {
            "id": l.id,
            "ledger_name": l.ledger_name,
            "amount": l.amount,
            "is_tax_line": l.is_tax_line,
            "tax_head": l.tax_head,
            "tax_rate": l.tax_rate,
            "stock_item_name": l.stock_item_name,
            "quantity": l.quantity,
            "unit": l.unit,
            "rate": l.rate,
            "order": l.order,
        }
        for l in lines
    ]
    return detail


# ── KPIs ──────────────────────────────────────────────────────────────────────


@router.get("/kpis", response_model=KPIResponse)
def get_kpis(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    company_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
):
    def _base_stmt():
        s = select(Voucher).where(Voucher.is_cancelled == False)
        if date_from:
            s = s.where(Voucher.voucher_date >= date_from)
        if date_to:
            s = s.where(Voucher.voucher_date <= date_to)
        if company_id:
            s = s.where(Voucher.company_id == company_id)
        return s

    def _sum(type_name: str) -> float:
        s = select(func.sum(Voucher.amount)).where(
            func.upper(Voucher.voucher_type) == type_name.upper(),
            Voucher.is_cancelled == False,
        )
        if date_from:
            s = s.where(Voucher.voucher_date >= date_from)
        if date_to:
            s = s.where(Voucher.voucher_date <= date_to)
        if company_id:
            s = s.where(Voucher.company_id == company_id)
        return float(session.exec(s).one() or 0.0)

    total_sales = _sum("Sales")
    total_purchases = _sum("Purchase")
    net_revenue = total_sales - total_purchases

    # GST: sum from VoucherLine where is_tax_line=True
    def _gst(vtype: str) -> float:
        s = (
            select(func.sum(VoucherLine.amount))
            .join(Voucher, VoucherLine.voucher_id == Voucher.id)
            .where(
                VoucherLine.is_tax_line == True,
                func.upper(Voucher.voucher_type) == vtype.upper(),
                Voucher.is_cancelled == False,
            )
        )
        if date_from:
            s = s.where(Voucher.voucher_date >= date_from)
        if date_to:
            s = s.where(Voucher.voucher_date <= date_to)
        return abs(float(session.exec(s).one() or 0.0))

    gst_collected = _gst("Sales")
    gst_paid = _gst("Purchase")

    # Receivables: total Sales minus total Receipts (from customers)
    total_receipts = _sum("Receipt")
    outstanding_receivables = max(0.0, total_sales - total_receipts)
    # Payables: total Purchases minus total Payments (to vendors)
    total_payments = _sum("Payment")
    outstanding_payables = max(0.0, total_purchases - total_payments)

    total_stmt = select(func.count()).select_from(_base_stmt().subquery())
    total_vouchers = session.exec(total_stmt).one() or 0

    return KPIResponse(
        total_sales=round(total_sales, 2),
        total_purchases=round(total_purchases, 2),
        net_revenue=round(net_revenue, 2),
        gst_collected=round(gst_collected, 2),
        gst_paid=round(gst_paid, 2),
        outstanding_receivables=round(outstanding_receivables, 2),
        outstanding_payables=round(outstanding_payables, 2),
        total_vouchers=total_vouchers,
        date_from=str(date_from) if date_from else None,
        date_to=str(date_to) if date_to else None,
    )


@router.get("/kpis/monthly", response_model=list[MonthlyDataPoint])
def get_monthly_kpis(
    year: Optional[int] = Query(default=None),
    company_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
):
    """Return monthly aggregated sales, purchases, GST for chart rendering."""
    # SQLite: strftime('%Y-%m', date_column)
    month_expr = func.strftime("%Y-%m", Voucher.voucher_date)

    result: dict[str, MonthlyDataPoint] = {}

    for vtype, field in [("Sales", "sales"), ("Purchase", "purchases")]:
        stmt = (
            select(month_expr.label("month"), func.sum(Voucher.amount).label("total"))
            .where(func.upper(Voucher.voucher_type) == vtype.upper(), Voucher.is_cancelled == False)
            .group_by("month")
            .order_by("month")
        )
        if year:
            stmt = stmt.where(
                func.strftime("%Y", Voucher.voucher_date) == str(year)
            )
        if company_id:
            stmt = stmt.where(Voucher.company_id == company_id)

        for row in session.exec(stmt):
            month, total = row
            if month not in result:
                result[month] = MonthlyDataPoint(
                    month=month, sales=0, purchases=0, gst_collected=0
                )
            setattr(result[month], field, round(total or 0, 2))

    # GST per month
    gst_stmt = (
        select(
            func.strftime("%Y-%m", Voucher.voucher_date).label("month"),
            func.sum(VoucherLine.amount).label("gst"),
        )
        .join(Voucher, VoucherLine.voucher_id == Voucher.id)
        .where(
            VoucherLine.is_tax_line == True,
            func.upper(Voucher.voucher_type) == "SALES",
            Voucher.is_cancelled == False,
        )
        .group_by("month")
        .order_by("month")
    )
    if year:
        gst_stmt = gst_stmt.where(
            func.strftime("%Y", Voucher.voucher_date) == str(year)
        )
    if company_id:
        gst_stmt = gst_stmt.where(Voucher.company_id == company_id)

    for row in session.exec(gst_stmt):
        month, gst = row
        if month not in result:
            result[month] = MonthlyDataPoint(
                month=month, sales=0, purchases=0, gst_collected=0
            )
        result[month].gst_collected = round(abs(gst or 0), 2)

    return sorted(result.values(), key=lambda x: x.month)


# ── Reports ───────────────────────────────────────────────────────────────────


@router.get("/reports/top-customers", response_model=list[TopCustomer])
def top_customers(
    n: int = Query(default=10, ge=1, le=100),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    session: Session = Depends(get_session),
):
    # Create labeled columns
    total_label = func.sum(Voucher.amount).label("total")
    count_label = func.count(Voucher.id).label("count")
    
    stmt = (
        select(
            Voucher.party_name,
            total_label,
            count_label,
        )
        .where(func.upper(Voucher.voucher_type) == "SALES", Voucher.is_cancelled == False)
        .group_by(Voucher.party_name)
        .order_by(total_label.desc())
        .limit(n)
    )
    if date_from:
        stmt = stmt.where(Voucher.voucher_date >= date_from)
    if date_to:
        stmt = stmt.where(Voucher.voucher_date <= date_to)

    rows = session.exec(stmt).all()
    return [
        TopCustomer(
            party_name=r[0] or "Unknown",
            total_amount=round(r[1] or 0, 2),
            voucher_count=r[2],
        )
        for r in rows
    ]


@router.get("/items/top", response_model=list[TopItem])
def top_items(
    n: int = Query(default=10, ge=1, le=100),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    session: Session = Depends(get_session),
):
    # Create labeled columns
    qty_label = func.sum(VoucherLine.quantity).label("qty")
    total_label = func.sum(VoucherLine.amount).label("total")
    count_label = func.count(VoucherLine.id).label("count")
    
    stmt = (
        select(
            VoucherLine.stock_item_name,
            qty_label,
            total_label,
            count_label,
        )
        .join(Voucher, VoucherLine.voucher_id == Voucher.id)
        .where(
            VoucherLine.stock_item_name.isnot(None),
            func.upper(Voucher.voucher_type) == "SALES",
            Voucher.is_cancelled == False,
        )
        .group_by(VoucherLine.stock_item_name)
        .order_by(total_label.desc())
        .limit(n)
    )
    if date_from:
        stmt = stmt.where(Voucher.voucher_date >= date_from)
    if date_to:
        stmt = stmt.where(Voucher.voucher_date <= date_to)

    rows = session.exec(stmt).all()
    return [
        TopItem(
            stock_item_name=r[0],
            total_quantity=round(r[1] or 0, 2),
            total_amount=round(abs(r[2] or 0), 2),
            voucher_count=r[3],
        )
        for r in rows
        if r[0]
    ]


def _compute_item_monthly(
    session: Session,
    item_name: str,
    months: int,
    opening_balance: float = 0.0,
) -> tuple[list[ItemMonthlyData], float, str | None]:
    """
    Compute monthly inward/outward/closing for one item over last N months.
    Returns (monthly_data, closing_balance, unit).
    """
    today = datetime.utcnow().date()
    start_date = today - relativedelta(months=months)
    current_month = start_date.replace(day=1)
    monthly_data: list[ItemMonthlyData] = []
    running_balance = opening_balance
    unit: str | None = None

    while current_month <= today:
        month_end = (current_month + relativedelta(months=1)) - timedelta(days=1)

        # Inward: Purchases
        inward_stmt = (
            select(func.sum(VoucherLine.quantity), func.max(VoucherLine.unit))
            .join(Voucher, VoucherLine.voucher_id == Voucher.id)
            .where(
                VoucherLine.stock_item_name == item_name,
                func.upper(Voucher.voucher_type) == "PURCHASE",
                Voucher.is_cancelled == False,
                Voucher.voucher_date >= current_month,
                Voucher.voucher_date <= month_end,
            )
        )
        inward_row = session.exec(inward_stmt).first()
        inward = float(inward_row[0] or 0.0) if inward_row else 0.0
        if inward_row and inward_row[1] and not unit:
            unit = inward_row[1]

        # Outward: Sales
        outward_stmt = (
            select(func.sum(VoucherLine.quantity), func.max(VoucherLine.unit))
            .join(Voucher, VoucherLine.voucher_id == Voucher.id)
            .where(
                VoucherLine.stock_item_name == item_name,
                func.upper(Voucher.voucher_type) == "SALES",
                Voucher.is_cancelled == False,
                Voucher.voucher_date >= current_month,
                Voucher.voucher_date <= month_end,
            )
        )
        outward_row = session.exec(outward_stmt).first()
        outward = float(outward_row[0] or 0.0) if outward_row else 0.0
        if outward_row and outward_row[1] and not unit:
            unit = outward_row[1]

        running_balance = running_balance + inward - outward
        monthly_data.append(
            ItemMonthlyData(
                month=current_month.strftime("%Y-%m"),
                inward=round(inward, 3),
                outward=round(outward, 3),
                closing=round(running_balance, 3),
            )
        )
        current_month += relativedelta(months=1)

    return monthly_data, running_balance, unit


@router.get("/items/inventory", response_model=list[ItemInventoryReport])
def item_inventory(
    months: int = Query(default=8, ge=1, le=24, description="Number of months to look back"),
    session: Session = Depends(get_session),
):
    """
    Get item inventory data with inward/outward/closing for last N months.
    Opening balance sourced from StockItem master.
    Inward = Purchases (qty). Outward = Sales (qty).
    """
    # Build opening balance lookup from StockItem master
    opening_map: dict[str, float] = {}
    unit_map: dict[str, str] = {}
    for si in session.exec(select(StockItem)).all():
        if si.name:
            opening_map[si.name] = si.opening_balance or 0.0
            if si.unit_name:
                unit_map[si.name] = si.unit_name

    # Get all unique items that have voucher line entries
    items_stmt = (
        select(VoucherLine.stock_item_name)
        .distinct()
        .where(VoucherLine.stock_item_name.isnot(None))
        .order_by(VoucherLine.stock_item_name)
    )
    item_names = [r for r in session.exec(items_stmt).all() if r]

    results = []
    for item_name in item_names:
        opening = opening_map.get(item_name, 0.0)
        monthly_data, closing, unit = _compute_item_monthly(
            session, item_name, months, opening
        )
        if not unit:
            unit = unit_map.get(item_name)

        if any(m.inward > 0 or m.outward > 0 for m in monthly_data):
            results.append(
                ItemInventoryReport(
                    stock_item_name=item_name,
                    unit=unit,
                    opening=round(opening, 3),
                    monthly_data=monthly_data,
                    closing=round(closing, 3),
                )
            )

    return results


@router.get("/items/inventory/{item_name}", response_model=ItemInventoryReport)
def item_inventory_detail(
    item_name: str,
    months: int = Query(default=8, ge=1, le=24),
    session: Session = Depends(get_session),
):
    """Get detailed monthly inventory for a single stock item."""
    # Get opening balance from StockItem master
    si = session.exec(select(StockItem).where(StockItem.name == item_name)).first()
    opening = si.opening_balance if si else 0.0
    unit_name = si.unit_name if si else None

    monthly_data, closing, unit = _compute_item_monthly(
        session, item_name, months, opening
    )
    if not unit:
        unit = unit_name

    return ItemInventoryReport(
        stock_item_name=item_name,
        unit=unit,
        opening=round(opening, 3),
        monthly_data=monthly_data,
        closing=round(closing, 3),
    )


# ── Aging Report ─────────────────────────────────────────────────────────────


@router.get("/reports/aging", response_model=AgingReport)
def aging_report(
    session: Session = Depends(get_session),
):
    """
    Accounts Receivable and Payable aging.
    Buckets: 0-30, 31-60, 61-90, 91+ days past due date (or voucher date).
    """
    today = datetime.utcnow().date()

    def _aging_for_type(vtype: str, label: str) -> list[AgingBucket]:
        stmt = (
            select(Voucher.party_name, Voucher.amount, Voucher.due_date, Voucher.voucher_date)
            .where(
                func.upper(Voucher.voucher_type) == vtype.upper(),
                Voucher.is_cancelled == False,
                Voucher.amount > 0,
            )
        )
        rows = session.exec(stmt).all()

        buckets = {"0-30": 0.0, "31-60": 0.0, "61-90": 0.0, "91+": 0.0}
        for party, amount, due_dt, voucher_dt in rows:
            ref_date = due_dt or voucher_dt
            if not ref_date:
                continue
            days_overdue = (today - ref_date).days
            if days_overdue <= 0:
                # Not yet due or future – still include in 0-30
                days_overdue = 0
            if days_overdue <= 30:
                buckets["0-30"] += amount
            elif days_overdue <= 60:
                buckets["31-60"] += amount
            elif days_overdue <= 90:
                buckets["61-90"] += amount
            else:
                buckets["91+"] += amount

        return [
            AgingBucket(bucket=k, amount=round(v, 2))
            for k, v in buckets.items()
        ]

    return AgingReport(
        receivables=_aging_for_type("Sales", "Receivables"),
        payables=_aging_for_type("Purchase", "Payables"),
        as_of=str(today),
    )


# ── Export ────────────────────────────────────────────────────────────────────


@router.get("/export/csv")
def export_csv(
    voucher_type: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    session: Session = Depends(get_session),
):
    """Download a CSV of vouchers matching filters."""
    stmt = select(Voucher)
    if voucher_type:
        stmt = stmt.where(Voucher.voucher_type == voucher_type)
    if date_from:
        stmt = stmt.where(Voucher.voucher_date >= date_from)
    if date_to:
        stmt = stmt.where(Voucher.voucher_date <= date_to)
    stmt = stmt.order_by(col(Voucher.voucher_date).desc())

    vouchers = session.exec(stmt).all()

    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "id", "voucher_number", "voucher_type", "voucher_date",
            "party_name", "amount", "gstin", "irn", "narration",
            "place_of_supply", "billing_city",
        ],
    )
    writer.writeheader()
    for v in vouchers:
        writer.writerow({
            "id": v.id,
            "voucher_number": v.voucher_number,
            "voucher_type": v.voucher_type,
            "voucher_date": str(v.voucher_date),
            "party_name": v.party_name or "",
            "amount": v.amount,
            "gstin": v.gstin or "",
            "irn": v.irn or "",
            "narration": v.narration or "",
            "place_of_supply": v.place_of_supply or "",
            "billing_city": v.billing_city or "",
        })

    output.seek(0)
    filename = f"vouchers_{voucher_type or 'all'}_{date.today()}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Masters ───────────────────────────────────────────────────────────────────


@router.get("/ledgers", response_model=list[LedgerRead])
def list_ledgers(
    company_id: Optional[int] = Query(default=None),
    ledger_type: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    stmt = select(Ledger)
    if company_id:
        stmt = stmt.where(Ledger.company_id == company_id)
    if ledger_type:
        stmt = stmt.where(Ledger.ledger_type == ledger_type)
    stmt = stmt.order_by(Ledger.name)
    return session.exec(stmt).all()


@router.get("/items", response_model=list[StockItemRead])
def list_items(
    company_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
):
    stmt = select(StockItem)
    if company_id:
        stmt = stmt.where(StockItem.company_id == company_id)
    stmt = stmt.order_by(StockItem.name)
    return session.exec(stmt).all()


# ── Import logs ───────────────────────────────────────────────────────────────


@router.get("/import-logs", response_model=list[ImportLogRead])
def list_import_logs(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    stmt = (
        select(ImportLog)
        .order_by(col(ImportLog.started_at).desc())
        .limit(limit)
    )
    return session.exec(stmt).all()


# ── Settings ──────────────────────────────────────────────────────────────────


@router.get("/settings", response_model=SettingsRead)
def get_settings():
    w = get_watcher()
    return SettingsRead(
        inbox_path=str(w.inbox),
        watcher_active=w._observer is not None and w._observer.is_alive()
        if w._observer
        else False,
        db_path=settings.DATABASE_URL,
        auth_enabled=settings.AUTH_ENABLED,
    )


@router.post("/settings/rescan", status_code=202)
def rescan_inbox():
    """Trigger a manual rescan of the inbox folder."""
    w = get_watcher()
    import threading
    threading.Thread(target=w.scan_existing, daemon=True).start()
    return {"message": "Rescan started", "inbox": str(w.inbox)}


# ── Voucher types (for filter dropdowns) ─────────────────────────────────────


@router.get("/voucher-types")
def voucher_types(session: Session = Depends(get_session)):
    stmt = select(Voucher.voucher_type).distinct().order_by(Voucher.voucher_type)
    rows = session.exec(stmt).all()
    return [r for r in rows if r]


# ── Companies ─────────────────────────────────────────────────────────────────


@router.get("/companies")
def list_companies(session: Session = Depends(get_session)):
    from app.models.master import Company
    stmt = select(Company).order_by(Company.name)
    companies = session.exec(stmt).all()
    return [{"id": c.id, "name": c.name, "gstin": c.gstin} for c in companies]
