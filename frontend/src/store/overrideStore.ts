import { create } from "zustand";
import { persist } from "zustand/middleware";

// Persisted to localStorage. Survives all page reloads.
// These are USER-entered corrections that override Tally data.

interface RateOverride {
  pkgRate?: number;    // Price per package (optional)
  unitRate?: number;   // Price per base unit (optional)
  updatedAt: string;   // ISO timestamp
  changeLog: Array<{
    field: "pkgRate" | "unitRate";
    oldValue?: number;
    newValue: number;
    ts: string;
  }>;
}

interface UnitOverride {
  baseUnit: string;
  pkgUnit: string;
  unitsPerPkg: number;
  source: "manual";
  updatedAt: string;
}

interface OverrideState {
  rates: Record<string, RateOverride>;    // keyed by item name
  units: Record<string, UnitOverride>;   // keyed by item name

  setRate: (name: string, r: Partial<Pick<RateOverride, "pkgRate"|"unitRate">>) => void;
  getRate: (name: string) => RateOverride | null;
  deleteRate: (name: string) => void;

  setUnit: (name: string, u: Omit<UnitOverride, "source"|"updatedAt">) => void;
  getUnit: (name: string) => UnitOverride | null;
  deleteUnit: (name: string) => void;

  // Bulk import from text paste
  bulkSetUnits: (configs: Array<{name: string; pkgUnit: string; unitsPerPkg: number; baseUnit: string}>) => void;
}

export const useOverrideStore = create<OverrideState>()(
  persist(
    (set, get) => ({
      rates: {},
      units: {},

      setRate: (name, r) => {
        set((state) => {
          const existing = state.rates[name];
          const now = new Date().toISOString();
          const changeLog = existing?.changeLog ?? [];

          if (r.pkgRate !== undefined) {
            changeLog.push({
              field: "pkgRate",
              oldValue: existing?.pkgRate,
              newValue: r.pkgRate,
              ts: now,
            });
          }
          if (r.unitRate !== undefined) {
            changeLog.push({
              field: "unitRate",
              oldValue: existing?.unitRate,
              newValue: r.unitRate,
              ts: now,
            });
          }

          // Keep only last 50 changes
          const trimmedLog = changeLog.slice(-50);

          return {
            rates: {
              ...state.rates,
              [name]: {
                pkgRate: r.pkgRate ?? existing?.pkgRate,
                unitRate: r.unitRate ?? existing?.unitRate,
                updatedAt: now,
                changeLog: trimmedLog,
              },
            },
          };
        });
      },

      getRate: (name) => get().rates[name] ?? null,

      deleteRate: (name) => {
        set((state) => {
          const { [name]: _, ...rest } = state.rates;
          return { rates: rest };
        });
      },

      setUnit: (name, u) => {
        set((state) => ({
          units: {
            ...state.units,
            [name]: {
              ...u,
              source: "manual",
              updatedAt: new Date().toISOString(),
            },
          },
        }));
      },

      getUnit: (name) => get().units[name] ?? null,

      deleteUnit: (name) => {
        set((state) => {
          const { [name]: _, ...rest } = state.units;
          return { units: rest };
        });
      },

      bulkSetUnits: (configs) => {
        set((state) => {
          const now = new Date().toISOString();
          const newUnits = { ...state.units };

          for (const config of configs) {
            newUnits[config.name] = {
              baseUnit: config.baseUnit,
              pkgUnit: config.pkgUnit,
              unitsPerPkg: config.unitsPerPkg,
              source: "manual",
              updatedAt: now,
            };
          }

          return { units: newUnits };
        });
      },
    }),
    { name: "mkcycles-overrides-v1" }
  )
);
