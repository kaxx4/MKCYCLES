"""SQLModel models for Tally master data (companies, ledgers, units, stock items)."""
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class Company(SQLModel, table=True):
    """Represents a Tally company detected from XML."""

    __tablename__ = "companies"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    gstin: Optional[str] = Field(default=None, index=True)
    address: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Ledger(SQLModel, table=True):
    """Tally ledger master entry (LEDGER node in Master.xml)."""

    __tablename__ = "ledgers"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: Optional[int] = Field(default=None, foreign_key="companies.id", index=True)
    name: str = Field(index=True)
    parent_group: Optional[str] = Field(default=None, index=True)
    mailing_name: Optional[str] = None
    gstin: Optional[str] = Field(default=None, index=True)
    pan: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    opening_balance: float = Field(default=0.0)
    # e.g. "Sundry Debtors", "Sundry Creditors", "Duties & Taxes"
    ledger_type: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        # Compound uniqueness enforced at app level (name + company_id)
        pass


class Unit(SQLModel, table=True):
    """Tally unit of measure master (UNIT node)."""

    __tablename__ = "units"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: Optional[int] = Field(default=None, foreign_key="companies.id", index=True)
    name: str = Field(index=True)
    symbol: Optional[str] = None
    formal_name: Optional[str] = None
    is_simple_unit: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StockItem(SQLModel, table=True):
    """Tally stock item master (STOCKITEM node)."""

    __tablename__ = "stock_items"

    id: Optional[int] = Field(default=None, primary_key=True)
    company_id: Optional[int] = Field(default=None, foreign_key="companies.id", index=True)
    name: str = Field(index=True)
    unit_name: Optional[str] = None
    base_units: Optional[str] = None
    category: Optional[str] = None
    gst_applicable: bool = Field(default=False)
    hsn_code: Optional[str] = None
    gst_rate: Optional[float] = None
    standard_rate: Optional[float] = None
    opening_balance: float = Field(default=0.0)
    opening_value: float = Field(default=0.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
