import type { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import clsx from "clsx";

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number;
  icon?: ReactNode;
  color?: "blue" | "green" | "amber" | "red" | "gray";
}

export function KPICard({
  title,
  value,
  change,
  icon,
  color = "blue",
}: KPICardProps) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    gray: "bg-gray-50 text-gray-600",
  };

  const isPositive = change !== undefined && change >= 0;
  const showTrend = change !== undefined && change !== 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
          {showTrend && (
            <div className="mt-2 flex items-center gap-1">
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-600" />
              )}
              <span
                className={clsx(
                  "text-sm font-medium",
                  isPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {isPositive ? "+" : ""}
                {change.toFixed(1)}%
              </span>
              <span className="text-sm text-gray-500">vs last period</span>
            </div>
          )}
        </div>
        {icon && (
          <div className={clsx("p-3 rounded-lg", colorClasses[color])}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
