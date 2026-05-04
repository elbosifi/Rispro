import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

const SETTINGS_LOAD_TIMEOUT_MS = 5000;

interface PacsNode {
  id: number;
  name: string;
  host: string;
  port: number;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: number;
  is_active: boolean;
  is_default: boolean;
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

type PacsNodeFormState = {
  name: string;
  host: string;
  port: number;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: number;
  is_active: boolean;
  is_default: boolean;
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
  const { data, isLoading, error } = useQuery<{ nodes: PacsNode[] }>({
    queryKey: ["pacs", "nodes"],
    queryFn: () => api<{ nodes: PacsNode[] }>("/pacs/nodes", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });
  const targetsQuery = useQuery<{ targets: OrthancVerificationTarget[] }>({
    queryKey: ["pacs", "orthanc-verification-targets"],
    queryFn: () => api<{ targets: OrthancVerificationTarget[] }>("/pacs/orthanc-verification-targets", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });
  const autoSettingsQuery = useQuery<{ settings: PacsAutoCompletionSetting[] }>({
    queryKey: ["pacs", "auto-completion-settings"],
    queryFn: () => api<{ settings: PacsAutoCompletionSetting[] }>("/pacs/auto-completion-settings", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number | null; ok: boolean; message: string } | null>(null);
  const [autoDrafts, setAutoDrafts] = useState<Record<number, AutoCompletionDraft>>({});
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoTestingId, setAutoTestingId] = useState<number | null>(null);

  const emptyForm: PacsNodeFormState = {
    name: "",
    host: "",
    port: 104,
    called_ae_title: "",
    calling_ae_title: "RISPRO",
    timeout_seconds: 10,
    is_active: true,
    is_default: false
  };

  const [createForm, setCreateForm] = useState<PacsNodeFormState>(emptyForm);
  const [editForm, setEditForm] = useState<PacsNodeFormState>(emptyForm);
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

  // Normalize snake_case form state to camelCase payload expected by backend
  const toBackendPayload = (form: Partial<PacsNodeFormState>) => ({
    name: form.name,
    host: form.host,
    port: form.port,
    calledAeTitle: form.called_ae_title,
    callingAeTitle: form.calling_ae_title,
    timeoutSeconds: form.timeout_seconds,
    isActive: form.is_active ? "enabled" : "disabled",
    isDefault: form.is_default ? "enabled" : "disabled"
  });

  const createMutation = useMutation({
    mutationFn: async (data: PacsNodeFormState) => {
      return api("/pacs/nodes", {
        method: "POST",
        body: JSON.stringify(toBackendPayload(data))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "nodes"] });
      setShowCreate(false);
      setCreateForm(emptyForm);
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<PacsNodeFormState> }) => {
      return api(`/pacs/nodes/${id}`, {
        method: "PUT",
        body: JSON.stringify(toBackendPayload(data))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "nodes"] });
      setEditingId(null);
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api(`/pacs/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "nodes"] });
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const testMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      setTestingId(nodeId);
      await api("/pacs/test", {
        method: "POST",
        body: JSON.stringify({ nodeId })
      });
      return { ok: true };
    },
    onSuccess: (_data, nodeId) => {
      setTestResult({ id: nodeId, ok: true, message: t(language, "settings.pacs.connectionSuccessful") });
      setTestingId(null);
    },
    onError: (err: Error, nodeId) => {
      setTestResult({ id: nodeId as number, ok: false, message: err.message });
      setTestingId(null);
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
    mutationFn: async (modalityId: number) => {
      setAutoTestingId(modalityId);
      return api<{ result: { status: string; lastError?: string | null }; bookingId: number | null }>(
        `/pacs/auto-completion-settings/${modalityId}/test`,
        { method: "POST", body: JSON.stringify({}) }
      );
    },
    onSuccess: async (result, modalityId) => {
      setAutoMessage(`Test for modality ${modalityId}: ${result.result.status}${result.result.lastError ? ` (${result.result.lastError})` : ""}`);
      setAutoTestingId(null);
      await queryClient.invalidateQueries({ queryKey: ["pacs", "auto-completion-settings"] });
    },
    onError: (err: Error) => {
      setAutoMessage(err.message);
      setAutoTestingId(null);
    }
  });

  const settingsError = error || autoSettingsQuery.error;
  if (settingsError) {
    const status = settingsError instanceof ApiError ? settingsError.status : undefined;
    const msg = (settingsError as Error).message;
    if (status === 401 || status === 403 || msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["pacs", "nodes"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading || autoSettingsQuery.isLoading) return <p className="text-sm text-stone-500 dark:text-stone-400">{t(language, "common.loading")}</p>;

  const startEdit = (node: PacsNode) => {
    setEditingId(node.id);
    setEditForm({
      name: node.name,
      host: node.host,
      port: node.port,
      called_ae_title: node.called_ae_title,
      calling_ae_title: node.calling_ae_title,
      timeout_seconds: node.timeout_seconds,
      is_active: node.is_active,
      is_default: node.is_default
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

      <div className="flex justify-between items-center">
        <span className="text-sm text-stone-600 dark:text-stone-400">{data?.nodes?.length ?? 0} {t(language, "settings.pacs.nodes")}</span>
        <button type="button" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">
          {showCreate ? t(language, "common.cancel") : t(language, "settings.pacs.addNode")}
        </button>
      </div>

      {showCreate && (
        <PacsNodeForm
          form={createForm}
          onChange={setCreateForm}
          onSubmit={() => createMutation.mutate(createForm)}
          isPending={createMutation.isPending}
          onCancel={() => { setShowCreate(false); setCreateForm(emptyForm); }}
        />
      )}

      <ul className="space-y-3">
        {data?.nodes?.map((node) => (
          <li key={node.id} className="p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800">
            {editingId === node.id ? (
              <PacsNodeForm
                form={editForm}
                onChange={setEditForm}
                onSubmit={() => updateMutation.mutate({ id: node.id, data: editForm })}
                isPending={updateMutation.isPending}
                onCancel={() => { setEditingId(null); setMutationError(null); }}
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900 dark:text-white">{node.name}</span>
                    {node.is_default && (
                      <span className="px-1.5 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 rounded">{t(language, "settings.pacs.default")}</span>
                    )}
                    {!node.is_active && (
                      <span className="px-1.5 py-0.5 text-xs bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400 rounded">{t(language, "settings.pacs.inactive")}</span>
                    )}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400 mt-1 font-mono">
                    {node.host}:{node.port} | AE: {node.called_ae_title} | Timeout: {node.timeout_seconds}s
                  </div>
                  {testResult?.id === node.id && (
                    <div className={`text-xs mt-1 ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {testResult.ok ? "✓" : "✗"} {testResult.message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => testMutation.mutate(node.id)}
                    disabled={testingId === node.id}
                    className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {testingId === node.id ? t(language, "settings.pacs.testing") : t(language, "settings.pacs.test")}
                  </button>
                  <button type="button" onClick={() => startEdit(node)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">{t(language, "common.edit")}</button>
                  <button
                    type="button"
                    onClick={() => { if (window.confirm(`${t(language, "common.delete")} "${node.name}"?`)) deleteMutation.mutate(node.id); }}
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

      {data?.nodes?.length === 0 && !showCreate && (
        <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-8">
          {language === "ar"
            ? "لا توجد عقد PACS مكوّنة. اضغط على \"إضافة عقدة PACS\" للبدء."
            : "No PACS nodes configured. Click \"Add PACS Node\" to get started."}
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
                    onClick={() => testAutoMutation.mutate(setting.modality_id)}
                  >
                    {autoTestingId === setting.modality_id ? "Testing..." : "Test verification"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PacsNodeForm({
  form,
  onChange,
  onSubmit,
  isPending,
  onCancel
}: {
  form: PacsNodeFormState;
  onChange: (form: PacsNodeFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="Node name (e.g. Primary PACS)"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
        <input
          value={form.host}
          onChange={(e) => onChange({ ...form, host: e.target.value })}
          placeholder="Host (IP or hostname)"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
        <input
          type="number"
          value={form.port}
          onChange={(e) => onChange({ ...form, port: parseInt(e.target.value) || 104 })}
          placeholder="Port"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
        <input
          value={form.called_ae_title}
          onChange={(e) => onChange({ ...form, called_ae_title: e.target.value.toUpperCase() })}
          placeholder="Called AE Title (PACS side)"
          maxLength={16}
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
        <input
          value={form.calling_ae_title}
          onChange={(e) => onChange({ ...form, calling_ae_title: e.target.value.toUpperCase() })}
          placeholder="Calling AE Title (RIS side)"
          maxLength={16}
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
        <input
          type="number"
          value={form.timeout_seconds}
          onChange={(e) => onChange({ ...form, timeout_seconds: parseInt(e.target.value) || 10 })}
          placeholder="Timeout (seconds)"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => onChange({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => onChange({ ...form, is_default: e.target.checked })}
          />
          Default node
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !form.name || !form.host || !form.called_ae_title}
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
      <p className="text-xs text-amber-600 dark:text-amber-400">Please re-authenticate to manage PACS nodes.</p>
      <button type="button" onClick={onReAuthRequired} className="btn-primary text-sm">
        Re-authenticate
      </button>
    </div>
  );
}
