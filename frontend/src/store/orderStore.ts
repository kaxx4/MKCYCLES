import { create } from "zustand";
import { persist } from "zustand/middleware";

// Persisted order quantities for reorder planning
interface OrderState {
  orders: Record<string, number>; // itemName → qty in BASE units
  coverMonths: number; // Default coverage period for suggestions

  setOrderQty: (itemName: string, baseQty: number) => void;
  getOrderQty: (itemName: string) => number;
  clearOrder: (itemName: string) => void;
  clearAllOrders: () => void;
  setCoverMonths: (months: number) => void;
  getAllOrders: () => Array<{ itemName: string; baseQty: number }>;
}

export const useOrderStore = create<OrderState>()(
  persist(
    (set, get) => ({
      orders: {},
      coverMonths: 2,

      setOrderQty: (itemName, baseQty) => {
        set((state) => ({
          orders: {
            ...state.orders,
            [itemName]: baseQty,
          },
        }));
      },

      getOrderQty: (itemName) => get().orders[itemName] ?? 0,

      clearOrder: (itemName) => {
        set((state) => {
          const { [itemName]: _, ...rest } = state.orders;
          return { orders: rest };
        });
      },

      clearAllOrders: () => set({ orders: {} }),

      setCoverMonths: (months) => set({ coverMonths: Math.max(1, Math.min(12, months)) }),

      getAllOrders: () => {
        const orders = get().orders;
        return Object.entries(orders).map(([itemName, baseQty]) => ({
          itemName,
          baseQty,
        }));
      },
    }),
    { name: "mkcycles-orders-v1" }
  )
);
