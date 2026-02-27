import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from "react";
import { Upload, FileText, AlertCircle, CheckCircle, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "../components";
import { getCached, setCached } from "../db/cache";
import { useDataStore } from "../store/dataStore";
import type { ParsedData, ImportWarning } from "../types/canonical";
import type { WorkerResponse } from "../workers/xmlParser.worker";

interface FileImportResult {
  fileName: string;
  success: boolean;
  itemsCount: number;
  ledgersCount: number;
  unitsCount: number;
  vouchersCount: number;
  vouchersByType: Record<string, number>;
  warnings: ImportWarning[];
  error?: string;
}

export function Import() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFileName, setCurrentFileName] = useState<string>("");
  const [importResults, setImportResults] = useState<FileImportResult[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const { mergeData, clearData } = useDataStore();

  // Initialize Web Worker
  useEffect(() => {
    // Create worker
    workerRef.current = new Worker(
      new URL("../workers/xmlParser.worker.ts", import.meta.url),
      { type: "module" }
    );

    // Cleanup on unmount
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // Drag & Drop handlers
  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (file) => file.name.toLowerCase().endsWith('.xml')
    );

    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  }, []);

  // File picker handlers
  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(
        (file) => file.name.toLowerCase().endsWith('.xml')
      );
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  }, []);

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFolderButtonClick = () => {
    folderInputRef.current?.click();
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Parse a single XML file using Web Worker
  const parseXmlFile = async (file: File): Promise<FileImportResult> => {
    const result: FileImportResult = {
      fileName: file.name,
      success: false,
      itemsCount: 0,
      ledgersCount: 0,
      unitsCount: 0,
      vouchersCount: 0,
      vouchersByType: {},
      warnings: [],
    };

    try {
      // Check cache first
      const cached = await getCached(file.name, file.lastModified);

      let parsedData: ParsedData;

      if (cached) {
        parsedData = cached;
        result.warnings.push({
          file: file.name,
          severity: "info",
          element: "Cache",
          message: "Loaded from cache (instant)",
        });
      } else {
        // Read file as ArrayBuffer
        const buffer = await file.arrayBuffer();

        // Parse using Web Worker (non-blocking)
        console.log(`[Import] Sending ${file.name} to worker...`);
        parsedData = await new Promise<ParsedData>((resolve, reject) => {
          if (!workerRef.current) {
            console.error("[Import] Worker not initialized!");
            reject(new Error("Worker not initialized"));
            return;
          }

          const handleMessage = (e: MessageEvent<WorkerResponse>) => {
            console.log(`[Import] Received message from worker:`, e.data);
            if (e.data.fileName !== file.name) return; // Ignore other files

            workerRef.current?.removeEventListener("message", handleMessage);

            if (e.data.type === "success" && e.data.data) {
              console.log(`[Import] Success! Got data for ${file.name}`);
              resolve(e.data.data);
            } else {
              console.error(`[Import] Error from worker:`, e.data.error);
              reject(new Error(e.data.error || "Unknown worker error"));
            }
          };

          workerRef.current.addEventListener("message", handleMessage);

          // Send to worker
          workerRef.current.postMessage({
            type: "parse",
            fileData: buffer,
            fileName: file.name,
          });
          console.log(`[Import] Message sent to worker for ${file.name}`);
        });

        // Cache the result
        await setCached(file.name, file.lastModified, parsedData);
      }

      // Build result summary
      result.success = true;
      result.itemsCount = parsedData.stockItems.size;
      result.ledgersCount = parsedData.ledgers.size;
      result.unitsCount = parsedData.units.size;
      result.vouchersCount = parsedData.vouchers.length;

      // Count vouchers by type
      for (const voucher of parsedData.vouchers) {
        result.vouchersByType[voucher.voucherType] =
          (result.vouchersByType[voucher.voucherType] || 0) + 1;
      }

      result.warnings = parsedData.warnings;

      // Merge into data store
      mergeData(parsedData);

    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
      result.warnings.push({
        file: file.name,
        severity: "fatal",
        element: "File",
        message: result.error,
      });
    }

    return result;
  };

  // Import all selected files
  const handleImport = async () => {
    if (files.length === 0) return;

    setLoading(true);
    setProgress(0);
    setCurrentFileName("");
    setImportResults([]);

    const results: FileImportResult[] = [];

    // Process files sequentially to avoid overwhelming the browser
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;

      // Update progress and current file
      setCurrentFileName(file.name);
      setProgress(((i) / files.length) * 100);

      // Small delay to let UI update
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await parseXmlFile(file);
      results.push(result);

      // Update results incrementally so user sees progress
      setImportResults([...results]);
    }

    setProgress(100);
    setCurrentFileName("");
    setLoading(false);
    setFiles([]);
  };

  // Clear all data
  const handleClearData = () => {
    if (window.confirm('Are you sure you want to clear all imported data? This cannot be undone.')) {
      clearData();
      setImportResults([]);
      setFiles([]);
    }
  };

  // Toggle expanded row
  const toggleRow = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Import XML Data</h1>
        <button
          onClick={handleClearData}
          className="flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
        >
          <Trash2 size={18} />
          Clear All Data
        </button>
      </div>

      <Card>
        {/* Drop zone */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`
            relative border-2 border-dashed rounded-lg p-12 text-center transition-colors
            ${isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400'
            }
          `}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="p-4 bg-blue-100 rounded-full">
              <Upload size={32} className="text-blue-600" />
            </div>

            <div>
              <p className="text-lg font-semibold text-gray-900 mb-2">
                Drag & drop XML files here
              </p>
              <p className="text-sm text-gray-600 mb-4">
                or use the buttons below to select files
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleFileButtonClick}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
              >
                Select Files
              </button>
              <button
                onClick={handleFolderButtonClick}
                className="px-6 py-2.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors font-medium"
              >
                Select Folder
              </button>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xml"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              accept=".xml"
              // @ts-ignore - webkitdirectory is not in standard types
              webkitdirectory="true"
              directory="true"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>

        {/* File list preview */}
        {files.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Selected Files ({files.length})
            </h3>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-gray-600" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{file.name}</p>
                      <p className="text-xs text-gray-500">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleImport}
              disabled={loading}
              className="mt-4 w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors font-semibold"
            >
              {loading ? 'Importing...' : `Import ${files.length} File${files.length > 1 ? 's' : ''}`}
            </button>

            {/* Progress bar */}
            {loading && (
              <div className="mt-4">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-600 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-gray-600 text-center">
                    {Math.round(progress)}% complete
                  </p>
                  {currentFileName && (
                    <p className="text-xs text-blue-600 text-center font-medium">
                      Processing: {currentFileName}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Import results table */}
      {importResults.length > 0 && (
        <Card title="Import Results">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    File Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Masters
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Vouchers
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Warnings
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {importResults.map((result, index) => (
                  <>
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {result.fileName}
                      </td>
                      <td className="px-4 py-3">
                        {result.success ? (
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle size={16} />
                            <span className="text-sm font-medium">Success</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-red-600">
                            <AlertCircle size={16} />
                            <span className="text-sm font-medium">Failed</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="space-y-0.5">
                          <div>Items: <span className="font-medium">{result.itemsCount}</span></div>
                          <div>Ledgers: <span className="font-medium">{result.ledgersCount}</span></div>
                          <div>Units: <span className="font-medium">{result.unitsCount}</span></div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="space-y-0.5">
                          <div>Total: <span className="font-medium">{result.vouchersCount}</span></div>
                          {Object.entries(result.vouchersByType)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 3)
                            .map(([type, count]) => (
                              <div key={type}>
                                {type}: <span className="font-medium">{count}</span>
                              </div>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {result.warnings.length > 0 ? (
                          <button
                            onClick={() => toggleRow(index)}
                            className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700"
                          >
                            {expandedRows.has(index) ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                            <span className="font-medium">{result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''}</span>
                          </button>
                        ) : (
                          <span className="text-sm text-gray-500">None</span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded warnings row */}
                    {expandedRows.has(index) && result.warnings.length > 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-3 bg-amber-50">
                          <div className="space-y-2">
                            {result.warnings.map((warning, wIndex) => (
                              <div
                                key={wIndex}
                                className="flex items-start gap-2 text-sm"
                              >
                                <AlertCircle
                                  size={16}
                                  className={
                                    warning.severity === 'fatal'
                                      ? 'text-red-600 mt-0.5'
                                      : warning.severity === 'warn'
                                      ? 'text-amber-600 mt-0.5'
                                      : 'text-blue-600 mt-0.5'
                                  }
                                />
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {warning.element}
                                  </p>
                                  <p className="text-gray-700">{warning.message}</p>
                                </div>
                              </div>
                            ))}
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
      )}

      {/* Instructions */}
      <Card title="Import Instructions">
        <div className="prose prose-sm max-w-none text-gray-700">
          <p className="mb-4">
            This page allows you to import Tally ERP XML data into the application. You can import data in three ways:
          </p>
          <ul className="list-disc list-inside space-y-2 mb-4">
            <li><strong>Drag & Drop:</strong> Drag XML files directly onto the drop zone</li>
            <li><strong>File Picker:</strong> Click "Select Files" to choose individual XML files</li>
            <li><strong>Folder Picker:</strong> Click "Select Folder" to import all XML files from a directory</li>
          </ul>
          <p className="mb-4">
            <strong>Supported data types:</strong> Stock Items, Ledgers, Units, and Vouchers (Sales, Purchase, etc.)
          </p>
          <p className="text-amber-700 mb-4">
            <strong>Note:</strong> Files are automatically cached for faster subsequent imports. The cache expires after 24 hours.
          </p>
          <p className="text-red-700">
            <strong>Warning:</strong> The "Clear All Data" button will permanently delete all imported data from the application.
          </p>
        </div>
      </Card>
    </div>
  );
}
