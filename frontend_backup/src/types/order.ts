export interface VendorGroup {
  name: string;
  parent: string | null;
  base_unit: string;
}

export interface OrderItem {
  name: string;
  group: string;
  base_unit: string;
  pkg_factor: number | null;
  current_closing_base: number;
  current_closing_pkg: number | null;
  suggestion_pkg: number | null;
  suggestion_base: number;
  avg_monthly_outward: number;
}

export interface OrderMonthlyRow {
  month: string;       // "YYYY-MM"
  opening: number;
  inward: number;
  outward: number;
  closing: number;
}

export interface OrderExportRow {
  item_name: string;
  group?: string;
  qty_pkg: number;
  qty_base: number;
  uom: string;
  current_stock: number;
  suggestion_pkg?: number;
  remarks?: string;
}

export interface ComplianceIssue {
  voucher_id: number;
  voucher_number: string;
  voucher_type: string;
  voucher_date: string;
  party_name: string | null;
  issues: string[];
}

// ── Item Rate Override types ──────────────────────────────────────────────────
// Stored in backend/data/item_rate_overrides.json
// These ALWAYS take precedence over Tally XML-derived rates.

export interface RateOverride {
  item_name: string;
  /** Price per package (PKG rate), e.g. 1500.00 per box */
  pkg_rate: number | null;
  /** Price per individual unit (PCS rate), e.g. 5.00 per piece */
  unit_rate: number | null;
  last_modified: string | null;
  /** Advisory warnings returned on save (e.g. ">30% change") */
  warnings?: string[];
}

export interface RateOverrideIn {
  pkg_rate?: number | null;
  unit_rate?: number | null;
}

export interface ChangeLogEntry {
  item: string;
  field: "pkg_rate" | "unit_rate";
  old_value: number | null;
  new_value: number;
  timestamp: string;
}

// ── Master Override types ─────────────────────────────────────────────────────
// Stored in backend/data/master_overrides.json
// These ALWAYS take precedence over Tally XML / MKCP source data.

export interface MasterOverride {
  item_name: string;
  /** Override base unit (e.g. "PCS", "KG") */
  base_unit?: string | null;
  /** Override pkg_factor (items per package) */
  pkg_factor?: number | null;
  /** Override vendor group */
  group?: string | null;
  /** Override HSN/SAC code */
  hsn_code?: string | null;
  /** Override GST rate (%) */
  gst_rate?: number | null;
  /** Free text notes */
  notes?: string | null;
  last_modified?: string | null;
}

export interface MasterOverrideIn {
  base_unit?: string | null;
  pkg_factor?: number | null;
  group?: string | null;
  hsn_code?: string | null;
  gst_rate?: number | null;
  notes?: string | null;
}
