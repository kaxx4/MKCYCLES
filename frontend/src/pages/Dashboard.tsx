import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Receipt,
  Users,
  AlertCircle,
} from "lucide-react";
import {
  fetchKPIs,
  fetchMonthlyKPIs,
  fetchTopCustomers,
  fetchTopItems,
  fetchAging,
} from "../api/endpoints";
import KPICard from "../components/KPICard";
import { formatCurrency, formatNumber } from "../utils/format";

export default function Dashboard() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["kpis"],
    queryFn: () => fetchKPIs(),
  });

  const { data: monthly = [], isLoading: monthlyLoading } = useQuery({
    queryKey: ["monthly", year],
    queryFn: () => fetchMonthlyKPIs({ year }),
  });

  const { data: topCustomers = [] } = useQuery({
    queryKey: ["top-customers"],
    queryFn: () => fetchTopCustomers({ n: 8 }),
  });

  const { data: topItems = [] } = useQuery({
    queryKey: ["top-items"],
    queryFn: () => fetchTopItems({ n: 8 }),
  });

  const { data: aging, isLoading: agingLoading } = useQuery({
    queryKey: ["aging"],
    queryFn: fetchAging,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tally data analytics · All figures in INR
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        >
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-100" />
          ))}
        </div>
      ) : kpis ? (
        <>
          {/* ── Indian GAAP / GST Act 2017 color logic ─────────────────────────
               GREEN  = Revenue / Profit  (Sales, Gross Profit when +ve)
               RED    = Loss              (Gross Profit when -ve)
               BLUE   = Asset / Inflow   (Receivables, GST ITC claimable)
               ORANGE = Cost / Liability  (Purchases COGS, Payables — normal trade)
               PURPLE = Govt pass-through (GST Output Tax — NOT your money)
               ──────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Revenue → GREEN */}
          <KPICard
            title="Total Sales"
            value={formatCurrency(kpis.total_sales)}
            subtitle="Revenue from operations (net of GST)"
            color="green"
            icon={<TrendingUp size={20} />}
          />
          {/* COGS → ORANGE (cost to track, not inherently bad) */}
          <KPICard
            title="Total Purchases"
            value={formatCurrency(kpis.total_purchases)}
            subtitle="Cost of goods (net of GST / ITC)"
            color="orange"
            icon={<TrendingDown size={20} />}
          />
          {/* Gross Profit → GREEN if +ve, RED if -ve */}
          <KPICard
            title="Gross Profit"
            value={formatCurrency(kpis.net_revenue)}
            subtitle={kpis.net_revenue >= 0 ? "Sales − Purchases" : "Loss — review costs"}
            color={kpis.net_revenue >= 0 ? "green" : "red"}
            icon={<DollarSign size={20} />}
          />
          <KPICard
            title="Total Vouchers"
            value={formatNumber(kpis.total_vouchers)}
            subtitle="All transaction entries"
            color="purple"
            icon={<Receipt size={20} />}
          />
          {/* Output GST → PURPLE (Govt liability — pass-through, NOT income) */}
          <KPICard
            title="GST Output Tax"
            value={formatCurrency(kpis.gst_collected)}
            subtitle="Collected from customers · Payable to Govt"
            color="purple"
          />
          {/* Input GST / ITC → BLUE (asset — you claim this back) */}
          <KPICard
            title="GST ITC (Input)"
            value={formatCurrency(kpis.gst_paid)}
            subtitle="Paid on purchases · Input Tax Credit"
            color="blue"
          />
          {/* Receivables → BLUE (money owed TO you = asset) */}
          <KPICard
            title="Receivables"
            value={formatCurrency(kpis.outstanding_receivables)}
            subtitle="Sundry Debtors — outstanding from customers"
            color="blue"
            icon={<Users size={20} />}
          />
          {/* Payables → ORANGE (normal trade liability, not a red-flag) */}
          <KPICard
            title="Payables"
            value={formatCurrency(kpis.outstanding_payables)}
            subtitle="Sundry Creditors — outstanding to vendors"
            color="orange"
            icon={<AlertCircle size={20} />}
          />
        </div>
        </>
      ) : null}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Revenue Chart */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">
            Monthly Revenue {year}
          </h2>
          {monthlyLoading ? (
            <div className="h-56 bg-gray-100 animate-pulse rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="sales-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  {/* Orange for purchases — cost to monitor, not a "loss" signal */}
                  <linearGradient id="purchase-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={(v) =>
                    v >= 100000
                      ? `${(v / 100000).toFixed(0)}L`
                      : v >= 1000
                      ? `${(v / 1000).toFixed(0)}K`
                      : v
                  }
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(v: number) => formatCurrency(v)}
                  labelFormatter={(l) => `Month: ${l}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="sales"
                  name="Sales"
                  stroke="#3b82f6"
                  fill="url(#sales-grad)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="purchases"
                  name="Purchases (COGS)"
                  stroke="#f97316"
                  fill="url(#purchase-grad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly GST Chart */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">Monthly GST {year}</h2>
          {monthlyLoading ? (
            <div className="h-56 bg-gray-100 animate-pulse rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="month"
                  tickFormatter={(v) => v.slice(5)}
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v
                  }
                  tick={{ fontSize: 12 }}
                />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar
                  dataKey="gst_collected"
                  name="GST Collected"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* AR/AP Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(["receivables", "payables"] as const).map((kind) => {
          const buckets = aging?.[kind] ?? [];
          const total = buckets.reduce((s, b) => s + b.amount, 0);
          const colors: Record<string, { bar: string; text: string; bg: string }> = {
            "0-30":  { bar: "bg-green-500",  text: "text-green-700",  bg: "bg-green-50" },
            "31-60": { bar: "bg-yellow-400", text: "text-yellow-700", bg: "bg-yellow-50" },
            "61-90": { bar: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50" },
            "91+":   { bar: "bg-red-500",    text: "text-red-700",    bg: "bg-red-50" },
          };
          return (
            <div key={kind} className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">
                  {kind === "receivables" ? "Receivables Aging" : "Payables Aging"}
                </h2>
                {aging && (
                  <span className="text-xs text-gray-400">As of {aging.as_of}</span>
                )}
              </div>
              {agingLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 bg-gray-100 animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : buckets.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No data available</p>
              ) : (
                <div className="space-y-3">
                  {buckets.map((b) => {
                    const pct = total > 0 ? (b.amount / total) * 100 : 0;
                    const c = colors[b.bucket] ?? { bar: "bg-gray-400", text: "text-gray-700", bg: "bg-gray-50" };
                    return (
                      <div key={b.bucket} className={`rounded-lg p-3 ${c.bg}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-xs font-semibold ${c.text}`}>
                            {b.bucket} days
                          </span>
                          <span className={`text-sm font-bold ${c.text}`}>
                            {formatCurrency(b.amount)}
                          </span>
                        </div>
                        <div className="w-full bg-white/60 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full ${c.bar} transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-right mt-0.5">
                          <span className="text-xs text-gray-400">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t border-gray-100 pt-2 flex justify-between text-sm">
                    <span className="font-medium text-gray-600">Total</span>
                    <span className="font-bold text-gray-800">{formatCurrency(total)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top customers */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">Top Customers</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-gray-500 font-medium">#</th>
                <th className="text-left pb-2 text-gray-500 font-medium">Customer</th>
                <th className="text-right pb-2 text-gray-500 font-medium">Revenue</th>
                <th className="text-right pb-2 text-gray-500 font-medium">Invoices</th>
              </tr>
            </thead>
            <tbody>
              {topCustomers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">
                    No data yet. Import Tally XML files to see customers.
                  </td>
                </tr>
              ) : (
                topCustomers.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 font-medium">{c.party_name}</td>
                    <td className="py-2 text-right text-green-700">
                      {formatCurrency(c.total_amount)}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {c.voucher_count}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Top items */}
        <div className="card">
          <h2 className="text-base font-semibold mb-4">Top Items (Sales)</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-gray-500 font-medium">#</th>
                <th className="text-left pb-2 text-gray-500 font-medium">Item</th>
                <th className="text-right pb-2 text-gray-500 font-medium">Qty</th>
                <th className="text-right pb-2 text-gray-500 font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {topItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">
                    No items data. Ensure stock items are in your Tally export.
                  </td>
                </tr>
              ) : (
                topItems.map((item, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 text-gray-400">{i + 1}</td>
                    <td className="py-2 font-medium">{item.stock_item_name}</td>
                    <td className="py-2 text-right text-gray-600">
                      {formatNumber(item.total_quantity)}
                    </td>
                    <td className="py-2 text-right text-green-700">
                      {formatCurrency(item.total_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
