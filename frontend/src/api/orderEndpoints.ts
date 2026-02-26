import api from "./client";
import type {
  ChangeLogEntry,
  ComplianceIssue,
  MasterOverride,
  MasterOverrideIn,
  OrderExportRow,
  OrderItem,
  OrderMonthlyRow,
  RateOverride,
  RateOverrideIn,
  VendorGroup,
} from "../types/order";

// ── Order mode ────────────────────────────────────────────────────────────────

export interface MkcpImportCounts {
  groups_added: number;
  groups_updated: number;
  alt_units_added: number;
  alt_units_updated: number;
  item_groups_added: number;
  item_groups_updated: number;
  unmatched_xlsx_items: number;
  source_counts: { xlsx: number; price_list: number };
}

export const importMkcp = (): Promise<{ status: string; counts: MkcpImportCounts }> =>
  api.get("/order/import").then((r) => r.data);

export const fetchOrderGroups = (): Promise<VendorGroup[]> =>
  api.get("/order/groups").then((r) => r.data);

export const fetchOrderItems = (params?: {
  months_cover?: number;
  lookback?: number;
  group?: string;
}): Promise<OrderItem[]> =>
  api.get("/order/items", { params }).then((r) => r.data);

export const fetchOrderItemHistory = (
  itemName: string,
  months?: number
): Promise<OrderMonthlyRow[]> =>
  api
    .get(`/order/items/${encodeURIComponent(itemName)}/history`, {
      params: months ? { months } : undefined,
    })
    .then((r) => r.data);

export const exportOrderExcel = async (rows: OrderExportRow[]): Promise<void> => {
  const response = await api.post("/order/export", rows, {
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const a = document.createElement("a");
  a.href = url;
  a.download = "OrderList.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

export const fetchCompliance = (params?: {
  limit?: number;
  voucher_type?: string;
}): Promise<ComplianceIssue[]> =>
  api.get("/order/compliance", { params }).then((r) => r.data);

// ── Item Rate Overrides ───────────────────────────────────────────────────────
// Stored in backend/data/item_rate_overrides.json
// Overrides ALWAYS take precedence over Tally XML-derived rates.

/** List every item that has a saved rate override. */
export const fetchAllRateOverrides = (): Promise<RateOverride[]> =>
  api.get("/rates/").then((r) => r.data);

/** Get the rate override for a single item (empty if none saved). */
export const fetchRateOverride = (itemName: string): Promise<RateOverride> =>
  api.get(`/rates/${encodeURIComponent(itemName)}`).then((r) => r.data);

/**
 * Save / update pkg_rate and/or unit_rate for an item.
 * Returns the saved override plus any advisory warnings.
 */
export const saveRateOverride = (
  itemName: string,
  body: RateOverrideIn
): Promise<RateOverride> =>
  api.post(`/rates/${encodeURIComponent(itemName)}`, body).then((r) => r.data);

/** Remove a rate override — item reverts to Tally XML rates. */
export const deleteRateOverride = (
  itemName: string
): Promise<{ status: string; item: string }> =>
  api.delete(`/rates/${encodeURIComponent(itemName)}`).then((r) => r.data);

/** Audit log of recent rate changes (newest first). */
export const fetchRateChangeLog = (limit = 100): Promise<ChangeLogEntry[]> =>
  api.get("/rates/log/changes", { params: { limit } }).then((r) => r.data);

// ── Master Overrides ──────────────────────────────────────────────────────────
// Stored in backend/data/master_overrides.json
// Override pkg_factor, base_unit, group, hsn_code, gst_rate, notes per item.
// ALWAYS takes precedence over XML-derived values and MKCP import.

/** List all items that have master overrides. */
export const fetchAllMasterOverrides = (): Promise<MasterOverride[]> =>
  api.get("/master-overrides/").then((r) => r.data);

/** Get master override for a single item. Returns empty override if none set. */
export const fetchMasterOverride = (itemName: string): Promise<MasterOverride> =>
  api.get(`/master-overrides/${encodeURIComponent(itemName)}`).then((r) => r.data);

/**
 * Save / update master override fields for an item.
 * Only non-null fields are stored. Returns the saved override.
 */
export const saveMasterOverride = (
  itemName: string,
  body: MasterOverrideIn
): Promise<MasterOverride> =>
  api.post(`/master-overrides/${encodeURIComponent(itemName)}`, body).then((r) => r.data);

/** Remove all override fields for an item (reverts to XML/MKCP values). */
export const deleteMasterOverride = (
  itemName: string
): Promise<{ status: string; item_name: string }> =>
  api.delete(`/master-overrides/${encodeURIComponent(itemName)}`).then((r) => r.data);
