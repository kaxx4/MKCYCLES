/**
 * UnitsContext — global unit-mode state for the entire app.
 *
 * UnitMode:
 *   "BASE"    — display quantities in base unit (PCS / KG / MTR etc.)
 *   "PACKAGE" — display quantities in packages (PKG), requires a pkg_factor
 *
 * The mode is persisted to localStorage so it survives page refreshes.
 *
 * Usage:
 *   const { unitMode, toggleUnitMode, getDisplayQty, unitLabel } = useUnits();
 *
 *   getDisplayQty(rawQty, pkgFactor)
 *     rawQty    — quantity in base units (as stored in DB)
 *     pkgFactor — items per package (null/undefined → always shows BASE)
 *     returns   — { value: string, unit: string }
 *
 *   unitLabel(pkgFactor?)
 *     returns "PKG" in PACKAGE mode (when factor is valid), else "PCS"
 *
 *   inputToBase(entered, pkgFactor)
 *     converts user-entered qty back to base units for storage
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UnitMode = "BASE" | "PACKAGE";

export interface DisplayQty {
  /** Formatted numeric string, e.g. "12.00" or "0.25" */
  value: string;
  /** Unit label, e.g. "PCS" or "PKG" */
  unit: string;
}

interface UnitsContextValue {
  /** Current display mode */
  unitMode: UnitMode;
  /** Toggle between BASE and PACKAGE */
  toggleUnitMode: () => void;
  /** Set mode explicitly (useful for Settings page) */
  setUnitMode: (mode: UnitMode) => void;

  /**
   * Convert a raw base qty to a display value + unit label.
   * If pkgFactor is null/undefined/<= 0, always returns base units.
   */
  getDisplayQty: (rawQty: number, pkgFactor?: number | null) => DisplayQty;

  /**
   * Convert user-entered qty (in current mode) back to base units.
   * If pkgFactor is null/undefined/<= 0, treated as 1:1 (no conversion).
   */
  inputToBase: (enteredQty: number, pkgFactor?: number | null) => number;

  /**
   * Return the current unit label string.
   * "PKG" when in PACKAGE mode and factor is valid, else "PCS".
   */
  unitLabel: (pkgFactor?: number | null) => string;

  // ── Legacy compat helpers (used by older components) ──────────────────────
  /** @deprecated use unitMode === "PACKAGE" */
  useAltUnits: boolean;
  /** @deprecated use toggleUnitMode */
  toggle: () => void;
  /** @deprecated use getDisplayQty(qty, factor).value */
  displayQty: (baseQty: number, factor?: number | null) => string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "tally_unit_mode";

function loadStoredMode(): UnitMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "PACKAGE" || stored === "BASE") return stored;
  } catch {
    // SSR / storage blocked
  }
  return "BASE";
}

function saveMode(mode: UnitMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

function hasFactor(pkgFactor?: number | null): boolean {
  return typeof pkgFactor === "number" && isFinite(pkgFactor) && pkgFactor > 0;
}

// ── Provider ──────────────────────────────────────────────────────────────────

const UnitsContext = createContext<UnitsContextValue | null>(null);

export function UnitsProvider({ children }: { children: React.ReactNode }) {
  const [unitMode, setUnitModeState] = useState<UnitMode>(loadStoredMode);

  const setUnitMode = useCallback((mode: UnitMode) => {
    setUnitModeState(mode);
    saveMode(mode);
  }, []);

  const toggleUnitMode = useCallback(() => {
    setUnitModeState((prev) => {
      const next: UnitMode = prev === "BASE" ? "PACKAGE" : "BASE";
      saveMode(next);
      return next;
    });
  }, []);

  const getDisplayQty = useCallback(
    (rawQty: number, pkgFactor?: number | null): DisplayQty => {
      if (unitMode === "PACKAGE" && hasFactor(pkgFactor)) {
        const pkgs = rawQty / pkgFactor!;
        return {
          value: Number.isInteger(pkgs) ? pkgs.toFixed(0) : pkgs.toFixed(2),
          unit: "PKG",
        };
      }
      return {
        value: Number.isInteger(rawQty) ? rawQty.toFixed(0) : rawQty.toFixed(2),
        unit: "PCS",
      };
    },
    [unitMode]
  );

  const inputToBase = useCallback(
    (enteredQty: number, pkgFactor?: number | null): number => {
      if (unitMode === "PACKAGE" && hasFactor(pkgFactor)) {
        return enteredQty * pkgFactor!;
      }
      return enteredQty;
    },
    [unitMode]
  );

  const unitLabel = useCallback(
    (pkgFactor?: number | null): string => {
      if (unitMode === "PACKAGE" && hasFactor(pkgFactor)) return "PKG";
      return "PCS";
    },
    [unitMode]
  );

  // ── Legacy compat ──────────────────────────────────────────────────────────
  const useAltUnits = unitMode === "PACKAGE";
  const toggle = toggleUnitMode;
  const displayQty = useCallback(
    (baseQty: number, factor?: number | null) =>
      getDisplayQty(baseQty, factor).value,
    [getDisplayQty]
  );

  const value = useMemo<UnitsContextValue>(
    () => ({
      unitMode,
      toggleUnitMode,
      setUnitMode,
      getDisplayQty,
      inputToBase,
      unitLabel,
      // legacy
      useAltUnits,
      toggle,
      displayQty,
    }),
    [
      unitMode,
      toggleUnitMode,
      setUnitMode,
      getDisplayQty,
      inputToBase,
      unitLabel,
      useAltUnits,
      toggle,
      displayQty,
    ]
  );

  return (
    <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>
  );
}

export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used within <UnitsProvider>");
  return ctx;
}
