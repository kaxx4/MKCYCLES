// Indian financial year: April 1 to March 31
// Reference: Indian Fiscal Year convention

import type { CanonicalVoucher, CompanyInfo } from "../types/canonical";

export function getFYBounds(fyStartYear: number): { start: Date; end: Date } {
  return {
    start: new Date(fyStartYear, 3, 1, 0, 0, 0),         // April 1 00:00
    end: new Date(fyStartYear + 1, 2, 31, 23, 59, 59),   // March 31 23:59
  };
}

export function getFYFromDate(d: Date): number {
  // April onwards = current year FY, Jan-March = previous year FY
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

export function getCurrentFYStartYear(): number {
  return getFYFromDate(new Date());
}

export function getFYLabel(fyStartYear: number): string {
  const endYear = (fyStartYear + 1).toString().slice(-2);
  return `FY ${fyStartYear}-${endYear}`;
}

// Detect all FYs present in voucher data
export function detectAvailableFYs(vouchers: CanonicalVoucher[]): number[] {
  const fySet = new Set<number>();
  for (const v of vouchers) {
    fySet.add(getFYFromDate(v.date));
  }
  return Array.from(fySet).sort((a, b) => b - a); // newest first
}

// Determine which FY a Master.xml's opening balances belong to
// Heuristic: the earliest voucher date in the file determines FY start
// If no vouchers, assume current FY
export function detectMasterFY(
  vouchers: CanonicalVoucher[],
  company: CompanyInfo | null
): number {
  if (company?.financialYearBegins) {
    // Company master sometimes contains FY start info
    // "April" → current FY
  }
  if (vouchers.length === 0) return getCurrentFYStartYear();
  const earliestDate = vouchers.reduce(
    (min, v) => (v.date < min ? v.date : min),
    vouchers[0]?.date ?? new Date()
  );
  return getFYFromDate(earliestDate);
}
