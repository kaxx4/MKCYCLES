import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTopCustomers } from "../api/endpoints";
import { formatCurrency } from "../utils/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function Customers() {
  const [n, setN] = useState(15);
  const { data = [], isLoading } = useQuery({
    queryKey: ["top-customers", n],
    queryFn: () => fetchTopCustomers({ n }),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Top Customers</h1>
        <select
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value={5}>Top 5</option>
          <option value={10}>Top 10</option>
          <option value={15}>Top 15</option>
          <option value={25}>Top 25</option>
        </select>
      </div>

      {/* Chart */}
      <div className="card">
        <h2 className="text-base font-semibold mb-4">Revenue by Customer</h2>
        {isLoading ? (
          <div className="h-64 bg-gray-100 animate-pulse rounded-lg" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ left: 120 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                type="number"
                tickFormatter={(v) =>
                  v >= 100000 ? `${(v / 100000).toFixed(0)}L` : `${(v / 1000).toFixed(0)}K`
                }
                tick={{ fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="party_name"
                tick={{ fontSize: 11 }}
                width={120}
              />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="total_amount" name="Revenue" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">#</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Customer</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Total Revenue</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Invoices</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Avg Invoice</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50 animate-pulse">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded" />
                    </td>
                  </tr>
                ))
              : data.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{c.party_name}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-700">
                      {formatCurrency(c.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {c.voucher_count}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {formatCurrency(c.total_amount / c.voucher_count)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
