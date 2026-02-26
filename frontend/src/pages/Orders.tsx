/**
 * Orders — 3-Panel Layout
 *
 * LEFT   (28 %)  Item list: search · group filter · scrollable table
 *                Each row: name / group / stock / suggestion
 * CENTER (40 %)  Selected-item detail: header chips · sparkline · monthly table
 * RIGHT  (32 %)  Order entry: qty input + conversion preview +
 *                running order-summary list + export controls
 *
 * Keyboard: ↑↓ navigate list · Enter focus qty · Space = 0 · Ctrl+G group filter
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import {
  ChevronDown,
  Download,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import {
  exportOrderExcel,
  fetchCompliance,
  fetchOrderGroups,
  fetchOrderItemHistory,
  fetchOrderItems,
  importMkcp,
} from "../api/orderEndpoints";
import { useUnits } from "../context/UnitsContext";
import type { OrderExportRow, OrderItem, OrderMonthlyRow } from "../types/order";
import { formatNumber } from "../utils/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const d = new Date(+y, +m - 1, 1);
  return d.toLocaleString("default", { month: "short", year: "2-digit" });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: string;
}) {
  return (
    <div className={`rounded-lg p-2.5 text-center ${accent ?? "bg-gray-50"}`}>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-lg font-bold text-gray-800 leading-tight">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{unit}</div>
    </div>
  );
}

function HistoryTable({
  rows,
  factor,
  unitMode,
}: {
  rows: OrderMonthlyRow[];
  factor?: number | null;
  unitMode: "BASE" | "PACKAGE";
}) {
  const hasPkg = unitMode === "PACKAGE" && !!factor && factor > 0;
  const fmt = (v: number) => {
    if (hasPkg) return (v / factor!).toFixed(1);
    return v.toFixed(0);
  };
  const lbl = hasPkg ? "PKG" : "PCS";

  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200">
          <th className="text-left py-1.5 px-2 font-semibold text-gray-500">Month</th>
          <th className="text-right py-1.5 px-2 font-semibold text-gray-500">
            Opening ({lbl})
          </th>
          <th className="text-right py-1.5 px-2 font-semibold text-blue-600">
            +In
          </th>
          <th className="text-right py-1.5 px-2 font-semibold text-red-500">
            −Out
          </th>
          <th className="text-right py-1.5 px-2 font-semibold text-gray-700">
            Closing
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50">
            <td className="py-1 px-2 text-gray-500 font-medium">{monthLabel(r.month)}</td>
            <td className="py-1 px-2 text-right text-gray-600">{fmt(r.opening)}</td>
            <td className="py-1 px-2 text-right text-blue-600">{fmt(r.inward)}</td>
            <td className="py-1 px-2 text-right text-red-500">{fmt(r.outward)}</td>
            <td
              className={`py-1 px-2 text-right font-semibold ${
                r.closing < 0 ? "text-red-600" : "text-gray-800"
              }`}
            >
              {fmt(r.closing)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrendChart({
  rows,
  factor,
  unitMode,
}: {
  rows: OrderMonthlyRow[];
  factor?: number | null;
  unitMode: "BASE" | "PACKAGE";
}) {
  const hasPkg = unitMode === "PACKAGE" && !!factor && factor > 0;
  const data = rows.map((r) => ({
    month: monthLabel(r.month),
    closing: hasPkg ? +(r.closing / factor!).toFixed(2) : r.closing,
    outward: hasPkg ? +(r.outward / factor!).toFixed(2) : r.outward,
  }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 4, right: 10, bottom: 0, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 9 }} />
        <YAxis
          tick={{ fontSize: 9 }}
          tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
        />
        <ReferenceLine y={0} stroke="#e5e7eb" />
        <Tooltip
          formatter={(v: number, name: string) => [
            v.toFixed(hasPkg ? 1 : 0),
            name === "closing" ? "Closing" : "Outward",
          ]}
          labelStyle={{ fontSize: 10 }}
        />
        <Line
          type="monotone"
          dataKey="closing"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="outward"
          stroke="#f97316"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          dot={false}
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Orders() {
  const { unitMode, toggleUnitMode, getDisplayQty, inputToBase, unitLabel } = useUnits();
  const useAltUnits = unitMode === "PACKAGE";

  // ── Data fetching ──────────────────────────────────────────────────────────
  const [monthsCover, setMonthsCover] = useState(2);
  const [historyMonths] = useState(12);

  const { data: groups = [] } = useQuery({
    queryKey: ["order-groups"],
    queryFn: fetchOrderGroups,
  });

  const {
    data: items = [],
    isLoading: itemsLoading,
    refetch: refetchItems,
  } = useQuery({
    queryKey: ["order-items", monthsCover],
    queryFn: () => fetchOrderItems({ months_cover: monthsCover }),
  });

  // ── UI state ───────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [orderMap, setOrderMap] = useState<Map<string, number>>(new Map());
  const [qtyInput, setQtyInput] = useState<string>("");
  const [includeZeros, setIncludeZeros] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);
  const [importReport, setImportReport] = useState<string | null>(null);

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const centerQtyRef = useRef<HTMLInputElement>(null);
  const groupSelectRef = useRef<HTMLSelectElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Filtered item list ─────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = items;
    if (filterGroup) list = list.filter((i) => i.group === filterGroup);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [items, filterGroup, search]);

  const uniqueGroups = useMemo(
    () => [...new Set(items.map((i) => i.group ?? "Togo Cycles"))].sort(),
    [items]
  );

  // Keep selectedIndex in bounds
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  const selectedItem: OrderItem | null = filteredItems[selectedIndex] ?? null;

  // When selection changes, sync the right-panel qty input
  useEffect(() => {
    if (selectedItem) {
      const stored = orderMap.get(selectedItem.name) ?? 0;
      const { value } = getDisplayQty(stored, selectedItem.pkg_factor);
      setQtyInput(stored === 0 ? "" : value);
    } else {
      setQtyInput("");
    }
  }, [selectedItem, orderMap, getDisplayQty]);

  // ── History for selected item ──────────────────────────────────────────────
  const { data: history = [] } = useQuery({
    queryKey: ["order-history", selectedItem?.name, historyMonths],
    queryFn: () =>
      selectedItem
        ? fetchOrderItemHistory(selectedItem.name, historyMonths)
        : Promise.resolve([] as OrderMonthlyRow[]),
    enabled: !!selectedItem,
    staleTime: 60_000,
  });

  // ── Right-panel qty handlers ───────────────────────────────────────────────
  const commitQty = useCallback(
    (displayVal: string) => {
      if (!selectedItem) return;
      const entered = parseFloat(displayVal) || 0;
      const base = inputToBase(entered, selectedItem.pkg_factor);
      setOrderMap((m) => {
        const n = new Map(m);
        n.set(selectedItem.name, base);
        return n;
      });
    },
    [selectedItem, inputToBase]
  );

  const addSuggestion = useCallback(() => {
    if (!selectedItem) return;
    const sugBase = selectedItem.suggestion_pkg != null
      ? (selectedItem.pkg_factor ?? 1) * selectedItem.suggestion_pkg
      : selectedItem.suggestion_base;
    setOrderMap((m) => {
      const n = new Map(m);
      n.set(selectedItem.name, sugBase);
      return n;
    });
  }, [selectedItem]);

  const clearItem = useCallback(
    (name: string) => {
      setOrderMap((m) => {
        const n = new Map(m);
        n.delete(name);
        return n;
      });
    },
    []
  );

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isCenterQty = target === centerQtyRef.current;
      const isOtherInput = target.tagName === "INPUT" && !isCenterQty;
      const isSelect = target.tagName === "SELECT";

      if (isOtherInput || isSelect) return;

      switch (e.key) {
        case "ArrowUp":
          if (!isCenterQty) {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(0, i - 1));
          }
          break;
        case "ArrowDown":
          if (!isCenterQty) {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(filteredItems.length - 1, i + 1));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (isCenterQty) {
            commitQty(qtyInput);
            setSelectedIndex((i) => {
              const next = Math.min(filteredItems.length - 1, i + 1);
              setTimeout(() => centerQtyRef.current?.focus(), 30);
              return next;
            });
          } else {
            centerQtyRef.current?.focus();
            centerQtyRef.current?.select();
          }
          break;
        case " ":
          if (!isCenterQty) {
            e.preventDefault();
            if (selectedItem) {
              setOrderMap((m) => {
                const n = new Map(m);
                n.set(selectedItem.name, 0);
                return n;
              });
            }
          }
          break;
        case "g":
        case "G":
          if (e.ctrlKey) {
            e.preventDefault();
            groupSelectRef.current?.focus();
          }
          break;
      }
    },
    [selectedIndex, filteredItems, selectedItem, qtyInput, commitQty]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Auto-scroll selected row into view
  useEffect(() => {
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  // ── Import MKCP ────────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: importMkcp,
    onSuccess: (data) => {
      refetchItems();
      const sc = data.counts.source_counts ?? {};
      const lines = [
        `✅ MKCP Import complete`,
        `Groups: +${data.counts.groups_added} new, ${data.counts.groups_updated} updated`,
        `Pkg Factors: +${data.counts.alt_units_added} new, ${data.counts.alt_units_updated} updated`,
        `  (xlsx: ${sc.xlsx ?? 0}, price list: ${sc.price_list ?? 0})`,
        `Item-Group: +${data.counts.item_groups_added} new, ${data.counts.item_groups_updated} updated`,
        data.counts.unmatched_xlsx_items > 0
          ? `⚠️ ${data.counts.unmatched_xlsx_items} xlsx items had no exact DB match`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      setImportReport(lines);
    },
    onError: (err: Error) => setImportReport(`❌ Import failed: ${err.message}`),
  });

  // ── Compliance ─────────────────────────────────────────────────────────────
  const { data: complianceData = [], refetch: refetchCompliance } = useQuery({
    queryKey: ["order-compliance"],
    queryFn: () => fetchCompliance({ limit: 200 }),
    enabled: showCompliance,
  });

  // ── Export Excel ───────────────────────────────────────────────────────────
  const handleExport = async () => {
    const exportRows: OrderExportRow[] = filteredItems
      .filter((item) => includeZeros || (orderMap.get(item.name) ?? 0) > 0)
      .map((item) => {
        const baseQty = orderMap.get(item.name) ?? 0;
        const { value: displayVal } = getDisplayQty(baseQty, item.pkg_factor);
        const pkgQty = item.pkg_factor
          ? baseQty / item.pkg_factor
          : 0;
        return {
          item_name: item.name,
          group: item.group,
          qty_pkg: pkgQty,
          qty_base: baseQty,
          uom: unitLabel(item.pkg_factor),
          current_stock: item.current_closing_base,
          suggestion_pkg: item.suggestion_pkg ?? undefined,
          remarks: "",
        };
      });

    if (!exportRows.length) {
      alert("No items with order quantities to export.");
      return;
    }
    try {
      await exportOrderExcel(exportRows);
    } catch {
      alert("Export failed. Make sure the backend is running.");
    }
  };

  // ── Derived order list for right panel ────────────────────────────────────
  const orderedItems = useMemo(
    () =>
      Array.from(orderMap.entries())
        .filter(([, qty]) => qty > 0)
        .map(([name, baseQty]) => {
          const item = items.find((i) => i.name === name);
          const { value, unit } = getDisplayQty(baseQty, item?.pkg_factor);
          return { name, baseQty, displayVal: value, unit, item };
        }),
    [orderMap, items, getDisplayQty]
  );

  const totalOrderItems = orderedItems.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden bg-gray-50">

      {/* ══ LEFT PANEL: Item List (28%) ══ */}
      <aside className="w-[28%] min-w-[260px] flex flex-col border-r border-gray-200 bg-white overflow-hidden">

        {/* Toolbar */}
        <div className="p-3 border-b border-gray-100 space-y-2">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Group filter */}
          <div className="relative">
            <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <select
              ref={groupSelectRef}
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="appearance-none w-full pl-3 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 bg-white"
              title="Ctrl+G"
            >
              <option value="">All Groups</option>
              {uniqueGroups.map((g) => (
                <option key={g} value={g ?? "Togo Cycles"}>
                  {g ?? "Togo Cycles"}
                </option>
              ))}
            </select>
          </div>

          {/* Row count + hints */}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{filteredItems.length} items</span>
            <span className="hidden lg:block">↑↓ · Enter · Ctrl+G</span>
          </div>
        </div>

        {/* Item table */}
        <div className="flex-1 overflow-y-auto">
          {itemsLoading ? (
            <div className="p-6 text-center text-gray-400 text-xs">Loading…</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-xs">
              No items.{" "}
              {!items.length && (
                <button
                  className="text-blue-600 underline"
                  onClick={() => importMutation.mutate()}
                >
                  Import MKCP
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-gray-100">
                  <th className="text-left px-3 py-1.5 text-gray-400 font-medium">Item</th>
                  <th className="text-right px-2 py-1.5 text-gray-400 font-medium">Stock</th>
                  <th className="text-right px-2 py-1.5 text-amber-500 font-medium">Sug</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  const baseQty = orderMap.get(item.name) ?? 0;
                  const hasOrder = baseQty > 0;
                  const { value: stockDisp } = getDisplayQty(
                    item.current_closing_base,
                    item.pkg_factor
                  );

                  return (
                    <tr
                      key={item.name}
                      ref={(el) => { rowRefs.current[idx] = el; }}
                      onClick={() => setSelectedIndex(idx)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-blue-50"
                          : hasOrder
                          ? "bg-green-50 hover:bg-green-100"
                          : "hover:bg-gray-50"
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          {item.pkg_factor && (
                            <Package size={9} className="text-gray-300 shrink-0" />
                          )}
                          {hasOrder && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                          )}
                          <span
                            className={`font-medium truncate max-w-[140px] ${
                              isSelected ? "text-blue-700" : "text-gray-800"
                            }`}
                            title={item.name}
                          >
                            {item.name}
                          </span>
                        </div>
                        <div className="text-gray-400 truncate pl-3 text-[10px]">
                          {item.group ?? "Togo Cycles"}
                        </div>
                      </td>
                      <td
                        className={`text-right px-2 py-1.5 font-medium tabular-nums ${
                          item.current_closing_base < 0 ? "text-red-500" : "text-gray-600"
                        }`}
                      >
                        {stockDisp}
                      </td>
                      <td className="text-right px-2 py-1.5 text-amber-600 tabular-nums">
                        {item.suggestion_pkg != null && item.suggestion_pkg > 0
                          ? item.suggestion_pkg
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </aside>

      {/* ══ CENTER PANEL: Item Detail (40%) ══ */}
      <div className="w-[40%] flex flex-col border-r border-gray-200 bg-white overflow-hidden">

        {/* Header bar */}
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 min-h-[64px]">
          {selectedItem ? (
            <>
              <h2 className="text-sm font-bold text-gray-800 truncate leading-tight">
                {selectedItem.name}
              </h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                  {selectedItem.group ?? "Togo Cycles"}
                </span>
                {selectedItem.pkg_factor && (
                  <span className="text-xs text-gray-500">
                    1 PKG = {selectedItem.pkg_factor.toFixed(0)}{" "}
                    {selectedItem.base_unit}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 mt-2">← Select an item</p>
          )}
        </div>

        {/* Stats row */}
        {selectedItem && (
          <div className="grid grid-cols-3 gap-2 p-3 border-b border-gray-100">
            <StatChip
              label="Current Stock"
              value={getDisplayQty(selectedItem.current_closing_base, selectedItem.pkg_factor).value}
              unit={unitLabel(selectedItem.pkg_factor)}
              accent={selectedItem.current_closing_base < 0 ? "bg-red-50" : "bg-gray-50"}
            />
            <StatChip
              label="Avg Monthly Out"
              value={getDisplayQty(selectedItem.avg_monthly_outward, selectedItem.pkg_factor).value}
              unit={unitLabel(selectedItem.pkg_factor)}
              accent="bg-orange-50"
            />
            <StatChip
              label="Suggestion"
              value={
                selectedItem.suggestion_pkg != null && selectedItem.suggestion_pkg > 0
                  ? selectedItem.suggestion_pkg.toFixed(0)
                  : "—"
              }
              unit={selectedItem.suggestion_pkg ? "PKG" : ""}
              accent="bg-amber-50"
            />
          </div>
        )}

        {/* Trend chart */}
        {history.length > 0 && (
          <div className="px-3 pt-2 pb-1 border-b border-gray-100">
            <div className="flex items-center gap-3 mb-1 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 bg-blue-500" /> Closing
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 h-0.5 bg-orange-400 border-dashed border-t" /> Outward
              </span>
            </div>
            <TrendChart rows={history} factor={selectedItem?.pkg_factor} unitMode={unitMode} />
          </div>
        )}

        {/* Monthly history table */}
        <div className="flex-1 overflow-y-auto">
          {!selectedItem ? (
            <div className="flex items-center justify-center h-24 text-gray-300 text-xs">
              Select an item to see history
            </div>
          ) : history.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">
              No transaction history
            </div>
          ) : (
            <HistoryTable
              rows={history}
              factor={selectedItem.pkg_factor}
              unitMode={unitMode}
            />
          )}
        </div>
      </div>

      {/* ══ RIGHT PANEL: Order Entry + Summary (32%) ══ */}
      <div className="w-[32%] min-w-[240px] flex flex-col bg-gray-50 overflow-hidden">

        {/* Global controls */}
        <div className="p-3 bg-white border-b border-gray-200 space-y-2">
          {/* Row 1: PKG toggle + months cover + import */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={toggleUnitMode}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                useAltUnits
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
              title="Toggle PKG / PCS"
            >
              {useAltUnits ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {useAltUnits ? "PKG" : "PCS"}
            </button>

            <div className="flex items-center gap-1 text-xs text-gray-600">
              <span className="text-gray-400">Cover:</span>
              <button
                onClick={() => setMonthsCover((m) => Math.max(1, m - 1))}
                className="px-1.5 py-0.5 border border-gray-200 rounded text-xs hover:bg-gray-100"
              >
                −
              </button>
              <span className="w-5 text-center font-medium tabular-nums">{monthsCover}</span>
              <button
                onClick={() => setMonthsCover((m) => Math.min(12, m + 1))}
                className="px-1.5 py-0.5 border border-gray-200 rounded text-xs hover:bg-gray-100"
              >
                +
              </button>
              <span className="text-gray-400">mo</span>
            </div>

            <div className="flex-1" />

            <button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              className="flex items-center gap-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-50"
              title="Import MKCP data"
            >
              <RefreshCw size={12} className={importMutation.isPending ? "animate-spin" : ""} />
              Import
            </button>
          </div>

          {/* Row 2: Compliance + Export */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowCompliance((v) => !v);
                if (!showCompliance) refetchCompliance();
              }}
              className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                showCompliance
                  ? "bg-amber-50 border-amber-300 text-amber-700"
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              <ShieldCheck size={12} />
              GST Check
            </button>

            <div className="flex-1" />

            <label className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={includeZeros}
                onChange={(e) => setIncludeZeros(e.target.checked)}
                className="rounded w-3 h-3"
              />
              Zeros
            </label>

            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              <Download size={12} />
              Export ({totalOrderItems})
            </button>
          </div>
        </div>

        {/* Import report */}
        {importReport && (
          <div className="mx-3 mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 whitespace-pre-line">
            <div className="flex justify-between items-start gap-2">
              <span>{importReport}</span>
              <button
                onClick={() => setImportReport(null)}
                className="text-blue-400 hover:text-blue-600 shrink-0 mt-0.5"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── QTY INPUT CARD ── */}
        <div className="m-3 bg-white rounded-xl border border-gray-200 shadow-sm p-3 space-y-3">
          {selectedItem ? (
            <>
              <div className="text-xs font-semibold text-gray-700 truncate">
                {selectedItem.name}
              </div>

              {/* Big qty input */}
              <div className="flex items-stretch gap-2">
                <input
                  ref={centerQtyRef}
                  type="number"
                  min={0}
                  step={1}
                  value={qtyInput}
                  placeholder="0"
                  onChange={(e) => setQtyInput(e.target.value)}
                  onBlur={(e) => commitQty(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitQty(qtyInput);
                    }
                  }}
                  className="flex-1 text-2xl font-bold text-right px-3 py-2 border-2 border-blue-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 tabular-nums"
                />
                <div className="flex flex-col items-center justify-center px-2 bg-gray-50 rounded-lg border border-gray-200 min-w-[40px]">
                  <span className="text-xs font-bold text-gray-600">
                    {unitLabel(selectedItem.pkg_factor)}
                  </span>
                </div>
              </div>

              {/* Conversion preview */}
              {selectedItem.pkg_factor && selectedItem.pkg_factor > 1 && (
                <div className="text-xs text-gray-400 text-center">
                  {(() => {
                    const entered = parseFloat(qtyInput) || 0;
                    const base = inputToBase(entered, selectedItem.pkg_factor);
                    if (useAltUnits) {
                      return `${entered} PKG × ${selectedItem.pkg_factor.toFixed(0)} = ${base.toFixed(0)} PCS`;
                    } else {
                      const pkgs = selectedItem.pkg_factor
                        ? base / selectedItem.pkg_factor
                        : 0;
                      return `${base.toFixed(0)} PCS = ${pkgs.toFixed(1)} PKG`;
                    }
                  })()}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    commitQty(qtyInput);
                    setSelectedIndex((i) =>
                      Math.min(filteredItems.length - 1, i + 1)
                    );
                  }}
                  className="flex-1 py-2 text-xs font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Add & Next ↓
                </button>
                {selectedItem.suggestion_pkg != null &&
                  selectedItem.suggestion_pkg > 0 && (
                    <button
                      onClick={addSuggestion}
                      className="px-2 py-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 whitespace-nowrap"
                      title={`Use suggestion: ${selectedItem.suggestion_pkg} PKG`}
                    >
                      ✦ {selectedItem.suggestion_pkg}
                    </button>
                  )}
              </div>
            </>
          ) : (
            <div className="py-4 text-xs text-gray-400 text-center">
              Select an item to enter quantity
            </div>
          )}
        </div>

        {/* ── ORDER SUMMARY ── */}
        <div className="flex-1 overflow-hidden flex flex-col mx-3 mb-3 bg-white rounded-xl border border-gray-200">
          <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">
              Order Summary ({totalOrderItems})
            </span>
            {totalOrderItems > 0 && (
              <button
                onClick={() => setOrderMap(new Map())}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {orderedItems.length === 0 ? (
              <div className="p-4 text-xs text-gray-400 text-center">
                No items ordered yet
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <tbody>
                  {orderedItems.map(({ name, displayVal, unit, item }) => (
                    <tr
                      key={name}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        const idx = filteredItems.findIndex((i) => i.name === name);
                        if (idx >= 0) setSelectedIndex(idx);
                      }}
                    >
                      <td className="px-3 py-1.5">
                        <div
                          className="font-medium text-gray-800 truncate max-w-[140px]"
                          title={name}
                        >
                          {name}
                        </div>
                        <div className="text-gray-400 text-[10px]">
                          {item?.group ?? "Togo Cycles"}
                        </div>
                      </td>
                      <td className="text-right px-2 py-1.5 font-bold text-blue-700 tabular-nums whitespace-nowrap">
                        {displayVal} {unit}
                      </td>
                      <td className="px-2 py-1.5 w-6">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            clearItem(name);
                          }}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── GST Compliance ── */}
        {showCompliance && (
          <div className="mx-3 mb-3 bg-amber-50 border border-amber-200 rounded-xl max-h-40 overflow-y-auto">
            <div className="px-3 py-2 text-xs font-semibold text-amber-800 border-b border-amber-200">
              GST Issues ({complianceData.length})
            </div>
            {complianceData.length === 0 ? (
              <p className="px-3 py-2 text-xs text-green-700">All compliant.</p>
            ) : (
              <div className="divide-y divide-amber-100">
                {complianceData.slice(0, 30).map((c) => (
                  <div key={c.voucher_id} className="px-3 py-1.5">
                    <div className="font-mono text-gray-700">{c.voucher_number || "—"}</div>
                    <div className="text-red-600">{c.issues.join(", ")}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
