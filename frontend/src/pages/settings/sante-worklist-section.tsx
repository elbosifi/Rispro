import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api-client";
import { fetchSettings, saveSettings } from "@/lib/api-hooks";

interface Props {
  onReAuthRequired: (key: string[]) => void;
}

type FormState = {
  enabled: string;
  mode: string;
  keep_internal_mwl_active: string;
  delivery_method: string;
  output_folder_path: string;
  file_extension: string;
  success_behavior: string;
  error_extensions: string;
  mllp_host: string;
  mllp_port: string;
  mllp_timeout_seconds: string;
  mllp_expect_ack: string;
  retry_max_attempts: string;
  retry_initial_delay_seconds: string;
  retry_max_delay_seconds: string;
  pending_import_timeout_seconds: string;
  send_only_when_patient_enters_queue: string;
  sending_application: string;
  sending_facility: string;
  receiving_application: string;
  receiving_facility: string;
  hl7_version: string;
  charset: string;
  patient_id_field: string;
  patient_name_field: string;
  procedure_code_field: string;
  procedure_description_field: string;
  scheduled_station_ae_title_default: string;
  hl7_enabled_fields_json: string;
  hl7_field_limits_json: string;
  hl7_overflow_policy_json: string;
  hl7_extra_fields_json: string;
};

type OverflowPolicy = "reject" | "truncate" | "omit";

type Hl7ExtraField = {
  segment: "MSH" | "PID" | "PV1" | "ORC" | "OBR";
  field: number;
  value: string;
  maxLength?: number;
  policy?: OverflowPolicy;
};

const CHARSET_OPTIONS = [
  { value: "UNICODE UTF-8", label: "UTF-8 (UNICODE UTF-8)" },
  { value: "ASCII", label: "ASCII" },
  { value: "8859/1", label: "Latin-1 (8859/1)" },
  { value: "ISO IR14", label: "Arabic ISO IR14" },
  { value: "UNICODE", label: "Unicode" },
];

const OVERFLOW_POLICY_OPTIONS: Array<{ value: OverflowPolicy; label: string }> = [
  { value: "reject", label: "Reject" },
  { value: "truncate", label: "Truncate" },
  { value: "omit", label: "Omit" },
];

const HL7_SEGMENTS: Hl7ExtraField["segment"][] = ["MSH", "PID", "PV1", "ORC", "OBR"];

const HL7_FIELD_ROWS: Array<{ key: string; label: string; defaultMax: number; defaultPolicy: OverflowPolicy }> = [
  { key: "PID.3", label: "PID-3 Patient ID", defaultMax: 64, defaultPolicy: "reject" },
  { key: "PID.5", label: "PID-5 Patient Name", defaultMax: 64, defaultPolicy: "reject" },
  { key: "PID.7", label: "PID-7 Birth Date", defaultMax: 8, defaultPolicy: "reject" },
  { key: "PID.8", label: "PID-8 Sex", defaultMax: 1, defaultPolicy: "reject" },
  { key: "PID.11", label: "PID-11 Address", defaultMax: 64, defaultPolicy: "truncate" },
  { key: "PID.13", label: "PID-13 Phone", defaultMax: 40, defaultPolicy: "truncate" },
  { key: "ORC.2", label: "ORC-2 Placer Order", defaultMax: 64, defaultPolicy: "reject" },
  { key: "ORC.5", label: "ORC-5 Order Status", defaultMax: 8, defaultPolicy: "reject" },
  { key: "ORC.15", label: "ORC-15 Scheduled Date/Time", defaultMax: 14, defaultPolicy: "reject" },
  { key: "OBR.4", label: "OBR-4 Procedure Code/Text", defaultMax: 128, defaultPolicy: "truncate" },
  { key: "OBR.13", label: "OBR-13 Contrast Text", defaultMax: 64, defaultPolicy: "truncate" },
  { key: "OBR.20", label: "OBR-20 Description", defaultMax: 64, defaultPolicy: "truncate" },
  { key: "OBR.21", label: "OBR-21 Scheduled Station AE", defaultMax: 16, defaultPolicy: "reject" },
  { key: "OBR.31", label: "OBR-31 Comment", defaultMax: 64, defaultPolicy: "truncate" },
];

type SummaryResponse = {
  ok: boolean;
  summary: {
    outboxStatus: Array<{ status: string; count: number }>;
    recentFailures: Array<{
      id: number;
      bookingId: number | null;
      accessionNumber: string | null;
      status: string;
      attemptCount: number;
      lastError: string;
      updatedAt: string;
    }>;
    settings: {
      enabled: boolean;
      mode: string;
      deliveryMethod: string;
      sendOnlyWhenPatientEntersQueue: boolean;
      outputFolderPath: string;
      allowedBasePaths: string[];
      hostOutboxHint: string;
      windowsShareSourceHint: string;
      mllp: {
        host: string;
        port: number;
        timeoutSeconds: number;
        expectAck: boolean;
      };
    };
  };
};

const DEFAULT_FORM: FormState = {
  enabled: "false",
  mode: "disabled",
  keep_internal_mwl_active: "true",
  delivery_method: "file_drop",
  output_folder_path: "",
  file_extension: ".hl7",
  success_behavior: "auto_detect",
  error_extensions: ".ERR,.err",
  mllp_host: "",
  mllp_port: "",
  mllp_timeout_seconds: "10",
  mllp_expect_ack: "true",
  retry_max_attempts: "5",
  retry_initial_delay_seconds: "30",
  retry_max_delay_seconds: "300",
  pending_import_timeout_seconds: "900",
  send_only_when_patient_enters_queue: "false",
  sending_application: "RISPRO",
  sending_facility: "RISPRO",
  receiving_application: "SANTE_WORKLIST",
  receiving_facility: "SANTE",
  hl7_version: "2.3.1",
  charset: "UNICODE UTF-8",
  patient_id_field: "identifier_value",
  patient_name_field: "english_full_name",
  procedure_code_field: "exam_type_code",
  procedure_description_field: "exam_name_en",
  scheduled_station_ae_title_default: "RISPRO_MWL",
  hl7_enabled_fields_json: "{}",
  hl7_field_limits_json: "{}",
  hl7_overflow_policy_json: "{}",
  hl7_extra_fields_json: "[]",
};

function toForm(settings: Record<string, string> | null | undefined): FormState {
  return { ...DEFAULT_FORM, ...(settings || {}) };
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

export default function SanteWorklistSection({ onReAuthRequired }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["settings", "sante_worklist_hl7"],
    queryFn: () => fetchSettings("sante_worklist_hl7"),
  });

  const summaryQuery = useQuery({
    queryKey: ["dicom", "sante-hl7", "summary"],
    queryFn: () => api<SummaryResponse>("/dicom/sante-hl7/summary"),
  });

  useEffect(() => {
    if (!settingsQuery.data) return;
    setForm(toForm(settingsQuery.data as Record<string, string>));
    setDirty(false);
  }, [settingsQuery.data]);

  const setValue = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveSettings("sante_worklist_hl7", {
        entries: Object.entries(form).map(([key, value]) => ({ key, value: { value } })),
      }),
    onSuccess: async () => {
      setMessage("Sante Worklist HL7 settings saved.");
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["settings", "sante_worklist_hl7"] });
      await queryClient.invalidateQueries({ queryKey: ["dicom", "sante-hl7", "summary"] });
    },
    onError: (error: Error) => setMessage(error.message || "Failed to save Sante settings."),
  });

  const folderTestMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; path: string; message: string }>("/dicom/sante-hl7/test-folder", {
        method: "POST",
        body: JSON.stringify({ outputFolderPath: form.output_folder_path }),
      }),
    onSuccess: (result) => setMessage(`${result.message} ${result.path}`),
    onError: (error: Error) => setMessage(error.message || "Folder test failed."),
  });

  const testFileMutation = useMutation({
    mutationFn: () => api<{ ok: boolean; outboxId: number; synthetic: boolean }>("/dicom/sante-hl7/test-file", { method: "POST" }),
    onSuccess: async (result) => {
      setMessage(`Synthetic test HL7 file queued. Outbox #${result.outboxId}.`);
      await queryClient.invalidateQueries({ queryKey: ["dicom", "sante-hl7", "summary"] });
    },
    onError: (error: Error) => setMessage(error.message || "Failed to queue synthetic test file."),
  });

  const reconcileMutation = useMutation({
    mutationFn: (apply: boolean) =>
      api<{ ok: boolean; result: { missing: number[]; failed: number[]; pendingTimeout: number[]; repaired: number[] } }>(
        "/dicom/sante-hl7/reconcile",
        {
          method: "POST",
          body: JSON.stringify({ dateFrom, dateTo, apply }),
        }
      ),
    onSuccess: async (response, apply) => {
      const total = response.result.missing.length + response.result.failed.length + response.result.pendingTimeout.length;
      setMessage(`Sante reconciliation complete. Candidates: ${total}.${apply ? ` Requeued: ${response.result.repaired.length}.` : ""}`);
      await queryClient.invalidateQueries({ queryKey: ["dicom", "sante-hl7", "summary"] });
    },
    onError: (error: Error) => setMessage(error.message || "Sante reconciliation failed."),
  });

  const forceResyncMutation = useMutation({
    mutationFn: () =>
      api<{
        ok: boolean;
        result: {
          deletedOutboxCount: number;
          deletedSyncCount: number;
          selectedBookingIds: number[];
          enqueuedBookingIds: number[];
          skippedBookingIds: number[];
        };
      }>("/dicom/sante-hl7/force-resync", {
        method: "POST",
        body: JSON.stringify({ dateFrom, dateTo }),
      }),
    onSuccess: async (response) => {
      setMessage(
        `Sante force resync complete. Cleared ${response.result.deletedOutboxCount} outbox rows and ${response.result.deletedSyncCount} sync rows. Requeued ${response.result.enqueuedBookingIds.length} of ${response.result.selectedBookingIds.length} active bookings.`
      );
      await queryClient.invalidateQueries({ queryKey: ["dicom", "sante-hl7", "summary"] });
    },
    onError: (error: Error) => setMessage(error.message || "Sante force resync failed."),
  });

  const retryMutation = useMutation({
    mutationFn: (outboxId: number) => api(`/dicom/sante-hl7/retry/${outboxId}`, { method: "POST" }),
    onSuccess: async () => {
      setMessage("Retry queued. A new delivery attempt will be created.");
      await queryClient.invalidateQueries({ queryKey: ["dicom", "sante-hl7", "summary"] });
    },
    onError: (error: Error) => setMessage(error.message || "Retry failed."),
  });

  const error = settingsQuery.error || summaryQuery.error;
  if (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    if (status === 401 || status === 403 || (error as Error).message.includes("re-authentication")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "sante_worklist_hl7"])} />;
    }
    return <QueryError message={(error as Error).message} />;
  }

  if (settingsQuery.isLoading) {
    return <p className="text-sm text-stone-500">Loading Sante Worklist settings...</p>;
  }

  const summary = summaryQuery.data?.summary;
  const isFileDrop = form.delivery_method !== "mllp";
  const syntheticTestLabel = form.delivery_method === "mllp" ? "Send Synthetic Test HL7 via MLLP" : "Send Synthetic Test HL7";
  const enabledFields = parseJsonObject<Record<string, boolean>>(form.hl7_enabled_fields_json, {});
  const fieldLimits = parseJsonObject<Record<string, number>>(form.hl7_field_limits_json, {});
  const overflowPolicies = parseJsonObject<Record<string, OverflowPolicy>>(form.hl7_overflow_policy_json, {});
  const extraFields = parseJsonArray<Hl7ExtraField>(form.hl7_extra_fields_json, []);

  const updateJsonMap = <T extends string | number | boolean>(
    key: keyof FormState,
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
    setValue(key, jsonStringify(next));
  };

  const updateExtraField = (index: number, patch: Partial<Hl7ExtraField>) => {
    const next = extraFields.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    setValue("hl7_extra_fields_json", jsonStringify(next));
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-700 text-sm">
          {message}
        </div>
      )}

      {isFileDrop && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
          The folder path must be visible to the RISpro backend/container, not this browser.
        </div>
      )}

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Sante Worklist Server HL7</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Enabled" type="select" value={form.enabled} onChange={(value) => setValue("enabled", value)} options={[["false", "Disabled"], ["true", "Enabled"]]} />
          <Field label="Mode" type="select" value={form.mode} onChange={(value) => setValue("mode", value)} options={[["disabled", "Disabled"], ["shadow", "Shadow"], ["primary_with_internal_fallback", "Primary with internal fallback"], ["sante_only", "Sante only"]]} />
          <Field label="Keep internal MWL active" type="select" value={form.keep_internal_mwl_active} onChange={() => setValue("keep_internal_mwl_active", "true")} options={[["true", "Always true for rollout"]]} />
          <Field label="Delivery method" type="select" value={form.delivery_method} onChange={(value) => setValue("delivery_method", value)} options={[["file_drop", "File drop"], ["mllp", "MLLP"]]} />
          <Field label="Send only when patient enters queue" type="select" value={form.send_only_when_patient_enters_queue} onChange={(value) => setValue("send_only_when_patient_enters_queue", value)} options={[["false", "No"], ["true", "Yes"]]} />
          <Field label="Retry max attempts" type="number" value={form.retry_max_attempts} onChange={(value) => setValue("retry_max_attempts", value)} />
          <Field label="Initial retry delay seconds" type="number" value={form.retry_initial_delay_seconds} onChange={(value) => setValue("retry_initial_delay_seconds", value)} />
          <Field label="Max retry delay seconds" type="number" value={form.retry_max_delay_seconds} onChange={(value) => setValue("retry_max_delay_seconds", value)} />
        </div>
      </section>

      {isFileDrop ? (
        <section className="space-y-3">
          <h4 className="text-lg font-semibold text-stone-900 dark:text-white">File Drop Delivery</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Output folder path" value={form.output_folder_path} onChange={(value) => setValue("output_folder_path", value)} placeholder="storage/sante-hl7-output" />
            <Field label="File extension" type="select" value={form.file_extension} onChange={(value) => setValue("file_extension", value)} options={[[".hl7", ".hl7"], [".txt", ".txt"]]} />
            <Field label="Success behavior" type="select" value={form.success_behavior} onChange={(value) => setValue("success_behavior", value)} options={[["auto_detect", "Auto-detect"], ["deleted", "Deleted"], ["don", ".DON/.don"]]} />
            <Field label="Error extensions" value={form.error_extensions} onChange={(value) => setValue("error_extensions", value)} />
            <Field label="Pending import timeout seconds" type="number" value={form.pending_import_timeout_seconds} onChange={(value) => setValue("pending_import_timeout_seconds", value)} />
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <h4 className="text-lg font-semibold text-stone-900 dark:text-white">MLLP Delivery</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="MLLP host" value={form.mllp_host} onChange={(value) => setValue("mllp_host", value)} placeholder="192.168.1.50" />
            <Field label="MLLP port" type="number" value={form.mllp_port} onChange={(value) => setValue("mllp_port", value)} placeholder="2575" />
            <Field label="Timeout seconds" type="number" value={form.mllp_timeout_seconds} onChange={(value) => setValue("mllp_timeout_seconds", value)} />
            <Field label="Expect ACK" type="select" value={form.mllp_expect_ack} onChange={(value) => setValue("mllp_expect_ack", value)} options={[["true", "Yes"], ["false", "No"]]} />
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">HL7 Identity And Mapping</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Sending application" value={form.sending_application} onChange={(value) => setValue("sending_application", value)} />
          <Field label="Sending facility" value={form.sending_facility} onChange={(value) => setValue("sending_facility", value)} />
          <Field label="Receiving application" value={form.receiving_application} onChange={(value) => setValue("receiving_application", value)} />
          <Field label="Receiving facility" value={form.receiving_facility} onChange={(value) => setValue("receiving_facility", value)} />
          <Field label="HL7 version" value={form.hl7_version} onChange={(value) => setValue("hl7_version", value)} />
          <Field label="Charset" type="select" value={form.charset} onChange={(value) => setValue("charset", value)} options={CHARSET_OPTIONS.map((option) => [option.value, option.label])} />
          <Field label="Patient ID field" type="select" value={form.patient_id_field} onChange={(value) => setValue("patient_id_field", value)} options={[["identifier_value", "Primary identifier"], ["mrn", "MRN"], ["national_id", "National ID"], ["patient_id", "RISpro patient ID"]]} />
          <Field label="Patient name field" type="select" value={form.patient_name_field} onChange={(value) => setValue("patient_name_field", value)} options={[["english_full_name", "English name"], ["arabic_full_name", "Arabic name"]]} />
          <Field label="Procedure code field" type="select" value={form.procedure_code_field} onChange={(value) => setValue("procedure_code_field", value)} options={[["exam_type_code", "Exam type code"], ["modality_code", "Modality code"]]} />
          <Field label="Procedure description field" type="select" value={form.procedure_description_field} onChange={(value) => setValue("procedure_description_field", value)} options={[["exam_name_en", "Exam name English"], ["exam_name_ar", "Exam name Arabic"], ["modality_name_en", "Modality name English"], ["modality_name_ar", "Modality name Arabic"], ["modality_code", "Modality code"]]} />
          <Field label="Scheduled Station AE Title default" value={form.scheduled_station_ae_title_default} onChange={(value) => setValue("scheduled_station_ae_title_default", value)} placeholder="RISPRO_MWL" />
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">HL7 Field Mapping</h4>
        <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-800 text-stone-600 dark:text-stone-300">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Field</th>
                <th className="px-3 py-2 text-left font-semibold">Send</th>
                <th className="px-3 py-2 text-left font-semibold">Max</th>
                <th className="px-3 py-2 text-left font-semibold">Overflow</th>
              </tr>
            </thead>
            <tbody>
              {HL7_FIELD_ROWS.map((field) => (
                <tr key={field.key} className="border-t border-stone-200 dark:border-stone-700">
                  <td className="px-3 py-2 text-stone-800 dark:text-stone-100">{field.label}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={enabledFields[field.key] !== false}
                      onChange={(event) => updateJsonMap("hl7_enabled_fields_json", field.key, event.target.checked ? null : false, enabledFields)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      value={fieldLimits[field.key] || field.defaultMax}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        updateJsonMap(
                          "hl7_field_limits_json",
                          field.key,
                          Number.isInteger(parsed) && parsed > 0 && parsed !== field.defaultMax ? parsed : null,
                          fieldLimits
                        );
                      }}
                      className="w-24 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={overflowPolicies[field.key] || field.defaultPolicy}
                      onChange={(event) => updateJsonMap(
                        "hl7_overflow_policy_json",
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
            <h5 className="text-sm font-semibold text-stone-900 dark:text-white">Advanced Extra Fields</h5>
            <button type="button" className="btn-secondary text-xs" onClick={() => setValue("hl7_extra_fields_json", jsonStringify([...extraFields, { segment: "OBR", field: 27, value: "", policy: "reject" }]))}>
              Add Field
            </button>
          </div>
          {extraFields.length === 0 ? (
            <p className="text-xs text-stone-500">No advanced fields configured.</p>
          ) : (
            <div className="space-y-2">
              {extraFields.map((extraField, index) => (
                <div key={`${index}-${extraField.segment}.${extraField.field}`} className="grid grid-cols-1 md:grid-cols-[100px_100px_1.5fr_110px_130px_auto] gap-2 items-end">
                  <Field
                    label="Segment"
                    type="select"
                    value={extraField.segment || "OBR"}
                    onChange={(value) => updateExtraField(index, { segment: value as Hl7ExtraField["segment"] })}
                    options={HL7_SEGMENTS.map((segment) => [segment, segment])}
                  />
                  <Field
                    label="Field"
                    type="number"
                    value={extraField.field ? String(extraField.field) : ""}
                    onChange={(value) => updateExtraField(index, { field: Number(value) })}
                  />
                  <Field label="Value" value={extraField.value || ""} onChange={(value) => updateExtraField(index, { value })} />
                  <Field
                    label="Max"
                    type="number"
                    value={extraField.maxLength ? String(extraField.maxLength) : ""}
                    onChange={(value) => updateExtraField(index, { maxLength: value ? Number(value) : undefined })}
                  />
                  <Field
                    label="Policy"
                    type="select"
                    value={extraField.policy || "reject"}
                    onChange={(value) => updateExtraField(index, { policy: value as OverflowPolicy })}
                    options={OVERFLOW_POLICY_OPTIONS.map((option) => [option.value, option.label])}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setValue("hl7_extra_fields_json", jsonStringify(extraFields.filter((_, itemIndex) => itemIndex !== index)))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? "Saving..." : "Save Sante Settings"}
        </button>
        {isFileDrop && (
          <button type="button" className="btn-secondary text-sm" onClick={() => folderTestMutation.mutate()} disabled={folderTestMutation.isPending}>
            {folderTestMutation.isPending ? "Testing..." : "Test Folder Access"}
          </button>
        )}
        <button type="button" className="btn-secondary text-sm" onClick={() => testFileMutation.mutate()} disabled={testFileMutation.isPending}>
          {testFileMutation.isPending ? "Queueing..." : syntheticTestLabel}
        </button>
      </div>

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Status</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StatusList title="Outbox Status" items={summary?.outboxStatus || []} />
          <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-700 text-xs space-y-1">
            <p>Resolved mode: {summary?.settings.mode || "unknown"}</p>
            <p>Delivery method: {summary?.settings.deliveryMethod || "file_drop"}</p>
            <p>Queue-only sending: {summary?.settings.sendOnlyWhenPatientEntersQueue ? "yes" : "no"}</p>
            {summary?.settings.deliveryMethod === "mllp" ? (
              <>
                <p>MLLP target: {summary.settings.mllp.host || "(empty)"}:{summary.settings.mllp.port || "(empty)"}</p>
                <p>MLLP timeout: {summary.settings.mllp.timeoutSeconds}s</p>
                <p>Expect ACK: {summary.settings.mllp.expectAck ? "yes" : "no"}</p>
              </>
            ) : (
              <>
                <p>Resolved folder: {summary?.settings.outputFolderPath || "(empty)"}</p>
                <p>Windows folder to share: {summary?.settings.windowsShareSourceHint || "(not provided by deployment)"}</p>
                <p>Host folder hint: {summary?.settings.hostOutboxHint || "(not provided by deployment)"}</p>
                <p>Allowed bases: {(summary?.settings.allowedBasePaths || []).join(", ") || "(none)"}</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Recent Failures</h4>
        {(summary?.recentFailures || []).length === 0 ? (
          <p className="text-xs text-stone-500">No recent Sante HL7 failures.</p>
        ) : (
          <div className="space-y-2">
            {(summary?.recentFailures || []).map((failure) => (
              <div key={failure.id} className="p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-xs">
                <p className="font-semibold">Outbox #{failure.id} {failure.accessionNumber ? `(${failure.accessionNumber})` : ""}</p>
                <p>Status: {failure.status}; attempts: {failure.attemptCount}</p>
                <p className="break-all">Error: {failure.lastError || "(empty)"}</p>
                <button className="btn-secondary text-xs mt-2" onClick={() => retryMutation.mutate(failure.id)} disabled={retryMutation.isPending}>
                  Retry Delivery
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Reconciliation</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Date from" type="date" value={dateFrom} onChange={setDateFrom} />
          <Field label="Date to" type="date" value={dateTo} onChange={setDateTo} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-sm" onClick={() => reconcileMutation.mutate(false)} disabled={!dateFrom || !dateTo || reconcileMutation.isPending}>
            Dry Run Reconciliation
          </button>
          <button className="btn-primary text-sm" onClick={() => reconcileMutation.mutate(true)} disabled={!dateFrom || !dateTo || reconcileMutation.isPending}>
            Reconcile + Requeue
          </button>
          <button
            className="btn-secondary text-sm border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
            onClick={() => {
              const ok = window.confirm("Delete Sante HL7 tracking for active bookings in this date range and force a fresh resync?");
              if (ok) forceResyncMutation.mutate();
            }}
            disabled={!dateFrom || !dateTo || forceResyncMutation.isPending}
          >
            {forceResyncMutation.isPending ? "Force Resyncing..." : "Delete All + Force Resync"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({
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
  type?: "text" | "number" | "select" | "date";
  placeholder?: string;
  options?: Array<[string, string]>;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium text-stone-700 dark:text-stone-300">{label}</span>
      {type === "select" ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600">
          {(options || []).map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>{optionLabel}</option>
          ))}
        </select>
      ) : (
        <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" />
      )}
    </label>
  );
}

function StatusList({ title, items }: { title: string; items: Array<{ status: string; count: number }> }) {
  return (
    <div className="p-3 rounded-lg border border-stone-200 dark:border-stone-700">
      <p className="font-semibold text-sm mb-2">{title}</p>
      {items.length === 0 ? <p className="text-xs text-stone-500">No records.</p> : items.map((item) => (
        <div key={item.status} className="flex justify-between text-xs">
          <span>{item.status}</span>
          <span className="font-mono">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Re-authentication required</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">Please re-authenticate to manage Sante Worklist settings.</p>
      <button onClick={onReAuthRequired} className="btn-primary text-sm">Re-authenticate</button>
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">Failed to load Sante settings</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}
