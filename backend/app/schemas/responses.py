"""Pydantic response schemas for API endpoints."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    db: str
    version: str = "1.0.0"
    inbox: str


class ImportResponse(BaseModel):
    id: int
    file_name: str
    status: str
    vouchers_inserted: int
    vouchers_updated: int
    masters_processed: int
    error_message: Optional[str]
    warnings: Optional[list[str]]
    started_at: datetime
    finished_at: Optional[datetime]


class VoucherLineRead(BaseModel):
    id: int
    ledger_name: str
    amount: float
    is_tax_line: bool
    tax_head: Optional[str]
    tax_rate: Optional[float]
    stock_item_name: Optional[str]
    quantity: Optional[float]
    unit: Optional[str]
    rate: Optional[float]
    order: int

    class Config:
        from_attributes = True


class VoucherRead(BaseModel):
    id: int
    voucher_number: str
    voucher_type: str
    voucher_date: date
    party_name: Optional[str]
    party_ledger: Optional[str]
    amount: float
    narration: Optional[str]
    irn: Optional[str]
    gstin: Optional[str]
    place_of_supply: Optional[str]
    billing_city: Optional[str]
    reference_number: Optional[str]
    due_date: Optional[date]
    is_cancelled: bool
    company_id: Optional[int]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VoucherDetail(VoucherRead):
    raw_xml: Optional[str]
    lines: list[VoucherLineRead] = []


class VoucherListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[VoucherRead]


class KPIResponse(BaseModel):
    total_sales: float
    total_purchases: float
    net_revenue: float
    gst_collected: float
    gst_paid: float
    outstanding_receivables: float
    outstanding_payables: float
    total_vouchers: int
    date_from: Optional[str]
    date_to: Optional[str]


class MonthlyDataPoint(BaseModel):
    month: str  # "YYYY-MM"
    sales: float
    purchases: float
    gst_collected: float


class TopCustomer(BaseModel):
    party_name: str
    total_amount: float
    voucher_count: int


class TopItem(BaseModel):
    stock_item_name: str
    total_quantity: float
    total_amount: float
    voucher_count: int


class ItemMonthlyData(BaseModel):
    month: str  # "YYYY-MM"
    inward: float  # Purchases/Receipts quantity
    outward: float  # Sales quantity
    closing: float  # Closing balance (inward - outward)


class ItemInventoryReport(BaseModel):
    """Item inventory tracking with monthly breakdown."""
    stock_item_name: str
    unit: Optional[str]
    opening: float  # Opening balance
    monthly_data: list[ItemMonthlyData]
    closing: float  # Final closing balance


class LedgerRead(BaseModel):
    id: int
    name: str
    parent_group: Optional[str]
    mailing_name: Optional[str]
    gstin: Optional[str]
    ledger_type: Optional[str]
    opening_balance: float

    class Config:
        from_attributes = True


class StockItemRead(BaseModel):
    id: int
    name: str
    unit_name: Optional[str]
    category: Optional[str]
    hsn_code: Optional[str]
    gst_rate: Optional[float]
    standard_rate: Optional[float]
    opening_balance: float

    class Config:
        from_attributes = True


class SettingsRead(BaseModel):
    inbox_path: str
    watcher_active: bool
    db_path: str
    auth_enabled: bool


class ImportLogRead(BaseModel):
    id: int
    file_name: str
    file_type: str
    status: str
    vouchers_processed: int
    vouchers_inserted: int
    vouchers_updated: int
    masters_processed: int
    error_message: Optional[str]
    started_at: datetime
    finished_at: Optional[datetime]

    class Config:
        from_attributes = True


class AgingBucket(BaseModel):
    bucket: str   # "0-30", "31-60", "61-90", "91+"
    amount: float


class AgingReport(BaseModel):
    receivables: list[AgingBucket]
    payables: list[AgingBucket]
    as_of: str    # ISO date string
