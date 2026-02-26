// ══ Field Value Extraction Utilities ═══════════════════════════════════════
// Safe parsers for Tally XML strings → typed values

/**
 * Parse Tally quantity/amount strings.
 * Tally exports: "1234.50" or "-1234.50"
 * Returns 0 if empty/invalid.
 */
export function parseQuantity(val: string | undefined | null): number {
  if (!val) return 0;
  const trimmed = val.trim();
  if (trimmed === '') return 0;
  const parsed = parseFloat(trimmed);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Alias for parseQuantity (same logic).
 */
export function parseAmount(val: string | undefined | null): number {
  return parseQuantity(val);
}

/**
 * Parse Tally rate strings (may have trailing spaces/units in some exports).
 * Returns 0 if invalid.
 */
export function parseRate(val: string | undefined | null): number {
  if (!val) return 0;
  const trimmed = val.trim();
  // Remove non-numeric suffix (e.g. "123.45 Per Unit")
  const match = trimmed.match(/^-?[\d.]+/);
  if (!match) return 0;
  const parsed = parseFloat(match[0]);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse Tally date format: "YYYYMMDD" → Date object.
 * Returns undefined if invalid.
 */
export function parseTallyDate(val: string | undefined | null): Date | undefined {
  if (!val) return undefined;
  const trimmed = val.trim();
  if (trimmed.length !== 8) return undefined;

  const year = parseInt(trimmed.substring(0, 4), 10);
  const month = parseInt(trimmed.substring(4, 6), 10);
  const day = parseInt(trimmed.substring(6, 8), 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return undefined;
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > 31) return undefined;

  return new Date(year, month - 1, day);
}

/**
 * Parse Tally boolean strings.
 * Tally uses "Yes"/"No" for booleans.
 */
export function parseTallyBool(val: string | undefined | null): boolean {
  if (!val) return false;
  return val.trim().toLowerCase() === 'yes';
}

/**
 * Normalize unit symbol: uppercase, strip spaces.
 * "pcs" → "PCS", " Kg " → "KG"
 */
export function normalizeUnit(val: string | undefined | null): string {
  if (!val) return '';
  return val.trim().toUpperCase();
}

/**
 * Normalize stock group name by stripping HSN suffix pattern.
 * "BICYCLE ( 87120010 )" → "BICYCLE"
 * "BELL CROWN MINI" → "BELL CROWN MINI" (unchanged)
 */
export function normalizeGroupName(val: string | undefined | null): string {
  if (!val) return '';
  const trimmed = val.trim();
  // Strip " ( <digits> )" at end
  return trimmed.replace(/\s*\(\s*\d+\s*\)\s*$/g, '');
}

/**
 * Normalize ledger/item name for map keys: uppercase + trim.
 */
export function normalizeName(val: string | undefined | null): string {
  if (!val) return '';
  return val.trim().toUpperCase();
}
