"""SQLModel models for Advanced Order Mode data (vendor groups, alternate units, item-group mappings)."""
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class VendorGroup(SQLModel, table=True):
    """Stock group / vendor group parsed from STOCK GROUPS.xml."""

    __tablename__ = "vendor_groups"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    parent: Optional[str] = Field(default=None)
    base_unit: str = Field(default="PCS")   # PKG or PCS from BASEUNITS element
    guid: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AlternateUnit(SQLModel, table=True):
    """
    Package-to-base-unit conversion factor for a stock item.
    Parsed from PRICE LIST ST.xml FULLPRICELIST RATE field.
    The user stores items-per-package as the "price" (e.g. RATE = '300.00/PKG' → factor = 300).
    """

    __tablename__ = "alternate_units"

    id: Optional[int] = Field(default=None, primary_key=True)
    item_name: str = Field(index=True, unique=True)
    pkg_factor: float = Field(default=1.0)   # number of base units (PCS) per 1 PKG
    pkg_unit: str = Field(default="PKG")
    base_unit: str = Field(default="PCS")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ItemGroupMapping(SQLModel, table=True):
    """Maps stock item name to vendor group name (from STOCK ITEM.xml PARENT field)."""

    __tablename__ = "item_group_mappings"

    id: Optional[int] = Field(default=None, primary_key=True)
    item_name: str = Field(index=True, unique=True)
    group_name: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
