import type { CanonicalStockItem, CanonicalVoucher } from "../types/canonical";
import { getFYBounds } from "./financial";

// Voucher types that move stock INWARD (increase closing balance)
// Source: https://help.tallysolutions.com/stock-items-faq/
export const INWARD_VOUCHER_TYPES = new Set([
  "Purchase",
  "Receipt Note",      // Goods received before purchase invoice
  "Rejection In",      // Customer returns goods back to you
  "Credit Note",       // Sales return (when ISDEEMEDPOSITIVE=Yes on inventory line)
  "Stock Journal",     // Depends on ISDEEMEDPOSITIVE per line
]);

// Voucher types that move stock OUTWARD (decrease closing balance)
export const OUTWARD_VOUCHER_TYPES = new Set([
  "Sales",
  "Delivery Note",     // Goods dispatched before sales invoice
  "Rejection Out",     // You return goods to supplier
  "Debit Note",        // Purchase return (when ISDEEMEDPOSITIVE=No on inventory line)
  "Stock Journal",     // Depends on ISDEEMEDPOSITIVE per line
]);

// IMPORTANT: For Stock Journal and Credit/Debit Notes, the actual direction
// is determined by ISDEEMEDPOSITIVE on each inventory line, not the type.
// The INWARD_TYPES / OUTWARD_TYPES sets are a secondary cross-check.

export interface InventoryPeriod {
  itemName: string;
  unit: string;
  periodStart: Date;
  periodEnd: Date;
  openingQty: number;
  inwardQty: number;
  outwardQty: number;
  closingQty: number;
  // Additional diagnostics
  inwardVoucherCount: number;
  outwardVoucherCount: number;
}

export function computeItemInventory(
  item: CanonicalStockItem,
  vouchers: CanonicalVoucher[],
  fyStartYear: number,
  periodStart: Date,
  periodEnd: Date
): InventoryPeriod {
  const fyBounds = getFYBounds(fyStartYear);

  // Filter vouchers to only those that can affect this item
  // (skip orders, cancelled, void, deleted, post-dated future ones)
  const effectiveVouchers = vouchers.filter((v) => {
    if (v.isOptional) return false;   // Orders – never affect stock
    if (v.isCancelled) return false;
    if (v.isVoid) return false;
    if (v.isDeleted) return false;
    // Include post-dated only if their date is <= today
    if (v.isPostDated && v.date > new Date()) return false;
    return true;
  });

  // ── Step 1-4: Compute opening for this period ──────────────────────────
  // Master opening is at FY start. We need to walk forward to periodStart.
  let openingQty = item.openingQty;

  for (const v of effectiveVouchers) {
    // Only pre-period transactions (from FY start, before periodStart)
    if (v.date < fyBounds.start) continue;
    if (v.date >= periodStart) continue;

    for (const line of v.lines) {
      if (line.stockItemName !== item.name) continue;
      if (line.actualQty == null || line.actualQty === 0) continue;

      // Use ISDEEMEDPOSITIVE as the direction indicator
      // (more reliable than voucher type name)
      if (line.isDeemedPositive) {
        openingQty += line.actualQty;
      } else {
        openingQty -= line.actualQty;
      }
    }
  }

  // ── Steps 5-7: Compute inward/outward within period ───────────────────
  let inwardQty = 0;
  let outwardQty = 0;

  const inwardVoucherIds = new Set<string>();
  const outwardVoucherIds = new Set<string>();

  for (const v of effectiveVouchers) {
    if (v.date < periodStart) continue;
    if (v.date > periodEnd) continue;

    for (const line of v.lines) {
      if (line.stockItemName !== item.name) continue;
      if (line.actualQty == null || line.actualQty === 0) continue;

      if (line.isDeemedPositive) {
        inwardQty += line.actualQty;
        inwardVoucherIds.add(v.id);
      } else {
        outwardQty += line.actualQty;
        outwardVoucherIds.add(v.id);
      }
    }
  }

  return {
    itemName: item.name,
    unit: item.baseUnit,
    periodStart,
    periodEnd,
    openingQty: Math.round(openingQty * 1000) / 1000,  // 3dp to avoid float drift
    inwardQty: Math.round(inwardQty * 1000) / 1000,
    outwardQty: Math.round(outwardQty * 1000) / 1000,
    closingQty: Math.round((openingQty + inwardQty - outwardQty) * 1000) / 1000,
    inwardVoucherCount: inwardVoucherIds.size,
    outwardVoucherCount: outwardVoucherIds.size,
  };
}

// ── 8-month history for Orders page ───────────────────────────────────────
export function computeMonthlyHistory(
  item: CanonicalStockItem,
  vouchers: CanonicalVoucher[],
  fyStartYear: number,
  monthCount: number = 8
): InventoryPeriod[] {
  const results: InventoryPeriod[] = [];
  const today = new Date();

  for (let i = monthCount - 1; i >= 0; i--) {
    // Period: first day to last day of each past month
    const year = today.getFullYear();
    const month = today.getMonth() - i;
    const periodStart = new Date(year, month, 1);
    const periodEnd = new Date(year, month + 1, 0, 23, 59, 59);

    results.push(
      computeItemInventory(item, vouchers, fyStartYear, periodStart, periodEnd)
    );
  }

  return results;
}

// ── Current FY totals for an item ─────────────────────────────────────────
export function computeItemFYSummary(
  item: CanonicalStockItem,
  vouchers: CanonicalVoucher[],
  fyStartYear: number
): InventoryPeriod {
  const fyBounds = getFYBounds(fyStartYear);
  return computeItemInventory(
    item, vouchers, fyStartYear, fyBounds.start, fyBounds.end
  );
}

// ── Validate calculations (for import report) ─────────────────────────────
// Cross-checks: closing should be non-negative (usually), opening + inward - outward = closing
export function validateInventory(periods: InventoryPeriod[]): string[] {
  const warnings: string[] = [];
  for (const p of periods) {
    const computed = p.openingQty + p.inwardQty - p.outwardQty;
    if (Math.abs(computed - p.closingQty) > 0.001) {
      warnings.push(
        `${p.itemName}: Closing mismatch. Expected ${computed}, got ${p.closingQty}`
      );
    }
    // Negative closing is VALID in Tally (can happen with back-dated entries)
    // Just flag it, don't treat as error
    if (p.closingQty < 0) {
      warnings.push(`${p.itemName}: Negative closing balance (${p.closingQty} ${p.unit})`);
    }
  }
  return warnings;
}
