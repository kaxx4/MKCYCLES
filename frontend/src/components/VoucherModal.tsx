import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Code, List } from "lucide-react";
import { fetchVoucher } from "../api/endpoints";
import { formatCurrency, formatDate } from "../utils/format";

interface VoucherModalProps {
  voucherId: number;
  onClose: () => void;
}

export default function VoucherModal({ voucherId, onClose }: VoucherModalProps) {
  const [view, setView] = useState<"json" | "xml">("json");

  const { data, isLoading } = useQuery({
    queryKey: ["voucher", voucherId],
    queryFn: () => fetchVoucher(voucherId),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold">
              {data?.voucher_type} #{data?.voucher_number}
            </h2>
            <p className="text-sm text-gray-500">
              {data?.voucher_date ? formatDate(data.voucher_date) : ""} ·{" "}
              {data?.party_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : data ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-4 p-6 border-b border-gray-100">
              <div>
                <p className="text-xs text-gray-500">Amount</p>
                <p className="text-lg font-bold text-blue-700">
                  {formatCurrency(data.amount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">IRN</p>
                <p className="text-sm font-mono truncate">{data.irn || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">GST Reg</p>
                <p className="text-sm font-mono">{data.gstin || "—"}</p>
              </div>
            </div>

            {/* Tab toggle */}
            <div className="flex gap-2 px-6 pt-4">
              <button
                onClick={() => setView("json")}
                className={`btn text-sm ${
                  view === "json" ? "btn-primary" : "btn-secondary"
                }`}
              >
                <List size={14} /> Ledger Entries
              </button>
              <button
                onClick={() => setView("xml")}
                className={`btn text-sm ${
                  view === "xml" ? "btn-primary" : "btn-secondary"
                }`}
              >
                <Code size={14} /> Raw XML
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
              {view === "json" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left pb-2 text-gray-500 font-medium">Ledger</th>
                      <th className="text-left pb-2 text-gray-500 font-medium">Item</th>
                      <th className="text-right pb-2 text-gray-500 font-medium">Qty</th>
                      <th className="text-right pb-2 text-gray-500 font-medium">Amount</th>
                      <th className="text-center pb-2 text-gray-500 font-medium">Tax?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line, i) => (
                      <tr
                        key={i}
                        className={`border-b border-gray-50 ${
                          line.is_tax_line ? "bg-yellow-50" : ""
                        }`}
                      >
                        <td className="py-2 pr-3">{line.ledger_name}</td>
                        <td className="py-2 pr-3 text-gray-500">
                          {line.stock_item_name || "—"}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {line.quantity != null
                            ? `${line.quantity} ${line.unit || ""}`
                            : "—"}
                        </td>
                        <td
                          className={`py-2 text-right font-medium ${
                            line.amount < 0 ? "text-red-600" : "text-green-700"
                          }`}
                        >
                          {formatCurrency(line.amount)}
                        </td>
                        <td className="py-2 text-center">
                          {line.is_tax_line ? (
                            <span className="badge bg-yellow-100 text-yellow-800">
                              {line.tax_head || "Tax"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded-lg overflow-auto font-mono whitespace-pre-wrap">
                  {data.raw_xml
                    ? data.raw_xml
                        .replace(/></g, ">\n<")
                        .replace(/^\s*\n/gm, "")
                    : "No raw XML available"}
                </pre>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
