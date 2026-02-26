import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UnitMode } from "../engine/units";
import { getCurrentFYStartYear } from "../engine/financial";

interface UIState {
  unitMode: UnitMode;
  fyYear: number;
  filters: {
    dateFrom?: string;
    dateTo?: string;
    voucherType?: string;
    search?: string;
    group?: string;
    party?: string;
    status?: "all" | "outstanding" | "cancelled";
  };
  toggleUnitMode: () => void;
  setUnitMode: (m: UnitMode) => void;
  setFyYear: (y: number) => void;
  setFilters: (f: Partial<UIState["filters"]>) => void;
  resetFilters: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      unitMode: "BASE",
      fyYear: getCurrentFYStartYear(),
      filters: {},
      toggleUnitMode: () =>
        set((s) => ({ unitMode: s.unitMode === "BASE" ? "PKG" : "BASE" })),
      setUnitMode: (m) => set({ unitMode: m }),
      setFyYear: (y) => set({ fyYear: y }),
      setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
      resetFilters: () => set({ filters: {} }),
    }),
    { name: "mkcycles-ui-v1" }
  )
);
