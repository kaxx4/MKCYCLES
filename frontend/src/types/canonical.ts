// ══ All internal data uses these types ONLY ═══════════════════════════════
// Raw XML types are in src/xml/xmlTypes.ts
// Nothing in pages/components should touch raw XML types directly

export interface ParsedData {
  company: CompanyInfo | null;
  ledgers: Map<string, CanonicalLedger>;      // key = ledger name (normalized)
  stockItems: Map<string, CanonicalStockItem>; // key = item name (normalized)
  units: Map<string, CanonicalUnit>;           // key = unit symbol
  vouchers: CanonicalVoucher[];
  importedAt: Date;
  sourceFiles: string[];
  warnings: ImportWarning[];
}

export interface CompanyInfo {
  name: string;
  gstin?: string;
  stateName?: string;
  financialYearBegins?: string; // e.g. "April" – from COMPANYFISCALYEARSTARTMONTH
}

export interface CanonicalUnit {
  symbol: string;           // "PCS", "KG", etc. (normalized)
  formalName: string;       // "Pieces", "Kilograms"
  isSimple: boolean;
  // For compound units:
  baseUnit?: string;        // The larger unit: "BOX"
  additionalUnit?: string;  // The smaller unit: "PCS"
  conversion?: number;      // 1 BOX = 12 PCS → conversion = 12
}

export interface CanonicalLedger {
  name: string;
  nameNormalized: string;
  parent: string;           // Group: "Sundry Debtors", "Sundry Creditors", etc.
  openingBalance: number;   // Positive = Debit (receivable), Negative = Credit (payable)
  gstin?: string;
  stateName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  creditPeriod: number;     // Days (0 if not set)
}

export interface CanonicalStockItem {
  name: string;             // As exported by Tally (preserve exact case)
  nameNormalized: string;   // UPPERCASE, trimmed, for matching
  group: string;            // Parent stock group (HSN suffix stripped)
  baseUnit: string;         // Normalized: "PCS", "KG", etc.
  // Native Tally compound unit (if configured in Tally):
  alternateUnit?: string;   // e.g. "BOX"
  alternateConversion?: number; // e.g. 12 (1 BOX = 12 PCS)
  hsn?: string;
  gstRate?: number;         // percentage, e.g. 18
  openingQty: number;       // In BASE UNITS. Positive = debit (stock in hand)
  openingValue: number;     // INR, always positive (abs of Tally value)
  openingRate: number;      // openingValue / openingQty (if qty > 0)
  // Source tracking
  openingFYYear: number;    // Which FY start year this opening is for
}

export type VoucherType =
  | "Sales" | "Purchase" | "Receipt" | "Payment" | "Journal" | "Contra"
  | "Debit Note" | "Credit Note"
  | "Sales Order" | "Purchase Order"
  | "Delivery Note" | "Receipt Note"
  | "Rejection In" | "Rejection Out"
  | "Stock Journal" | "Other";

export interface CanonicalVoucherLine {
  // Exactly one of these is set:
  ledgerName?: string;        // Financial line
  stockItemName?: string;     // Inventory line
  // Common fields:
  isDeemedPositive: boolean;  // true=Debit, false=Credit (from ISDEEMEDPOSITIVE)
  isPartyLedger: boolean;
  amount: number;             // Raw from Tally (may be signed)
  // Inventory-specific:
  actualQty?: number;         // In base units (USE THIS for calculations)
  billedQty?: number;         // In base units
  unit?: string;              // Normalized unit
  rate?: number;              // Per base unit
  // Financial-specific:
  isTaxLine?: boolean;
  taxType?: "CGST" | "SGST" | "IGST" | "Cess" | "TDS" | "Other";
  // Bill allocation (on party ledger lines):
  billAllocations: CanonicalBillAllocation[];
}

export interface CanonicalBillAllocation {
  billRef: string;            // Invoice number reference
  billType: "New Ref" | "Agst Ref" | "Advance" | "On Account";
  amount: number;             // Positive = amount on this bill
  dueDate?: Date;             // If available from Tally
}

export interface CanonicalVoucher {
  id: string;                 // Dedup key: `${type}|${number}|${date.toISOString()}`
  voucherNumber: string;
  voucherType: VoucherType;
  date: Date;
  effectiveDate: Date;        // May differ from date
  partyName?: string;
  amount: number;             // Total voucher amount (abs of party ledger line)
  narration?: string;
  gstin?: string;             // Buyer's GSTIN
  placeOfSupply?: string;
  irnNumber?: string;
  // Flags (from XML):
  isOptional: boolean;        // true = Order (pending), NOT a real invoice
  isCancelled: boolean;
  isPostDated: boolean;
  isVoid: boolean;
  isDeleted: boolean;
  // Lines:
  lines: CanonicalVoucherLine[];
}

export interface ImportWarning {
  file: string;
  severity: "fatal" | "warn" | "info";
  element: string;            // e.g. "STOCKITEM:Bell Crown Mini"
  message: string;
}
