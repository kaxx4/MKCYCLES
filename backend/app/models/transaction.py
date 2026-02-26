"""SQLModel models for Tally transaction data (vouchers, lines, import log)."""
from typing import Optional
from datetime import date, datetime
from sqlmodel import SQLModel, Field


class Voucher(SQLModel, table=True):
    """A single Tally voucher (invoice, payment, receipt, journal, etc.)."""

    __tablename__ = "vouchers"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: Optional[int] = Field(default=None, foreign_key="companies.id", index=True)

    # Core identification
    voucher_number: str = Field(index=True)
    voucher_type: str = Field(index=True)  # Sales, Purchase, Receipt, Payment, Journal …
    voucher_date: date = Field(index=True)

    # Party info
    party_name: Optional[str] = Field(default=None, index=True)
    party_ledger: Optional[str] = Field(default=None, index=True)

    # Financial
    amount: float = Field(default=0.0)
    narration: Optional[str] = None

    # GST / IRN
    irn: Optional[str] = Field(default=None, index=True, unique=True)
    ack_no: Optional[str] = None
    ack_date: Optional[str] = None
    gstin: Optional[str] = None
    place_of_supply: Optional[str] = None
    billing_city: Optional[str] = None

    # Reference
    reference_number: Optional[str] = None
    due_date: Optional[date] = None
    is_cancelled: bool = Field(default=False)

    # Raw XML stored for drilldown
    raw_xml: Optional[str] = Field(default=None)  # sanitized XML text

    # Deduplication composite key (used when IRN absent)
    # Enforced at app level for flexibility
    dedup_key: Optional[str] = Field(default=None, index=True)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class VoucherLine(SQLModel, table=True):
    """A single ledger entry line within a voucher."""

    __tablename__ = "voucher_lines"

    id: Optional[int] = Field(default=None, primary_key=True)
    voucher_id: int = Field(foreign_key="vouchers.id", index=True)

    # Ledger entry
    ledger_name: str = Field(index=True)
    amount: float = Field(default=0.0)  # positive = debit, negative = credit (Tally convention)

    # Classification helpers
    is_tax_line: bool = Field(default=False)
    tax_head: Optional[str] = None  # CGST, SGST, IGST, Cess …
    tax_rate: Optional[float] = None

    # Stock item details (if applicable)
    stock_item_name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    rate: Optional[float] = None
    discount: Optional[float] = None

    # GST allocation fields
    gstin_of_party: Optional[str] = None

    order: int = Field(default=0)  # line order within voucher


class ImportLog(SQLModel, table=True):
    """Audit log of every file import attempt."""

    __tablename__ = "import_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    file_path: str
    file_name: str
    file_type: str  # "master" or "transaction"
    status: str  # "success", "partial", "error"
    vouchers_processed: int = Field(default=0)
    vouchers_inserted: int = Field(default=0)
    vouchers_updated: int = Field(default=0)
    masters_processed: int = Field(default=0)
    error_message: Optional[str] = None
    warnings: Optional[str] = None  # JSON list of warning messages
    started_at: datetime = Field(default_factory=datetime.utcnow)
    finished_at: Optional[datetime] = None
