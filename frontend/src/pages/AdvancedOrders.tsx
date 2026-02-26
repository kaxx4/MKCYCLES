/**
 * Advanced Order Mode
 *
 * Layout
 * ──────
 *  [Header: title + PKG/PCS toggle + Export button]
 *  [Group tabs: ALL | BASKET | BHOGAL | BICYCLE | … | Togo Cycles]
 *  ┌──────────────────────────┬────────────────────────────────────┐
 *  │ LEFT (40 %)              │ RIGHT (60 %)                       │
 *  │ Selected item history    │ Item list — all start at qty 0     │
 *  │  Sparkline               │  Search bar                        │
 *  │  Month | In | Out | Cls  │  ► Item name      | [qty] | unit   │
 *  └──────────────────────────┴────────────────────────────────────┘
 *
 * Key behaviours
 * ──────────────
 *  • Arrow keys navigate the RIGHT list; LEFT panel auto-syncs.
 *  • Enter focuses the qty input for the selected row.
 *  • Space zeros the selected row's qty.
 *  • Ctrl+G focuses the group tab search / select.
 *  • Export sends only non-zero rows to /api/order/export → .xlsx download.
 *  • All quantities start at 0 — no auto-suggestions pre-filled.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Download,
  Search,
  Package,
  ToggleLeft,
  ToggleRight,
  ClipboardList,
} from "lucide-react";

import {
  exportOrderExcel,
  fetchOrderGroups,
  fetchOrderItemHistory,
  fetchOrderItems,
} from "../api/orderEndpoints";
import { useUnits } from "../context/UnitsContext";
import type { OrderExportRow, OrderItem, OrderMonthlyRow } from "../types/order";

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString("default", {
    month: "short",
    year: "2-digit",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Compact history table (left panel) */
function HistoryPanel({ rows }: { rows: OrderMonthlyRow[] }) {
  if (!rows.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        No transaction history
      </div>
    );
  }

  const sparkData = rows.map((r) => ({
    month: monthLabel(r.month),
    closing: r.closing,
  }));

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Sparkline */}
      <div className="px-3 pt-2 pb-1 border-b border-gray-100">
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={sparkData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 8 }} />
            <YAxis
              tick={{ fontSize: 8 }}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
            />
            <Tooltip
              formatter={(v: number) => [v.toFixed(0), "Closing"]}
              labelStyle={{ fontSize: 10 }}
            />
            <Line
              type="monotone"
              dataKey="closing"
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly table */}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <th className="text-left py-1.5 px-2 font-semibold text-gray-500">Month</th>
            <th className="text-right py-1.5 px-2 font-semibold text-blue-600">In +</th>
            <th className="text-right py-1.5 px-2 font-semibold text-red-500">Out −</th>
            <th className="text-right py-1.5 px-2 font-semibold text-gray-700">Closing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-1 px-2 text-gray-500">{monthLabel(r.month)}</td>
              <td className="py-1 px-2 text-right text-blue-600">
                {r.inward > 0 ? r.inward.toFixed(0) : "—"}
              </td>
              <td className="py-1 px-2 text-right text-red-500">
                {r.outward > 0 ? r.outward.toFixed(0) : "—"}
              </td>
              <td
                className={`py-1 px-2 text-right font-semibold ${
                  r.closing < 0 ? "text-red-600" : "text-gray-800"
                }`}
              >
                {r.closing.toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdvancedOrders() {
  const { useAltUnits, toggle, displayQty, inputToBase, unitLabel } = useUnits();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: groups = [] } = useQuery({
    queryKey: ["order-groups"],
    queryFn: fetchOrderGroups,
  });

  const { data: allItems = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["adv-order-items"],
    // No months_cover pre-fill — we just need the stock data
    queryFn: () => fetchOrderItems({ months_cover: 1, lookback: 12 }),
    staleTime: 5 * 60 * 1000,
  });

  // ── UI state ───────────────────────────────────────────────────────────────
  // "" = ALL groups
  const [activeGroup, setActiveGroup] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // All quantities start at 0 — user fills them manually
  const [orderMap, setOrderMap] = useState<Map<string, number>>(new Map());
  const [historyMonths] = useState(12);

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const qtyInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ── Filtered item list ─────────────────────────────────────────────────────
  const filteredItems = useMemo<OrderItem[]>(() => {
    let list = allItems;
    if (activeGroup) list = list.filter((i) => i.group === activeGroup);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [allItems, activeGroup, search]);

  // Keep selectedIndex in bounds when filter changes
  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, filteredItems.length - 1)));
  }, [filteredItems.length]);

  const selectedItem: OrderItem | null = filteredItems[selectedIndex] ?? null;

  // ── History for the currently focused item ─────────────────────────────────
  const { data: history = [] } = useQuery<OrderMonthlyRow[]>({
    queryKey: ["adv-history", selectedItem?.name, historyMonths],
    queryFn: () =>
      selectedItem
        ? fetchOrderItemHistory(selectedItem.name, historyMonths)
        : Promise.resolve([] as OrderMonthlyRow[]),
    enabled: !!selectedItem,
    staleTime: 60_000,
  });

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isQtyInput = target.dataset.type === "adv-qty";
      const isOtherInput = target.tagName === "INPUT" && !isQtyInput;

      if (isOtherInput) return;

      switch (e.key) {
        case "ArrowUp":
          if (!isQtyInput) {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(0, i - 1));
          }
          break;

        case "ArrowDown":
          if (!isQtyInput) {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(filteredItems.length - 1, i + 1));
          }
          break;

        case "Enter":
          if (isQtyInput) {
            e.preventDefault();
            // Move to next row's qty input
            setSelectedIndex((i) => {
              const next = Math.min(filteredItems.length - 1, i + 1);
              setTimeout(() => qtyInputRefs.current[next]?.focus(), 30);
              return next;
            });
          } else {
            e.preventDefault();
            qtyInputRefs.current[selectedIndex]?.focus();
          }
          break;

        case " ":
          if (!isQtyInput) {
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
            // focus first group tab
            document.getElementById("adv-group-tabs")?.querySelector("button")?.focus();
          }
          break;
      }
    },
    [selectedIndex, filteredItems, selectedItem]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Auto-scroll selected row into view
  useEffect(() => {
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  // ── Group tab list (ALL + 18 vendor groups + Togo Cycles) ─────────────────
  const groupNames = useMemo(() => {
    const fromItems = [...new Set(allItems.map((i) => i.group))].sort();
    return fromItems;
  }, [allItems]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const totalOrderedItems = Array.from(orderMap.values()).filter((v) => v > 0).length;

  const handleExport = async () => {
    const exportRows: OrderExportRow[] = filteredItems
      .filter((item) => (orderMap.get(item.name) ?? 0) > 0)
      .map((item) => {
        const displayVal = orderMap.get(item.name) ?? 0;
        const baseQty = inputToBase(displayVal, item.pkg_factor);
        const pkgQty =
          useAltUnits && item.pkg_factor
            ? displayVal
            : item.pkg_factor
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
      alert("No items with quantities > 0. Enter some quantities first.");
      return;
    }

    try {
      await exportOrderExcel(exportRows);
    } catch {
      alert("Export failed. Make sure the backend is running.");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-3">
          <ClipboardList size={20} className="text-indigo-600" />
          <div>
            <h1 className="text-base font-bold text-gray-900">Advanced Order Mode</h1>
            <p className="text-xs text-gray-400">
              {filteredItems.length} items · {totalOrderedItems} to order
              {activeGroup ? ` · ${activeGroup}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* PKG / PCS toggle */}
          <button
            onClick={toggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              useAltUnits
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
            title="Toggle PKG / PCS display"
          >
            {useAltUnits ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            {useAltUnits ? "PKG" : "PCS"}
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={totalOrderedItems === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export non-zero items to Excel"
          >
            <Download size={14} />
            Export ({totalOrderedItems})
          </button>
        </div>
      </div>

      {/* ── Group tabs ── */}
      <div
        id="adv-group-tabs"
        className="flex gap-1 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto scrollbar-none"
      >
        <button
          onClick={() => { setActiveGroup(""); setSelectedIndex(0); }}
          className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
            activeGroup === ""
              ? "bg-indigo-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          All Groups
        </button>
        {groupNames.map((g) => (
          <button
            key={g}
            onClick={() => { setActiveGroup(g); setSelectedIndex(0); }}
            className={`shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              activeGroup === g
                ? "bg-indigo-600 text-white"
                : g === "Togo Cycles"
                ? "bg-gray-200 text-gray-700 hover:bg-gray-300"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* ── Split panel ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Item history panel */}
        <aside className="w-[40%] min-w-[300px] flex flex-col border-r border-gray-200 bg-white overflow-hidden">

          {/* Selected item header */}
          <div className="p-3 border-b border-gray-100 bg-gray-50">
            {selectedItem ? (
              <>
                <div className="text-sm font-bold text-gray-800 truncate" title={selectedItem.name}>
                  {selectedItem.name}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">
                    {selectedItem.group}
                  </span>
                  {selectedItem.pkg_factor && (
                    <span className="text-xs text-gray-400">
                      1 PKG = {selectedItem.pkg_factor.toFixed(0)} {selectedItem.base_unit}
                    </span>
                  )}
                </div>
                {/* Stock chips */}
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  <div className="rounded-md bg-white border border-gray-100 px-2 py-1 text-center">
                    <div className="text-xs text-gray-400">Current Stock</div>
                    <div className={`text-sm font-bold ${
                      selectedItem.current_closing_base < 0 ? "text-red-600" : "text-gray-800"
                    }`}>
                      {displayQty(selectedItem.current_closing_base, selectedItem.pkg_factor)}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        {unitLabel(selectedItem.pkg_factor)}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-md bg-blue-50 border border-blue-100 px-2 py-1 text-center">
                    <div className="text-xs text-gray-400">Avg Monthly Out</div>
                    <div className="text-sm font-bold text-blue-700">
                      {displayQty(selectedItem.avg_monthly_outward, selectedItem.pkg_factor)}
                      <span className="text-xs font-normal text-blue-400 ml-1">
                        {unitLabel(selectedItem.pkg_factor)}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-gray-400 text-center py-2">
                Use ↑ ↓ to select an item
              </div>
            )}
          </div>

          {/* History */}
          {selectedItem ? (
            <HistoryPanel rows={history} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">
              ← Select an item
            </div>
          )}
        </aside>

        {/* RIGHT: Order list */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

          {/* Search + status bar */}
          <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search items…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedIndex(0); }}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <span className="text-xs text-gray-400 ml-auto">
              ↑↓ Navigate · Enter Edit · Space = 0 · Ctrl+G Group
            </span>
          </div>

          {/* Item table */}
          <div className="flex-1 overflow-y-auto">
            {itemsLoading ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Loading items… Import MKCP data first if this is empty.
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                No items found.
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-3 py-2 text-gray-500 font-medium w-[55%]">Item</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium w-[15%]">Stock</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium w-[18%]">Order Qty</th>
                    <th className="text-center px-2 py-2 text-gray-500 font-medium w-[12%]">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, idx) => {
                    const isSelected = idx === selectedIndex;
                    const rawQty = orderMap.get(item.name) ?? 0;

                    return (
                      <tr
                        key={item.name}
                        ref={(el) => { rowRefs.current[idx] = el; }}
                        onClick={() => setSelectedIndex(idx)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-indigo-50 border-indigo-200"
                            : rawQty > 0
                            ? "bg-green-50 hover:bg-green-100"
                            : "hover:bg-gray-50"
                        }`}
                      >
                        {/* Item name */}
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {item.pkg_factor && (
                              <Package size={11} className="text-gray-300 shrink-0" />
                            )}
                            <span
                              className={`text-xs font-medium truncate ${
                                isSelected ? "text-indigo-800" : "text-gray-800"
                              }`}
                              title={item.name}
                            >
                              {item.name}
                            </span>
                          </div>
                          {/* Show group only when "All Groups" tab is active */}
                          {!activeGroup && (
                            <div className="text-xs text-gray-400 pl-4 truncate">{item.group}</div>
                          )}
                        </td>

                        {/* Current stock */}
                        <td
                          className={`text-right px-2 py-1.5 text-xs font-medium ${
                            item.current_closing_base < 0 ? "text-red-500" : "text-gray-500"
                          }`}
                        >
                          {displayQty(item.current_closing_base, item.pkg_factor)}
                        </td>

                        {/* Qty input — starts at 0, no auto-fill */}
                        <td className="text-right px-2 py-1.5">
                          <input
                            ref={(el) => { qtyInputRefs.current[idx] = el; }}
                            type="number"
                            min={0}
                            step={1}
                            data-type="adv-qty"
                            value={rawQty === 0 ? "" : rawQty}
                            placeholder="0"
                            onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx); }}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setOrderMap((m) => {
                                const n = new Map(m);
                                n.set(item.name, val);
                                return n;
                              });
                            }}
                            className={`w-16 text-right px-1.5 py-0.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-indigo-300 ${
                              rawQty > 0
                                ? "border-green-400 bg-green-50"
                                : isSelected
                                ? "border-indigo-300 bg-white"
                                : "border-gray-200 bg-white"
                            }`}
                          />
                        </td>

                        {/* Unit */}
                        <td className="text-center px-2 py-1.5 text-xs text-gray-400">
                          {unitLabel(item.pkg_factor)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer summary */}
          {totalOrderedItems > 0 && (
            <div className="px-3 py-2 bg-white border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
              <span>
                <span className="font-semibold text-indigo-700">{totalOrderedItems}</span> items to order
              </span>
              <button
                onClick={handleExport}
                className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
              >
                <Download size={12} />
                Export to Excel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
