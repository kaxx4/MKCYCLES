import { useState } from "react";
import { Card } from "../components";
import { useDataStore } from "../store/dataStore";
import { useOverrideStore } from "../store/overrideStore";
import { clearCache, getAllCachedKeys } from "../db/cache";
import { matchItemName } from "../engine/units";
import {
  Download,
  Upload,
  Trash2,
  Edit2,
  Eye,
  AlertTriangle,
  FileText,
  Database,
  Settings as SettingsIcon,
  DollarSign,
  Check,
  X,
} from "lucide-react";

type TabName = "units" | "rates" | "debug";

interface BulkImportRow {
  inputName: string;
  unitsPerPkg: number;
}

interface MatchedRow extends BulkImportRow {
  matchedName: string;
  confidence: "exact" | "fuzzy" | "none";
  score: number;
  baseUnit: string;
  pkgUnit: string;
}

export function Settings() {
  const [activeTab, setActiveTab] = useState<TabName>("units");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="w-8 h-8 text-gray-700" />
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8">
          <TabButton
            active={activeTab === "units"}
            onClick={() => setActiveTab("units")}
            icon={<FileText className="w-4 h-4" />}
          >
            Unit Configuration
          </TabButton>
          <TabButton
            active={activeTab === "rates"}
            onClick={() => setActiveTab("rates")}
            icon={<DollarSign className="w-4 h-4" />}
          >
            Rate Overrides
          </TabButton>
          <TabButton
            active={activeTab === "debug"}
            onClick={() => setActiveTab("debug")}
            icon={<Database className="w-4 h-4" />}
          >
            Debug
          </TabButton>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "units" && <UnitsTab />}
      {activeTab === "rates" && <RatesTab />}
      {activeTab === "debug" && <DebugTab />}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function TabButton({ active, onClick, icon, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 pb-3 px-1 border-b-2 transition-colors
        ${
          active
            ? "border-blue-500 text-blue-600 font-medium"
            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
        }
      `}
    >
      {icon}
      {children}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: Unit Configuration
// ═══════════════════════════════════════════════════════════════════════════

function UnitsTab() {
  const { units, deleteUnit, bulkSetUnits } = useOverrideStore();
  const { data, getAllStockItems } = useDataStore();
  const [bulkText, setBulkText] = useState("");
  const [matchPreview, setMatchPreview] = useState<MatchedRow[]>([]);
  const [unmatchedRows, setUnmatchedRows] = useState<BulkImportRow[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  // Combine Tally units (from stockItems with alternateUnit) + manual overrides
  const allUnits = new Map<
    string,
    {
      itemName: string;
      baseUnit: string;
      pkgUnit: string;
      unitsPerPkg: number;
      source: "tally" | "manual";
    }
  >();

  // First, add Tally compound units
  if (data) {
    for (const item of getAllStockItems()) {
      if (item.alternateUnit && item.alternateConversion) {
        allUnits.set(item.name, {
          itemName: item.name,
          baseUnit: item.baseUnit,
          pkgUnit: item.alternateUnit,
          unitsPerPkg: item.alternateConversion,
          source: "tally",
        });
      }
    }
  }

  // Then, overlay manual overrides
  for (const [name, override] of Object.entries(units)) {
    allUnits.set(name, {
      itemName: name,
      baseUnit: override.baseUnit,
      pkgUnit: override.pkgUnit,
      unitsPerPkg: override.unitsPerPkg,
      source: override.source,
    });
  }

  const unitRows = Array.from(allUnits.values()).sort((a, b) =>
    a.itemName.localeCompare(b.itemName)
  );

  const handlePreviewMatches = () => {
    if (!data) return;

    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed: BulkImportRow[] = [];

    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length !== 2) continue;
      const itemName = parts[0]!;
      const qty = parseInt(parts[1]!, 10);
      if (!itemName || isNaN(qty) || qty <= 0) continue;
      parsed.push({ inputName: itemName, unitsPerPkg: qty });
    }

    const stockItemNames = getAllStockItems().map((i) => i.name);
    const matched: MatchedRow[] = [];
    const unmatched: BulkImportRow[] = [];

    for (const row of parsed) {
      const result = matchItemName(row.inputName, stockItemNames);
      if (result.confidence === "none") {
        unmatched.push(row);
      } else {
        const item = data.stockItems.get(result.matched.toUpperCase().trim());
        matched.push({
          inputName: row.inputName,
          unitsPerPkg: row.unitsPerPkg,
          matchedName: result.matched,
          confidence: result.confidence,
          score: result.score,
          baseUnit: item?.baseUnit ?? "PCS",
          pkgUnit: "PKG", // Default to "PKG" for bulk import
        });
      }
    }

    setMatchPreview(matched);
    setUnmatchedRows(unmatched);
    setShowPreview(true);
  };

  const handleConfirmImport = () => {
    const configs = matchPreview.map((row) => ({
      name: row.matchedName,
      baseUnit: row.baseUnit,
      pkgUnit: row.pkgUnit,
      unitsPerPkg: row.unitsPerPkg,
    }));

    bulkSetUnits(configs);
    setBulkText("");
    setMatchPreview([]);
    setUnmatchedRows([]);
    setShowPreview(false);
  };

  const handleDeleteUnit = (name: string) => {
    if (
      window.confirm(
        `Delete manual unit override for "${name}"?\n\nThis will revert to Tally default if it exists.`
      )
    ) {
      deleteUnit(name);
    }
  };

  return (
    <div className="space-y-6">
      {/* Table of all units */}
      <Card title="Current Unit Configurations">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2 px-3">Item Name</th>
                <th className="text-left py-2 px-3">Base Unit</th>
                <th className="text-left py-2 px-3">PKG Unit</th>
                <th className="text-left py-2 px-3">Units/PKG</th>
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {unitRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    No unit configurations found. Import Tally data or add
                    manual overrides.
                  </td>
                </tr>
              )}
              {unitRows.map((row) => (
                <tr key={row.itemName} className="border-b border-gray-100">
                  <td className="py-2 px-3 font-medium">{row.itemName}</td>
                  <td className="py-2 px-3">{row.baseUnit}</td>
                  <td className="py-2 px-3">{row.pkgUnit}</td>
                  <td className="py-2 px-3">{row.unitsPerPkg}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        row.source === "tally"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {row.source}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    {row.source === "manual" && (
                      <button
                        onClick={() => handleDeleteUnit(row.itemName)}
                        className="text-red-600 hover:text-red-800"
                        title="Delete override"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bulk Import Panel */}
      <Card title="Bulk Import from Paste">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Paste tab or pipe-separated data:{" "}
            <code className="bg-gray-100 px-1 rounded">
              Item Name | Units/Pkg
            </code>
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            className="w-full h-32 border border-gray-300 rounded p-2 text-sm font-mono"
            placeholder="BELL CROWN MINI | 300&#10;HERO PASSION PRO | 150&#10;..."
          />
          <button
            onClick={handlePreviewMatches}
            disabled={!bulkText.trim() || !data}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Preview Matches
          </button>

          {showPreview && (
            <div className="mt-6 space-y-4">
              {matchPreview.length > 0 && (
                <>
                  <h3 className="font-semibold text-gray-900">
                    Matched Items ({matchPreview.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="text-left py-2 px-3">Input Name</th>
                          <th className="text-left py-2 px-3">Matched Item</th>
                          <th className="text-left py-2 px-3">Confidence</th>
                          <th className="text-left py-2 px-3">Base Unit</th>
                          <th className="text-left py-2 px-3">PKG Unit</th>
                          <th className="text-left py-2 px-3">Units/PKG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matchPreview.map((row, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-2 px-3 text-gray-600">
                              {row.inputName}
                            </td>
                            <td className="py-2 px-3 font-medium">
                              {row.matchedName}
                            </td>
                            <td className="py-2 px-3">
                              <ConfidenceBadge
                                confidence={row.confidence}
                                score={row.score}
                              />
                            </td>
                            <td className="py-2 px-3">{row.baseUnit}</td>
                            <td className="py-2 px-3">{row.pkgUnit}</td>
                            <td className="py-2 px-3">{row.unitsPerPkg}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={handleConfirmImport}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Confirm Import ({matchPreview.length} items)
                  </button>
                </>
              )}

              {unmatchedRows.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Unmatched Items ({unmatchedRows.length})
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {unmatchedRows.map((row, i) => (
                      <li key={i} className="text-sm text-gray-600">
                        {row.inputName} ({row.unitsPerPkg})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
  score,
}: {
  confidence: "exact" | "fuzzy" | "none";
  score: number;
}) {
  const colors = {
    exact: "bg-green-100 text-green-800",
    fuzzy: "bg-amber-100 text-amber-800",
    none: "bg-red-100 text-red-800",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${colors[confidence]}`}
    >
      {confidence === "exact" && <Check className="w-3 h-3" />}
      {confidence === "fuzzy" && <AlertTriangle className="w-3 h-3" />}
      {confidence === "none" && <X className="w-3 h-3" />}
      {confidence} ({Math.round(score * 100)}%)
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2: Rate Overrides
// ═══════════════════════════════════════════════════════════════════════════

function RatesTab() {
  const { rates, setRate, deleteRate } = useOverrideStore();
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ pkgRate: "", unitRate: "" });

  const rateRows = Object.entries(rates)
    .map(([name, rate]) => ({
      itemName: name,
      pkgRate: rate.pkgRate,
      unitRate: rate.unitRate,
      updatedAt: rate.updatedAt,
      changeCount: rate.changeLog.length,
      changeLog: rate.changeLog,
    }))
    .sort((a, b) => a.itemName.localeCompare(b.itemName));

  const handleExport = () => {
    const json = JSON.stringify(rates, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rate-overrides-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const imported = JSON.parse(text);

        // Validate structure
        if (typeof imported !== "object") {
          throw new Error("Invalid JSON structure");
        }

        // Confirm before overwriting
        if (
          !window.confirm(
            `Import ${Object.keys(imported).length} rate overrides?\n\nThis will merge with existing data.`
          )
        ) {
          return;
        }

        // Merge into store
        for (const [name, rateData] of Object.entries(imported)) {
          const r = rateData as any;
          if (r.pkgRate !== undefined || r.unitRate !== undefined) {
            setRate(name, {
              pkgRate: r.pkgRate,
              unitRate: r.unitRate,
            });
          }
        }

        alert("Import successful!");
      } catch (err) {
        alert(`Import failed: ${err}`);
      }
    };
    input.click();
  };

  const handleDelete = (name: string) => {
    if (window.confirm(`Delete all rate overrides for "${name}"?`)) {
      deleteRate(name);
    }
  };

  const handleEdit = (name: string) => {
    const rate = rates[name];
    if (!rate) return;
    setEditingItem(name);
    setEditForm({
      pkgRate: rate.pkgRate?.toString() ?? "",
      unitRate: rate.unitRate?.toString() ?? "",
    });
  };

  const handleSaveEdit = () => {
    if (!editingItem) return;

    const pkgRate = parseFloat(editForm.pkgRate);
    const unitRate = parseFloat(editForm.unitRate);

    setRate(editingItem, {
      pkgRate: isNaN(pkgRate) ? undefined : pkgRate,
      unitRate: isNaN(unitRate) ? undefined : unitRate,
    });

    setEditingItem(null);
    setEditForm({ pkgRate: "", unitRate: "" });
  };

  return (
    <div className="space-y-6">
      {/* Export/Import controls */}
      <Card>
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Download className="w-4 h-4" />
            Export Overrides
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            <Upload className="w-4 h-4" />
            Import Overrides
          </button>
        </div>
      </Card>

      {/* Rate overrides table */}
      <Card title="Rate Overrides">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2 px-3">Item Name</th>
                <th className="text-right py-2 px-3">PKG Rate</th>
                <th className="text-right py-2 px-3">Unit Rate</th>
                <th className="text-left py-2 px-3">Last Updated</th>
                <th className="text-center py-2 px-3">Changes</th>
                <th className="text-right py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rateRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    No rate overrides. Set rates from the Orders page.
                  </td>
                </tr>
              )}
              {rateRows.map((row) => (
                <>
                  <tr
                    key={row.itemName}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="py-2 px-3 font-medium">{row.itemName}</td>
                    <td className="py-2 px-3 text-right">
                      {row.pkgRate !== undefined
                        ? `₹${row.pkgRate.toFixed(2)}`
                        : "-"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {row.unitRate !== undefined
                        ? `₹${row.unitRate.toFixed(2)}`
                        : "-"}
                    </td>
                    <td className="py-2 px-3 text-gray-600">
                      {new Date(row.updatedAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className="inline-block px-2 py-1 bg-gray-100 rounded text-xs">
                        {row.changeCount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(row.itemName)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() =>
                            setExpandedLog(
                              expandedLog === row.itemName
                                ? null
                                : row.itemName
                            )
                          }
                          className="text-gray-600 hover:text-gray-800"
                          title="View Log"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(row.itemName)}
                          className="text-red-600 hover:text-red-800"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Change log expansion */}
                  {expandedLog === row.itemName && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-3 py-3">
                        <div className="text-xs space-y-1">
                          <h4 className="font-semibold text-gray-700 mb-2">
                            Change Log (Last {Math.min(50, row.changeCount)}{" "}
                            changes)
                          </h4>
                          <div className="space-y-1">
                            {row.changeLog
                              .slice()
                              .reverse()
                              .map((change, i) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-3 text-gray-600"
                                >
                                  <span className="font-mono text-gray-400">
                                    {new Date(change.ts).toLocaleString()}
                                  </span>
                                  <span className="font-medium">
                                    {change.field}:
                                  </span>
                                  <span>
                                    {change.oldValue !== undefined
                                      ? `₹${change.oldValue.toFixed(2)}`
                                      : "—"}
                                  </span>
                                  <span>→</span>
                                  <span className="font-semibold text-gray-900">
                                    ₹{change.newValue.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Edit Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">
              Edit Rates: {editingItem}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PKG Rate (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.pkgRate}
                  onChange={(e) =>
                    setEditForm({ ...editForm, pkgRate: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="Leave empty to clear"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Unit Rate (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.unitRate}
                  onChange={(e) =>
                    setEditForm({ ...editForm, unitRate: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="Leave empty to clear"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3: Debug
// ═══════════════════════════════════════════════════════════════════════════

function DebugTab() {
  const { data, clearData } = useDataStore();
  const [cacheKeys, setCacheKeys] = useState<string[]>([]);

  const loadCacheKeys = async () => {
    const keys = await getAllCachedKeys();
    setCacheKeys(keys);
  };

  const handleClearCache = async () => {
    if (window.confirm("Clear all cached XML files?")) {
      await clearCache();
      setCacheKeys([]);
      alert("Cache cleared!");
    }
  };

  const handleClearAll = () => {
    if (
      window.confirm(
        "Clear ALL data (parsed data + cache)?\n\nThis cannot be undone!"
      )
    ) {
      clearData();
      clearCache();
      setCacheKeys([]);
      alert("All data cleared!");
    }
  };

  const handleExportParsedData = () => {
    if (!data) {
      alert("No data loaded");
      return;
    }

    // Convert Maps to objects for JSON serialization
    const exportable = {
      company: data.company,
      ledgers: Array.from(data.ledgers.entries()),
      stockItems: Array.from(data.stockItems.entries()),
      units: Array.from(data.units.entries()),
      vouchers: data.vouchers,
      importedAt: data.importedAt.toISOString(),
      sourceFiles: data.sourceFiles,
      warnings: data.warnings,
    };

    const json = JSON.stringify(exportable, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parsed-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Extract FY years from vouchers
  const fyYears = new Set<number>();
  if (data) {
    for (const voucher of data.vouchers) {
      fyYears.add(voucher.date.getFullYear());
    }
  }

  return (
    <div className="space-y-6">
      {/* Data Summary */}
      <Card title="Loaded Data Summary">
        {!data ? (
          <p className="text-gray-500">No data loaded</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <InfoRow label="Stock Items" value={data.stockItems.size} />
            <InfoRow label="Ledgers" value={data.ledgers.size} />
            <InfoRow label="Units" value={data.units.size} />
            <InfoRow label="Vouchers" value={data.vouchers.length} />
            <InfoRow label="Warnings" value={data.warnings.length} />
            <InfoRow
              label="Source Files"
              value={data.sourceFiles.join(", ") || "None"}
            />
            <InfoRow
              label="FY Years"
              value={Array.from(fyYears).sort().join(", ") || "None"}
            />
            <InfoRow
              label="Last Import"
              value={data.importedAt.toLocaleString()}
            />
          </div>
        )}
      </Card>

      {/* Cache Status */}
      <Card title="Cache Status">
        <div className="space-y-3">
          <button
            onClick={loadCacheKeys}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Refresh Cache Info
          </button>
          <InfoRow label="Cached Files" value={cacheKeys.length} />
          {cacheKeys.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-medium text-gray-700 mb-1">
                Cache Keys:
              </p>
              <ul className="text-xs text-gray-600 space-y-1">
                {cacheKeys.map((key) => (
                  <li key={key} className="font-mono">
                    {key}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <Card title="Data Management">
        <div className="space-y-3">
          <button
            onClick={handleExportParsedData}
            disabled={!data}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Export Parsed Data
          </button>

          <button
            onClick={handleClearCache}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
          >
            <Trash2 className="w-4 h-4" />
            Clear Cache Only
          </button>

          <button
            onClick={handleClearAll}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            <AlertTriangle className="w-4 h-4" />
            Clear All Data
          </button>
        </div>
      </Card>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <span className="text-sm text-gray-600">{label}:</span>
      <span className="ml-2 font-semibold text-gray-900">{value}</span>
    </div>
  );
}
