import React from "react";
import clsx from "clsx";

// ── Indian GAAP color guide ────────────────────────────────────────────────────
//   green  → Income / Profit  (Sales revenue, Net Profit when +ve)
//   red    → Loss / Negative  (Net Profit when -ve, overdue aging)
//   blue   → Asset / Inflow   (Receivables, GST ITC claimable)
//   orange → Liability / Cost (Payables to vendors, Purchases COGS)
//   purple → Pass-through Tax (GST Output collected — belongs to Govt)
//   yellow → Advisory watch   (General alerts, non-critical flags)
// ──────────────────────────────────────────────────────────────────────────────

interface KPICardProps {
  title: string;
  value: string;
  subtitle?: string;
  color?: "blue" | "green" | "red" | "yellow" | "purple" | "orange";
  icon?: React.ReactNode;
}

const colorMap: Record<string, string> = {
  blue:   "text-blue-600 bg-blue-50",
  green:  "text-green-600 bg-green-50",
  red:    "text-red-600 bg-red-50",
  yellow: "text-yellow-600 bg-yellow-50",
  purple: "text-purple-600 bg-purple-50",
  orange: "text-orange-600 bg-orange-50",
};

export default function KPICard({
  title,
  value,
  subtitle,
  color = "blue",
  icon,
}: KPICardProps) {
  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className={clsx("text-2xl font-bold mt-1", colorMap[color].split(" ")[0])}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className={clsx("p-2 rounded-lg", colorMap[color])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
