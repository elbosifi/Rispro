import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

const SETTINGS_LOAD_TIMEOUT_MS = 5000;

interface OrthancRemoteModality {
  key: string;
  aet: string;
  host: string;
  port: number | null;
  isDefault: boolean;
  configurationError?: string | null;
}

type OrthancTargetType = "local" | "remote_modality";
type CompletionThreshold = "study_exists" | "series_exists" | "instance_exists";

interface OrthancVerificationTarget {
  type: OrthancTargetType;
  key: string;
  label: string;
}

interface PacsAutoCompletionSetting {
  id: number;
  modality_id: number;
  enabled: boolean;
  orthanc_target_type: OrthancTargetType;
  orthanc_target_key: string | null;
  matching_strategy: "study_uid_preferred_accession_fallback";
  completion_threshold: CompletionThreshold;
  poll_interval_minutes: number;
  lookback_hours: number;
  stop_after_hours: number;
  last_check_status: string | null;
  last_check_result_json: unknown;
  last_error: string | null;
  last_checked_at: string | null;
  modality_code: string;
  modality_name_ar: string;
  modality_name_en: string;
  modality_is_active: boolean;
}

interface PacsAutoCompletionTestDiagnostics {
  bookingId: number;
  bookingStatus: string;
  expectedAccession: string;
  studyInstanceUid: string | null;
  modalityId: number;
  modalityCode: string;
  orthancTargetType: OrthancTargetType;
  orthancTargetKey: string | null;
  orthancTargetLabel: string;
  matchKey: string | null;
  matchValue: string | null;
  candidateCount: number | null;
  completionThreshold: CompletionThreshold;
  lastError: string | null;
}

interface PacsAutoCompletionTestResponse {
  result: { status: string; lastError?: string | null };
  history: unknown;
  bookingId: number | null;
  diagnostics: PacsAutoCompletionTestDiagnostics;
}

type OrthancModalityFormState = {
  key: string;
  aet: string;
  host: string;
  port: number | "";
  isDefault: boolean;
};

type AutoCompletionDraft = {
  enabled: boolean;
  orthancTargetType: OrthancTargetType;
  orthancTargetKey: string;
  matchingStrategy: "study_uid_preferred_accession_fallback";
  completionThreshold: CompletionThreshold;
  pollIntervalMinutes: number | "";
  lookbackHours: number | "";
  stopAfterHours: number | "";
};

export default function PacsSettingsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<{ modalities: OrthancRemoteModality[] }>({
    queryKey: ["pacs", "orthanc-modalities"],
    queryFn: () => api<{ modalities: OrthancRemoteModality[] }>("/pacs/orthanc-modalities", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });
  const targetsQuery = useQuery<{ targets: OrthancVerificationTarget[] }>({
    queryKey: ["pacs", "orthanc-verification-targets"],
    queryFn: () => api<{ targets: OrthancVerificationTarget[] }>("/pacs/orthanc-verification-targets", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });
  const autoSettingsQuery = useQuery<{ settings: PacsAutoCompletionSetting[] }>({
    queryKey: ["pacs", "auto-completion-settings"],
    queryFn: () => api<{ settings: PacsAutoCompletionSetting[] }>("/pacs/auto-completion-settings", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ key: string | null; ok: boolean; message: string } | null>(null);
  const [autoDrafts, setAutoDrafts] = useState<Record<number, AutoCompletionDraft>>({});
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoTestingId, setAutoTestingId] = useState<number | null>(null);
  const [autoTestBookingIds, setAutoTestBookingIds] = useState<Record<number, string>>({});
  const [autoTestResults, setAutoTestResults] = useState<Record<number, PacsAutoCompletionTestResponse>>({});

  const emptyForm: OrthancModalityFormState = {
    key: "",
    aet: "",
    host: "",
    port: 104,
    isDefault: false
  };

  const [createForm, setCreateForm] = useState<OrthancModalityFormState>(emptyForm);
  const [editForm, setEditForm] = useState<OrthancModalityFormState>(emptyForm);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoSettingsQuery.data?.settings) return;
    setAutoDrafts((current) => {
      const next: Record<number, AutoCompletionDraft> = { ...current };
      for (const setting of autoSettingsQuery.data.settings) {
        if (next[setting.modality_id]) continue;
        next[setting.modality_id] = {
          enabled: setting.enabled,
          orthancTargetType: setting.orthanc_target_type,
          orthancTargetKey: setting.orthanc_target_key || "",
          matchingStrategy: setting.matching_strategy,
          completionThreshold: setting.completion_threshold,
          pollIntervalMinutes: Number(setting.poll_interval_minutes || 15),
          lookbackHours: Number(setting.lookback_hours || 24),
          stopAfterHours: Number(setting.stop_after_hours || 72)
        };
      }
      return next;
    });
  }, [autoSettingsQuery.data?.settings]);

  const toOrthancPayload = (form: OrthancModalityFormState) => ({
    aet: form.aet,
    host: form.host,
    port: Number(form.port),
    isDefault: form.isDefault
  });

  const createMutation = useMutation({
    mutationFn: async (form: OrthancModalityFormState) => {
      return api(`/pacs/orthanc-modalities/${encodeURIComponent(form.key)}`, {
        method: "PUT",
        body: JSON.stringify(toOrthancPayload(form))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-modalities"] });
      queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-verification-targets"] });
      setShowCreate(false);
      setCreateForm(emptyForm);
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, data }: { key: string; data: OrthancModalityFormState }) => {
      return api(`/pacs/orthanc-modalities/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify(toOrthancPayload(data))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-modalities"] });
      queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-verification-targets"] });
      setEditingKey(null);
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => api(`/pacs/orthanc-modalities/${encodeURIComponent(key)}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-modalities"] });
      queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-verification-targets"] });
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const testMutation = useMutation({
    mutationFn: async (targetKey: string) => {
      setTestingKey(targetKey);
      await api("/pacs/test", {
        method: "POST",
        body: JSON.stringify({ targetKey })
      });
      return { ok: true };
    },
    onSuccess: (_data, targetKey) => {
      setTestResult({ key: targetKey, ok: true, message: t(language, "settings.pacs.connectionSuccessful") });
      setTestingKey(null);
    },
    onError: (err: Error, targetKey) => {
      setTestResult({ key: targetKey as string, ok: false, message: err.message });
      setTestingKey(null);
    }
  });

  const saveAutoMutation = useMutation({
    mutationFn: async ({ modalityId, draft }: { modalityId: number; draft: AutoCompletionDraft }) => {
      return api(`/pacs/auto-completion-settings/${modalityId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...draft,
          pollIntervalMinutes: Math.max(1, Number(draft.pollIntervalMinutes) || 1),
          lookbackHours: Math.max(0, Number(draft.lookbackHours) || 0),
          stopAfterHours: Math.max(1, Number(draft.stopAfterHours) || 1)
        })
      });
    },
    onSuccess: async () => {
      setAutoMessage("Auto-completion setting saved.");
      await queryClient.invalidateQueries({ queryKey: ["pacs", "auto-completion-settings"] });
    },
    onError: (err: Error) => setAutoMessage(err.message)
  });

  const testAutoMutation = useMutation({
    mutationFn: async ({ modalityId, bookingId }: { modalityId: number; bookingId: string }) => {
      setAutoTestingId(modalityId);
      const cleanBookingId = bookingId.trim();
      return api<PacsAutoCompletionTestResponse>(
        `/pacs/auto-completion-settings/${modalityId}/test`,
        { method: "POST", body: JSON.stringify(cleanBookingId ? { bookingId: cleanBookingId } : {}) }
      );
    },
    onSuccess: async (result, { modalityId }) => {
      setAutoMessage(`Test for modality ${modalityId}: ${result.result.status}${result.result.lastError ? ` (${result.result.lastError})` : ""}`);
      setAutoTestResults((current) => ({ ...current, [modalityId]: result }));
      setAutoTestingId(null);
      await queryClient.invalidateQueries({ queryKey: ["pacs", "auto-completion-settings"] });
    },
    onError: (err: Error) => {
      setAutoMessage(err.message);
      setAutoTestingId(null);
    }
  });

  const settingsError = autoSettingsQuery.error;
  if (settingsError) {
    const status = settingsError instanceof ApiError ? settingsError.status : undefined;
    const msg = (settingsError as Error).message;
    if (status === 401 || status === 403 || msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["pacs", "orthanc-modalities"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (autoSettingsQuery.isLoading) return <p className="text-sm text-stone-500 dark:text-stone-400">{t(language, "common.loading")}</p>;

  const startEdit = (modality: OrthancRemoteModality) => {
    setEditingKey(modality.key);
    setEditForm({
      key: modality.key,
      aet: modality.aet,
      host: modality.host,
      port: modality.port ?? "",
      isDefault: modality.isDefault
    });
  };

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button type="button" onClick={() => setMutationError(null)} className="ml-2 underline">{t(language, "common.dismiss")}</button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          <p className="font-medium">Could not load Orthanc remote modalities</p>
          <p className="text-xs mt-1">{(error as Error).message}</p>
          <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-modalities"] })} className="mt-2 underline">
            Retry
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-semibold text-stone-900 dark:text-white">Orthanc remote modalities</h4>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            PACS search, remap send, and auto-completion use these Orthanc REST modalities.
          </p>
        </div>
        <button type="button" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">
          {showCreate ? t(language, "common.cancel") : "Add Orthanc modality"}
        </button>
      </div>

      {showCreate && (
        <OrthancModalityForm
          form={createForm}
          onChange={setCreateForm}
          onSubmit={() => createMutation.mutate(createForm)}
          isPending={createMutation.isPending}
          onCancel={() => { setShowCreate(false); setCreateForm(emptyForm); }}
        />
      )}

      <ul className="space-y-3">
        {data?.modalities?.map((modality) => (
          <li key={modality.key} className="p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800">
            {editingKey === modality.key ? (
              <OrthancModalityForm
                form={editForm}
                onChange={setEditForm}
                onSubmit={() => updateMutation.mutate({ key: modality.key, data: editForm })}
                isPending={updateMutation.isPending}
                onCancel={() => { setEditingKey(null); setMutationError(null); }}
                keyReadOnly
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900 dark:text-white">{modality.key}</span>
                    <span className="px-1.5 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 rounded">Orthanc</span>
                    {modality.isDefault && (
                      <span className="px-1.5 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400 mt-1 font-mono">
                    {modality.host || "missing-host"}:{modality.port ?? "invalid-port"} | AET: {modality.aet || "missing-aet"}
                  </div>
                  {modality.configurationError && (
                    <div className="text-xs mt-1 text-red-600 dark:text-red-400">
                      {modality.configurationError}
                    </div>
                  )}
                  {testResult?.key === modality.key && (
                    <div className={`text-xs mt-1 ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {testResult.ok ? "OK" : "Failed"} {testResult.message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    aria-label={`Test ${modality.key}`}
                    onClick={() => testMutation.mutate(modality.key)}
                    disabled={testingKey === modality.key}
                    className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {testingKey === modality.key ? t(language, "settings.pacs.testing") : t(language, "settings.pacs.test")}
                  </button>
                  <button type="button" aria-label={`Edit ${modality.key}`} onClick={() => startEdit(modality)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">{t(language, "common.edit")}</button>
                  <button
                    type="button"
                    aria-label={`Delete ${modality.key}`}
                    onClick={() => { if (window.confirm(`${t(language, "common.delete")} "${modality.key}"?`)) deleteMutation.mutate(modality.key); }}
                    className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  >
                    {t(language, "common.delete")}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {data?.modalities?.length === 0 && !showCreate && (
        <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-8">
          No Orthanc remote modalities are configured.
        </p>
      )}
      <div className="border-t border-stone-200 dark:border-stone-700 pt-4 space-y-3">
        <div>
          <h4 className="font-semibold text-stone-900 dark:text-white">Orthanc PACS auto-completion</h4>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            RISpro verifies completed imaging through Orthanc REST, then completes V2 bookings only on deterministic matches.
          </p>
        </div>
        {targetsQuery.error && (
          <div className="text-xs text-amber-700 dark:text-amber-300">
            Remote Orthanc modalities could not be loaded. Local Orthanc remains available.
          </div>
        )}
        {autoMessage && (
          <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-700 text-sm">
            {autoMessage}
            <button type="button" onClick={() => setAutoMessage(null)} className="ml-2 underline">{t(language, "common.dismiss")}</button>
          </div>
        )}
        <div className="space-y-3">
          {autoSettingsQuery.data?.settings?.map((setting) => {
            const draft = autoDrafts[setting.modality_id] || {
              enabled: false,
              orthancTargetType: "local" as const,
              orthancTargetKey: "",
              matchingStrategy: "study_uid_preferred_accession_fallback" as const,
              completionThreshold: "study_exists" as const,
              pollIntervalMinutes: 15,
              lookbackHours: 24,
              stopAfterHours: 72
            };
            const targetValue = draft.orthancTargetType === "local" ? "local" : draft.orthancTargetKey;
            const updateDraft = (patch: Partial<AutoCompletionDraft>) => {
              setAutoDrafts((prev) => ({
                ...prev,
                [setting.modality_id]: { ...draft, ...patch }
              }));
            };
            const testDetails = autoTestResults[setting.modality_id];
            const diagnostics = testDetails?.diagnostics;
            return (
              <div key={setting.modality_id} className="p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-stone-900 dark:text-white">
                      {language === "ar" ? setting.modality_name_ar || setting.modality_name_en : setting.modality_name_en || setting.modality_name_ar}
                      <span className="ml-2 text-xs font-mono text-stone-500">{setting.modality_code}</span>
                    </div>
                    <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                      Last result: {setting.last_check_status || "never"}
                      {setting.last_checked_at ? ` at ${new Date(setting.last_checked_at).toLocaleString()}` : ""}
                      {setting.last_error ? ` | ${setting.last_error}` : ""}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => updateDraft({ enabled: event.target.checked })}
                    />
                    Enable
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">Orthanc target</span>
                    <select
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={targetValue || "local"}
                      onChange={(event) => {
                        if (event.target.value === "local") {
                          updateDraft({ orthancTargetType: "local", orthancTargetKey: "" });
                        } else {
                          updateDraft({ orthancTargetType: "remote_modality", orthancTargetKey: event.target.value });
                        }
                      }}
                    >
                      <option value="local">Local Orthanc index</option>
                      {(targetsQuery.data?.targets || [])
                        .filter((target) => target.type === "remote_modality")
                        .map((target) => (
                          <option key={target.key} value={target.key}>{target.label}</option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">Matching strategy</span>
                    <select
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.matchingStrategy}
                      onChange={() => updateDraft({ matchingStrategy: "study_uid_preferred_accession_fallback" })}
                    >
                      <option value="study_uid_preferred_accession_fallback">Study UID, accession fallback</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">Completion threshold</span>
                    <select
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.completionThreshold}
                      onChange={(event) => updateDraft({ completionThreshold: event.target.value as CompletionThreshold })}
                    >
                      <option value="study_exists">Study exists</option>
                      <option value="series_exists">At least one series</option>
                      <option value="instance_exists">At least one image</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">Poll interval minutes</span>
                    <input
                      type="number"
                      min={1}
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.pollIntervalMinutes}
                      onChange={(event) => updateDraft({ pollIntervalMinutes: event.target.value === "" ? "" : Number(event.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">Lookback hours</span>
                    <input
                      type="number"
                      min={0}
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.lookbackHours}
                      onChange={(event) => updateDraft({ lookbackHours: event.target.value === "" ? "" : Number(event.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">Stop after hours</span>
                    <input
                      type="number"
                      min={1}
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.stopAfterHours}
                      onChange={(event) => updateDraft({ stopAfterHours: event.target.value === "" ? "" : Number(event.target.value) })}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors"
                    disabled={saveAutoMutation.isPending}
                    onClick={() => saveAutoMutation.mutate({ modalityId: setting.modality_id, draft })}
                  >
                    {saveAutoMutation.isPending ? "Saving..." : "Save auto-completion"}
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                    disabled={autoTestingId === setting.modality_id}
                    onClick={() => testAutoMutation.mutate({
                      modalityId: setting.modality_id,
                      bookingId: autoTestBookingIds[setting.modality_id] || "",
                    })}
                  >
                    {autoTestingId === setting.modality_id ? "Testing..." : "Test verification"}
                  </button>
                </div>
                <label className="block text-xs text-stone-600 dark:text-stone-300">
                  Booking ID to test
                  <input
                    type="text"
                    inputMode="text"
                    placeholder="Latest eligible booking, or V2-123"
                    className="mt-1 px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full max-w-xs"
                    value={autoTestBookingIds[setting.modality_id] || ""}
                    onChange={(event) => setAutoTestBookingIds((current) => ({
                      ...current,
                      [setting.modality_id]: event.target.value,
                    }))}
                  />
                </label>
                {diagnostics && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 text-xs text-stone-600 dark:text-stone-300">
                    <DiagnosticValue label="Tested booking ID" value={diagnostics.bookingId} />
                    <DiagnosticValue label="Booking status" value={diagnostics.bookingStatus} />
                    <DiagnosticValue label="Expected accession" value={diagnostics.expectedAccession} />
                    <DiagnosticValue label="Target" value={diagnostics.orthancTargetLabel} />
                    <DiagnosticValue label="Match key" value={diagnostics.matchKey} />
                    <DiagnosticValue label="Match value" value={diagnostics.matchValue} />
                    <DiagnosticValue label="Candidate count" value={diagnostics.candidateCount} />
                    <DiagnosticValue label="Threshold" value={diagnostics.completionThreshold} />
                    <DiagnosticValue label="Result status" value={testDetails.result.status} />
                    <DiagnosticValue label="Last error" value={diagnostics.lastError || testDetails.result.lastError || null} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DiagnosticValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded border border-stone-200 dark:border-stone-700 px-2 py-1.5">
      <div className="text-stone-500 dark:text-stone-400">{label}</div>
      <div className="font-mono text-stone-900 dark:text-white break-words">{value ?? "N/A"}</div>
    </div>
  );
}

function OrthancModalityForm({
  form,
  onChange,
  onSubmit,
  isPending,
  onCancel,
  keyReadOnly = false
}: {
  form: OrthancModalityFormState;
  onChange: (form: OrthancModalityFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
  onCancel: () => void;
  keyReadOnly?: boolean;
}) {
  return (
    <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">Orthanc key</span>
          <input
            value={form.key}
            onChange={(e) => onChange({ ...form, key: e.target.value })}
            placeholder="Orthanc key (e.g. CT_REMOTE)"
            disabled={keyReadOnly}
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono disabled:opacity-60"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">Remote AET</span>
          <input
            value={form.aet}
            onChange={(e) => onChange({ ...form, aet: e.target.value.toUpperCase() })}
            placeholder="Remote AET"
            maxLength={16}
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">Host</span>
          <input
            value={form.host}
            onChange={(e) => onChange({ ...form, host: e.target.value })}
            placeholder="Host (IP or hostname)"
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">Port</span>
          <input
            type="number"
            value={form.port}
            onChange={(e) => onChange({ ...form, port: e.target.value === "" ? "" : Number(e.target.value) })}
            placeholder="Port"
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
          />
        </label>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => onChange({ ...form, isDefault: e.target.checked })}
        />
        Default destination
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !form.key || !form.host || !form.aet || form.port === ""}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">
          Cancel
        </button>
      </div>
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
      <p className="text-xs text-amber-600 dark:text-amber-400">Please re-authenticate to manage Orthanc remote modalities.</p>
      <button type="button" onClick={onReAuthRequired} className="btn-primary text-sm">
        Re-authenticate
      </button>
    </div>
  );
}
