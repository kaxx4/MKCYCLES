export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function voucherTypeBadgeColor(type: string): string {
  const map: Record<string, string> = {
    Sales: "bg-green-100 text-green-800",
    Purchase: "bg-blue-100 text-blue-800",
    Receipt: "bg-teal-100 text-teal-800",
    Payment: "bg-red-100 text-red-800",
    Journal: "bg-purple-100 text-purple-800",
    "Credit Note": "bg-orange-100 text-orange-800",
    "Debit Note": "bg-yellow-100 text-yellow-800",
  };
  return map[type] || "bg-gray-100 text-gray-800";
}
