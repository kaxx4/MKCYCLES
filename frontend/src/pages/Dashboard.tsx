import { useMemo } from "react";
import { Card, KPICard } from "../components";
import { useDataStore } from "../store/dataStore";
import { useUIStore } from "../store/uiStore";
import { getFYBounds, getFYFromDate } from "../engine/financial";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  ShoppingCart,
  DollarSign,
  FileText,
  Users,
  CreditCard,
  AlertCircle,
  Calendar,
} from "lucide-react";

// Indian number formatting
function formatINR(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";

  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function Dashboard() {
  const { data } = useDataStore();
  const { fyYear, setFyYear } = useUIStore();

  // Financial Year bounds
  const fyBounds = useMemo(() => getFYBounds(fyYear), [fyYear]);

  // Filter vouchers by FY (not cancelled, not optional)
  const fyVouchers = useMemo(() => {
    if (!data) return [];
    return data.vouchers.filter((v) => {
      if (v.isCancelled || v.isOptional) return false;
      return v.date >= fyBounds.start && v.date <= fyBounds.end;
    });
  }, [data, fyBounds]);

  // 1. Total Sales
  const totalSales = useMemo(() => {
    return fyVouchers
      .filter((v) => v.voucherType === "Sales")
      .reduce((sum, v) => sum + v.amount, 0);
  }, [fyVouchers]);

  // 2. Total Purchases
  const totalPurchases = useMemo(() => {
    return fyVouchers
      .filter((v) => v.voucherType === "Purchase")
      .reduce((sum, v) => sum + v.amount, 0);
  }, [fyVouchers]);

  // 3. Gross Profit
  const grossProfit = useMemo(() => {
    return totalSales - totalPurchases;
  }, [totalSales, totalPurchases]);

  // 4. GST Payable
  const gstPayable = useMemo(() => {
    let salesGST = 0;
    let purchaseGST = 0;

    fyVouchers.forEach((v) => {
      v.lines.forEach((line) => {
        if (line.isTaxLine && (line.taxType === "CGST" || line.taxType === "SGST")) {
          if (v.voucherType === "Sales") {
            salesGST += Math.abs(line.amount);
          } else if (v.voucherType === "Purchase") {
            purchaseGST += Math.abs(line.amount);
          }
        }
      });
    });

    return salesGST - purchaseGST;
  }, [fyVouchers]);

  // 5. Receivables (Sundry Debtors)
  const receivables = useMemo(() => {
    if (!data) return 0;

    const debtorLedgers = Array.from(data.ledgers.values()).filter(
      (l) => l.parent.toUpperCase().includes("SUNDRY DEBTORS")
    );

    let total = 0;
    debtorLedgers.forEach((ledger) => {
      // Start with opening balance (positive = receivable)
      let outstanding = ledger.openingBalance;

      // Add New Ref amounts, subtract Agst Ref amounts
      fyVouchers.forEach((v) => {
        v.lines.forEach((line) => {
          if (line.ledgerName?.toUpperCase() === ledger.nameNormalized) {
            line.billAllocations.forEach((alloc) => {
              if (alloc.billType === "New Ref") {
                outstanding += alloc.amount;
              } else if (alloc.billType === "Agst Ref") {
                outstanding -= alloc.amount;
              }
            });
          }
        });
      });

      total += outstanding;
    });

    return total;
  }, [data, fyVouchers]);

  // 6. Payables (Sundry Creditors)
  const payables = useMemo(() => {
    if (!data) return 0;

    const creditorLedgers = Array.from(data.ledgers.values()).filter(
      (l) => l.parent.toUpperCase().includes("SUNDRY CREDITORS")
    );

    let total = 0;
    creditorLedgers.forEach((ledger) => {
      // Opening balance negative = payable, so take absolute value
      let outstanding = Math.abs(Math.min(0, ledger.openingBalance));

      // Add New Ref amounts, subtract Agst Ref amounts
      fyVouchers.forEach((v) => {
        v.lines.forEach((line) => {
          if (line.ledgerName?.toUpperCase() === ledger.nameNormalized) {
            line.billAllocations.forEach((alloc) => {
              if (alloc.billType === "New Ref") {
                outstanding += alloc.amount;
              } else if (alloc.billType === "Agst Ref") {
                outstanding -= alloc.amount;
              }
            });
          }
        });
      });

      total += outstanding;
    });

    return total;
  }, [data, fyVouchers]);

  // 7. Today's Sales
  const todaysSales = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return fyVouchers
      .filter(
        (v) =>
          v.voucherType === "Sales" &&
          v.date >= today &&
          v.date < tomorrow
      )
      .reduce((sum, v) => sum + v.amount, 0);
  }, [fyVouchers]);

  // 8. Pending Orders
  const pendingOrders = useMemo(() => {
    if (!data) return 0;
    return data.vouchers.filter((v) => v.isOptional && !v.isCancelled).length;
  }, [data]);

  // Monthly Revenue Chart Data
  const monthlyData = useMemo(() => {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const data: { month: string; sales: number; purchases: number }[] = [];

    // Generate last 12 months from FY start
    for (let i = 0; i < 12; i++) {
      const monthDate = new Date(fyBounds.start);
      monthDate.setMonth(monthDate.getMonth() + i);

      const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59);

      const monthSales = fyVouchers
        .filter(
          (v) =>
            v.voucherType === "Sales" &&
            v.date >= monthStart &&
            v.date <= monthEnd
        )
        .reduce((sum, v) => sum + v.amount, 0);

      const monthPurchases = fyVouchers
        .filter(
          (v) =>
            v.voucherType === "Purchase" &&
            v.date >= monthStart &&
            v.date <= monthEnd
        )
        .reduce((sum, v) => sum + v.amount, 0);

      data.push({
        month: monthNames[monthDate.getMonth()] ?? "Unknown",
        sales: Math.round(monthSales),
        purchases: Math.round(monthPurchases),
      });
    }

    return data;
  }, [fyVouchers, fyBounds]);

  // Detect available FY years from data
  const availableFYs = useMemo(() => {
    if (!data) return [fyYear];
    const fySet = new Set<number>();
    data.vouchers.forEach((v) => {
      fySet.add(getFYFromDate(v.date));
    });
    const years = Array.from(fySet).sort((a, b) => b - a);
    return years.length > 0 ? years : [fyYear];
  }, [data, fyYear]);

  return (
    <div className="space-y-6">
      {/* Header with FY selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-gray-500" />
          <select
            value={fyYear}
            onChange={(e) => setFyYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {availableFYs.map((year) => (
              <option key={year} value={year}>
                FY {year}-{(year + 1).toString().slice(-2)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard
          title="Total Sales"
          value={formatINR(totalSales)}
          icon={<TrendingUp className="w-6 h-6" />}
          color="green"
        />
        <KPICard
          title="Total Purchases"
          value={formatINR(totalPurchases)}
          icon={<ShoppingCart className="w-6 h-6" />}
          color="amber"
        />
        <KPICard
          title="Gross Profit"
          value={formatINR(grossProfit)}
          icon={<DollarSign className="w-6 h-6" />}
          color={grossProfit >= 0 ? "green" : "red"}
        />
        <KPICard
          title="GST Payable"
          value={formatINR(gstPayable)}
          icon={<FileText className="w-6 h-6" />}
          color={gstPayable >= 0 ? "blue" : "green"}
        />
        <KPICard
          title="Receivables"
          value={formatINR(receivables)}
          icon={<Users className="w-6 h-6" />}
          color="blue"
        />
        <KPICard
          title="Payables"
          value={formatINR(payables)}
          icon={<CreditCard className="w-6 h-6" />}
          color="red"
        />
        <KPICard
          title="Today's Sales"
          value={formatINR(todaysSales)}
          icon={<Calendar className="w-6 h-6" />}
          color="green"
        />
        <KPICard
          title="Pending Orders"
          value={pendingOrders.toString()}
          icon={<AlertCircle className="w-6 h-6" />}
          color="amber"
        />
      </div>

      {/* Monthly Revenue Chart */}
      <Card title="Monthly Revenue Trend">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={monthlyData}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="month"
                stroke="#6b7280"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="#6b7280"
                fontSize={12}
                tickLine={false}
                tickFormatter={(value) => {
                  if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(1)}Cr`;
                  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(1)}L`;
                  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
                  return value.toString();
                }}
              />
              <Tooltip
                formatter={(value) => value != null ? formatINR(value as number) : ""}
                contentStyle={{
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: "0.5rem",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                }}
              />
              <Area
                type="monotone"
                dataKey="sales"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSales)"
                name="Sales"
              />
              <Area
                type="monotone"
                dataKey="purchases"
                stroke="#f59e0b"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorPurchases)"
                name="Purchases"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
