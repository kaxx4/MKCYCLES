export type UnitMode = "BASE" | "PKG";

export interface ItemUnitConfig {
  itemName: string;
  baseUnit: string;        // "PCS"
  pkgUnit: string;         // "PKG", "BOX", "CARTON", etc.
  unitsPerPkg: number;     // How many base units in 1 package
  source: "tally" | "manual";  // "tally" = from Tally compound unit, "manual" = user input
}

/**
 * Format a base quantity for display in current unit mode.
 * THE ONLY function that should do unit conversion anywhere in the app.
 *
 * @param baseQty - Quantity in base units (always what's stored)
 * @param config  - Item's unit config (null if no pkg config exists)
 * @param mode    - Current global display mode
 * @returns Display string + numeric value + unit label
 *
 * Examples:
 *   formatQty(300, {pkgUnit:"BOX", unitsPerPkg:12}, "PKG") → "25 BOX"
 *   formatQty(300, {pkgUnit:"BOX", unitsPerPkg:12}, "BASE") → "300 PCS"
 *   formatQty(7, {pkgUnit:"BOX", unitsPerPkg:12}, "PKG") → "0.58 BOX" (partial pkg)
 */
export function formatQty(
  baseQty: number,
  config: ItemUnitConfig | null,
  mode: UnitMode
): { value: number; label: string; formatted: string } {
  if (mode === "PKG" && config && config.unitsPerPkg > 0) {
    const pkgQty = baseQty / config.unitsPerPkg;
    const rounded = Math.round(pkgQty * 100) / 100;
    return {
      value: rounded,
      label: config.pkgUnit,
      formatted: formatNumber(rounded) + " " + config.pkgUnit,
    };
  }
  const rounded = Math.round(baseQty * 100) / 100;
  const label = config?.baseUnit ?? "PCS";
  return {
    value: rounded,
    label,
    formatted: formatNumber(rounded) + " " + label,
  };
}

/**
 * Convert user-entered display quantity back to base units.
 * Call this before saving any quantity the user typed.
 */
export function toBase(
  displayQty: number,
  config: ItemUnitConfig | null,
  mode: UnitMode
): number {
  if (mode === "PKG" && config && config.unitsPerPkg > 0) {
    return displayQty * config.unitsPerPkg;
  }
  return displayQty;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Smart name matching for PKG config import.
 * Handles Tally's parenthetical suffixes: "BELL CROWN MINI ( 300 PCS )" → "BELL CROWN MINI"
 */
export function matchItemName(
  inputName: string,
  xmlNames: string[]
): { matched: string; confidence: "exact" | "fuzzy" | "none"; score: number } {
  const norm = (s: string) =>
    s.toUpperCase()
     .replace(/\s*\(.*?\)\s*/g, "")   // strip (HSN code) and (qty description)
     .replace(/[^A-Z0-9\s]/g, " ")    // strip punctuation
     .replace(/\s+/g, " ")
     .trim();

  const normInput = norm(inputName);

  // 1. Exact match
  for (const xmlName of xmlNames) {
    if (norm(xmlName) === normInput) {
      return { matched: xmlName, confidence: "exact", score: 1.0 };
    }
  }

  // 2. Starts-with match (handles "BELL CROWN" matching "BELL CROWN MINI")
  for (const xmlName of xmlNames) {
    const normXml = norm(xmlName);
    if (normXml.startsWith(normInput) || normInput.startsWith(normXml)) {
      return { matched: xmlName, confidence: "fuzzy", score: 0.85 };
    }
  }

  // 3. Levenshtein distance
  let best = { name: "", score: 0 };
  for (const xmlName of xmlNames) {
    const normXml = norm(xmlName);
    if (!normInput[0] || normXml[0] !== normInput[0]) continue; // fast pre-filter
    const dist = levenshtein(normInput, normXml);
    const maxLen = Math.max(normInput.length, normXml.length);
    if (maxLen === 0) continue;
    const score = 1 - dist / maxLen;
    if (score > best.score && score > 0.7) {
      best = { name: xmlName, score };
    }
  }
  if (best.name) {
    return { matched: best.name, confidence: "fuzzy", score: best.score };
  }

  return { matched: "", confidence: "none", score: 0 };
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i-1] === b[j-1]
        ? dp[i-1]![j-1]!
        : 1 + Math.min(dp[i-1]![j]!, dp[i]![j-1]!, dp[i-1]![j-1]!);
    }
  }
  return dp[m]![n]!;
}
