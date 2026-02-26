/**
 * Import Page — enhanced with:
 * - Expandable warnings per import log
 * - MKCP data import section (PKG CONVERSION.xlsx + XML)
 * - Import report panel showing pkg_factor source breakdown
 */
import React, { useCallback, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { fetchImportLogs, uploadFile, triggerRescan } from "../api/endpoints";
import { importMkcp } from "../api/orderEndpoints";
import { formatDate } from "../utils/format";
import type { ImportLog } from "../types";

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-800">
        <CheckCircle size={11} /> success
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-800">
        <XCircle size={11} /> error
      </span>
    );
  if (status === "partial")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-800">
        <AlertTriangle size={11} /> partial
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700">
      <Clock size={11} /> {status}
    </span>
  );
}

function LogRow({ log }: { log: ImportLog }) {
  const [expanded, setExpanded] = useState(false);
  let warnings: string[] = [];
  try {
    if (log.warnings) warnings = JSON.parse(log.warnings);
  } catch {
    warnings = [];
  }
  const hasDetails = warnings.length > 0 || !!log.error_message;

  return (
    <>
      <tr
        className={`border-b border-gray-50 hover:bg-gray-50 ${
          hasDetails ? "cursor-pointer" : ""
        } ${log.status === "error" ? "bg-red-50/30" : ""}`}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        <td className="px-4 py-2.5 font-mono text-xs max-w-[190px]">
          <div className="flex items-center gap-1.5">
            {hasDetails ? (
              expanded ? (
                <ChevronDown size={12} className="text-gray-400 shrink-0" />
              ) : (
                <ChevronRight size={12} className="text-gray-400 shrink-0" />
              )
            ) : (
              <span className="w-3" />
            )}
            <span className="truncate" title={log.file_name}>
              {log.file_name}
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500 capitalize">{log.file_type}</td>
        <td className="px-4 py-2.5 text-center">
          <StatusBadge status={log.status} />
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-green-700 tabular-nums">
          {log.vouchers_inserted}
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-blue-600 tabular-nums">
          {log.vouchers_updated}
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-gray-500 tabular-nums">
          {log.masters_processed}
        </td>
        <td className="px-4 py-2.5 text-right text-xs text-gray-400">
          {formatDate(log.started_at)}
        </td>
      </tr>

      {/* Expanded: warnings */}
      {expanded && warnings.length > 0 && (
        <tr className="bg-amber-50/60">
          <td colSpan={7} className="px-8 py-2 text-xs text-amber-800">
            <div className="font-semibold mb-1 flex items-center gap-1">
              <AlertTriangle size={11} />
              {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
            </div>
            <ul className="space-y-0.5 list-disc list-inside max-h-32 overflow-y-auto">
              {warnings.map((w, i) => (
                <li key={i} className="truncate" title={w}>
                  {w}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}

      {/* Expanded: error */}
      {expanded && log.error_message && (
        <tr className="bg-red-50">
          <td colSpan={7} className="px-8 py-1.5 text-xs text-red-700">
            <span className="font-semibold">Error:</span> {log.error_message}
          </td>
        </tr>
      )}
    </>
  );
}

// ── MKCP Report card ──────────────────────────────────────────────────────────

interface MkcpReport {
  lines: string[];
  error?: boolean;
}

function MkcpReportCard({
  report,
  onDismiss,
}: {
  report: MkcpReport;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`mt-3 p-3 rounded-lg text-xs border ${
        report.error
          ? "bg-red-50 border-red-200 text-red-800"
          : "bg-green-50 border-green-200 text-green-800"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          {report.lines.filter(Boolean).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
        <button onClick={onDismiss} className="shrink-0 text-gray-400 hover:text-gray-600">
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mkcpReport, setMkcpReport] = useState<MkcpReport | null>(null);

  // ── Tally XML import log ──────────────────────────────────────────────────
  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["import-logs"],
    queryFn: fetchImportLogs,
    refetchInterval: 5000,
  });

  // ── Tally XML upload ──────────────────────────────────────────────────────
  const handleFiles = useCallback(
    async (files: FileList) => {
      const xmlFiles = Array.from(files).filter((f) =>
        f.name.toLowerCase().endsWith(".xml")
      );
      if (!xmlFiles.length) {
        toast.error("Please upload .xml files only");
        return;
      }
      setUploading(true);
      for (const file of xmlFiles) {
        try {
          const result = await uploadFile(file);
          if (result.status === "error") {
            toast.error(`${file.name}: ${result.error_message}`);
          } else {
            toast.success(
              `${file.name}: ${result.vouchers_inserted} inserted, ${result.vouchers_updated} updated`
            );
          }
        } catch {
          toast.error(`Upload failed for ${file.name}`);
        }
      }
      setUploading(false);
      qc.invalidateQueries();
    },
    [qc]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleRescan = async () => {
    try {
      const result = await triggerRescan();
      toast.success(result.message);
      setTimeout(() => qc.invalidateQueries(), 2000);
    } catch {
      toast.error("Rescan failed");
    }
  };

  // ── MKCP data import ──────────────────────────────────────────────────────
  const mkcpMutation = useMutation({
    mutationFn: importMkcp,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["order-items"] });
      qc.invalidateQueries({ queryKey: ["order-groups"] });
      const sc = data.counts.source_counts;
      const lines = [
        `✅ MKCP Import complete`,
        `Groups: +${data.counts.groups_added} new · ${data.counts.groups_updated} updated`,
        `Pkg Factors: +${data.counts.alt_units_added} new · ${data.counts.alt_units_updated} updated`,
        `  Sources — xlsx: ${sc?.xlsx ?? 0}, price list: ${sc?.price_list ?? 0}`,
        data.counts.unmatched_xlsx_items > 0
          ? `⚠️ ${data.counts.unmatched_xlsx_items} xlsx items had no exact DB match`
          : "✓ All xlsx items matched DB items",
        `Item-Group: +${data.counts.item_groups_added} new · ${data.counts.item_groups_updated} updated`,
      ];
      setMkcpReport({ lines });
    },
    onError: (err: Error) =>
      setMkcpReport({ lines: [`Import failed: ${err.message}`], error: true }),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload Tally XML files · Import MKCP catalogue data
          </p>
        </div>
        <button
          onClick={handleRescan}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
        >
          <RefreshCw size={14} />
          Rescan Inbox
        </button>
      </div>

      {/* ── UPLOAD CARDS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Tally XML */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Upload size={16} className="text-blue-500" />
            Tally XML Files
          </h2>
          <div
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragging
                ? "border-blue-400 bg-blue-50"
                : "border-gray-200 bg-gray-50 hover:border-gray-300"
            }`}
          >
            <Upload
              size={32}
              className={`mx-auto mb-3 ${dragging ? "text-blue-500" : "text-gray-300"}`}
            />
            <p className="text-sm font-medium text-gray-700">
              {uploading ? "Uploading…" : "Drop XML files here"}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Master.xml · Transactions.xml
            </p>
            <label className="mt-4 inline-block">
              <input
                type="file"
                accept=".xml"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleFiles(e.target.files)}
                disabled={uploading}
              />
              <span className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
                Browse files
              </span>
            </label>
          </div>
        </div>

        {/* MKCP catalogue */}
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Database size={16} className="text-indigo-500" />
            MKCP Catalogue Data
          </h2>

          <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5 text-xs text-indigo-800 mb-3">
            <p className="font-semibold text-indigo-700">
              Reads from Desktop/MKCP/:
            </p>
            {[
              ["PKG CONVERSION.xlsx", "Package factors (PRIMARY source)"],
              ["PRICE LIST ST.xml", "Package factors (fallback)"],
              ["STOCK GROUPS.xml", "Vendor group definitions"],
              ["STOCK ITEM.xml", "Item → group mappings"],
            ].map(([file, desc]) => (
              <div key={file} className="flex items-start gap-1.5">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                <span>
                  <strong>{file}</strong> — {desc}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={() => mkcpMutation.mutate()}
            disabled={mkcpMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            <RefreshCw
              size={14}
              className={mkcpMutation.isPending ? "animate-spin" : ""}
            />
            {mkcpMutation.isPending ? "Importing…" : "Run MKCP Import"}
          </button>

          {mkcpReport && (
            <MkcpReportCard
              report={mkcpReport}
              onDismiss={() => setMkcpReport(null)}
            />
          )}
        </div>
      </div>

      {/* ── IMPORT LOG ── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Import History
            {logs.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({logs.length} files)
              </span>
            )}
          </h2>
          <div className="flex gap-3 text-xs text-gray-400">
            <span>Click a row to expand warnings</span>
          </div>
        </div>
        <table className="w-full">
          <thead className="border-b border-gray-100 bg-gray-50/50">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">File</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Type</th>
              <th className="text-center px-4 py-2.5 text-xs text-gray-500 font-medium">Status</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Inserted</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Updated</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Masters</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {logsLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No imports yet. Drop XML files above to get started.
                </td>
              </tr>
            ) : (
              logs.map((log: ImportLog) => <LogRow key={log.id} log={log} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
