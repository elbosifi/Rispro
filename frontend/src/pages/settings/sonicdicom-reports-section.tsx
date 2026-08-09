import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import {
  fetchSonicDicomSettings,
  saveSettings,
  testSonicDicomSqlReadiness,
  type SonicDicomSqlReadinessResponse,
} from "@/lib/api-hooks";
import { ApiError } from "@/lib/api-client";

interface SonicDicomReportsSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

type SonicSettings = Record<string, string | boolean | number | string[] | number[]>;

const DEFAULTS: SonicSettings = {
  sonicDicomReportsEnabled: false,
  sonicDicomReadinessMode: "sql_server",
  sonicDicomPublicBaseUrl: "https://ris.nccb.com.ly/viewer",
  sonicDicomLocalBaseUrl: "",
  sonicDicomPublicReportViewerUrlTemplate: "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomPublicPdfUrlTemplate: "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomPublicImageViewerUrlTemplate: "{{publicBaseUrl}}/#/viewer?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}",
  sonicDicomInternalBaseUrl: "",
  sonicDicomReportViewerUsername: "patient",
  sonicDicomReportViewerPassword: "patient",
  sonicDicomReportLookupKey: "accession_number",
  sonicDicomSearchMode: "auto",
  sonicDicomTimeoutMs: 8000,
  sonicDicomStatusCacheTtlSeconds: 60,
  sonicDicomVerifyTls: true,
  allowPublicFallbackForStatusCheck: false,
  auditPatientReportAccess: true,
  auditReportStatusChecks: true,
  sonicDicomSqlEnabled: false,
  sonicDicomSqlServer: "",
  sonicDicomSqlUsername: "",
  sonicDicomSqlPassword: "",
  sonicDicomSqlEncrypt: true,
  sonicDicomSqlTrustServerCertificate: false,
  sonicDicomSqlTimeoutMs: 8000,
  sonicDicomDicomDatabaseName: "dicom",
  sonicDicomReportDatabaseName: "report",
  sonicDicomSqlFinalStatusCodes: [6],
  sonicDicomSqlDraftStatusCodes: [1],
};

type SonicSettingsFormOverride = {
  baseUpdatedAt: number;
  value: SonicSettings;
};

function normalize(raw: Record<string, unknown>): SonicSettings {
  return { ...DEFAULTS, ...(raw || {}) } as SonicSettings;
}

function parseCodeList(value: string): number[] {
  return value
    .split(/[\n,]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item));
}

function formatCodeList(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : "";
}

function isValidUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function SonicDicomReportsSection({ onReAuthRequired }: SonicDicomReportsSectionProps) {
  const queryClient = useQueryClient();
  const { data, dataUpdatedAt, isLoading, error } = useQuery({
    queryKey: ["settings", "sonicdicom_reports"],
    queryFn: () => fetchSonicDicomSettings(),
  });
  const [formOverride, setFormOverride] = useState<SonicSettingsFormOverride | null>(null);
  const serverForm = normalize(data ?? {});
  const form =
    formOverride?.baseUpdatedAt === dataUpdatedAt
      ? formOverride.value
      : serverForm;
  const setForm: Dispatch<SetStateAction<SonicSettings>> = (nextForm) => {
    setFormOverride((currentOverride) => {
      const currentForm =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverForm;
      return {
        baseUpdatedAt: dataUpdatedAt,
        value: typeof nextForm === "function" ? nextForm(currentForm) : nextForm,
      };
    });
  };
  const [message, setMessage] = useState("");
  const [testAccessionNumber, setTestAccessionNumber] = useState("");
  const [testReportNo, setTestReportNo] = useState("");
  const [testResult, setTestResult] = useState<SonicDicomSqlReadinessResponse | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: SonicSettings) =>
      saveSettings("sonicdicom_reports", {
        entries: [{ key: "config", value: payload }],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "sonicdicom_reports"] });
      setMessage("SonicDICOM report settings saved.");
    },
    onError: (err) => {
      const status = err instanceof ApiError ? err.status : undefined;
      const msg = err instanceof Error ? err.message : "";
      if (status === 401 || status === 403 || msg.includes("re-authentication") || msg.includes("403")) {
        onReAuthRequired(["settings", "sonicdicom_reports"]);
        return;
      }
      setMessage(msg || "Failed to save settings.");
    },
  });

  const sqlTestMutation = useMutation({
    mutationFn: (mode: "sql_connection" | "accession_to_study" | "report_status" | "full_readiness") =>
      testSonicDicomSqlReadiness({
        mode,
        accessionNumber: testAccessionNumber.trim() || undefined,
        reportNo: testReportNo.trim() || undefined,
      }),
    onSuccess: (result) => {
      setTestResult(result);
      setMessage(`SQL test completed: ${result.normalizedState}.`);
    },
    onError: (err) => {
      const status = err instanceof ApiError ? err.status : undefined;
      const msg = err instanceof Error ? err.message : "";
      if (status === 401 || status === 403 || msg.includes("re-authentication") || msg.includes("403")) {
        onReAuthRequired(["settings", "sonicdicom_reports"]);
        return;
      }
      setTestResult(null);
      setMessage(msg || "SQL test failed.");
    },
  });

  const setValue = (key: string, value: SonicSettings[string]) => setForm((current) => ({ ...current, [key]: value }));

  const testPublicTemplate = () => {
    const baseUrl = String(form.sonicDicomPublicBaseUrl || "");
    const template = String(form.sonicDicomPublicReportViewerUrlTemplate || "");
    if (!isValidUrl(baseUrl)) {
      setMessage("Public SonicDICOM base URL is malformed.");
      return;
    }
    if (!template.includes("{{publicBaseUrl}}") || !template.includes("{{username}}") || !template.includes("{{password}}")) {
      setMessage("Public report template is missing required placeholders.");
      return;
    }
    setMessage("Public patient-facing report URL template looks valid.");
  };

  if (isLoading) return <p className="text-sm text-stone-500">Loading SonicDICOM report settings...</p>;
  if (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    const msg = error instanceof Error ? error.message : "";
    if (status === 401 || status === 403 || msg.includes("re-authentication") || msg.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "sonicdicom_reports"])} />;
    }
    return <p className="text-sm text-red-700">Failed to load SonicDICOM report settings.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        SQL Server is the active readiness authority in production mode. Patient report and image links use the SonicDICOM browser URL selected according to how RISpro was accessed.
      </div>

      <FieldCard title="SonicDICOM Browser URLs">
        <Input label="Public SonicDICOM browser URL" value={String(form.sonicDicomPublicBaseUrl ?? "")} onChange={(value) => setValue("sonicDicomPublicBaseUrl", value)} />
        <p className="text-xs text-slate-600">Used when RISpro is accessed through its public/domain address.</p>
        <Input label="Local SonicDICOM browser URL" value={String(form.sonicDicomLocalBaseUrl ?? "")} onChange={(value) => setValue("sonicDicomLocalBaseUrl", value)} />
        <p className="text-xs text-slate-600">Used when RISpro is accessed through a local IP address. If empty, the public URL is used.</p>
        <Textarea label="Public report viewer URL template" value={String(form.sonicDicomPublicReportViewerUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomPublicReportViewerUrlTemplate", value)} />
        <Textarea label="Public PDF URL template" value={String(form.sonicDicomPublicPdfUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomPublicPdfUrlTemplate", value)} />
        <Textarea label="Public image viewer URL template" value={String(form.sonicDicomPublicImageViewerUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomPublicImageViewerUrlTemplate", value)} />
        <button type="button" onClick={testPublicTemplate} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Test public report URL template</button>
      </FieldCard>

      <FieldCard title="Readiness Mode">
        <Toggle label="Enable SonicDICOM report integration" checked={Boolean(form.sonicDicomReportsEnabled)} onChange={(checked) => setValue("sonicDicomReportsEnabled", checked)} />
        <Select
          label="Readiness mode"
          value={String(form.sonicDicomReadinessMode ?? "sql_server")}
          options={["sql_server", "api (legacy diagnostic)", "html_scrape (legacy diagnostic)"]}
          onChange={(value) => setValue("sonicDicomReadinessMode", value.startsWith("api") ? "api" : value.startsWith("html_scrape") ? "html_scrape" : "sql_server")}
        />
        <p className="text-xs text-slate-600">
          `sql_server` is the production mode. `api` and `html_scrape` are legacy diagnostic modes and are not recommended for finality.
        </p>
      </FieldCard>

      <FieldCard title="SQL Server Readiness">
        <Toggle label="Enable SQL readiness lookup" checked={Boolean(form.sonicDicomSqlEnabled)} onChange={(checked) => setValue("sonicDicomSqlEnabled", checked)} />
        <Input label="SQL Server host" value={String(form.sonicDicomSqlServer ?? "")} onChange={(value) => setValue("sonicDicomSqlServer", value)} />
        <Input label="SQL username" value={String(form.sonicDicomSqlUsername ?? "")} onChange={(value) => setValue("sonicDicomSqlUsername", value)} />
        <Input label="SQL password" type="password" value={String(form.sonicDicomSqlPassword ?? "")} onChange={(value) => setValue("sonicDicomSqlPassword", value)} />
        <Toggle label="Encrypt SQL connection" checked={Boolean(form.sonicDicomSqlEncrypt)} onChange={(checked) => setValue("sonicDicomSqlEncrypt", checked)} />
        <Toggle label="Trust server certificate" checked={Boolean(form.sonicDicomSqlTrustServerCertificate)} onChange={(checked) => setValue("sonicDicomSqlTrustServerCertificate", checked)} />
        <Input label="SQL timeout (ms)" type="number" value={String(form.sonicDicomSqlTimeoutMs ?? 8000)} onChange={(value) => setValue("sonicDicomSqlTimeoutMs", Number(value))} />
        <Input label="DICOM database name" value={String(form.sonicDicomDicomDatabaseName ?? "dicom")} onChange={(value) => setValue("sonicDicomDicomDatabaseName", value)} />
        <Input label="Report database name" value={String(form.sonicDicomReportDatabaseName ?? "report")} onChange={(value) => setValue("sonicDicomReportDatabaseName", value)} />
        <Input
          label="Final status codes"
          value={formatCodeList(form.sonicDicomSqlFinalStatusCodes)}
          onChange={(value) => setValue("sonicDicomSqlFinalStatusCodes", parseCodeList(value))}
        />
        <Input
          label="Draft status codes"
          value={formatCodeList(form.sonicDicomSqlDraftStatusCodes)}
          onChange={(value) => setValue("sonicDicomSqlDraftStatusCodes", parseCodeList(value))}
        />
      </FieldCard>

      <FieldCard title="SQL Readiness Tests">
        <Input label="Test accession number" value={testAccessionNumber} onChange={setTestAccessionNumber} />
        <Input label="Test report number" value={testReportNo} onChange={setTestReportNo} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => sqlTestMutation.mutate("sql_connection")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60" disabled={sqlTestMutation.isPending}>
            Test SQL connection
          </button>
          <button type="button" onClick={() => sqlTestMutation.mutate("accession_to_study")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60" disabled={sqlTestMutation.isPending || !testAccessionNumber.trim()}>
            Test accession to StudyInstanceUID
          </button>
          <button type="button" onClick={() => sqlTestMutation.mutate("report_status")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60" disabled={sqlTestMutation.isPending || !testReportNo.trim()}>
            Test report status by report number
          </button>
          <button type="button" onClick={() => sqlTestMutation.mutate("full_readiness")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60" disabled={sqlTestMutation.isPending || !testAccessionNumber.trim()}>
            Test full SQL readiness by accession number
          </button>
        </div>
        {testResult ? (
          <pre className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
{JSON.stringify(testResult, null, 2)}
          </pre>
        ) : null}
      </FieldCard>

      <button
        type="button"
        onClick={() => mutation.mutate(form)}
        className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-teal-600 px-4 py-3 text-sm font-extrabold text-white disabled:opacity-60"
        disabled={mutation.isPending}
      >
        <Save className="h-4 w-4" />
        Save
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h4 className="text-base font-extrabold text-amber-900">Re-authentication Required</h4>
      <p className="mt-1 text-sm leading-7 text-amber-800">
        Supervisor re-authentication is required before modifying SonicDICOM report settings.
      </p>
      <button type="button" onClick={onReAuthRequired} className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white">
        Re-authenticate
      </button>
    </div>
  );
}

function FieldCard(props: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-base font-extrabold text-slate-900">{props.title}</h4>
      <div className="mt-4 space-y-3">{props.children}</div>
    </div>
  );
}

function Input(props: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {props.label}
      <input
        type={props.type || "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
    </label>
  );
}

function Textarea(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {props.label}
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
      <span className="font-medium text-slate-700">{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} className="h-5 w-5 rounded border-slate-300 text-teal-600" />
    </label>
  );
}

function Select(props: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
        {props.options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
