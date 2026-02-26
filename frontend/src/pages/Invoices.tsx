import { useState, useMemo } from "react";
import { useDataStore } from "../store/dataStore";
import { useUIStore } from "../store/uiStore";
import { formatQty, type ItemUnitConfig } from "../engine/units";
import type { CanonicalVoucher } from "../types/canonical";
import { format } from "date-fns";
import {
  Calendar,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  FileText,
  Building2,
  MapPin,
  FileSignature,
  Receipt,
} from "lucide-react";

// Voucher type badge colors
const TYPE_COLORS: Record<string, string> = {
  "Sales": "bg-green-100 text-green-800",
  "Purchase": "bg-orange-100 text-orange-800",
  "Receipt": "bg-blue-100 text-blue-800",
  "Payment": "bg-red-100 text-red-800",
  "Journal": "bg-gray-100 text-gray-800",
  "Contra": "bg-gray-100 text-gray-800",
  "Sales Order": "bg-amber-100 text-amber-800",
  "Purchase Order": "bg-amber-100 text-amber-800",
  "Debit Note": "bg-purple-100 text-purple-800",
  "Credit Note": "bg-purple-100 text-purple-800",
};

interface VoucherFilters {
  dateFrom?: string;
  dateTo?: string;
  voucherType: string;
  partySearch: string;
  amountMin?: number;
  amountMax?: number;
  status: "all" | "outstanding" | "cancelled";
  gstType: "all" | "intrastate" | "interstate";
}

const ITEMS_PER_PAGE = 50;

export function Invoices() {
  const data = useDataStore((s) => s.data);
  const unitMode = useUIStore((s) => s.unitMode);

  const [filters, setFilters] = useState<VoucherFilters>({
    voucherType: "all",
    partySearch: "",
    status: "all",
    gstType: "all",
  });
  const [selectedVoucher, setSelectedVoucher] = useState<CanonicalVoucher | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Get all vouchers
  const allVouchers = useMemo(() => {
    if (!data) return [];
    return data.vouchers;
  }, [data]);

  // Apply filters
  const filteredVouchers = useMemo(() => {
    let result = allVouchers;

    // Date range filter
    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      result = result.filter((v) => v.date >= fromDate);
    }
    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      toDate.setHours(23, 59, 59, 999); // Include full day
      result = result.filter((v) => v.date <= toDate);
    }

    // Voucher type filter
    if (filters.voucherType !== "all") {
      result = result.filter((v) => v.voucherType === filters.voucherType);
    }

    // Party name search
    if (filters.partySearch.trim()) {
      const search = filters.partySearch.toLowerCase();
      result = result.filter((v) =>
        v.partyName?.toLowerCase().includes(search)
      );
    }

    // Amount range filter
    if (filters.amountMin !== undefined && filters.amountMin > 0) {
      result = result.filter((v) => v.amount >= filters.amountMin!);
    }
    if (filters.amountMax !== undefined && filters.amountMax > 0) {
      result = result.filter((v) => v.amount <= filters.amountMax!);
    }

    // Status filter
    if (filters.status === "outstanding") {
      result = result.filter((v) => {
        // Outstanding = has bill allocations with outstanding amount
        const hasOutstanding = v.lines.some((line) =>
          line.billAllocations.some((bill) => bill.amount > 0)
        );
        return hasOutstanding && !v.isCancelled;
      });
    } else if (filters.status === "cancelled") {
      result = result.filter((v) => v.isCancelled);
    }

    // GST type filter
    if (filters.gstType !== "all") {
      result = result.filter((v) => {
        const hasCGST = v.lines.some((line) => line.taxType === "CGST");
        const hasIGST = v.lines.some((line) => line.taxType === "IGST");

        if (filters.gstType === "intrastate") {
          return hasCGST;
        } else {
          return hasIGST;
        }
      });
    }

    // Sort by date descending (newest first)
    result.sort((a, b) => b.date.getTime() - a.date.getTime());

    return result;
  }, [allVouchers, filters]);

  // Get unique voucher types for dropdown
  const voucherTypes = useMemo(() => {
    const types = new Set(allVouchers.map((v) => v.voucherType));
    return Array.from(types).sort();
  }, [allVouchers]);

  // Pagination
  const totalPages = Math.ceil(filteredVouchers.length / ITEMS_PER_PAGE);
  const paginatedVouchers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return filteredVouchers.slice(start, end);
  }, [filteredVouchers, currentPage]);

  // Reset to page 1 when filters change
  useMemo(() => {
    setCurrentPage(1);
  }, [filteredVouchers.length]);

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Get unit config for a stock item
  const getItemConfig = (itemName: string): ItemUnitConfig | null => {
    if (!data) return null;
    const item = data.stockItems.get(itemName.toUpperCase().trim());
    if (!item) return null;

    return {
      itemName: item.name,
      baseUnit: item.baseUnit,
      pkgUnit: item.alternateUnit ?? "PKG",
      unitsPerPkg: item.alternateConversion ?? 1,
      source: item.alternateUnit ? "tally" : "manual",
    };
  };

  // Calculate GST totals for selected voucher
  const gstBreakdown = useMemo(() => {
    if (!selectedVoucher) return null;

    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    selectedVoucher.lines.forEach((line) => {
      if (line.isTaxLine && line.amount) {
        const absAmount = Math.abs(line.amount);
        if (line.taxType === "CGST") cgst += absAmount;
        else if (line.taxType === "SGST") sgst += absAmount;
        else if (line.taxType === "IGST") igst += absAmount;
      }
    });

    const total = cgst + sgst + igst;
    return { cgst, sgst, igst, total };
  }, [selectedVoucher]);

  // Get bill allocations from selected voucher
  const billAllocations = useMemo(() => {
    if (!selectedVoucher) return [];

    const allocations: Array<{
      billRef: string;
      billType: string;
      amount: number;
      dueDate?: Date;
    }> = [];

    selectedVoucher.lines.forEach((line) => {
      if (line.billAllocations.length > 0) {
        allocations.push(...line.billAllocations);
      }
    });

    return allocations;
  }, [selectedVoucher]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-sm text-gray-600 mt-1">
          {filteredVouchers.length} voucher{filteredVouchers.length !== 1 ? "s" : ""} found
        </p>
      </div>

      {/* Main Content - 3 Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Filters (20%) */}
        <div className="w-1/5 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2 text-gray-700 font-semibold mb-4">
              <Filter className="w-4 h-4" />
              <span>Filters</span>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date From
              </label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.dateFrom ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date To
              </label>
              <input
                type="date"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.dateTo ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))
                }
              />
            </div>

            {/* Voucher Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Voucher Type
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.voucherType}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, voucherType: e.target.value }))
                }
              >
                <option value="all">All Types</option>
                {voucherTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {/* Party Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Party Name
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search party..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={filters.partySearch}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, partySearch: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Amount Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Min
              </label>
              <input
                type="number"
                placeholder="Min amount"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.amountMin ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    amountMin: e.target.value ? parseFloat(e.target.value) : undefined,
                  }))
                }
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount Max
              </label>
              <input
                type="number"
                placeholder="Max amount"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.amountMax ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    amountMax: e.target.value ? parseFloat(e.target.value) : undefined,
                  }))
                }
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.status}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: e.target.value as VoucherFilters["status"],
                  }))
                }
              >
                <option value="all">All</option>
                <option value="outstanding">Outstanding</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* GST Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                GST Type
              </label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={filters.gstType}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    gstType: e.target.value as VoucherFilters["gstType"],
                  }))
                }
              >
                <option value="all">All</option>
                <option value="intrastate">Intra-state (CGST+SGST)</option>
                <option value="interstate">Inter-state (IGST)</option>
              </select>
            </div>

            {/* Reset Button */}
            <button
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
              onClick={() =>
                setFilters({
                  voucherType: "all",
                  partySearch: "",
                  status: "all",
                  gstType: "all",
                })
              }
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Center List - Voucher List (40%) */}
        <div className="w-2/5 bg-white border-r border-gray-200 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {paginatedVouchers.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>No vouchers found</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {paginatedVouchers.map((voucher) => (
                  <div
                    key={voucher.id}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedVoucher?.id === voucher.id ? "bg-blue-50" : ""
                    }`}
                    onClick={() => setSelectedVoucher(voucher)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900">
                            {voucher.voucherNumber}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              TYPE_COLORS[voucher.voucherType] ??
                              "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {voucher.voucherType}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 truncate">
                          {voucher.partyName ?? "—"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {format(voucher.date, "dd MMM yyyy")}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="font-semibold text-gray-900">
                          {formatCurrency(voucher.amount)}
                        </p>
                        {voucher.isCancelled && (
                          <span className="text-xs text-red-600 font-medium">
                            Cancelled
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Voucher Detail (40%) */}
        <div className="w-2/5 bg-gray-50 overflow-y-auto">
          {!selectedVoucher ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              <div className="text-center">
                <Receipt className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p>Select a voucher to view details</p>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Header Section */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {selectedVoucher.voucherNumber}
                    </h2>
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`px-3 py-1 rounded-md text-sm font-medium ${
                          TYPE_COLORS[selectedVoucher.voucherType] ??
                          "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {selectedVoucher.voucherType}
                      </span>
                      {selectedVoucher.isCancelled && (
                        <span className="px-3 py-1 rounded-md text-sm font-medium bg-red-100 text-red-800">
                          Cancelled
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Amount</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {formatCurrency(selectedVoucher.amount)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                  <div className="flex items-start gap-2">
                    <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div>
                      <p className="text-xs text-gray-600">Date</p>
                      <p className="text-sm font-medium text-gray-900">
                        {format(selectedVoucher.date, "dd MMM yyyy")}
                      </p>
                    </div>
                  </div>

                  {selectedVoucher.partyName && (
                    <div className="flex items-start gap-2">
                      <Building2 className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-gray-600">Party</p>
                        <p className="text-sm font-medium text-gray-900">
                          {selectedVoucher.partyName}
                        </p>
                      </div>
                    </div>
                  )}

                  {selectedVoucher.gstin && (
                    <div className="flex items-start gap-2">
                      <FileSignature className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-gray-600">GSTIN</p>
                        <p className="text-sm font-medium text-gray-900 font-mono">
                          {selectedVoucher.gstin}
                        </p>
                      </div>
                    </div>
                  )}

                  {selectedVoucher.placeOfSupply && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-gray-600">Place of Supply</p>
                        <p className="text-sm font-medium text-gray-900">
                          {selectedVoucher.placeOfSupply}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {selectedVoucher.narration && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-600 mb-1">Narration</p>
                    <p className="text-sm text-gray-900">
                      {selectedVoucher.narration}
                    </p>
                  </div>
                )}
              </div>

              {/* Lines Table */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Line Items
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-semibold text-gray-700">
                          Description
                        </th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-700">
                          Qty
                        </th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-700">
                          Rate
                        </th>
                        <th className="text-right py-2 px-2 font-semibold text-gray-700">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {selectedVoucher.lines
                        .filter((line) => !line.isTaxLine)
                        .map((line, idx) => {
                          const description = line.stockItemName ?? line.ledgerName ?? "—";
                          const qty = line.actualQty ?? 0;
                          const rate = line.rate ?? 0;
                          const amount = Math.abs(line.amount ?? 0);

                          // Format quantity with unit conversion
                          let qtyDisplay = "—";
                          if (line.stockItemName && qty !== 0) {
                            const config = getItemConfig(line.stockItemName);
                            const formatted = formatQty(qty, config, unitMode);
                            qtyDisplay = formatted.formatted;
                          }

                          return (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="py-2 px-2 text-gray-900">
                                {description}
                              </td>
                              <td className="py-2 px-2 text-right text-gray-900 font-mono">
                                {qtyDisplay}
                              </td>
                              <td className="py-2 px-2 text-right text-gray-900 font-mono">
                                {rate > 0 ? formatCurrency(rate) : "—"}
                              </td>
                              <td className="py-2 px-2 text-right text-gray-900 font-mono font-medium">
                                {formatCurrency(amount)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* GST Breakdown */}
              {gstBreakdown && gstBreakdown.total > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    GST Breakdown
                  </h3>
                  <div className="space-y-2">
                    {gstBreakdown.cgst > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">CGST</span>
                        <span className="text-sm font-mono font-medium text-gray-900">
                          {formatCurrency(gstBreakdown.cgst)}
                        </span>
                      </div>
                    )}
                    {gstBreakdown.sgst > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">SGST</span>
                        <span className="text-sm font-mono font-medium text-gray-900">
                          {formatCurrency(gstBreakdown.sgst)}
                        </span>
                      </div>
                    )}
                    {gstBreakdown.igst > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-700">IGST</span>
                        <span className="text-sm font-mono font-medium text-gray-900">
                          {formatCurrency(gstBreakdown.igst)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                      <span className="text-sm font-semibold text-gray-900">
                        Total Tax
                      </span>
                      <span className="text-sm font-mono font-bold text-gray-900">
                        {formatCurrency(gstBreakdown.total)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Bill Allocations */}
              {billAllocations.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Bill Allocations
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">
                            Bill Reference
                          </th>
                          <th className="text-left py-2 px-2 font-semibold text-gray-700">
                            Type
                          </th>
                          <th className="text-right py-2 px-2 font-semibold text-gray-700">
                            Amount
                          </th>
                          <th className="text-right py-2 px-2 font-semibold text-gray-700">
                            Due Date
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {billAllocations.map((bill, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="py-2 px-2 text-gray-900">
                              {bill.billRef}
                            </td>
                            <td className="py-2 px-2 text-gray-700">
                              {bill.billType}
                            </td>
                            <td className="py-2 px-2 text-right text-gray-900 font-mono font-medium">
                              {formatCurrency(bill.amount)}
                            </td>
                            <td className="py-2 px-2 text-right text-gray-700">
                              {bill.dueDate
                                ? format(bill.dueDate, "dd MMM yyyy")
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
