import { create } from "zustand";
import type { ParsedData, CanonicalStockItem, CanonicalLedger, CanonicalVoucher, CanonicalUnit } from "../types/canonical";

interface DataState {
  data: ParsedData | null;
  loading: boolean;
  error: string | null;

  setData: (data: ParsedData) => void;
  mergeData: (newData: ParsedData) => void;
  clearData: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Convenience getters
  getStockItem: (name: string) => CanonicalStockItem | undefined;
  getLedger: (name: string) => CanonicalLedger | undefined;
  getUnit: (symbol: string) => CanonicalUnit | undefined;
  getAllStockItems: () => CanonicalStockItem[];
  getAllLedgers: () => CanonicalLedger[];
  getAllVouchers: () => CanonicalVoucher[];
}

const emptyData: ParsedData = {
  company: null,
  ledgers: new Map(),
  stockItems: new Map(),
  units: new Map(),
  vouchers: [],
  importedAt: new Date(),
  sourceFiles: [],
  warnings: [],
};

export const useDataStore = create<DataState>((set, get) => ({
  data: null,
  loading: false,
  error: null,

  setData: (data) => set({ data, error: null }),

  mergeData: (newData) => {
    const current = get().data ?? emptyData;

    // Merge maps
    const mergedLedgers = new Map([...current.ledgers, ...newData.ledgers]);
    const mergedStockItems = new Map([...current.stockItems, ...newData.stockItems]);
    const mergedUnits = new Map([...current.units, ...newData.units]);

    // Deduplicate vouchers by ID
    const voucherMap = new Map<string, CanonicalVoucher>();
    for (const v of [...current.vouchers, ...newData.vouchers]) {
      if (!voucherMap.has(v.id)) {
        voucherMap.set(v.id, v);
      }
    }

    const merged: ParsedData = {
      company: newData.company ?? current.company,
      ledgers: mergedLedgers,
      stockItems: mergedStockItems,
      units: mergedUnits,
      vouchers: Array.from(voucherMap.values()),
      importedAt: new Date(),
      sourceFiles: [...new Set([...current.sourceFiles, ...newData.sourceFiles])],
      warnings: [...current.warnings, ...newData.warnings],
    };

    set({ data: merged, error: null });
  },

  clearData: () => set({ data: null, error: null }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  // Convenience getters
  getStockItem: (name) => {
    const data = get().data;
    if (!data) return undefined;
    return data.stockItems.get(name.toUpperCase().trim());
  },

  getLedger: (name) => {
    const data = get().data;
    if (!data) return undefined;
    return data.ledgers.get(name.toUpperCase().trim());
  },

  getUnit: (symbol) => {
    const data = get().data;
    if (!data) return undefined;
    return data.units.get(symbol.toUpperCase().trim());
  },

  getAllStockItems: () => {
    const data = get().data;
    if (!data) return [];
    return Array.from(data.stockItems.values());
  },

  getAllLedgers: () => {
    const data = get().data;
    if (!data) return [];
    return Array.from(data.ledgers.values());
  },

  getAllVouchers: () => {
    const data = get().data;
    if (!data) return [];
    return data.vouchers;
  },
}));
