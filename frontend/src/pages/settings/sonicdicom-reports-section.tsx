import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { fetchSonicDicomSettings, saveSettings, testSonicDicomLookup, type SonicDicomLookupDebugResponse } from "@/lib/api-hooks";

type SonicSettings = Record<string, string | boolean | number | string[]>;

const DEFAULTS: SonicSettings = {
  sonicDicomReportsEnabled: false,
  sonicDicomPublicBaseUrl: "https://ris.nccb.com.ly/viewer",
  sonicDicomPublicReportViewerUrlTemplate: "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomPublicPdfUrlTemplate: "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomInternalBaseUrl: "",
  sonicDicomInternalSearchUrlTemplate: "",
  sonicDicomInternalReportViewerUrlTemplate: "{{internalBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomInternalPdfUrlTemplate: "{{internalBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
  sonicDicomReportViewerUsername: "patient",
  sonicDicomReportViewerPassword: "patient",
  sonicDicomReportLookupKey: "accession_number",
  sonicDicomSearchMode: "auto",
  sonicDicomFinalStatusTerms: ["Final", "Signed", "Approved"],
  sonicDicomDraftStatusTerms: ["Draft", "Preliminary", "In review", "Unsigned"],
  sonicDicomNoReportStatusTerms: ["No report", "Not found", "Empty", "No matching report"],
  sonicDicomUnavailableStatusTerms: ["Unavailable", "Timeout", "Login failed"],
  sonicDicomTimeoutMs: 8000,
  sonicDicomStatusCacheTtlSeconds: 60,
  sonicDicomVerifyTls: true,
  allowPublicFallbackForStatusCheck: false,
  auditPatientReportAccess: true,
  auditReportStatusChecks: true,
};

function normalize(raw: Record<string, unknown>): SonicSettings {
  return { ...DEFAULTS, ...(raw || {}) } as SonicSettings;
}

function asTerms(value: unknown): string {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function fromTerms(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function isValidUrl(value: unknown): boolean {
  try {
    new URL(String(value || ""));
    return true;
  } catch {
    return false;
  }
}

function hasLookupToken(template: string): boolean {
  return template.includes("{{accessionNumber}}") || template.includes("{{studyInstanceUid}}");
}

export default function SonicDicomReportsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "sonicdicom_reports"],
    queryFn: () => fetchSonicDicomSettings(),
  });
  const [form, setForm] = useState<SonicSettings>(DEFAULTS);
  const [message, setMessage] = useState("");
  const [testAccessionNumber, setTestAccessionNumber] = useState("");
  const [testStudyInstanceUid, setTestStudyInstanceUid] = useState("");
  const [testResult, setTestResult] = useState<SonicDicomLookupDebugResponse | null>(null);

  useEffect(() => {
    if (data) setForm(normalize(data));
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: SonicSettings) =>
      saveSettings("sonicdicom_reports", {
        entries: [{ key: "config", value: payload }],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "sonicdicom_reports"] });
      setMessage("SonicDICOM report settings saved.");
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "Failed to save settings."),
  });
  const testLookupMutation = useMutation({
    mutationFn: () =>
      testSonicDicomLookup({
        accessionNumber: testAccessionNumber.trim(),
        studyInstanceUid: testStudyInstanceUid.trim() || undefined,
        lookupKey: String(form.sonicDicomReportLookupKey || "accession_number") as
          | "accession_number"
          | "study_instance_uid"
          | "prefer_study_uid_then_accession"
          | "prefer_accession_then_study_uid",
      }),
    onSuccess: (result) => {
      setTestResult(result);
      setMessage(`Lookup test completed: ${result.state}.`);
    },
    onError: (err) => {
      setTestResult(null);
      setMessage(err instanceof Error ? err.message : "Lookup test failed.");
    },
  });

  const setValue = (key: string, value: SonicSettings[string]) => setForm((current) => ({ ...current, [key]: value }));
  const testPublicTemplate = () => {
    const template = String(form.sonicDicomPublicReportViewerUrlTemplate || form.sonicDicomPublicPdfUrlTemplate || "");
    if (!isValidUrl(form.sonicDicomPublicBaseUrl)) {
      setMessage("Public SonicDICOM base URL is missing or malformed.");
    } else if (!template.includes("{{publicBaseUrl}}") || !template.includes("{{username}}") || !template.includes("{{password}}") || !hasLookupToken(template)) {
      setMessage("Public report template must include publicBaseUrl, username, password, and a lookup token.");
    } else {
      setMessage("Public report URL template is valid. Password values remain hidden.");
    }
  };
  const testInternalSettings = () => {
    const baseUrl = String(form.sonicDicomInternalBaseUrl || "").trim();
    const fallbackAllowed = Boolean(form.allowPublicFallbackForStatusCheck);
    const effectiveBaseUrl = baseUrl || (fallbackAllowed ? String(form.sonicDicomPublicBaseUrl || "") : "");
    const template = String(form.sonicDicomInternalSearchUrlTemplate || form.sonicDicomInternalReportViewerUrlTemplate || form.sonicDicomInternalPdfUrlTemplate || "");
    if (!effectiveBaseUrl) {
      setMessage("Internal SonicDICOM base URL is required unless public fallback is enabled.");
    } else if (!isValidUrl(effectiveBaseUrl)) {
      setMessage("Effective status-check base URL is malformed.");
    } else if (!template || (!template.includes("{{internalBaseUrl}}") && !template.includes("{{publicBaseUrl}}")) || !hasLookupToken(template)) {
      setMessage("Internal status template must include a base URL token and a lookup token.");
    } else {
      setMessage("Internal status-check settings are structurally valid. Use a real lookup endpoint to confirm searchable status content.");
    }
  };
  const testLookupTemplate = (lookup: "accessionNumber" | "studyInstanceUid") => {
    const template = String(form.sonicDicomInternalSearchUrlTemplate || form.sonicDicomInternalReportViewerUrlTemplate || form.sonicDicomInternalPdfUrlTemplate || "");
    if (!template.includes(`{{${lookup}}}`)) {
      setMessage(`Configured internal status template does not include {{${lookup}}}.`);
    } else {
      setMessage(`${lookup === "accessionNumber" ? "Accession number" : "StudyInstanceUID"} lookup token is present in the internal status template.`);
    }
  };

  if (isLoading) return <p className="text-sm text-stone-500">Loading SonicDICOM report settings...</p>;
  if (error) return <p className="text-sm text-red-700">Failed to load SonicDICOM report settings.</p>;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Public URL settings are used only for patient redirects after RISpro confirms a final report. Internal/local URL settings are used only by the RISpro backend for status checks.
      </div>

      <FieldCard title="Public patient-facing URL">
        <Input label="Public SonicDICOM base URL" value={String(form.sonicDicomPublicBaseUrl ?? "")} onChange={(value) => setValue("sonicDicomPublicBaseUrl", value)} />
        <Textarea label="Public report viewer URL template" value={String(form.sonicDicomPublicReportViewerUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomPublicReportViewerUrlTemplate", value)} />
        <Textarea label="Public PDF URL template" value={String(form.sonicDicomPublicPdfUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomPublicPdfUrlTemplate", value)} />
        <button type="button" onClick={testPublicTemplate} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Test public report URL template</button>
      </FieldCard>

      <FieldCard title="Internal/local RISpro check URL">
        <Input label="Internal SonicDICOM base URL" value={String(form.sonicDicomInternalBaseUrl ?? "")} onChange={(value) => setValue("sonicDicomInternalBaseUrl", value)} />
        <Textarea label="Internal search URL template" value={String(form.sonicDicomInternalSearchUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomInternalSearchUrlTemplate", value)} />
        <Textarea label="Internal report viewer URL template" value={String(form.sonicDicomInternalReportViewerUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomInternalReportViewerUrlTemplate", value)} />
        <Textarea label="Internal PDF URL template" value={String(form.sonicDicomInternalPdfUrlTemplate ?? "")} onChange={(value) => setValue("sonicDicomInternalPdfUrlTemplate", value)} />
        <Toggle label="Allow fallback to public URL for status checks" checked={Boolean(form.allowPublicFallbackForStatusCheck)} onChange={(checked) => setValue("allowPublicFallbackForStatusCheck", checked)} />
        <button type="button" onClick={testInternalSettings} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Test internal connection</button>
      </FieldCard>

      <FieldCard title="Authentication and lookup">
        <Toggle label="Enable SonicDICOM report integration" checked={Boolean(form.sonicDicomReportsEnabled)} onChange={(checked) => setValue("sonicDicomReportsEnabled", checked)} />
        <Input label="Viewer username" value={String(form.sonicDicomReportViewerUsername ?? "")} onChange={(value) => setValue("sonicDicomReportViewerUsername", value)} />
        <Input label="Viewer password" type="password" value={String(form.sonicDicomReportViewerPassword ?? "")} onChange={(value) => setValue("sonicDicomReportViewerPassword", value)} />
        <Select label="Lookup key preference" value={String(form.sonicDicomReportLookupKey ?? "accession_number")} options={["accession_number", "study_instance_uid", "prefer_study_uid_then_accession", "prefer_accession_then_study_uid"]} onChange={(value) => setValue("sonicDicomReportLookupKey", value)} />
        <Select label="Search mode" value={String(form.sonicDicomSearchMode ?? "auto")} options={["auto", "api", "html_scrape"]} onChange={(value) => setValue("sonicDicomSearchMode", value)} />
        <Input label="Timeout (ms)" type="number" value={String(form.sonicDicomTimeoutMs ?? 8000)} onChange={(value) => setValue("sonicDicomTimeoutMs", Number(value))} />
        <Input label="Status cache TTL (seconds)" type="number" value={String(form.sonicDicomStatusCacheTtlSeconds ?? 60)} onChange={(value) => setValue("sonicDicomStatusCacheTtlSeconds", Number(value))} />
        <Toggle label="Verify TLS" checked={Boolean(form.sonicDicomVerifyTls)} onChange={(checked) => setValue("sonicDicomVerifyTls", checked)} />
        <button type="button" onClick={() => testLookupTemplate("accessionNumber")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Test lookup by accession number</button>
        <button type="button" onClick={() => testLookupTemplate("studyInstanceUid")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Test lookup by StudyInstanceUID</button>
        <Input label="Test accession number (manual)" value={testAccessionNumber} onChange={setTestAccessionNumber} />
        <Input label="Test StudyInstanceUID (optional)" value={testStudyInstanceUid} onChange={setTestStudyInstanceUid} />
        <button
          type="button"
          onClick={() => testLookupMutation.mutate()}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
          disabled={testLookupMutation.isPending || (!testAccessionNumber.trim() && !testStudyInstanceUid.trim())}
        >
          {testLookupMutation.isPending ? "Testing..." : "Run real lookup test"}
        </button>
        {testResult ? (
          <pre className="overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
{JSON.stringify(testResult, null, 2)}
          </pre>
        ) : null}
      </FieldCard>

      <FieldCard title="Status terms">
        <Textarea label="Final status terms" value={asTerms(form.sonicDicomFinalStatusTerms)} onChange={(value) => setValue("sonicDicomFinalStatusTerms", fromTerms(value))} />
        <Textarea label="Draft/in-review status terms" value={asTerms(form.sonicDicomDraftStatusTerms)} onChange={(value) => setValue("sonicDicomDraftStatusTerms", fromTerms(value))} />
        <Textarea label="No-report status terms" value={asTerms(form.sonicDicomNoReportStatusTerms)} onChange={(value) => setValue("sonicDicomNoReportStatusTerms", fromTerms(value))} />
        <Textarea label="Unavailable status terms" value={asTerms(form.sonicDicomUnavailableStatusTerms)} onChange={(value) => setValue("sonicDicomUnavailableStatusTerms", fromTerms(value))} />
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
      <input type={props.type || "text"} value={props.value} onChange={(e) => props.onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
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
