import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api-client";
import { fetchSettings, saveSettings } from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";

interface OrthancMwlSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

type OrthancSettingsForm = {
  enabled: string;
  shadow_mode: string;
  base_url: string;
  username: string;
  password: string;
  timeout_seconds: string;
  verify_tls: string;
  worklist_target: string;
};

type SyncSummaryResponse = {
  ok: boolean;
  summary: {
    syncStatus: Array<{ status: string; count: number }>;
    outboxStatus: Array<{ status: string; count: number }>;
  };
};

type ReconcileResponse = {
  ok: boolean;
  result: {
    missing: number[];
    staleExtras: number[];
    payloadMismatches: number[];
    notSynced: number[];
    repaired: {
      enqueuedBookingIds: number[];
      failedBookingIds: Array<{ bookingId: number; error: string }>;
    };
  };
};

function isoDateDaysFromNow(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toInitialForm(settings: Record<string, string> | null | undefined): OrthancSettingsForm {
  const map = settings || {};
  return {
    enabled: map.enabled || "false",
    shadow_mode: map.shadow_mode || "false",
    base_url: map.base_url || "",
    username: map.username || "",
    password: map.password || "",
    timeout_seconds: map.timeout_seconds || "10",
    verify_tls: map.verify_tls || "true",
    worklist_target: map.worklist_target || "",
  };
}

export default function OrthancMwlSection({ onReAuthRequired }: OrthancMwlSectionProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OrthancSettingsForm>(() => toInitialForm(null));
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(() => isoDateDaysFromNow(-1));
  const [dateTo, setDateTo] = useState(() => isoDateDaysFromNow(1));
  const [limit, setLimit] = useState("5000");

  const {
    data: settingsData,
    isLoading: settingsLoading,
    error: settingsError,
  } = useQuery({
    queryKey: ["settings", "orthanc_mwl_sync"],
    queryFn: () => fetchSettings("orthanc_mwl_sync"),
  });

  useEffect(() => {
    if (!settingsData) return;
    setForm(toInitialForm(settingsData as Record<string, string>));
    setDirty(false);
  }, [settingsData]);

  const {
    data: summaryData,
    isLoading: summaryLoading,
    refetch: refetchSummary,
    error: summaryError,
  } = useQuery({
    queryKey: ["dicom", "orthanc-sync", "summary"],
    queryFn: () => api<SyncSummaryResponse>("/dicom/orthanc-sync/summary"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(form).map(([key, value]) => ({ key, value: { value } }));
      return saveSettings("orthanc_mwl_sync", { entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "orthanc_mwl_sync"] });
      setDirty(false);
      setStatusMessage("Orthanc settings saved.");
      setTimeout(() => setStatusMessage(null), 3000);
    },
    onError: (error: Error) => {
      setStatusMessage(error.message || "Failed to save Orthanc settings.");
      setTimeout(() => setStatusMessage(null), 5000);
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async ({ apply }: { apply: boolean }) => {
      const parsedLimit = Number(limit);
      return api<ReconcileResponse>("/dicom/orthanc-sync/reconcile", {
        method: "POST",
        body: JSON.stringify({
          dateFrom,
          dateTo,
          apply,
          limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5000,
        }),
      });
    },
    onSuccess: (response, variables) => {
      const result = response.result;
      const driftCount =
        result.missing.length +
        result.staleExtras.length +
        result.payloadMismatches.length +
        result.notSynced.length;
      const repaired = result.repaired.enqueuedBookingIds.length;
      const suffix = variables.apply ? ` Re-enqueued: ${repaired}.` : "";
      setStatusMessage(`Reconciliation completed. Drift candidates: ${driftCount}.${suffix}`);
      setTimeout(() => setStatusMessage(null), 5000);
      void refetchSummary();
    },
    onError: (error: Error) => {
      setStatusMessage(error.message || "Orthanc reconciliation failed.");
      setTimeout(() => setStatusMessage(null), 5000);
    },
  });

  const allErrors = useMemo(() => {
    const errors: Array<{ source: string; error: Error }> = [];
    if (settingsError instanceof Error) errors.push({ source: "settings", error: settingsError });
    if (summaryError instanceof Error) errors.push({ source: "summary", error: summaryError });
    return errors;
  }, [settingsError, summaryError]);

  if (allErrors.length > 0) {
    const authError = allErrors.find(({ error }) => {
      const status = error instanceof ApiError ? error.status : undefined;
      return status === 401 || status === 403 || error.message.includes("re-authentication");
    });
    if (authError) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "orthanc_mwl_sync"])} />;
    }
    return <QueryError message={allErrors[0].error.message || t("settings.failedLoad")} />;
  }

  if (settingsLoading) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>;
  }

  const syncStatus = summaryData?.summary?.syncStatus || [];
  const outboxStatus = summaryData?.summary?.outboxStatus || [];

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-sm text-stone-700 dark:text-stone-300">
          {statusMessage}
        </div>
      )}

      <div className="space-y-4">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Orthanc MWL Sync Configuration</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingField
            label="Enable Orthanc MWL sync"
            type="select"
            value={form.enabled}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, enabled: value }));
              setDirty(true);
            }}
            options={[
              { value: "false", label: "Disabled" },
              { value: "true", label: "Enabled" },
            ]}
          />
          <SettingField
            label="Shadow mode"
            type="select"
            value={form.shadow_mode}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, shadow_mode: value }));
              setDirty(true);
            }}
            options={[
              { value: "false", label: "Primary mode" },
              { value: "true", label: "Shadow mode" },
            ]}
          />
          <SettingField
            label="Orthanc Base URL"
            value={form.base_url}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, base_url: value.trim() }));
              setDirty(true);
            }}
            placeholder="https://orthanc.example.local:8042"
          />
          <SettingField
            label="Timeout (seconds)"
            type="number"
            value={form.timeout_seconds}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, timeout_seconds: value }));
              setDirty(true);
            }}
            placeholder="10"
          />
          <SettingField
            label="Username"
            value={form.username}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, username: value }));
              setDirty(true);
            }}
            placeholder="orthanc-user"
          />
          <SettingField
            label="Password"
            type="password"
            value={form.password}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, password: value }));
              setDirty(true);
            }}
            placeholder="********"
          />
          <SettingField
            label="Verify TLS"
            type="select"
            value={form.verify_tls}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, verify_tls: value }));
              setDirty(true);
            }}
            options={[
              { value: "true", label: "Verify certificates" },
              { value: "false", label: "Skip verification" },
            ]}
          />
          <SettingField
            label="Worklist target AE (optional)"
            value={form.worklist_target}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, worklist_target: value.toUpperCase() }));
              setDirty(true);
            }}
            placeholder="RISPRO_MWL"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={saveMutation.isPending || !dirty}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : "Save Orthanc Settings"}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              setForm(toInitialForm(settingsData as Record<string, string>));
              setDirty(false);
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Sync Status</h4>
        {summaryLoading ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatusList title="Projection Status" items={syncStatus} />
            <StatusList title="Outbox Status" items={outboxStatus} />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Reconciliation</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SettingField label="Date from" type="date" value={dateFrom} onChange={setDateFrom} />
          <SettingField label="Date to" type="date" value={dateTo} onChange={setDateTo} />
          <SettingField label="Limit" type="number" value={limit} onChange={setLimit} placeholder="5000" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm disabled:opacity-50"
            disabled={reconcileMutation.isPending}
            onClick={() => reconcileMutation.mutate({ apply: false })}
          >
            {reconcileMutation.isPending ? "Running..." : "Dry Run Reconciliation"}
          </button>
          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={reconcileMutation.isPending}
            onClick={() => reconcileMutation.mutate({ apply: true })}
          >
            {reconcileMutation.isPending ? "Applying..." : "Reconcile + Re-enqueue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusList({ title, items }: { title: string; items: Array<{ status: string; count: number }> }) {
  return (
    <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800">
      <p className="text-sm font-semibold text-stone-900 dark:text-white mb-2">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">No records.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={`${title}-${item.status}`} className="flex items-center justify-between text-xs">
              <span className="text-stone-600 dark:text-stone-300">{item.status}</span>
              <span className="font-mono text-stone-900 dark:text-white">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "password" | "select" | "date";
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</label>
      {type === "select" ? (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        >
          {(options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
      )}
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">Failed to load</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Re-authentication required</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">Please re-authenticate to access Orthanc settings.</p>
      <button onClick={onReAuthRequired} className="btn-primary text-sm">
        Re-authenticate
      </button>
    </div>
  );
}
