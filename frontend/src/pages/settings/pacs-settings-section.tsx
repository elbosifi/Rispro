import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
type BelowMinimumSeriesAction = "leave_unchanged" | "discontinue";

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
  minimum_series_count: number;
  below_minimum_series_action: BelowMinimumSeriesAction;
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
  minimumSeriesCount: number;
  belowMinimumSeriesAction: BelowMinimumSeriesAction;
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
  minimumSeriesCount: number | "";
  belowMinimumSeriesAction: BelowMinimumSeriesAction;
  pollIntervalMinutes: number | "";
  lookbackHours: number | "";
  stopAfterHours: number | "";
};

function toAutoCompletionDraft(setting: PacsAutoCompletionSetting): AutoCompletionDraft {
  return {
    enabled: setting.enabled,
    orthancTargetType: setting.orthanc_target_type,
    orthancTargetKey: setting.orthanc_target_key || "",
    matchingStrategy: setting.matching_strategy,
    completionThreshold: setting.completion_threshold,
    minimumSeriesCount: Number(setting.minimum_series_count || 2),
    belowMinimumSeriesAction: setting.below_minimum_series_action || "leave_unchanged",
    pollIntervalMinutes: Number(setting.poll_interval_minutes || 15),
    lookbackHours: Number(setting.lookback_hours || 24),
    stopAfterHours: Number(setting.stop_after_hours || 72)
  };
}

export default function PacsSettingsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const { data, error } = useQuery<{ modalities: OrthancRemoteModality[] }>({
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
  const [autoDraftOverrides, setAutoDraftOverrides] = useState<Record<number, AutoCompletionDraft>>({});
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

  const serverAutoDrafts = useMemo(
    () =>
      Object.fromEntries(
        (autoSettingsQuery.data?.settings ?? []).map((setting) => [
          setting.modality_id,
          toAutoCompletionDraft(setting),
        ])
      ) as Record<number, AutoCompletionDraft>,
    [autoSettingsQuery.data?.settings]
  );
  const autoDrafts = useMemo(
    () => ({ ...serverAutoDrafts, ...autoDraftOverrides }),
    [autoDraftOverrides, serverAutoDrafts]
  );

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
          minimumSeriesCount: Math.max(1, Number(draft.minimumSeriesCount) || 2),
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
          <p className="font-medium">{t(language, "settings.pacs.remoteModalitiesLoadFailed")}</p>
          <p className="text-xs mt-1">{(error as Error).message}</p>
          <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["pacs", "orthanc-modalities"] })} className="mt-2 underline">
            {t(language, "common.tryAgain")}
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h4 className="font-semibold text-stone-900 dark:text-white">{t(language, "settings.pacs.remoteModalities")}</h4>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            {t(language, "settings.pacs.remoteModalitiesDescription")}
          </p>
        </div>
        <button type="button" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">
          {showCreate ? t(language, "common.cancel") : t(language, "settings.pacs.addOrthancModality")}
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
                    <span className="px-1.5 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 rounded">{t(language, "settings.pacs.orthanc")}</span>
                    {modality.isDefault && (
                      <span className="px-1.5 py-0.5 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded">
                        {t(language, "settings.pacs.default")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400 mt-1 font-mono">
                    {modality.host || t(language, "settings.pacs.missingHost")}:{modality.port ?? t(language, "settings.pacs.invalidPort")} | {t(language, "settings.pacs.aet")}: {modality.aet || t(language, "settings.pacs.missingAet")}
                  </div>
                  {modality.configurationError && (
                    <div className="text-xs mt-1 text-red-600 dark:text-red-400">
                      {modality.configurationError}
                    </div>
                  )}
                  {testResult?.key === modality.key && (
                    <div className={`text-xs mt-1 ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {testResult.ok ? t(language, "settings.pacs.ok") : t(language, "settings.pacs.failed")} {testResult.message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    aria-label={t(language, "settings.pacs.testModality", { key: modality.key })}
                    onClick={() => testMutation.mutate(modality.key)}
                    disabled={testingKey === modality.key}
                    className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {testingKey === modality.key ? t(language, "settings.pacs.testing") : t(language, "settings.pacs.test")}
                  </button>
                  <button type="button" aria-label={t(language, "settings.pacs.editModality", { key: modality.key })} onClick={() => startEdit(modality)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">{t(language, "common.edit")}</button>
                  <button
                    type="button"
                    aria-label={t(language, "settings.pacs.deleteModality", { key: modality.key })}
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
          {t(language, "settings.pacs.noRemoteModalities")}
        </p>
      )}
      <div className="border-t border-stone-200 dark:border-stone-700 pt-4 space-y-3">
        <div>
          <h4 className="font-semibold text-stone-900 dark:text-white">{t(language, "settings.pacs.autoCompletion")}</h4>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            {t(language, "settings.pacs.autoCompletionDescription")}
          </p>
        </div>
        {targetsQuery.error && (
          <div className="text-xs text-amber-700 dark:text-amber-300">
            {t(language, "settings.pacs.targetsLoadFailed")}
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
              minimumSeriesCount: 2,
              belowMinimumSeriesAction: "leave_unchanged" as const,
              pollIntervalMinutes: 15,
              lookbackHours: 24,
              stopAfterHours: 72
            };
            const targetValue = draft.orthancTargetType === "local" ? "local" : draft.orthancTargetKey;
            const updateDraft = (patch: Partial<AutoCompletionDraft>) => {
              setAutoDraftOverrides((prev) => ({
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
                      {t(language, "settings.pacs.lastResult")}: {setting.last_check_status || t(language, "settings.pacs.never")}
                      {setting.last_checked_at ? ` ${t(language, "settings.pacs.at")} ${new Date(setting.last_checked_at).toLocaleString()}` : ""}
                      {setting.last_error ? ` | ${setting.last_error}` : ""}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => updateDraft({ enabled: event.target.checked })}
                    />
                    {t(language, "settings.pacs.enable")}
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.orthancTarget")}</span>
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
                      <option value="local">{t(language, "settings.pacs.localOrthancIndex")}</option>
                      {(targetsQuery.data?.targets || [])
                        .filter((target) => target.type === "remote_modality")
                        .map((target) => (
                          <option key={target.key} value={target.key}>{target.label}</option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.matchingStrategy")}</span>
                    <select
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.matchingStrategy}
                      onChange={() => updateDraft({ matchingStrategy: "study_uid_preferred_accession_fallback" })}
                    >
                      <option value="study_uid_preferred_accession_fallback">{t(language, "settings.pacs.studyUidAccessionFallback")}</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.completionThreshold")}</span>
                    <select
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.completionThreshold}
                      onChange={(event) => updateDraft({ completionThreshold: event.target.value as CompletionThreshold })}
                    >
                      <option value="study_exists">{t(language, "settings.pacs.studyExists")}</option>
                      <option value="series_exists">{t(language, "settings.pacs.seriesExists")}</option>
                      <option value="instance_exists">{t(language, "settings.pacs.instanceExists")}</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.minimumSeriesCount")}</span>
                    <input
                      type="number"
                      min={1}
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.minimumSeriesCount}
                      onChange={(event) => updateDraft({ minimumSeriesCount: event.target.value === "" ? "" : Number(event.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.belowMinimumSeriesAction")}</span>
                    <select
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.belowMinimumSeriesAction}
                      onChange={(event) => updateDraft({ belowMinimumSeriesAction: event.target.value as BelowMinimumSeriesAction })}
                    >
                      <option value="leave_unchanged">{t(language, "settings.pacs.leaveUnchanged")}</option>
                      <option value="discontinue">{t(language, "settings.pacs.discontinue")}</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.pollIntervalMinutes")}</span>
                    <input
                      type="number"
                      min={1}
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.pollIntervalMinutes}
                      onChange={(event) => updateDraft({ pollIntervalMinutes: event.target.value === "" ? "" : Number(event.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.lookbackHours")}</span>
                    <input
                      type="number"
                      min={0}
                      className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm w-full"
                      value={draft.lookbackHours}
                      onChange={(event) => updateDraft({ lookbackHours: event.target.value === "" ? "" : Number(event.target.value) })}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="block text-xs text-stone-500">{t(language, "settings.pacs.stopAfterHours")}</span>
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
                    {saveAutoMutation.isPending ? t(language, "settings.pacs.saving") : t(language, "settings.pacs.saveAutoCompletion")}
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
                    {autoTestingId === setting.modality_id ? t(language, "settings.pacs.testing") : t(language, "settings.pacs.testVerification")}
                  </button>
                </div>
                <label className="block text-xs text-stone-600 dark:text-stone-300">
                  {t(language, "settings.pacs.bookingIdToTest")}
                  <input
                    type="text"
                    inputMode="text"
                    placeholder={t(language, "settings.pacs.bookingIdToTestPlaceholder")}
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
                    <DiagnosticValue label={t(language, "settings.pacs.testedBookingId")} value={diagnostics.bookingId} />
                    <DiagnosticValue label={t(language, "settings.pacs.bookingStatus")} value={diagnostics.bookingStatus} />
                    <DiagnosticValue label={t(language, "settings.pacs.expectedAccession")} value={diagnostics.expectedAccession} />
                    <DiagnosticValue label={t(language, "settings.pacs.target")} value={diagnostics.orthancTargetLabel} />
                    <DiagnosticValue label={t(language, "settings.pacs.matchKey")} value={diagnostics.matchKey} />
                    <DiagnosticValue label={t(language, "settings.pacs.matchValue")} value={diagnostics.matchValue} />
                    <DiagnosticValue label={t(language, "settings.pacs.candidateCount")} value={diagnostics.candidateCount} />
                    <DiagnosticValue label={t(language, "settings.pacs.threshold")} value={diagnostics.completionThreshold} />
                    <DiagnosticValue label={t(language, "settings.pacs.minimumSeriesCount")} value={diagnostics.minimumSeriesCount} />
                    <DiagnosticValue label={t(language, "settings.pacs.belowMinimumSeriesAction")} value={diagnostics.belowMinimumSeriesAction} />
                    <DiagnosticValue label={t(language, "settings.pacs.resultStatus")} value={testDetails.result.status} />
                    <DiagnosticValue label={t(language, "settings.pacs.lastError")} value={diagnostics.lastError || testDetails.result.lastError || null} />
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
  const { language } = useLanguage();
  return (
    <div className="rounded border border-stone-200 dark:border-stone-700 px-2 py-1.5">
      <div className="text-stone-500 dark:text-stone-400">{label}</div>
      <div className="font-mono text-stone-900 dark:text-white break-words">{value ?? t(language, "common.na")}</div>
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
  const { language } = useLanguage();
  return (
    <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">{t(language, "settings.pacs.orthancKey")}</span>
          <input
            value={form.key}
            onChange={(e) => onChange({ ...form, key: e.target.value })}
            placeholder={t(language, "settings.pacs.orthancKeyPlaceholder")}
            disabled={keyReadOnly}
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono disabled:opacity-60"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">{t(language, "settings.pacs.remoteAet")}</span>
          <input
            value={form.aet}
            onChange={(e) => onChange({ ...form, aet: e.target.value.toUpperCase() })}
            placeholder={t(language, "settings.pacs.remoteAet")}
            maxLength={16}
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">{t(language, "settings.pacs.host")}</span>
          <input
            value={form.host}
            onChange={(e) => onChange({ ...form, host: e.target.value })}
            placeholder={t(language, "settings.pacs.hostPlaceholder")}
            className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-stone-500">{t(language, "settings.pacs.port")}</span>
          <input
            type="number"
            value={form.port}
            onChange={(e) => onChange({ ...form, port: e.target.value === "" ? "" : Number(e.target.value) })}
            placeholder={t(language, "settings.pacs.port")}
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
        {t(language, "settings.pacs.defaultDestination")}
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !form.key || !form.host || !form.aet || form.port === ""}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors"
        >
          {isPending ? t(language, "settings.pacs.saving") : t(language, "common.save")}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">
          {t(language, "common.cancel")}
        </button>
      </div>
    </div>
  );
}
function QueryError({ message }: { message: string }) {
  const { language } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{t(language, "settings.pacs.failedToLoad")}</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  const { language } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t(language, "settings.pacs.reauthRequired")}</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">{t(language, "settings.pacs.reauthDescription")}</p>
      <button type="button" onClick={onReAuthRequired} className="btn-primary text-sm">
        {t(language, "common.reAuthenticate")}
      </button>
    </div>
  );
}
