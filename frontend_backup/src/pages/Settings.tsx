import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Folder, Database, Shield } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api/client";
import { triggerRescan } from "../api/endpoints";

export default function Settings() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get("/settings").then((r) => r.data),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get("/health").then((r) => r.data),
  });

  const handleRescan = async () => {
    try {
      const res = await triggerRescan();
      toast.success(res.message);
      setTimeout(() => {
        qc.invalidateQueries();
      }, 2000);
    } catch {
      toast.error("Rescan failed. Check the backend logs.");
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Application configuration (read from .env)
        </p>
      </div>

      {/* Config cards */}
      <div className="space-y-4">
        <div className="card flex items-start gap-4">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Folder size={20} className="text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium">Inbox Folder</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Drop Tally XML files here to auto-import
            </p>
            <code className="mt-2 block text-xs bg-gray-100 px-3 py-2 rounded-lg font-mono">
              {settings?.inbox_path || "—"}
            </code>
          </div>
          <button
            onClick={handleRescan}
            className="btn-secondary text-sm mt-0.5"
          >
            <RefreshCw size={14} /> Rescan
          </button>
        </div>

        <div className="card flex items-start gap-4">
          <div className="p-2 bg-green-50 rounded-lg">
            <Database size={20} className="text-green-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium">Database</h3>
            <p className="text-sm text-gray-500 mt-0.5">Local SQLite database</p>
            <code className="mt-2 block text-xs bg-gray-100 px-3 py-2 rounded-lg font-mono">
              {settings?.db_path || "—"}
            </code>
          </div>
          <span
            className={`badge mt-0.5 ${
              health?.db === "ok"
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {health?.db === "ok" ? "Connected" : "Error"}
          </span>
        </div>

        <div className="card flex items-start gap-4">
          <div className="p-2 bg-purple-50 rounded-lg">
            <Shield size={20} className="text-purple-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium">Authentication</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {settings?.auth_enabled
                ? "Basic auth is enabled. Set AUTH_USERNAME and AUTH_PASSWORD in .env."
                : "Auth is disabled (dev mode). Set AUTH_ENABLED=true in .env to enable."}
            </p>
          </div>
          <span
            className={`badge mt-0.5 ${
              settings?.auth_enabled
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {settings?.auth_enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        <div className="card">
          <h3 className="font-medium mb-2">File Watcher</h3>
          <p className="text-sm text-gray-500">
            The watcher monitors the inbox folder for new or modified .xml files and
            automatically runs the ETL pipeline. Check backend logs for watcher events.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${
                settings?.watcher_active ? "bg-green-500 animate-pulse" : "bg-gray-300"
              }`}
            />
            <span className="text-sm text-gray-600">
              {settings?.watcher_active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* API version */}
      <p className="text-xs text-gray-400">
        API version: {health?.version || "—"} · Backend status:{" "}
        <span className="text-green-600">{health?.status || "unknown"}</span>
      </p>
    </div>
  );
}
