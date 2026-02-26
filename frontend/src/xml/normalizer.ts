// ══ XML Object Normalization Layer ════════════════════════════════════════
// Converts raw parsed XML objects into canonical types.
// Raw XML is parsed by fast-xml-parser, which gives us nested objects with
// attributes prefixed by "@" and text nodes as "#text".

import type {
  CanonicalStockItem,
  CanonicalVoucher,
  CanonicalVoucherLine,
  CanonicalBillAllocation,
  CanonicalUnit,
  CanonicalLedger,
  VoucherType,
} from '../types/canonical';

import {
  parseQuantity,
  parseAmount,
  parseRate,
  parseTallyDate,
  parseTallyBool,
  normalizeUnit as normalizeUnitString,
  normalizeGroupName,
  normalizeName,
} from './extractor';

import { getCurrentFYStartYear } from '../engine/financial';

// ══════════════════════════════════════════════════════════════════════════
// Helper: Extract name from various Tally XML patterns
// ══════════════════════════════════════════════════════════════════════════

/**
 * Extract name from raw XML element.
 * Tally uses multiple patterns:
 * - {@_NAME: "value"}
 * - {NAME: "value"}
 * - {NAME.LIST: [{NAME: "value"}]}
 */
function extractName(raw: any): string {
  if (!raw) return '';

  // Try attribute first
  if (raw['@_NAME']) return String(raw['@_NAME']).trim();
  if (raw['@NAME']) return String(raw['@NAME']).trim();

  // Try direct field
  if (raw.NAME && typeof raw.NAME === 'string') {
    return raw.NAME.trim();
  }

  // Try NAME.LIST (for multi-language support)
  if (raw['NAME.LIST'] && Array.isArray(raw['NAME.LIST'])) {
    const first = raw['NAME.LIST'][0];
    if (first?.NAME) {
      return String(first.NAME).trim();
    }
  }

  return '';
}

// ══════════════════════════════════════════════════════════════════════════
// Stock Item Normalization
// ══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a STOCKITEM element into CanonicalStockItem.
 *
 * @param raw - Raw parsed STOCKITEM XML object
 * @param units - Map of available units for validation
 * @returns CanonicalStockItem or null if invalid
 */
export function normalizeStockItem(
  raw: any,
  _units: Map<string, CanonicalUnit>
): CanonicalStockItem | null {
  if (!raw) return null;

  const name = extractName(raw);
  if (!name) return null;

  const nameNormalized = normalizeName(name);

  // Base unit
  const baseUnitRaw = raw.BASEUNITS || raw['@BASEUNITS'] || 'PCS';
  const baseUnit = normalizeUnitString(baseUnitRaw);

  // Opening balances
  const openingQty = parseQuantity(raw.OPENINGBALANCE);
  const openingValue = Math.abs(parseAmount(raw.OPENINGVALUE));
  const openingRate = openingQty > 0 ? openingValue / openingQty : parseRate(raw.OPENINGRATE);

  // Parent group (strip HSN suffix)
  const parentRaw = raw.PARENT || raw['@PARENT'] || '';
  const group = normalizeGroupName(parentRaw);

  // Alternate unit from ADDITIONALUNITS
  let alternateUnit: string | undefined;
  let alternateConversion: number | undefined;

  if (raw.ADDITIONALUNITS) {
    const altUnitRaw = raw.ADDITIONALUNITS;
    alternateUnit = normalizeUnitString(altUnitRaw);

    // Try to find conversion factor
    if (raw.CONVERSION) {
      alternateConversion = parseQuantity(raw.CONVERSION);
    }
  }

  // GST details (nested in GSTDETAILS.LIST)
  let hsn: string | undefined;
  let gstRate: number | undefined;

  if (raw['GSTDETAILS.LIST'] && Array.isArray(raw['GSTDETAILS.LIST'])) {
    const gstDetails = raw['GSTDETAILS.LIST'][0];
    if (gstDetails) {
      hsn = gstDetails.HSNCODE || gstDetails.HSNUMBER;
      if (hsn) {
        hsn = String(hsn).trim();
      }

      const gstRateStr = gstDetails.GSTRATE || gstDetails.TAXRATE;
      if (gstRateStr) {
        gstRate = parseRate(gstRateStr);
      }
    }
  }

  // Determine FY year for opening balance
  const openingFYYear = getCurrentFYStartYear();

  return {
    name,
    nameNormalized,
    group,
    baseUnit,
    alternateUnit,
    alternateConversion,
    hsn,
    gstRate,
    openingQty,
    openingValue,
    openingRate,
    openingFYYear,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Unit Normalization
// ══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a UNIT element into CanonicalUnit.
 *
 * Units can be:
 * - Simple: {NAME: "PCS", ISSIMPLEUNIT: "Yes"}
 * - Compound: {NAME: "BOX", BASEUNITS: "PCS", ADDITIONALUNITS: "BOX", CONVERSION: "12"}
 */
export function normalizeUnit(raw: any): CanonicalUnit | null {
  if (!raw) return null;

  const name = extractName(raw);
  if (!name) return null;

  const symbol = normalizeUnitString(name);
  const formalName = name; // Keep original case for display

  const isSimple = parseTallyBool(raw.ISSIMPLEUNIT);

  if (isSimple) {
    return {
      symbol,
      formalName,
      isSimple: true,
    };
  }

  // Compound unit
  const baseUnitRaw = raw.BASEUNITS;
  const additionalUnitRaw = raw.ADDITIONALUNITS;
  const conversionStr = raw.CONVERSION;

  if (!baseUnitRaw || !additionalUnitRaw) {
    // Treat as simple if compound fields missing
    return {
      symbol,
      formalName,
      isSimple: true,
    };
  }

  return {
    symbol,
    formalName,
    isSimple: false,
    baseUnit: normalizeUnitString(baseUnitRaw),
    additionalUnit: normalizeUnitString(additionalUnitRaw),
    conversion: parseQuantity(conversionStr),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Ledger Normalization
// ══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a LEDGER element into CanonicalLedger.
 */
export function normalizeLedger(raw: any): CanonicalLedger | null {
  if (!raw) return null;

  const name = extractName(raw);
  if (!name) return null;

  const nameNormalized = normalizeName(name);

  // Parent group
  const parent = raw.PARENT || raw['@PARENT'] || '';

  // Opening balance (positive = debit, negative = credit)
  const openingBalance = parseAmount(raw.OPENINGBALANCE);

  // Contact details
  const gstin = raw.GSTIN || raw.PARTYGSTIN;
  const stateName = raw.STATENAME || raw.LEDSTATENAME;
  const email = raw.EMAIL || raw.EMAILID;
  const phone = raw.PHONE || raw.PHONENUMBER;
  const mobile = raw.MOBILE || raw.MOBILENUMBER;

  // Credit period (days)
  const creditPeriodStr = raw.CREDITPERIOD || raw.CREDITDAYS || '0';
  const creditPeriod = parseQuantity(creditPeriodStr);

  return {
    name,
    nameNormalized,
    parent,
    openingBalance,
    gstin: gstin ? String(gstin).trim() : undefined,
    stateName: stateName ? String(stateName).trim() : undefined,
    email: email ? String(email).trim() : undefined,
    phone: phone ? String(phone).trim() : undefined,
    mobile: mobile ? String(mobile).trim() : undefined,
    creditPeriod,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Voucher Type Normalization
// ══════════════════════════════════════════════════════════════════════════

/**
 * Normalize Tally voucher type string to canonical VoucherType.
 */
export function normalizeVoucherType(raw: string | undefined | null): VoucherType {
  if (!raw) return 'Other';

  const normalized = raw.trim().toLowerCase();

  if (normalized.includes('sales')) return 'Sales';
  if (normalized.includes('purchase')) return 'Purchase';
  if (normalized.includes('receipt')) return 'Receipt';
  if (normalized.includes('payment')) return 'Payment';
  if (normalized.includes('journal')) return 'Journal';
  if (normalized.includes('contra')) return 'Contra';
  if (normalized.includes('debit note')) return 'Debit Note';
  if (normalized.includes('credit note')) return 'Credit Note';
  if (normalized.includes('sales order')) return 'Sales Order';
  if (normalized.includes('purchase order')) return 'Purchase Order';
  if (normalized.includes('delivery note')) return 'Delivery Note';
  if (normalized.includes('receipt note')) return 'Receipt Note';
  if (normalized.includes('rejection in')) return 'Rejection In';
  if (normalized.includes('rejection out')) return 'Rejection Out';
  if (normalized.includes('stock journal')) return 'Stock Journal';

  return 'Other';
}

/**
 * Normalize bill type string.
 */
export function normalizeBillType(
  raw: string | undefined | null
): "New Ref" | "Agst Ref" | "Advance" | "On Account" {
  if (!raw) return 'On Account';

  const normalized = raw.trim().toLowerCase();

  if (normalized.includes('new ref')) return 'New Ref';
  if (normalized.includes('agst ref')) return 'Agst Ref';
  if (normalized.includes('advance')) return 'Advance';

  return 'On Account';
}

/**
 * Detect tax type from ledger name.
 */
export function detectTaxType(
  ledgerName: string
): "CGST" | "SGST" | "IGST" | "Cess" | "TDS" | "Other" | undefined {
  if (!ledgerName) return undefined;

  const normalized = ledgerName.trim().toLowerCase();

  if (normalized.includes('cgst')) return 'CGST';
  if (normalized.includes('sgst')) return 'SGST';
  if (normalized.includes('igst')) return 'IGST';
  if (normalized.includes('cess')) return 'Cess';
  if (normalized.includes('tds')) return 'TDS';

  // Common tax ledger patterns
  if (normalized.includes('tax') || normalized.includes('gst')) {
    return 'Other';
  }

  return undefined;
}

// ══════════════════════════════════════════════════════════════════════════
// Voucher Line Normalization
// ══════════════════════════════════════════════════════════════════════════

/**
 * Normalize an INVENTORYENTRIES.LIST or ALLINVENTORYENTRIES.LIST element.
 */
export function normalizeInventoryEntry(raw: any): CanonicalVoucherLine {
  const stockItemName = extractName(raw) || raw.STOCKITEMNAME || '';

  // Quantities (use ACTUALQTY for calculations)
  const actualQty = parseQuantity(raw.ACTUALQTY);
  const billedQty = parseQuantity(raw.BILLEDQTY);

  // Rate and amount
  const rate = parseRate(raw.RATE);
  const amount = parseAmount(raw.AMOUNT);

  // Unit
  const unitRaw = raw.UNIT || raw.UOM || 'PCS';
  const unit = normalizeUnitString(unitRaw);

  // Direction (debit/credit)
  const isDeemedPositive = parseTallyBool(raw.ISDEEMEDPOSITIVE);

  return {
    stockItemName,
    isDeemedPositive,
    isPartyLedger: false,
    amount,
    actualQty,
    billedQty,
    unit,
    rate,
    billAllocations: [],
  };
}

/**
 * Normalize a LEDGERENTRIES.LIST or ALLLEDGERENTRIES.LIST element.
 * Returns an array because a single ledger entry may have multiple bill allocations.
 */
export function normalizeLedgerEntry(raw: any): CanonicalVoucherLine[] {
  const ledgerName = extractName(raw) || raw.LEDGERNAME || '';
  if (!ledgerName) return [];

  const amount = parseAmount(raw.AMOUNT);
  const isDeemedPositive = parseTallyBool(raw.ISDEEMEDPOSITIVE);

  // Detect if this is a party ledger (has bill allocations)
  const isPartyLedger = parseTallyBool(raw.ISPARTYLEDGER);

  // Detect tax type
  const taxType = detectTaxType(ledgerName);
  const isTaxLine = taxType !== undefined;

  // Parse bill allocations
  const billAllocations: CanonicalBillAllocation[] = [];

  if (raw['BILLALLOCATIONS.LIST'] && Array.isArray(raw['BILLALLOCATIONS.LIST'])) {
    for (const billRaw of raw['BILLALLOCATIONS.LIST']) {
      const billRef = billRaw.NAME || billRaw.BILLNAME || '';
      if (!billRef) continue;

      const billTypeRaw = billRaw.BILLTYPE || 'On Account';
      const billType = normalizeBillType(billTypeRaw);

      const billAmount = Math.abs(parseAmount(billRaw.AMOUNT));

      const dueDateStr = billRaw.DUEDATE || billRaw.BILLDATE;
      const dueDate = parseTallyDate(dueDateStr);

      billAllocations.push({
        billRef,
        billType,
        amount: billAmount,
        dueDate,
      });
    }
  }

  // Return single line
  return [{
    ledgerName,
    isDeemedPositive,
    isPartyLedger,
    amount,
    isTaxLine,
    taxType,
    billAllocations,
  }];
}

// ══════════════════════════════════════════════════════════════════════════
// Voucher Normalization
// ══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a VOUCHER element into CanonicalVoucher.
 */
export function normalizeVoucher(raw: any): CanonicalVoucher | null {
  if (!raw) return null;

  // Extract voucher number
  const voucherNumber = raw.VOUCHERNUMBER || raw['@VOUCHERNUMBER'] || '';
  if (!voucherNumber) return null;

  // Extract voucher type
  const voucherTypeRaw = raw.VOUCHERTYPE || raw.VOUCHERTYPENAME || 'Other';
  const voucherType = normalizeVoucherType(voucherTypeRaw);

  // Extract dates
  const dateStr = raw.DATE || raw['@DATE'];
  const date = parseTallyDate(dateStr);
  if (!date) return null;

  const effectiveDateStr = raw.EFFECTIVEDATE || dateStr;
  const effectiveDate = parseTallyDate(effectiveDateStr) || date;

  // Extract party name
  const partyName = raw.PARTYNAME || raw.PARTYLEDGERNAME;

  // Narration
  const narration = raw.NARRATION;

  // GST details
  const gstin = raw.PARTYGSTIN || raw.CONSIGNEEGSTIN;
  const placeOfSupply = raw.PLACEOFSUPPLY;
  const irnNumber = raw.IRN || raw.IRNNUMBER;

  // Flags
  const isOptional = parseTallyBool(raw.ISOPTIONAL);
  const isCancelled = parseTallyBool(raw.ISCANCELLED);
  const isPostDated = parseTallyBool(raw.ISPOSTDATED);
  const isVoid = parseTallyBool(raw.ISVOID);
  const isDeleted = parseTallyBool(raw.ISDELETED);

  // Process lines
  const lines: CanonicalVoucherLine[] = [];

  // Process ledger entries
  const allLedgerEntries = raw['ALLLEDGERENTRIES.LIST'] || [];
  const ledgerEntries = raw['LEDGERENTRIES.LIST'] || [];
  const combinedLedger = [...allLedgerEntries, ...ledgerEntries];

  for (const ledgerRaw of combinedLedger) {
    const ledgerLines = normalizeLedgerEntry(ledgerRaw);
    lines.push(...ledgerLines);
  }

  // Process inventory entries
  const allInventoryEntries = raw['ALLINVENTORYENTRIES.LIST'] || [];
  const inventoryEntries = raw['INVENTORYENTRIES.LIST'] || [];
  const combinedInventory = [...allInventoryEntries, ...inventoryEntries];

  for (const invRaw of combinedInventory) {
    const invLine = normalizeInventoryEntry(invRaw);
    lines.push(invLine);

    // Process nested inventory allocations (batch/godown allocations)
    if (invRaw['INVENTORYALLOCATIONS.LIST']) {
      const allocations = invRaw['INVENTORYALLOCATIONS.LIST'];
      if (Array.isArray(allocations)) {
        for (const _allocRaw of allocations) {
          // Inventory allocations are sub-items, merge into parent line
          // For now, we'll skip detailed allocation tracking
          // In a full implementation, you might aggregate these
        }
      }
    }
  }

  // Compute total amount from party ledger line
  let amount = 0;
  const partyLine = lines.find(l => l.isPartyLedger);
  if (partyLine) {
    amount = Math.abs(partyLine.amount);
  } else {
    // Fallback: sum of inventory lines
    amount = lines
      .filter(l => l.stockItemName)
      .reduce((sum, l) => sum + Math.abs(l.amount), 0);
  }

  // Build ID for deduplication
  const id = `${voucherType}|${voucherNumber}|${date.toISOString()}`;

  return {
    id,
    voucherNumber,
    voucherType,
    date,
    effectiveDate,
    partyName: partyName ? String(partyName).trim() : undefined,
    amount,
    narration: narration ? String(narration).trim() : undefined,
    gstin: gstin ? String(gstin).trim() : undefined,
    placeOfSupply: placeOfSupply ? String(placeOfSupply).trim() : undefined,
    irnNumber: irnNumber ? String(irnNumber).trim() : undefined,
    isOptional,
    isCancelled,
    isPostDated,
    isVoid,
    isDeleted,
    lines,
  };
}
