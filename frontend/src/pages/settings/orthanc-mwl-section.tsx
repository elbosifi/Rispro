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
  connection_mode: string;
  base_url: string;
  username: string;
  password: string;
  timeout_seconds: string;
  verify_tls: string;
  worklist_target: string;
  strategy_preference: string;
  mwl_specific_character_set: string;
  mwl_patient_id_source: string;
  mwl_patient_name_source: string;
  mwl_procedure_description_source: string;
  mwl_enabled_tags_json: string;
  mwl_tag_limits_json: string;
  mwl_overflow_policy_json: string;
  mwl_extra_tags_json: string;
};

type OverflowPolicy = "reject" | "truncate" | "omit";
type DicomVr = "AE" | "CS" | "DA" | "LO" | "PN" | "SH" | "UI";

type DicomExtraTag = {
  tag: string;
  vr: DicomVr;
  value: string;
  maxLength?: number;
  policy?: OverflowPolicy;
};

const CHARACTER_SET_OPTIONS = [
  { value: "ISO_IR 192", label: "UTF-8 (ISO_IR 192)" },
  { value: "ISO_IR 6", label: "ASCII (ISO_IR 6)" },
  { value: "ISO_IR 100", label: "Latin-1 Western European (ISO_IR 100)" },
  { value: "ISO_IR 101", label: "Latin-2 Central European (ISO_IR 101)" },
  { value: "ISO_IR 109", label: "Latin-3 South European (ISO_IR 109)" },
  { value: "ISO_IR 144", label: "Cyrillic (ISO_IR 144)" },
  { value: "ISO_IR 126", label: "Greek (ISO_IR 126)" },
  { value: "ISO_IR 127", label: "Arabic (ISO_IR 127)" },
  { value: "ISO_IR 138", label: "Hebrew (ISO_IR 138)" },
  { value: "GB18030", label: "Chinese GB18030" },
];

const OVERFLOW_POLICY_OPTIONS: Array<{ value: OverflowPolicy; label: string }> = [
  { value: "reject", label: "Reject" },
  { value: "truncate", label: "Truncate" },
  { value: "omit", label: "Omit" },
];

const DICOM_VR_OPTIONS: DicomVr[] = ["AE", "CS", "DA", "LO", "PN", "SH", "UI"];

const ORTHANC_TAG_FIELDS: Array<{ key: string; label: string; defaultMax: number; defaultPolicy: OverflowPolicy }> = [
  { key: "SpecificCharacterSet", label: "Specific Character Set", defaultMax: 16, defaultPolicy: "reject" },
  { key: "PatientName", label: "Patient Name", defaultMax: 64, defaultPolicy: "reject" },
  { key: "PatientID", label: "Patient ID", defaultMax: 64, defaultPolicy: "reject" },
  { key: "PatientBirthDate", label: "Patient Birth Date", defaultMax: 8, defaultPolicy: "reject" },
  { key: "PatientSex", label: "Patient Sex", defaultMax: 16, defaultPolicy: "reject" },
  { key: "AccessionNumber", label: "Accession Number", defaultMax: 16, defaultPolicy: "reject" },
  { key: "Modality", label: "Modality", defaultMax: 16, defaultPolicy: "reject" },
  { key: "ScheduledProcedureStepStartDate", label: "SPS Start Date", defaultMax: 8, defaultPolicy: "reject" },
  { key: "ScheduledProcedureStepDescription", label: "SPS Description", defaultMax: 64, defaultPolicy: "truncate" },
];

type SyncSummaryResponse = {
  ok: boolean;
  summary: {
    syncStatus: Array<{ status: string; count: number }>;
    outboxStatus: Array<{ status: string; count: number }>;
    recentFailures?: {
      outbox: Array<{
        bookingId: number;
        operation: "upsert" | "delete";
        attemptCount: number;
        lastError: string;
        nextAttemptAt: string | null;
        updatedAt: string;
      }>;
      sync: Array<{
        bookingId: number;
        syncStatus: string;
        lastError: string;
        lastAttemptAt: string | null;
        updatedAt: string;
      }>;
    };
    orthancProbe?: {
      ok: boolean;
      baseUrl: string;
      orthancVersion: string | null;
      worklistsRouteReachable: boolean;
      error: string | null;
    } | null;
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

type ResetWindowResponse = {
  ok: boolean;
  result: {
    activeBookingIds: number[];
    deletedCount: number;
    deleteFailures: Array<{ worklistId: string; error: string }>;
    requeuedBookingIds: number[];
    requeueFailures: Array<{ bookingId: number; error: string }>;
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
  const worklistTarget = String(map.worklist_target || "").trim().toUpperCase() === "RISPRO_MWL"
    ? ""
    : (map.worklist_target || "");
  return {
    enabled: map.enabled || "false",
    shadow_mode: map.shadow_mode || "false",
    connection_mode: map.connection_mode || "external",
    base_url: map.base_url || "",
    username: map.username || "",
    password: map.password || "",
    timeout_seconds: map.timeout_seconds || "10",
    verify_tls: map.verify_tls || "true",
    worklist_target: worklistTarget,
    strategy_preference: map.strategy_preference || "put_first",
    mwl_specific_character_set: map.mwl_specific_character_set || "ISO_IR 192",
    mwl_patient_id_source: map.mwl_patient_id_source || "identifier_value",
    mwl_patient_name_source: map.mwl_patient_name_source || "english_full_name",
    mwl_procedure_description_source: map.mwl_procedure_description_source || "exam_name_en",
    mwl_enabled_tags_json: map.mwl_enabled_tags_json || "{}",
    mwl_tag_limits_json: map.mwl_tag_limits_json || "{}",
    mwl_overflow_policy_json: map.mwl_overflow_policy_json || "{}",
    mwl_extra_tags_json: map.mwl_extra_tags_json || "[]",
  };
}

function parseJsonObject<T extends Record<string, unknown>>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(value || "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray<T>(value: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(value || "");
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value);
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

  const resetWindowMutation = useMutation({
    mutationFn: async () => {
      const parsedLimit = Number(limit);
      return api<ResetWindowResponse>("/dicom/orthanc-sync/reset-window", {
        method: "POST",
        body: JSON.stringify({
          dateFrom,
          dateTo,
          limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5000,
        }),
      });
    },
    onSuccess: (response) => {
      const result = response.result;
      setStatusMessage(
        `Orthanc reset completed. Deleted ${result.deletedCount} entries, re-enqueued ${result.requeuedBookingIds.length} bookings.`
      );
      setTimeout(() => setStatusMessage(null), 5000);
      void refetchSummary();
    },
    onError: (error: Error) => {
      setStatusMessage(error.message || "Orthanc reset failed.");
      setTimeout(() => setStatusMessage(null), 5000);
    },
  });

  const allErrors = useMemo(() => {
    const errors: Array<{ source: string; error: Error }> = [];
    if (settingsError instanceof Error) errors.push({ source: "settings", error: settingsError });
    if (summaryError instanceof Error) errors.push({ source: "summary", error: summaryError });
    return errors;
  }, [settingsError, summaryError]);

  const requestOrthancReAuth = () => {
    // Orthanc section relies on both settings and summary queries.
    // Queue both so successful re-auth fully unblocks the page.
    onReAuthRequired(["settings", "orthanc_mwl_sync"]);
    onReAuthRequired(["dicom", "orthanc-sync", "summary"]);
  };

  if (allErrors.length > 0) {
    const authError = allErrors.find(({ error }) => {
      const status = error instanceof ApiError ? error.status : undefined;
      return status === 401 || status === 403 || error.message.includes("re-authentication");
    });
    if (authError) {
      return <ReAuthPrompt onReAuthRequired={requestOrthancReAuth} />;
    }
    return <QueryError message={allErrors[0].error.message || t("settings.failedLoad")} />;
  }

  if (settingsLoading) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>;
  }

  const syncStatus = summaryData?.summary?.syncStatus || [];
  const outboxStatus = summaryData?.summary?.outboxStatus || [];
  const recentOutboxFailures = summaryData?.summary?.recentFailures?.outbox || [];
  const orthancProbe = summaryData?.summary?.orthancProbe;
  const isInternalMode = form.connection_mode === "internal";
  const enabledTags = parseJsonObject<Record<string, boolean>>(form.mwl_enabled_tags_json, {});
  const tagLimits = parseJsonObject<Record<string, number>>(form.mwl_tag_limits_json, {});
  const overflowPolicies = parseJsonObject<Record<string, OverflowPolicy>>(form.mwl_overflow_policy_json, {});
  const extraTags = parseJsonArray<DicomExtraTag>(form.mwl_extra_tags_json, []);

  const updateJsonMap = <T extends string | number | boolean>(
    key: keyof OrthancSettingsForm,
    field: string,
    value: T | null,
    current: Record<string, T>
  ) => {
    const next = { ...current };
    if (value === null || value === "") {
      delete next[field];
    } else {
      next[field] = value;
    }
    setForm((prev) => ({ ...prev, [key]: jsonStringify(next) }));
    setDirty(true);
  };

  const updateExtraTag = (index: number, patch: Partial<DicomExtraTag>) => {
    const next = extraTags.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    setForm((prev) => ({ ...prev, mwl_extra_tags_json: jsonStringify(next) }));
    setDirty(true);
  };

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
            label="Orthanc connection"
            type="select"
            value={form.connection_mode}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, connection_mode: value }));
              setDirty(true);
            }}
            options={[
              { value: "external", label: "External Orthanc" },
              { value: "internal", label: "Internal Orthanc" },
            ]}
          />
          {isInternalMode ? (
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium text-stone-700 dark:text-stone-300">Internal Orthanc routing</label>
              <div className="w-full px-3 py-2 rounded border bg-stone-50 dark:bg-stone-900 border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 text-sm">
                RISpro will use the internal Orthanc service configured by deployment. The resolved base URL appears in the probe section below.
              </div>
            </div>
          ) : (
          <SettingField
            label="Orthanc Base URL"
            value={form.base_url}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, base_url: value.trim() }));
              setDirty(true);
            }}
            placeholder="https://orthanc.example.local:8042"
          />
          )}
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
          {!isInternalMode && (
            <>
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
            </>
          )}
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
          <SettingField
            label="Write strategy"
            type="select"
            value={form.strategy_preference}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, strategy_preference: value }));
              setDirty(true);
            }}
            options={[
              { value: "put_first", label: "Update by stable ID first" },
              { value: "post_first", label: "Create by POST first" },
            ]}
          />
        </div>

        <section className="space-y-3">
          <h4 className="text-lg font-semibold text-stone-900 dark:text-white">DICOM Tag Compatibility</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SettingField
              label="Specific Character Set"
              type="select"
              value={form.mwl_specific_character_set}
              onChange={(value) => {
                setForm((prev) => ({ ...prev, mwl_specific_character_set: value }));
                setDirty(true);
              }}
              options={CHARACTER_SET_OPTIONS}
            />
            <SettingField
              label="Patient ID source"
              type="select"
              value={form.mwl_patient_id_source}
              onChange={(value) => {
                setForm((prev) => ({ ...prev, mwl_patient_id_source: value }));
                setDirty(true);
              }}
              options={[
                { value: "identifier_value", label: "Primary identifier" },
                { value: "mrn", label: "MRN" },
                { value: "national_id", label: "National ID" },
                { value: "patient_id", label: "RISpro patient ID" },
              ]}
            />
            <SettingField
              label="Patient name source"
              type="select"
              value={form.mwl_patient_name_source}
              onChange={(value) => {
                setForm((prev) => ({ ...prev, mwl_patient_name_source: value }));
                setDirty(true);
              }}
              options={[
                { value: "english_full_name", label: "English full name" },
                { value: "arabic_full_name", label: "Arabic full name" },
              ]}
            />
            <SettingField
              label="Procedure description source"
              type="select"
              value={form.mwl_procedure_description_source}
              onChange={(value) => {
                setForm((prev) => ({ ...prev, mwl_procedure_description_source: value }));
                setDirty(true);
              }}
              options={[
                { value: "exam_name_en", label: "Exam name English" },
                { value: "exam_name_ar", label: "Exam name Arabic" },
                { value: "modality_name_en", label: "Modality name English" },
                { value: "modality_name_ar", label: "Modality name Arabic" },
              ]}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Length Safeguards</h4>
          <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Tag</th>
                  <th className="px-3 py-2 text-left font-semibold">Sync</th>
                  <th className="px-3 py-2 text-left font-semibold">Max</th>
                  <th className="px-3 py-2 text-left font-semibold">Overflow</th>
                </tr>
              </thead>
              <tbody>
                {ORTHANC_TAG_FIELDS.map((field) => (
                  <tr key={field.key} className="border-t border-stone-200 dark:border-stone-700">
                    <td className="px-3 py-2 text-stone-800 dark:text-stone-100">{field.label}</td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={enabledTags[field.key] !== false}
                        onChange={(event) => updateJsonMap(
                          "mwl_enabled_tags_json",
                          field.key,
                          event.target.checked ? null : false,
                          enabledTags
                        )}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        value={tagLimits[field.key] || field.defaultMax}
                        onChange={(event) => {
                          const parsed = Number(event.target.value);
                          updateJsonMap(
                            "mwl_tag_limits_json",
                            field.key,
                            Number.isInteger(parsed) && parsed > 0 && parsed !== field.defaultMax ? parsed : null,
                            tagLimits
                          );
                        }}
                        className="w-24 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={overflowPolicies[field.key] || field.defaultPolicy}
                        onChange={(event) => updateJsonMap(
                          "mwl_overflow_policy_json",
                          field.key,
                          event.target.value === field.defaultPolicy ? null : event.target.value as OverflowPolicy,
                          overflowPolicies
                        )}
                        className="w-full px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
                      >
                        {OVERFLOW_POLICY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h5 className="text-sm font-semibold text-stone-900 dark:text-white">Advanced Optional Tags</h5>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => {
                  setForm((prev) => ({
                    ...prev,
                    mwl_extra_tags_json: jsonStringify([...extraTags, { tag: "", vr: "LO", value: "", policy: "reject" }]),
                  }));
                  setDirty(true);
                }}
              >
                Add Tag
              </button>
            </div>
            {extraTags.length === 0 ? (
              <p className="text-xs text-stone-500 dark:text-stone-400">No advanced tags configured.</p>
            ) : (
              <div className="space-y-2">
                {extraTags.map((extraTag, index) => (
                  <div key={`${index}-${extraTag.tag}`} className="grid grid-cols-1 md:grid-cols-[1fr_90px_1.5fr_110px_130px_auto] gap-2 items-end">
                    <SettingField label="Tag" value={extraTag.tag || ""} onChange={(value) => updateExtraTag(index, { tag: value })} placeholder="RequestedProcedureDescription" />
                    <SettingField
                      label="VR"
                      type="select"
                      value={extraTag.vr || "LO"}
                      onChange={(value) => updateExtraTag(index, { vr: value as DicomVr })}
                      options={DICOM_VR_OPTIONS.map((vr) => ({ value: vr, label: vr }))}
                    />
                    <SettingField label="Value" value={extraTag.value || ""} onChange={(value) => updateExtraTag(index, { value })} />
                    <SettingField
                      label="Max"
                      type="number"
                      value={extraTag.maxLength ? String(extraTag.maxLength) : ""}
                      onChange={(value) => updateExtraTag(index, { maxLength: value ? Number(value) : undefined })}
                    />
                    <SettingField
                      label="Policy"
                      type="select"
                      value={extraTag.policy || "reject"}
                      onChange={(value) => updateExtraTag(index, { policy: value as OverflowPolicy })}
                      options={OVERFLOW_POLICY_OPTIONS}
                    />
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        setForm((prev) => ({ ...prev, mwl_extra_tags_json: jsonStringify(extraTags.filter((_, itemIndex) => itemIndex !== index)) }));
                        setDirty(true);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

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
        {orthancProbe && (
          <div
            className={`p-3 rounded-lg border text-xs ${
              orthancProbe.ok
                ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
            }`}
          >
            <p>Probe: {orthancProbe.ok ? "reachable" : "failed"}</p>
            <p>Base URL: {orthancProbe.baseUrl || "(empty)"}</p>
            <p>Orthanc Version: {orthancProbe.orthancVersion || "(unknown)"}</p>
            <p>Worklists Route: {orthancProbe.worklistsRouteReachable ? "reachable" : "not reachable"}</p>
            {orthancProbe.error && <p>Error: {orthancProbe.error}</p>}
          </div>
        )}
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
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Recent Failures</h4>
        {recentOutboxFailures.length === 0 ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">No recent outbox failures.</p>
        ) : (
          <div className="space-y-2">
            {recentOutboxFailures.map((item) => (
              <div
                key={`outbox-failure-${item.bookingId}-${item.updatedAt}`}
                className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-xs"
              >
                <p className="font-semibold text-red-700 dark:text-red-300">
                  Booking #{item.bookingId} - {item.operation}
                </p>
                <p className="text-red-700 dark:text-red-300">Attempts: {item.attemptCount}</p>
                <p className="text-red-700 dark:text-red-300 break-all">Error: {item.lastError || "(empty)"}</p>
                <p className="text-red-600 dark:text-red-400">Next retry: {item.nextAttemptAt || "n/a"}</p>
              </div>
            ))}
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
            disabled={reconcileMutation.isPending || resetWindowMutation.isPending}
            onClick={() => reconcileMutation.mutate({ apply: false })}
          >
            {reconcileMutation.isPending ? "Running..." : "Dry Run Reconciliation"}
          </button>
          <button
            type="button"
            className="btn-primary text-sm disabled:opacity-50"
            disabled={reconcileMutation.isPending || resetWindowMutation.isPending}
            onClick={() => reconcileMutation.mutate({ apply: true })}
          >
            {reconcileMutation.isPending ? "Applying..." : "Reconcile + Re-enqueue"}
          </button>
          <button
            type="button"
            className="btn-secondary text-sm disabled:opacity-50"
            disabled={reconcileMutation.isPending || resetWindowMutation.isPending}
            onClick={() => resetWindowMutation.mutate()}
          >
            {resetWindowMutation.isPending ? "Resetting..." : "Delete in Window + Resync"}
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
