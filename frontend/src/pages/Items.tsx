import { useState, useMemo } from "react";
import { Edit, Save, X, Trash, ChevronDown, ChevronUp } from "lucide-react";
import { Card, Toast } from "../components";
import { useDataStore } from "../store/dataStore";
import { useUIStore } from "../store/uiStore";
import { useOverrideStore } from "../store/overrideStore";
import { computeMonthlyHistory } from "../engine/inventory";
import { formatQty, type ItemUnitConfig } from "../engine/units";
import type { CanonicalStockItem } from "../types/canonical";
import clsx from "clsx";

interface ToastState {
  show: boolean;
  message: string;
  type: "success" | "error";
}

export function Items() {
  // Store hooks
  const { getAllStockItems, getAllVouchers } = useDataStore();
  const { unitMode, fyYear } = useUIStore();
  const { getRate, setRate, deleteRate, getUnit, setUnit, deleteUnit } = useOverrideStore();

  // Data
  const items = getAllStockItems();
  const vouchers = getAllVouchers();

  // Get unique groups
  const groups = useMemo(() => {
    const groupSet = new Set(items.map((item) => item.group));
    return Array.from(groupSet).sort();
  }, [items]);

  // State
  const [selectedItem, setSelectedItem] = useState<CanonicalStockItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("");

  // Rate edit state
  const [rateEditMode, setRateEditMode] = useState(false);
  const [localPkgRate, setLocalPkgRate] = useState<string>("");
  const [localUnitRate, setLocalUnitRate] = useState<string>("");

  // Unit config edit state
  const [unitEditMode, setUnitEditMode] = useState(false);
  const [localBaseUnit, setLocalBaseUnit] = useState("");
  const [localPkgUnit, setLocalPkgUnit] = useState("");
  const [localUnitsPerPkg, setLocalUnitsPerPkg] = useState<string>("");

  // UI state
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [monthCount, setMonthCount] = useState<8 | 12>(8);
  const [toast, setToast] = useState<ToastState>({ show: false, message: "", type: "success" });

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesGroup = !groupFilter || item.group === groupFilter;
      return matchesSearch && matchesGroup;
    });
  }, [items, searchQuery, groupFilter]);

  // Get unit config for selected item
  const getItemUnitConfig = (item: CanonicalStockItem | null): ItemUnitConfig | null => {
    if (!item) return null;

    // Check manual override first
    const override = getUnit(item.name);
    if (override) {
      return {
        itemName: item.name,
        baseUnit: override.baseUnit,
        pkgUnit: override.pkgUnit,
        unitsPerPkg: override.unitsPerPkg,
        source: "manual",
      };
    }

    // Check Tally native compound unit
    if (item.alternateUnit && item.alternateConversion && item.alternateConversion > 0) {
      return {
        itemName: item.name,
        baseUnit: item.baseUnit,
        pkgUnit: item.alternateUnit,
        unitsPerPkg: item.alternateConversion,
        source: "tally",
      };
    }

    return null;
  };

  // Handle item selection
  const handleSelectItem = (item: CanonicalStockItem) => {
    setSelectedItem(item);

    // Reset edit modes
    setRateEditMode(false);
    setUnitEditMode(false);

    // Load saved rates
    const savedRate = getRate(item.name);
    setLocalPkgRate(savedRate?.pkgRate?.toString() ?? "");
    setLocalUnitRate(savedRate?.unitRate?.toString() ?? "");

    // Load unit config
    const config = getItemUnitConfig(item);
    if (config) {
      setLocalBaseUnit(config.baseUnit);
      setLocalPkgUnit(config.pkgUnit);
      setLocalUnitsPerPkg(config.unitsPerPkg.toString());
    } else {
      setLocalBaseUnit(item.baseUnit);
      setLocalPkgUnit("PKG");
      setLocalUnitsPerPkg("");
    }
  };

  // Rate edit handlers
  const handleEditRates = () => {
    setRateEditMode(true);
  };

  const handleSaveRates = () => {
    if (!selectedItem) return;

    const pkgRate = localPkgRate ? parseFloat(localPkgRate) : undefined;
    const unitRate = localUnitRate ? parseFloat(localUnitRate) : undefined;

    if ((pkgRate !== undefined && isNaN(pkgRate)) || (unitRate !== undefined && isNaN(unitRate))) {
      setToast({ show: true, message: "Invalid rate value", type: "error" });
      return;
    }

    if (pkgRate === undefined && unitRate === undefined) {
      setToast({ show: true, message: "At least one rate must be set", type: "error" });
      return;
    }

    setRate(selectedItem.name, { pkgRate, unitRate });
    setRateEditMode(false);
    setToast({ show: true, message: "Rates saved successfully", type: "success" });
  };

  const handleDiscardRates = () => {
    if (!selectedItem) return;
    const savedRate = getRate(selectedItem.name);
    setLocalPkgRate(savedRate?.pkgRate?.toString() ?? "");
    setLocalUnitRate(savedRate?.unitRate?.toString() ?? "");
    setRateEditMode(false);
  };

  const handleDeleteRates = () => {
    if (!selectedItem) return;
    deleteRate(selectedItem.name);
    setLocalPkgRate("");
    setLocalUnitRate("");
    setRateEditMode(false);
    setToast({ show: true, message: "Rate override deleted", type: "success" });
  };

  // Unit config handlers
  const handleEditUnitConfig = () => {
    setUnitEditMode(true);
  };

  const handleSaveUnitConfig = () => {
    if (!selectedItem) return;

    const unitsPerPkg = parseFloat(localUnitsPerPkg);

    if (!localBaseUnit.trim()) {
      setToast({ show: true, message: "Base unit is required", type: "error" });
      return;
    }

    if (!localPkgUnit.trim()) {
      setToast({ show: true, message: "Package unit is required", type: "error" });
      return;
    }

    if (isNaN(unitsPerPkg) || unitsPerPkg <= 0) {
      setToast({ show: true, message: "Units per package must be a positive number", type: "error" });
      return;
    }

    setUnit(selectedItem.name, {
      baseUnit: localBaseUnit.trim(),
      pkgUnit: localPkgUnit.trim(),
      unitsPerPkg,
    });

    setUnitEditMode(false);
    setToast({ show: true, message: "Unit configuration saved", type: "success" });
  };

  const handleDiscardUnitConfig = () => {
    if (!selectedItem) return;
    const config = getItemUnitConfig(selectedItem);
    if (config) {
      setLocalBaseUnit(config.baseUnit);
      setLocalPkgUnit(config.pkgUnit);
      setLocalUnitsPerPkg(config.unitsPerPkg.toString());
    } else {
      setLocalBaseUnit(selectedItem.baseUnit);
      setLocalPkgUnit("PKG");
      setLocalUnitsPerPkg("");
    }
    setUnitEditMode(false);
  };

  const handleDeleteUnitConfig = () => {
    if (!selectedItem) return;
    deleteUnit(selectedItem.name);
    setLocalBaseUnit(selectedItem.baseUnit);
    setLocalPkgUnit("PKG");
    setLocalUnitsPerPkg("");
    setUnitEditMode(false);
    setToast({ show: true, message: "Unit configuration deleted", type: "success" });
  };

  // Get saved rate data
  const savedRate = selectedItem ? getRate(selectedItem.name) : null;
  const savedUnitConfig = selectedItem ? getItemUnitConfig(selectedItem) : null;

  // Check if rates have changed
  const pkgRateChanged = localPkgRate !== (savedRate?.pkgRate?.toString() ?? "");
  const unitRateChanged = localUnitRate !== (savedRate?.unitRate?.toString() ?? "");

  // Get monthly history
  const monthlyHistory = selectedItem
    ? computeMonthlyHistory(selectedItem, vouchers, fyYear, monthCount)
    : [];

  // Get current closing stock
  const currentClosing = selectedItem
    ? formatQty(selectedItem.openingQty, savedUnitConfig, unitMode)
    : null;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <h1 className="text-3xl font-bold">Items</h1>
      </div>

      {/* Split Panel Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Item List (30%) */}
        <div className="w-[30%] border-r border-gray-200 flex flex-col">
          {/* Filters */}
          <div className="p-4 space-y-3 border-b border-gray-200">
            <input
              type="text"
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Groups</option>
              {groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </div>

          {/* Item List */}
          <div className="flex-1 overflow-y-auto">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No items found</div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.name}
                  onClick={() => handleSelectItem(item)}
                  className={clsx(
                    "w-full px-4 py-3 text-left border-b border-gray-200 hover:bg-gray-50 transition-colors",
                    selectedItem?.name === item.name && "bg-blue-50 border-l-4 border-l-blue-500"
                  )}
                >
                  <div className="font-medium text-gray-900">{item.name}</div>
                  <div className="text-sm text-gray-500">{item.group}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Stock: {formatQty(item.openingQty, getItemUnitConfig(item), unitMode).formatted}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Item Details (70%) */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedItem ? (
            <div className="h-full flex items-center justify-center text-gray-500">
              Select an item to view details
            </div>
          ) : (
            <div className="space-y-6 max-w-5xl">
              {/* Item Header */}
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedItem.name}</h2>
                <div className="mt-2 space-y-1 text-sm text-gray-600">
                  <div>Group: {selectedItem.group}</div>
                  {selectedItem.hsn && <div>HSN: {selectedItem.hsn}</div>}
                  {selectedItem.gstRate !== undefined && <div>GST: {selectedItem.gstRate}%</div>}
                  <div>
                    Current Stock: <span className="font-semibold">{currentClosing?.formatted}</span>
                  </div>
                </div>
              </div>

              {/* Card 1: Rate Edit Card */}
              <Card title="Pricing">
                {!rateEditMode ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-600">PKG Rate</div>
                        <div className="text-lg font-semibold">
                          {savedRate?.pkgRate !== undefined ? `₹${savedRate.pkgRate.toFixed(2)}` : "Not Set"}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Unit Rate</div>
                        <div className="text-lg font-semibold">
                          {savedRate?.unitRate !== undefined ? `₹${savedRate.unitRate.toFixed(2)}` : "Not Set"}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleEditRates}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                      Edit Rates
                    </button>

                    {/* Change Log */}
                    {savedRate && savedRate.changeLog.length > 0 && (
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <button
                          onClick={() => setShowChangeLog(!showChangeLog)}
                          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                        >
                          {showChangeLog ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          Change History ({savedRate.changeLog.length})
                        </button>
                        {showChangeLog && (
                          <div className="mt-3 space-y-2">
                            {savedRate.changeLog.slice(-10).reverse().map((change, idx) => (
                              <div key={idx} className="text-sm p-2 bg-gray-50 rounded">
                                <div className="font-medium">
                                  {change.field === "pkgRate" ? "PKG Rate" : "Unit Rate"}:{" "}
                                  {change.oldValue !== undefined ? `₹${change.oldValue}` : "Not Set"} → ₹{change.newValue}
                                </div>
                                <div className="text-gray-500 text-xs">
                                  {new Date(change.ts).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          PKG Rate (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={localPkgRate}
                          onChange={(e) => setLocalPkgRate(e.target.value)}
                          className={clsx(
                            "w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500",
                            pkgRateChanged ? "border-amber-400" : "border-gray-300"
                          )}
                          placeholder="Enter PKG rate"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Unit Rate (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={localUnitRate}
                          onChange={(e) => setLocalUnitRate(e.target.value)}
                          className={clsx(
                            "w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500",
                            unitRateChanged ? "border-amber-400" : "border-gray-300"
                          )}
                          placeholder="Enter unit rate"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveRates}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        <Save className="w-4 h-4" />
                        Save Changes
                      </button>
                      <button
                        onClick={handleDiscardRates}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        Discard
                      </button>
                      {savedRate && (
                        <button
                          onClick={handleDeleteRates}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                          Delete Override
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Card>

              {/* Card 2: Unit Config Card */}
              <Card title="Unit Configuration">
                {!unitEditMode ? (
                  <div className="space-y-4">
                    <div>
                      <div className="text-sm text-gray-600">Current Configuration</div>
                      {savedUnitConfig ? (
                        <div className="mt-2">
                          <div className="text-lg font-semibold">
                            1 {savedUnitConfig.pkgUnit} = {savedUnitConfig.unitsPerPkg} {savedUnitConfig.baseUnit}
                          </div>
                          {savedUnitConfig.source === "tally" && (
                            <span className="inline-block mt-2 px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                              from Tally
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="text-gray-500 mt-2">No package configuration</div>
                      )}
                    </div>
                    <button
                      onClick={handleEditUnitConfig}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                      Edit Config
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Base Unit
                        </label>
                        <input
                          type="text"
                          value={localBaseUnit}
                          onChange={(e) => setLocalBaseUnit(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g., PCS, KG"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Package Unit
                        </label>
                        <input
                          type="text"
                          value={localPkgUnit}
                          onChange={(e) => setLocalPkgUnit(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g., PKG, BOX, CARTON"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Units per Package
                        </label>
                        <input
                          type="number"
                          step="1"
                          value={localUnitsPerPkg}
                          onChange={(e) => setLocalUnitsPerPkg(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g., 12, 300"
                        />
                      </div>
                    </div>

                    {/* Conversion Preview */}
                    {localUnitsPerPkg && parseFloat(localUnitsPerPkg) > 0 && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="text-sm font-medium text-blue-900">Preview:</div>
                        <div className="text-sm text-blue-800 mt-1">
                          Example: {parseFloat(localUnitsPerPkg) * 100} {localBaseUnit || "PCS"} ={" "}
                          {(100).toFixed(2)} {localPkgUnit || "PKG"}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveUnitConfig}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        <Save className="w-4 h-4" />
                        Save
                      </button>
                      <button
                        onClick={handleDiscardUnitConfig}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        <X className="w-4 h-4" />
                        Discard
                      </button>
                      {getUnit(selectedItem.name) && (
                        <button
                          onClick={handleDeleteUnitConfig}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Card>

              {/* Card 3: Monthly History */}
              <Card
                title={
                  <div className="flex items-center justify-between">
                    <span>Monthly History</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setMonthCount(8)}
                        className={clsx(
                          "px-3 py-1 text-sm rounded",
                          monthCount === 8
                            ? "bg-blue-600 text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        )}
                      >
                        8 Months
                      </button>
                      <button
                        onClick={() => setMonthCount(12)}
                        className={clsx(
                          "px-3 py-1 text-sm rounded",
                          monthCount === 12
                            ? "bg-blue-600 text-white"
                            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                        )}
                      >
                        12 Months
                      </button>
                    </div>
                  </div>
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-semibold text-gray-700">Month</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700">Opening</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700">+Inward</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700">−Outward</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700">Closing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyHistory.map((period, idx) => {
                        const hasActivity = period.inwardQty > 0 || period.outwardQty > 0;
                        const monthLabel = period.periodStart.toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                        });

                        return (
                          <tr
                            key={idx}
                            className={clsx(
                              "border-b border-gray-100",
                              !hasActivity && "opacity-50"
                            )}
                          >
                            <td className="py-2 px-3">{monthLabel}</td>
                            <td className="text-right py-2 px-3">
                              {formatQty(period.openingQty, savedUnitConfig, unitMode).formatted}
                            </td>
                            <td className="text-right py-2 px-3 text-green-600">
                              {formatQty(period.inwardQty, savedUnitConfig, unitMode).formatted}
                            </td>
                            <td className="text-right py-2 px-3 text-red-600">
                              {formatQty(period.outwardQty, savedUnitConfig, unitMode).formatted}
                            </td>
                            <td
                              className={clsx(
                                "text-right py-2 px-3 font-semibold",
                                period.closingQty < 0 && "text-red-600"
                              )}
                            >
                              {formatQty(period.closingQty, savedUnitConfig, unitMode).formatted}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
        />
      )}
    </div>
  );
}
