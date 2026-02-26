import { useState, useEffect, useRef, useMemo } from "react";
import { Card } from "../components";
import { useDataStore } from "../store/dataStore";
import { useUIStore } from "../store/uiStore";
import { useOrderStore } from "../store/orderStore";
import { useOverrideStore } from "../store/overrideStore";
import { computeMonthlyHistory, computeItemFYSummary, type InventoryPeriod } from "../engine/inventory";
import { formatQty, toBase, type ItemUnitConfig } from "../engine/units";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Search, Filter, Plus, Minus, Download } from "lucide-react";
import * as XLSX from "xlsx";

export function Orders() {
  const data = useDataStore((s) => s.data);
  const fyYear = useUIStore((s) => s.fyYear);
  const unitMode = useUIStore((s) => s.unitMode);
  const toggleUnitMode = useUIStore((s) => s.toggleUnitMode);

  const orders = useOrderStore((s) => s.orders);
  const setOrderQty = useOrderStore((s) => s.setOrderQty);
  const clearOrder = useOrderStore((s) => s.clearOrder);
  const coverMonths = useOrderStore((s) => s.coverMonths);
  const setCoverMonths = useOrderStore((s) => s.setCoverMonths);
  const getAllOrders = useOrderStore((s) => s.getAllOrders);
  const clearAllOrders = useOrderStore((s) => s.clearAllOrders);

  const overrideUnits = useOverrideStore((s) => s.units);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const groupFilterRef = useRef<HTMLInputElement>(null);

  // Get all items with their closing stock from current FY
  const allItems = useMemo(() => {
    if (!data) return [];
    const stockItems = Array.from(data.stockItems.values());
    const vouchers = data.vouchers;

    return stockItems.map((item) => {
      const fySummary = computeItemFYSummary(item, vouchers, fyYear);
      return {
        name: item.name,
        group: item.group,
        closingQty: fySummary.closingQty,
        baseUnit: item.baseUnit,
      };
    });
  }, [data, fyYear]);

  // Filter items by search and group
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      const matchesSearch = search
        ? item.name.toLowerCase().includes(search.toLowerCase())
        : true;
      const matchesGroup = groupFilter
        ? item.group.toLowerCase().includes(groupFilter.toLowerCase())
        : true;
      return matchesSearch && matchesGroup;
    });
  }, [allItems, search, groupFilter]);


  // Refs for keyboard navigation (avoid stale closures)
  const filteredRef = useRef(filteredItems);
  const selectedRef = useRef(selectedItemName);

  useEffect(() => {
    filteredRef.current = filteredItems;
  }, [filteredItems]);

  useEffect(() => {
    selectedRef.current = selectedItemName;
  }, [selectedItemName]);

  // Auto-select first item when filters change
  useEffect(() => {
    if (filteredItems.length > 0 && !selectedItemName) {
      setSelectedItemName(filteredItems[0]!.name);
    } else if (filteredItems.length === 0) {
      setSelectedItemName(null);
    } else if (selectedItemName && !filteredItems.find((i) => i.name === selectedItemName)) {
      setSelectedItemName(filteredItems[0]!.name);
    }
  }, [filteredItems, selectedItemName]);

  // Get selected item full data
  const selectedItem = useMemo(() => {
    if (!selectedItemName || !data) return null;
    return data.stockItems.get(selectedItemName.toUpperCase().trim()) ?? null;
  }, [selectedItemName, data]);

  // Get unit config for selected item
  const selectedItemConfig = useMemo((): ItemUnitConfig | null => {
    if (!selectedItem) return null;

    // Check overrides first
    const override = overrideUnits[selectedItem.name];
    if (override) {
      return {
        itemName: selectedItem.name,
        baseUnit: override.baseUnit,
        pkgUnit: override.pkgUnit,
        unitsPerPkg: override.unitsPerPkg,
        source: "manual",
      };
    }

    // Check Tally native compound unit
    if (selectedItem.alternateUnit && selectedItem.alternateConversion) {
      return {
        itemName: selectedItem.name,
        baseUnit: selectedItem.baseUnit,
        pkgUnit: selectedItem.alternateUnit,
        unitsPerPkg: selectedItem.alternateConversion,
        source: "tally",
      };
    }

    return null;
  }, [selectedItem, overrideUnits]);

  // Compute monthly history for selected item
  const monthlyHistory = useMemo((): InventoryPeriod[] => {
    if (!selectedItem || !data) return [];
    return computeMonthlyHistory(selectedItem, data.vouchers, fyYear, 8);
  }, [selectedItem, data, fyYear]);

  // Compute FY summary for selected item
  const fySummary = useMemo((): InventoryPeriod | null => {
    if (!selectedItem || !data) return null;
    return computeItemFYSummary(selectedItem, data.vouchers, fyYear);
  }, [selectedItem, data, fyYear]);

  // Compute reorder suggestion
  const suggestion = useMemo(() => {
    if (monthlyHistory.length === 0) return 0;

    const recent = monthlyHistory.slice(-6);
    const avgOutward = recent.length > 0
      ? recent.reduce((s, m) => s + m.outwardQty, 0) / recent.length
      : 0;

    const currentClosing = monthlyHistory[monthlyHistory.length - 1]?.closingQty ?? 0;
    const neededBase = Math.max(0, avgOutward * coverMonths - currentClosing);

    if (selectedItemConfig && selectedItemConfig.unitsPerPkg > 0) {
      // Round up to whole packages
      return Math.ceil(neededBase / selectedItemConfig.unitsPerPkg) * selectedItemConfig.unitsPerPkg;
    }
    return Math.ceil(neededBase);
  }, [monthlyHistory, coverMonths, selectedItemConfig]);

  // Keyboard handler (stable, no closures)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const items = filteredRef.current;
      const current = selectedRef.current;

      // Ctrl+G: Focus group filter
      if (e.ctrlKey && e.key === "g") {
        e.preventDefault();
        groupFilterRef.current?.focus();
        return;
      }

      // Don't interfere if user is typing in an input
      if (
        document.activeElement?.tagName === "INPUT" &&
        document.activeElement !== groupFilterRef.current
      ) {
        return;
      }

      // ArrowUp/Down: Navigate list
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;

        const currentIndex = items.findIndex((i) => i.name === current);
        let newIndex = 0;

        if (e.key === "ArrowDown") {
          newIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        } else {
          newIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        }

        setSelectedItemName(items[newIndex]!.name);
        return;
      }

      // Enter: Focus input
      if (e.key === "Enter") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      // Space: Set qty to 0
      if (e.key === " " && current) {
        e.preventDefault();
        clearOrder(current);
        setInputValue("");
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearOrder]);

  // Update input when selected item changes
  useEffect(() => {
    if (selectedItemName) {
      const currentOrder = orders[selectedItemName] ?? 0;
      if (currentOrder > 0) {
        const displayQty = formatQty(currentOrder, selectedItemConfig, unitMode);
        setInputValue(String(displayQty.value));
      } else {
        setInputValue("");
      }
    }
  }, [selectedItemName, orders, selectedItemConfig, unitMode]);

  // Auto-focus input when item selected
  useEffect(() => {
    if (selectedItemName) {
      inputRef.current?.focus();
    }
  }, [selectedItemName]);

  const handleInputChange = (value: string) => {
    setInputValue(value);
  };

  const handleInputBlur = () => {
    if (!selectedItemName) return;

    const num = parseFloat(inputValue);
    if (isNaN(num) || num <= 0) {
      clearOrder(selectedItemName);
      setInputValue("");
    } else {
      const baseQty = toBase(num, selectedItemConfig, unitMode);
      setOrderQty(selectedItemName, baseQty);
    }
  };

  const useSuggestion = () => {
    if (!selectedItemName || suggestion === 0) return;
    setOrderQty(selectedItemName, suggestion);
    const displayQty = formatQty(suggestion, selectedItemConfig, unitMode);
    setInputValue(String(displayQty.value));
  };

  const addAndNext = () => {
    // Save current
    handleInputBlur();

    // Move to next
    const currentIndex = filteredItems.findIndex((i) => i.name === selectedItemName);
    if (currentIndex < filteredItems.length - 1) {
      setSelectedItemName(filteredItems[currentIndex + 1]!.name);
    }
  };

  const exportToExcel = () => {
    if (!data) return;

    const orderList = getAllOrders();
    const rows = orderList.map(({ itemName, baseQty }) => {
      const item = data.stockItems.get(itemName.toUpperCase().trim());
      if (!item) return null;

      const fySummary = computeItemFYSummary(item, data.vouchers, fyYear);
      const config = overrideUnits[itemName]
        ? {
            itemName,
            baseUnit: overrideUnits[itemName]!.baseUnit,
            pkgUnit: overrideUnits[itemName]!.pkgUnit,
            unitsPerPkg: overrideUnits[itemName]!.unitsPerPkg,
            source: "manual" as const,
          }
        : item.alternateUnit && item.alternateConversion
        ? {
            itemName,
            baseUnit: item.baseUnit,
            pkgUnit: item.alternateUnit,
            unitsPerPkg: item.alternateConversion,
            source: "tally" as const,
          }
        : null;

      const currentStock = formatQty(fySummary.closingQty, config, unitMode);
      const orderQty = formatQty(baseQty, config, unitMode);
      const total = formatQty(fySummary.closingQty + baseQty, config, unitMode);

      return {
        Item: itemName,
        Group: item.group,
        "Current Stock": currentStock.formatted,
        "Order Qty": orderQty.formatted,
        "Total After Order": total.formatted,
      };
    }).filter(Boolean);

    // Summary sheet
    const ws1 = XLSX.utils.json_to_sheet(rows);

    // Detailed sheet with monthly breakdown
    const detailedRows = orderList.flatMap(({ itemName, baseQty }) => {
      const item = data.stockItems.get(itemName.toUpperCase().trim());
      if (!item) return [];

      const history = computeMonthlyHistory(item, data.vouchers, fyYear, 8);
      const config = overrideUnits[itemName]
        ? {
            itemName,
            baseUnit: overrideUnits[itemName]!.baseUnit,
            pkgUnit: overrideUnits[itemName]!.pkgUnit,
            unitsPerPkg: overrideUnits[itemName]!.unitsPerPkg,
            source: "manual" as const,
          }
        : item.alternateUnit && item.alternateConversion
        ? {
            itemName,
            baseUnit: item.baseUnit,
            pkgUnit: item.alternateUnit,
            unitsPerPkg: item.alternateConversion,
            source: "tally" as const,
          }
        : null;

      return history.map((period) => ({
        Item: itemName,
        Group: item.group,
        Month: period.periodStart.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
        Opening: formatQty(period.openingQty, config, unitMode).formatted,
        Inward: formatQty(period.inwardQty, config, unitMode).formatted,
        Outward: formatQty(period.outwardQty, config, unitMode).formatted,
        Closing: formatQty(period.closingQty, config, unitMode).formatted,
        "Order Qty": formatQty(baseQty, config, unitMode).formatted,
      }));
    });

    const ws2 = XLSX.utils.json_to_sheet(detailedRows);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Order Summary");
    XLSX.utils.book_append_sheet(wb, ws2, "Detailed");

    XLSX.writeFile(wb, "OrderList.xlsx");
  };

  // Chart data
  const chartData = useMemo(() => {
    return monthlyHistory.map((period) => ({
      month: period.periodStart.toLocaleDateString("en-IN", { month: "short" }),
      closing: formatQty(period.closingQty, selectedItemConfig, unitMode).value,
      outward: formatQty(period.outwardQty, selectedItemConfig, unitMode).value,
    }));
  }, [monthlyHistory, selectedItemConfig, unitMode]);

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Orders</h1>
        <Card>
          <p className="text-gray-600">No data loaded. Please import data first.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Reorder Planning</h1>
      </div>

      {/* 3-Panel Layout */}
      <div className="flex gap-6 h-[calc(100vh-12rem)]">
        {/* LEFT PANEL - Item List (28%) */}
        <div className="w-[28%] flex flex-col gap-4">
          <Card className="flex-1 flex flex-col !p-0">
            {/* Search + Filter */}
            <div className="p-4 border-b space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="relative">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  ref={groupFilterRef}
                  type="text"
                  placeholder="Filter by group (Ctrl+G)"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="text-xs text-gray-500">
                Showing {filteredItems.length} of {allItems.length} items
              </div>
            </div>

            {/* Virtual-scrollable item list */}
            <div className="flex-1 overflow-y-auto">
              {filteredItems.map((item) => {
                const hasOrder = (orders[item.name] ?? 0) > 0;
                const isSelected = item.name === selectedItemName;
                const displayClosing = formatQty(item.closingQty, null, unitMode);

                return (
                  <div
                    key={item.name}
                    onClick={() => setSelectedItemName(item.name)}
                    className={`px-4 py-3 border-b cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-blue-50 border-blue-200"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">
                          {item.name}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {item.group}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Stock: {displayClosing.formatted}
                        </div>
                      </div>
                      {hasOrder && (
                        <div className="w-2 h-2 bg-green-500 rounded-full mt-1 flex-shrink-0" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* CENTER PANEL - Item Details + Chart (42%) */}
        <div className="w-[42%] flex flex-col gap-4">
          <Card className="flex-1 flex flex-col">
            {selectedItem && fySummary ? (
              <div className="space-y-4 h-full flex flex-col">
                {/* Header */}
                <div>
                  <h2 className="text-xl font-bold">{selectedItem.name}</h2>
                  <p className="text-sm text-gray-600">{selectedItem.group}</p>
                  {selectedItemConfig && (
                    <p className="text-xs text-blue-600 mt-1">
                      PKG Config: 1 {selectedItemConfig.pkgUnit} = {selectedItemConfig.unitsPerPkg} {selectedItemConfig.baseUnit}
                      {selectedItemConfig.source === "manual" && " (Manual)"}
                    </p>
                  )}
                </div>

                {/* FY Summary Chips */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600">Opening</div>
                    <div className="text-lg font-bold text-blue-700">
                      {formatQty(fySummary.openingQty, selectedItemConfig, unitMode).value}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatQty(fySummary.openingQty, selectedItemConfig, unitMode).label}
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600">+Inward</div>
                    <div className="text-lg font-bold text-green-700">
                      {formatQty(fySummary.inwardQty, selectedItemConfig, unitMode).value}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatQty(fySummary.inwardQty, selectedItemConfig, unitMode).label}
                    </div>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600">-Outward</div>
                    <div className="text-lg font-bold text-red-700">
                      {formatQty(fySummary.outwardQty, selectedItemConfig, unitMode).value}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatQty(fySummary.outwardQty, selectedItemConfig, unitMode).label}
                    </div>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600">Closing</div>
                    <div className="text-lg font-bold text-purple-700">
                      {formatQty(fySummary.closingQty, selectedItemConfig, unitMode).value}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatQty(fySummary.closingQty, selectedItemConfig, unitMode).label}
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-2">Last 8 Months Trend</h3>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="closing"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        name="Closing Stock"
                      />
                      <Line
                        type="monotone"
                        dataKey="outward"
                        stroke="#f97316"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        name="Outward"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Monthly Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Month</th>
                        <th className="px-3 py-2 text-right">Opening</th>
                        <th className="px-3 py-2 text-right">Inward</th>
                        <th className="px-3 py-2 text-right">Outward</th>
                        <th className="px-3 py-2 text-right">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyHistory.map((period, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="px-3 py-2">
                            {period.periodStart.toLocaleDateString("en-IN", {
                              month: "short",
                              year: "2-digit",
                            })}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatQty(period.openingQty, selectedItemConfig, unitMode).value}
                          </td>
                          <td className="px-3 py-2 text-right text-green-600">
                            +{formatQty(period.inwardQty, selectedItemConfig, unitMode).value}
                          </td>
                          <td className="px-3 py-2 text-right text-red-600">
                            -{formatQty(period.outwardQty, selectedItemConfig, unitMode).value}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatQty(period.closingQty, selectedItemConfig, unitMode).value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                Select an item to view details
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT PANEL - Order Entry + Summary (30%) */}
        <div className="w-[30%] flex flex-col gap-4">
          {/* Unit Toggle */}
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Display Unit</span>
              <button
                onClick={toggleUnitMode}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-amber-50 hover:border-amber-400 hover:text-amber-700 transition-colors"
              >
                {unitMode === "BASE" ? "PCS ⇄ PKG" : "PKG ⇄ PCS"}
              </button>
            </div>
          </Card>

          {/* Cover Months Adjuster */}
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Cover Period</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCoverMonths(coverMonths - 1)}
                  className="p-1 rounded hover:bg-gray-100"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-lg font-bold w-12 text-center">
                  {coverMonths}
                </span>
                <span className="text-sm text-gray-600">months</span>
                <button
                  onClick={() => setCoverMonths(coverMonths + 1)}
                  className="p-1 rounded hover:bg-gray-100"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </Card>

          {/* Order Entry */}
          {selectedItem && (
            <Card>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Order Quantity
                  </label>
                  <input
                    ref={inputRef}
                    type="number"
                    value={inputValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onBlur={handleInputBlur}
                    placeholder="0"
                    className="w-full text-2xl font-bold px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {selectedItemConfig && inputValue && !isNaN(parseFloat(inputValue)) && (
                    <div className="mt-2 text-sm text-gray-600">
                      {unitMode === "PKG"
                        ? `${parseFloat(inputValue)} ${selectedItemConfig.pkgUnit} = ${
                            parseFloat(inputValue) * selectedItemConfig.unitsPerPkg
                          } ${selectedItemConfig.baseUnit}`
                        : `${parseFloat(inputValue)} ${selectedItemConfig.baseUnit} = ${(
                            parseFloat(inputValue) / selectedItemConfig.unitsPerPkg
                          ).toFixed(2)} ${selectedItemConfig.pkgUnit}`}
                    </div>
                  )}
                </div>

                {suggestion > 0 && (
                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-gray-600">Suggested</div>
                        <div className="text-lg font-bold text-blue-700">
                          {formatQty(suggestion, selectedItemConfig, unitMode).formatted}
                        </div>
                      </div>
                      <button
                        onClick={useSuggestion}
                        className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Use
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={addAndNext}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                  Add & Next →
                </button>
              </div>
            </Card>
          )}

          {/* Order Summary */}
          <Card className="flex-1 flex flex-col !p-0">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Order Summary</h3>
              <span className="text-sm text-gray-600">
                {getAllOrders().length} items
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {getAllOrders().length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">
                  No orders yet
                </div>
              ) : (
                getAllOrders().map(({ itemName, baseQty }) => {
                  const item = data.stockItems.get(itemName.toUpperCase().trim());
                  if (!item) return null;

                  const config = overrideUnits[itemName]
                    ? {
                        itemName,
                        baseUnit: overrideUnits[itemName]!.baseUnit,
                        pkgUnit: overrideUnits[itemName]!.pkgUnit,
                        unitsPerPkg: overrideUnits[itemName]!.unitsPerPkg,
                        source: "manual" as const,
                      }
                    : item.alternateUnit && item.alternateConversion
                    ? {
                        itemName,
                        baseUnit: item.baseUnit,
                        pkgUnit: item.alternateUnit,
                        unitsPerPkg: item.alternateConversion,
                        source: "tally" as const,
                      }
                    : null;

                  const displayQty = formatQty(baseQty, config, unitMode);

                  return (
                    <div
                      key={itemName}
                      className="px-4 py-3 border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedItemName(itemName)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {itemName}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {item.group}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-bold text-blue-600">
                            {displayQty.formatted}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="p-4 border-t space-y-2">
              <button
                onClick={exportToExcel}
                disabled={getAllOrders().length === 0}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export to Excel
              </button>
              <button
                onClick={clearAllOrders}
                disabled={getAllOrders().length === 0}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Clear All Orders
              </button>
            </div>
          </Card>
        </div>
      </div>

      {/* Keyboard shortcuts help */}
      <Card>
        <div className="text-xs text-gray-600 space-y-1">
          <div className="font-semibold mb-2">Keyboard Shortcuts:</div>
          <div className="grid grid-cols-4 gap-2">
            <div><kbd className="px-2 py-1 bg-gray-100 rounded">↑/↓</kbd> Navigate list</div>
            <div><kbd className="px-2 py-1 bg-gray-100 rounded">Enter</kbd> Focus qty input</div>
            <div><kbd className="px-2 py-1 bg-gray-100 rounded">Space</kbd> Clear qty</div>
            <div><kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl+G</kbd> Focus group filter</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
