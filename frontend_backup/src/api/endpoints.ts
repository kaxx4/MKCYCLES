import api from "./client";
import type {
  AgingReport,
  Company,
  HealthResponse,
  ImportLog,
  ItemInventoryReport,
  KPIResponse,
  MonthlyDataPoint,
  TopCustomer,
  TopItem,
  VoucherDetail,
  VoucherFilters,
  VoucherListResponse,
} from "../types";

export const fetchHealth = (): Promise<HealthResponse> =>
  api.get("/health").then((r) => r.data);

export const fetchKPIs = (
  params?: Partial<{ date_from: string; date_to: string; company_id: number }>
): Promise<KPIResponse> => api.get("/kpis", { params }).then((r) => r.data);

export const fetchMonthlyKPIs = (params?: {
  year?: number;
  company_id?: number;
}): Promise<MonthlyDataPoint[]> =>
  api.get("/kpis/monthly", { params }).then((r) => r.data);

export const fetchVouchers = (
  filters: VoucherFilters
): Promise<VoucherListResponse> =>
  api.get("/vouchers", { params: filters }).then((r) => r.data);

export const fetchVoucher = (id: number): Promise<VoucherDetail> =>
  api.get(`/vouchers/${id}`).then((r) => r.data);

export const fetchTopCustomers = (params?: {
  n?: number;
  date_from?: string;
  date_to?: string;
}): Promise<TopCustomer[]> =>
  api.get("/reports/top-customers", { params }).then((r) => r.data);

export const fetchTopItems = (params?: {
  n?: number;
  date_from?: string;
  date_to?: string;
}): Promise<TopItem[]> =>
  api.get("/items/top", { params }).then((r) => r.data);

export const fetchItemInventory = (params?: {
  months?: number;
}): Promise<ItemInventoryReport[]> =>
  api.get("/items/inventory", { params }).then((r) => r.data);

export const fetchItemInventoryDetail = (
  itemName: string,
  months?: number
): Promise<ItemInventoryReport> =>
  api
    .get(`/items/inventory/${encodeURIComponent(itemName)}`, {
      params: months ? { months } : undefined,
    })
    .then((r) => r.data);

export const fetchAging = (): Promise<AgingReport> =>
  api.get("/reports/aging").then((r) => r.data);

export const fetchImportLogs = (): Promise<ImportLog[]> =>
  api.get("/import-logs").then((r) => r.data);

export const fetchCompanies = (): Promise<Company[]> =>
  api.get("/companies").then((r) => r.data);

export const fetchVoucherTypes = (): Promise<string[]> =>
  api.get("/voucher-types").then((r) => r.data);

export const uploadFile = (file: File): Promise<ImportLog> => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/import", form).then((r) => r.data);
};

export const triggerRescan = (): Promise<{ message: string; inbox: string }> =>
  api.post("/settings/rescan").then((r) => r.data);

export const exportCsv = (params: {
  voucher_type?: string;
  date_from?: string;
  date_to?: string;
}): string => {
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    ) as Record<string, string>
  ).toString();
  return `/api/export/csv${qs ? "?" + qs : ""}`;
};
