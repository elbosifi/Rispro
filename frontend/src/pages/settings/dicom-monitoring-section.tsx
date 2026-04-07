import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLanguage } from "@/providers/language-provider";
import { formatDateTimeLy } from "@/lib/date-format";

interface DicomMonitoringSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

export default function DicomMonitoringSection(_props: DicomMonitoringSectionProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "actions">("overview");
  const [logFilter, setLogFilter] = useState({ status: "", accession: "", limit: "50" });
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ["dicom", "overview"],
    queryFn: async () => {
      const response = await fetch("/api/dicom/overview");
      if (!response.ok) throw new Error("Failed to fetch DICOM overview");
      return response.json();
    }
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ["dicom", "logs", logFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (logFilter.status) params.set("status", logFilter.status);
      if (logFilter.accession) params.set("accession", logFilter.accession);
      params.set("limit", logFilter.limit);

      const response = await fetch(`/api/dicom/logs?${params}`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      return response.json();
    },
    enabled: activeTab === "logs"
  });

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/dicom/rebuild", { method: "POST" });
      if (!response.ok) throw new Error("Rebuild failed");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dicom", "overview"] });
      // Show success message inline instead of alert
      setActionMessage({ type: "success", text: data.message });
      setTimeout(() => setActionMessage(null), 5000);
    },
    onError: (err: Error) => {
      setActionMessage({ type: "error", text: err.message });
      setTimeout(() => setActionMessage(null), 5000);
    }
  });

  const overview = overviewData as any;
  const logs = logsData as any;

  if (overviewLoading) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>;
  }

  const status = overview?.status || {};
  const settings = overview?.settings || {};
  const tools = overview?.tools || { dump2dcm: {}, dcmdump: {} };
  const fileHealth = overview?.fileHealth || {};
  const deviceSummary = overview?.deviceSummary || {};

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-stone-200 dark:border-stone-700">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === "overview"
              ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
              : "text-stone-600 dark:text-stone-400"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === "logs"
              ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
              : "text-stone-600 dark:text-stone-400"
          }`}
        >
          Logs
        </button>
        <button
          onClick={() => setActiveTab("actions")}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === "actions"
              ? "border-b-2 border-teal-600 text-teal-700 dark:text-teal-400"
              : "text-stone-600 dark:text-stone-400"
          }`}
        >
          Actions
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatusCard
              title="Gateway Status"
              status={status.gatewayEnabled ? "Ready" : "Disabled"}
              statusType={status.gatewayEnabled ? "success" : "warning"}
              details={[
                `AE Title: ${settings.mwlAeTitle || "N/A"}`,
                `Port: ${settings.mwlPort || "N/A"}`
              ]}
            />

            <StatusCard
              title="DICOM Tools"
              status={tools.dump2dcm?.detected && tools.dcmdump?.detected ? "Detected" : "Not Detected"}
              statusType={tools.dump2dcm?.detected && tools.dcmdump?.detected ? "success" : "warning"}
              details={[
                `dump2dcm: ${tools.dump2dcm?.detected ? tools.dump2dcm.path || "Yes" : "Missing"}`,
                `dcmdump: ${tools.dcmdump?.detected ? tools.dcmdump.path || "Yes" : "Missing"}`
              ]}
            />

            <StatusCard
              title="Devices"
              status={`${deviceSummary.mwlEnabled || 0} Active`}
              statusType={deviceSummary.mwlEnabled > 0 ? "success" : "warning"}
              details={[
                `Total: ${deviceSummary.total || 0}`,
                `MWL Enabled: ${deviceSummary.mwlEnabled || 0}`,
                `MPPS Enabled: ${deviceSummary.mppsEnabled || 0}`
              ]}
            />
          </div>

          {/* File Health */}
          <div className="card-shell p-4 bg-stone-50 dark:bg-stone-800/50">
            <h4 className="text-sm font-semibold text-stone-900 dark:text-white mb-3">File System Health</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <FileStat label="Source Files" count={fileHealth.sourceDir?.fileCount || 0} exists={fileHealth.sourceDir?.exists} />
              <FileStat label="Output Files" count={fileHealth.outputDir?.fileCount || 0} exists={fileHealth.outputDir?.exists} />
              <FileStat label="MPPS Inbox" count={fileHealth.mppsInboxDir?.fileCount || 0} exists={fileHealth.mppsInboxDir?.exists} />
              <FileStat label="MPPS Processed" count={fileHealth.mppsProcessedDir?.fileCount || 0} exists={fileHealth.mppsProcessedDir?.exists} />
              <FileStat label="MPPS Failed" count={fileHealth.mppsFailedDir?.fileCount || 0} exists={fileHealth.mppsFailedDir?.exists} />
            </div>
            {(fileHealth.orphanedSourceFiles?.length > 0 || fileHealth.orphanedOutputFiles?.length > 0) && (
              <div className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                ⚠️ {fileHealth.orphanedSourceFiles?.length || 0} orphaned source files, {fileHealth.orphanedOutputFiles?.length || 0} orphaned output files
              </div>
            )}
          </div>

          {/* Log Summary */}
          {overview?.logSummary && (
            <div className="card-shell p-4 bg-stone-50 dark:bg-stone-800/50">
              <h4 className="text-sm font-semibold text-stone-900 dark:text-white mb-3">Recent Activity</h4>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {Number(overview.logSummary.processed_count || 0)}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400">Processed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {Number(overview.logSummary.failed_count || 0)}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400">Failed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-stone-600 dark:text-stone-400">
                    {Number(overview.logSummary.total_count || 0)}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400">Total</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Logs Tab */}
      {activeTab === "logs" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Status (processed/failed)"
              value={logFilter.status}
              onChange={(e) => setLogFilter({ ...logFilter, status: e.target.value })}
              className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
            />
            <input
              type="text"
              placeholder="Accession number"
              value={logFilter.accession}
              onChange={(e) => setLogFilter({ ...logFilter, accession: e.target.value })}
              className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
            />
            <select
              value={logFilter.limit}
              onChange={(e) => setLogFilter({ ...logFilter, limit: e.target.value })}
              className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
            >
              <option value="25">25 entries</option>
              <option value="50">50 entries</option>
              <option value="100">100 entries</option>
            </select>
          </div>

          {/* Log Entries */}
          {logsLoading ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>
          ) : (
            <div className="space-y-2">
              {logs?.logs?.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-8">No logs found</p>
              ) : (
                logs?.logs?.map((log: any) => (
                  <div
                    key={log.id}
                    className={`p-3 rounded-lg border text-sm ${
                      log.processing_status === "failed"
                        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                        : log.processing_status === "processed"
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
                        : "bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="font-medium text-stone-900 dark:text-white">
                          {log.event_type}
                          {log.device_name && <span className="ml-2 text-xs text-stone-600 dark:text-stone-400">→ {log.device_name}</span>}
                        </div>
                        {log.accession_number && (
                          <div className="text-xs text-stone-600 dark:text-stone-400 mt-1">
                            Accession: {log.accession_number}
                          </div>
                        )}
                        {log.error_message && (
                          <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                            ⚠️ {log.error_message}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-stone-500 dark:text-stone-400 ml-4">
                        {formatDateTimeLy(log.created_at)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions Tab */}
      {activeTab === "actions" && (
        <div className="space-y-4">
          {actionMessage && (
            <div className={`p-3 rounded-lg border text-sm ${
              actionMessage.type === "success"
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
            }`}>
              {actionMessage.text}
              <button onClick={() => setActionMessage(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          <div className="card-shell p-4">
            <h4 className="text-sm font-semibold text-stone-900 dark:text-white mb-3">Worklist Operations</h4>
            <div className="space-y-3">
              <button
                onClick={() => {
                  if (confirm("Rebuild all worklists? This may take several minutes.")) {
                    rebuildMutation.mutate();
                  }
                }}
                disabled={rebuildMutation.isPending}
                className="w-full btn-primary text-sm disabled:opacity-50"
              >
                {rebuildMutation.isPending ? "Rebuilding..." : "Rebuild All Worklists"}
              </button>
            </div>
          </div>

          <div className="card-shell p-4">
            <h4 className="text-sm font-semibold text-stone-900 dark:text-white mb-3">Maintenance</h4>
            <div className="space-y-3">
              <button
                onClick={async () => {
                  try {
                    const response = await fetch("/api/dicom/detect-tools", { method: "POST" });
                    const data = await response.json();
                    setActionMessage({ type: response.ok ? "success" : "error", text: data.message });
                    setTimeout(() => setActionMessage(null), 5000);
                  } catch (err) {
                    setActionMessage({ type: "error", text: (err as Error).message });
                    setTimeout(() => setActionMessage(null), 5000);
                  }
                }}
                className="w-full btn-secondary text-sm"
              >
                Auto-detect DICOM Tools
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({
  title,
  status,
  statusType,
  details
}: {
  title: string;
  status: string;
  statusType: "success" | "warning" | "error";
  details: string[];
}) {
  const colorMap = {
    success: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    error: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
  };

  return (
    <div className="card-shell p-4">
      <h4 className="text-xs font-medium text-stone-600 dark:text-stone-400 mb-2">{title}</h4>
      <div className={`inline-block px-2 py-1 rounded-full text-xs font-medium mb-2 ${colorMap[statusType]}`}>
        {status}
      </div>
      <ul className="text-xs text-stone-600 dark:text-stone-400 space-y-1">
        {details.map((detail, idx) => (
          <li key={idx}>{detail}</li>
        ))}
      </ul>
    </div>
  );
}

function FileStat({ label, count, exists }: { label: string; count: number; exists?: boolean }) {
  return (
    <div className={`p-2 rounded border ${exists ? "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"}`}>
      <div className="font-medium text-stone-900 dark:text-white">{label}</div>
      <div className="text-lg font-bold text-stone-700 dark:text-stone-300">{count}</div>
      {!exists && <div className="text-xs text-red-600 dark:text-red-400">Missing</div>}
    </div>
  );
}
