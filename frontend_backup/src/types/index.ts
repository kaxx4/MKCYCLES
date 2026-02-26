export interface KPIResponse {
  total_sales: number;
  total_purchases: number;
  net_revenue: number;
  gst_collected: number;
  gst_paid: number;
  outstanding_receivables: number;
  outstanding_payables: number;
  total_vouchers: number;
  date_from: string | null;
  date_to: string | null;
}

export interface MonthlyDataPoint {
  month: string;
  sales: number;
  purchases: number;
  gst_collected: number;
}

export interface TopCustomer {
  party_name: string;
  total_amount: number;
  voucher_count: number;
}

export interface TopItem {
  stock_item_name: string;
  total_quantity: number;
  total_amount: number;
  voucher_count: number;
}

export interface ItemMonthlyData {
  month: string;  // "YYYY-MM"
  inward: number;   // Purchases/Receipts
  outward: number;  // Sales
  closing: number;  // Closing balance
}

export interface ItemInventoryReport {
  stock_item_name: string;
  unit: string | null;
  opening: number;
  monthly_data: ItemMonthlyData[];
  closing: number;
}

export interface VoucherLine {
  id: number;
  ledger_name: string;
  amount: number;
  is_tax_line: boolean;
  tax_head: string | null;
  tax_rate: number | null;
  stock_item_name: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  order: number;
}

export interface Voucher {
  id: number;
  voucher_number: string;
  voucher_type: string;
  voucher_date: string;
  party_name: string | null;
  party_ledger: string | null;
  amount: number;
  narration: string | null;
  irn: string | null;
  gstin: string | null;
  place_of_supply: string | null;
  billing_city: string | null;
  reference_number: string | null;
  due_date: string | null;
  is_cancelled: boolean;
  company_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface VoucherDetail extends Voucher {
  raw_xml: string | null;
  lines: VoucherLine[];
}

export interface VoucherListResponse {
  total: number;
  page: number;
  page_size: number;
  items: Voucher[];
}

export interface ImportLog {
  id: number;
  file_name: string;
  file_type: string;
  status: string;
  vouchers_processed: number;
  vouchers_inserted: number;
  vouchers_updated: number;
  masters_processed: number;
  error_message: string | null;
  /** JSON-encoded list of warning strings, or null */
  warnings: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Company {
  id: number;
  name: string;
  gstin: string | null;
}

export interface HealthResponse {
  status: string;
  db: string;
  version: string;
  inbox: string;
}

export interface VoucherFilters {
  date_from?: string;
  date_to?: string;
  voucher_type?: string;
  ledger?: string;
  search?: string;
  company_id?: number;
  page?: number;
  page_size?: number;
}

export interface AgingBucket {
  bucket: string;  // "0-30", "31-60", "61-90", "91+"
  amount: number;
}

export interface AgingReport {
  receivables: AgingBucket[];
  payables: AgingBucket[];
  as_of: string;
}
