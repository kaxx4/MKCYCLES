import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, Filter, Eye } from "lucide-react";
import { fetchVouchers, fetchVoucherTypes, exportCsv } from "../api/endpoints";
import VoucherModal from "../components/VoucherModal";
import { formatCurrency, formatDate, voucherTypeBadgeColor } from "../utils/format";
import type { VoucherFilters, VoucherListResponse } from "../types";

export default function Vouchers() {
  const [filters, setFilters] = useState<VoucherFilters>({
    page: 1,
    page_size: 50,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useQuery<VoucherListResponse>({
    queryKey: ["vouchers", filters],
    queryFn: () => fetchVouchers(filters),
    placeholderData: (prev) => prev,
  });

  const { data: voucherTypes = [] } = useQuery({
    queryKey: ["voucher-types"],
    queryFn: fetchVoucherTypes,
  });

  const totalPages = data ? Math.ceil(data.total / (filters.page_size || 50)) : 0;

  function update(patch: Partial<VoucherFilters>) {
    setFilters((f) => ({ ...f, ...patch, page: 1 }));
  }

  const csvUrl = exportCsv({
    voucher_type: filters.voucher_type,
    date_from: filters.date_from,
    date_to: filters.date_to,
  });

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vouchers</h1>
          <p className="text-sm text-gray-500">
            {data ? `${data.total.toLocaleString()} records` : "Loading…"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary text-sm"
          >
            <Filter size={14} /> Filters
          </button>
          <a href={csvUrl} download className="btn-primary text-sm">
            <Download size={14} /> Export CSV
          </a>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="card grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-gray-500 font-medium">From Date</label>
            <input
              type="date"
              value={filters.date_from || ""}
              onChange={(e) => update({ date_from: e.target.value || undefined })}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">To Date</label>
            <input
              type="date"
              value={filters.date_to || ""}
              onChange={(e) => update({ date_to: e.target.value || undefined })}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Voucher Type</label>
            <select
              value={filters.voucher_type || ""}
              onChange={(e) => update({ voucher_type: e.target.value || undefined })}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
            >
              <option value="">All Types</option>
              {voucherTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Party / Ledger</label>
            <input
              type="text"
              placeholder="Filter by party…"
              value={filters.ledger || ""}
              onChange={(e) => update({ ledger: e.target.value || undefined })}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search voucher number or party name…"
          value={filters.search || ""}
          onChange={(e) => update({ search: e.target.value || undefined })}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-white"
        />
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Number</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Party</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Amount</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">IRN</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-50 animate-pulse">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="h-4 bg-gray-100 rounded" />
                      </td>
                    </tr>
                  ))
                : (data?.items ?? []).map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-500">
                        {formatDate(v.voucher_date)}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium">
                        {v.voucher_number}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${voucherTypeBadgeColor(v.voucher_type)}`}
                        >
                          {v.voucher_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[200px] truncate">
                        {v.party_name || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(v.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {v.irn ? (
                          <span className="badge bg-green-100 text-green-700">
                            IRN
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setSelectedId(v.id)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                          title="View details"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-sm text-gray-500">
              Page {filters.page} of {totalPages} ({data.total} total)
            </p>
            <div className="flex gap-2">
              <button
                disabled={filters.page === 1}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page || 1) - 1 }))}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={filters.page === totalPages}
                onClick={() => setFilters((f) => ({ ...f, page: (f.page || 1) + 1 }))}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Voucher detail modal */}
      {selectedId && (
        <VoucherModal
          voucherId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
