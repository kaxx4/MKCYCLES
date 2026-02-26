/**
 * Stock Inventory page — with Rate Edit Mode
 *
 * Additions over the base version:
 *  • "Edit Rates" toggle button in the item detail header
 *  • Rate Override card showing current pkg_rate and unit_rate
 *  • Edit mode: both rate fields become editable inputs
 *  • Save → POST /api/rates/{item}   |   Discard → reverts to saved values
 *  • Delete override → DELETE /api/rates/{item}
 *  • Visual highlight on edited (unsaved) fields
 *  • Advisory warnings on large % changes (returned by backend)
 */
import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Package,
  TrendingUp,
  TrendingDown,
  Search,
  Edit2,
  X,
  Save,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { fetchItemInventory, fetchItemInventoryDetail } from "../api/endpoints";
import {
  fetchRateOverride,
  saveRateOverride,
  deleteRateOverride,
} from "../api/orderEndpoints";
import { formatNumber } from "../utils/format";
import type { RateOverride } from "../types/order";

function MonthLabel({ month }: { month: string }) {
  const [, m] = month.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return <>{months[parseInt(m, 10) - 1]} {month.slice(2, 4)}</>;
}

// ── Rate Edit Card ─────────────────────────────────────────────────────────────

interface RateCardProps {
  itemName: string;
}

function RateCard({ itemName }: RateCardProps) {
  const queryClient = useQueryClient();

  // Fetch saved override
  const { data: saved, isLoading: rateLoading } = useQuery<RateOverride>({
    queryKey: ["rate-override", itemName],
    queryFn: () => fetchRateOverride(itemName),
    enabled: !!itemName,
  });

  // Local edit state
  const [editMode, setEditMode] = useState(false);
  const [pkgRate, setPkgRate] = useState<string>("");
  const [unitRate, setUnitRate] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);

  // Sync local state when saved data changes or item changes
  useEffect(() => {
    setEditMode(false);
    setWarnings([]);
    setPkgRate(saved?.pkg_rate != null ? String(saved.pkg_rate) : "");
    setUnitRate(saved?.unit_rate != null ? String(saved.unit_rate) : "");
  }, [saved, itemName]);

  const hasUnsavedChanges =
    editMode &&
    (pkgRate !== (saved?.pkg_rate != null ? String(saved.pkg_rate) : "") ||
     unitRate !== (saved?.unit_rate != null ? String(saved.unit_rate) : ""));

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      saveRateOverride(itemName, {
        pkg_rate: pkgRate !== "" ? parseFloat(pkgRate) : null,
        unit_rate: unitRate !== "" ? parseFloat(unitRate) : null,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["rate-override", itemName] });
      setWarnings(result.warnings ?? []);
      setEditMode(false);
    },
    onError: (err: Error) => alert(`Save failed: ${err.message}`),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => deleteRateOverride(itemName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rate-override", itemName] });
      setWarnings([]);
      setEditMode(false);
    },
    onError: (err: Error) => alert(`Delete failed: ${err.message}`),
  });

  if (rateLoading) {
    return (
      <div className="card animate-pulse h-24" />
    );
  }

  const hasSavedOverride =
    saved && (saved.pkg_rate != null || saved.unit_rate != null);

  return (
    <div className={`card border-2 transition-colors ${
      editMode ? "border-amber-300 bg-amber-50/30" : "border-transparent"
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Rate Override</h3>
          {hasSavedOverride && !editMode && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
              Custom
            </span>
          )}
          {editMode && hasUnsavedChanges && (
            <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-medium">
              Unsaved
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {editMode ? (
            <>
              <button
                onClick={() => {
                  // Discard — revert to saved
                  setPkgRate(saved?.pkg_rate != null ? String(saved.pkg_rate) : "");
                  setUnitRate(saved?.unit_rate != null ? String(saved.unit_rate) : "");
                  setEditMode(false);
                  setWarnings([]);
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <X size={12} /> Discard
              </button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
              >
                <Save size={12} />
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
              {hasSavedOverride && (
                <button
                  onClick={() => {
                    if (confirm("Remove rate override and revert to Tally rates?")) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                  title="Remove override — revert to Tally XML rates"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100"
            >
              <Edit2 size={12} /> Edit Rates
            </button>
          )}
        </div>
      </div>

      {/* Rate fields */}
      <div className="grid grid-cols-2 gap-3">
        {/* PKG Rate */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">PKG Rate (₹ / package)</label>
          {editMode ? (
            <input
              type="number"
              min={0}
              step={0.01}
              value={pkgRate}
              placeholder="e.g. 1500.00"
              onChange={(e) => setPkgRate(e.target.value)}
              className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                pkgRate !== (saved?.pkg_rate != null ? String(saved.pkg_rate) : "")
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200"
              }`}
            />
          ) : (
            <div className="text-sm font-semibold text-gray-800">
              {saved?.pkg_rate != null
                ? `₹ ${saved.pkg_rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                : <span className="text-gray-400 font-normal italic">Not set (uses Tally)</span>}
            </div>
          )}
        </div>

        {/* Unit Rate */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Unit Rate (₹ / piece)</label>
          {editMode ? (
            <input
              type="number"
              min={0}
              step={0.01}
              value={unitRate}
              placeholder="e.g. 5.00"
              onChange={(e) => setUnitRate(e.target.value)}
              className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 ${
                unitRate !== (saved?.unit_rate != null ? String(saved.unit_rate) : "")
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200"
              }`}
            />
          ) : (
            <div className="text-sm font-semibold text-gray-800">
              {saved?.unit_rate != null
                ? `₹ ${saved.unit_rate.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                : <span className="text-gray-400 font-normal italic">Not set (uses Tally)</span>}
            </div>
          )}
        </div>
      </div>

      {/* Last modified */}
      {hasSavedOverride && saved?.last_modified && !editMode && (
        <p className="text-xs text-gray-400 mt-2">
          Last updated: {new Date(saved.last_modified).toLocaleString("en-IN")}
        </p>
      )}

      {/* Advisory warnings from backend */}
      {warnings.length > 0 && (
        <div className="mt-2 p-2 rounded-lg bg-yellow-50 border border-yellow-200">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-yellow-800">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {editMode && (
        <p className="text-xs text-gray-400 mt-2">
          Overrides take precedence over Tally XML rates in all dashboard calculations.
          Negative rates are not allowed.
        </p>
      )}
    </div>
  );
}

// ── Main Items page ───────────────────────────────────────────────────────────

export default function Items() {
  const [months, setMonths] = useState<8 | 12>(8);
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [itemIndex, setItemIndex] = useState(0);

  const { data: inventory = [], isLoading } = useQuery({
    queryKey: ["item-inventory", months],
    queryFn: () => fetchItemInventory({ months }),
  });

  const filtered = inventory.filter((i) =>
    i.stock_item_name.toLowerCase().includes(search.toLowerCase())
  );

  // When filtered list changes, sync selection
  useEffect(() => {
    if (filtered.length === 0) { setSelectedItem(null); setItemIndex(0); return; }
    const idx = selectedItem ? filtered.findIndex((i) => i.stock_item_name === selectedItem) : -1;
    if (idx >= 0) { setItemIndex(idx); }
    else { setItemIndex(0); setSelectedItem(filtered[0].stock_item_name); }
  }, [filtered.length, search]);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["item-detail", selectedItem, months],
    queryFn: () => selectedItem ? fetchItemInventoryDetail(selectedItem, months) : Promise.resolve(null),
    enabled: !!selectedItem,
  });

  const currentItem = detail ?? filtered[itemIndex] ?? null;
  const totalInward = currentItem?.monthly_data.reduce((s, m) => s + m.inward, 0) ?? 0;
  const totalOutward = currentItem?.monthly_data.reduce((s, m) => s + m.outward, 0) ?? 0;

  function go(dir: 1 | -1) {
    if (!filtered.length) return;
    const newIdx = (itemIndex + dir + filtered.length) % filtered.length;
    setItemIndex(newIdx);
    setSelectedItem(filtered[newIdx].stock_item_name);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stock Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">
            {isLoading ? "Loading…" : `${filtered.length} active items`} · Monthly inward/outward movements
          </p>
        </div>
        <div className="flex gap-2">
          {([8, 12] as const).map((n) => (
            <button
              key={n}
              onClick={() => setMonths(n)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
                months === n ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {n} Months
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Item list */}
        <div className="xl:col-span-1 card p-0 overflow-hidden flex flex-col" style={{ maxHeight: "75vh" }}>
          <div className="p-3 border-b border-gray-100 bg-gray-50">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="px-3 py-2.5 border-b border-gray-50 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-3/4 mb-1" />
                  <div className="h-3 bg-gray-100 rounded w-1/3" />
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-gray-400 text-sm">No items found</div>
            ) : (
              filtered.map((item, i) => (
                <button
                  key={item.stock_item_name}
                  onClick={() => { setItemIndex(i); setSelectedItem(item.stock_item_name); }}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 text-sm transition ${
                    selectedItem === item.stock_item_name
                      ? "bg-blue-50 text-blue-800"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <div className="font-medium truncate">{item.stock_item_name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Balance: <span className={item.closing < 0 ? "text-red-600 font-semibold" : "text-gray-700 font-semibold"}>
                      {formatNumber(item.closing)}
                    </span> {item.unit || ""}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
            {filtered.length} of {inventory.length} items
          </div>
        </div>

        {/* Detail panel */}
        <div className="xl:col-span-2 space-y-4">
          {!isLoading && currentItem ? (
            <>
              {/* Navigation header */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => go(-1)} disabled={filtered.length <= 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
                    <ChevronLeft size={18} />
                  </button>
                  <div className="flex-1 text-center px-4">
                    <div className="flex items-center justify-center gap-2">
                      <Package size={16} className="text-blue-600" />
                      <h2 className="text-base font-semibold">{currentItem.stock_item_name}</h2>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Item {itemIndex + 1} of {filtered.length} · Unit: {currentItem.unit || "—"}
                    </p>
                  </div>
                  <button onClick={() => go(1)} disabled={filtered.length <= 1}
                    className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition">
                    <ChevronRight size={18} />
                  </button>
                </div>

                {/* Summary row */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Opening", value: currentItem.opening, color: "gray" },
                    { label: "Total Inward", value: totalInward, color: "blue" },
                    { label: "Total Outward", value: totalOutward, color: "red" },
                    { label: "Closing", value: currentItem.closing, color: currentItem.closing < 0 ? "red" : "green" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`text-center p-2.5 rounded-lg bg-${color}-50`}>
                      <div className={`text-xs text-${color}-600 flex items-center justify-center gap-1`}>
                        {label === "Total Inward" && <TrendingUp size={11} />}
                        {label === "Total Outward" && <TrendingDown size={11} />}
                        {label}
                      </div>
                      <div className={`font-bold text-${color}-800 mt-0.5`}>
                        {formatNumber(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rate Override Card */}
              <RateCard itemName={currentItem.stock_item_name} />

              {/* Monthly table */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Monthly Movement · Last {months} Months
                  </h3>
                  {detailLoading && <span className="text-xs text-blue-500 animate-pulse">Refreshing…</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500">Month</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-500">Opening</th>
                        <th className="text-right px-4 py-2.5 font-medium text-blue-600">Inward (+)</th>
                        <th className="text-right px-4 py-2.5 font-medium text-red-600">Outward (−)</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-700">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentItem.monthly_data.map((m, i, arr) => {
                        const prevClose = i === 0 ? currentItem.opening : arr[i - 1].closing;
                        return (
                          <tr key={m.month} className={`border-b border-gray-50 hover:bg-gray-50 ${
                            m.inward > 0 || m.outward > 0 ? "" : "opacity-50"
                          }`}>
                            <td className="px-4 py-2.5 font-medium text-gray-700">
                              <MonthLabel month={m.month} />
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-500">{formatNumber(prevClose)}</td>
                            <td className="px-4 py-2.5 text-right text-blue-700 font-medium">
                              {m.inward > 0 ? `+${formatNumber(m.inward)}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right text-red-700 font-medium">
                              {m.outward > 0 ? `−${formatNumber(m.outward)}` : "—"}
                            </td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${
                              m.closing < 0 ? "text-red-700" : "text-gray-900"
                            }`}>
                              {formatNumber(m.closing)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td className="px-4 py-2.5 font-bold text-gray-700">Period Total</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{formatNumber(currentItem.opening)}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-blue-800">+{formatNumber(totalInward)}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-red-800">−{formatNumber(totalOutward)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold ${
                          currentItem.closing < 0 ? "text-red-700" : "text-green-700"
                        }`}>
                          {formatNumber(currentItem.closing)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          ) : !isLoading ? (
            <div className="card flex items-center justify-center h-48 text-gray-400">
              Select an item from the list to view its inventory
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
