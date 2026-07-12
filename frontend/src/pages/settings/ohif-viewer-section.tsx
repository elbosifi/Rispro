import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api-client";

interface PacsNode {
  id: number;
  name: string;
  host: string;
  port: number | string;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: number | string;
  is_active: boolean;
  is_default: boolean;
}

interface OhifConfigurationResponse {
  configuration: {
    settings: {
      enabled: boolean;
      ohifPublicBaseUrl: string;
      selectedPacsNodeId: number | null;
      accessStrategy: "native_dicomweb" | "orthanc_gateway";
      orthancGatewayEnabled: boolean;
      orthancModalityKey: string | null;
      openMode: "new_tab" | "same_tab";
      allowPriorStudies: boolean;
      maxPriorStudies: number;
      launchTokenTtlSeconds: number;
      cacheRetentionHours: number;
      retrievalTimeoutSeconds: number;
    };
    webEndpoint: {
      enabled: boolean;
      dicomwebBaseUrl: string;
      qidoRoot: string;
      wadoRsRoot: string;
      wadoUriRoot: string | null;
      stowRoot: string | null;
      authType: "none" | "basic" | "bearer";
      usernameEnvKey: string | null;
      passwordEnvKey: string | null;
      bearerTokenEnvKey: string | null;
      verifyTls: boolean;
      timeoutSeconds: number;
      osirixVersion: string | null;
      dicomwebServerEnabled: boolean | null;
      lastTestedAt: string | null;
      lastTestStatus: string | null;
      lastTestMessage: string | null;
      qidoLastStatus: string | null;
      wadoMetadataLastStatus: string | null;
      wadoFrameLastStatus: string | null;
    } | null;
    environmentCredentialStatus: {
      usernameConfigured: boolean;
      passwordConfigured: boolean;
      bearerTokenConfigured: boolean;
    };
  };
  pacsNodes: PacsNode[];
}

type FormState = {
  enabled: boolean;
  ohifPublicBaseUrl: string;
  selectedPacsNodeId: string;
  accessStrategy: "native_dicomweb" | "orthanc_gateway";
  orthancGatewayEnabled: boolean;
  orthancModalityKey: string;
  openMode: "new_tab" | "same_tab";
  allowPriorStudies: boolean;
  maxPriorStudies: string;
  launchTokenTtlSeconds: string;
  cacheRetentionHours: string;
  retrievalTimeoutSeconds: string;
  webEnabled: boolean;
  dicomwebBaseUrl: string;
  qidoRoot: string;
  wadoRsRoot: string;
  wadoUriRoot: string;
  authType: "none" | "basic" | "bearer";
  usernameEnvKey: string;
  passwordEnvKey: string;
  bearerTokenEnvKey: string;
  verifyTls: boolean;
  timeoutSeconds: string;
  osirixVersion: string;
  dicomwebServerEnabled: boolean;
};

const EMPTY_FORM: FormState = {
  enabled: false, ohifPublicBaseUrl: "/ohif", selectedPacsNodeId: "", accessStrategy: "native_dicomweb",
  orthancGatewayEnabled: false, orthancModalityKey: "", openMode: "new_tab", allowPriorStudies: true,
  maxPriorStudies: "5", launchTokenTtlSeconds: "600", cacheRetentionHours: "24", retrievalTimeoutSeconds: "300",
  webEnabled: false, dicomwebBaseUrl: "", qidoRoot: "", wadoRsRoot: "", wadoUriRoot: "", authType: "none",
  usernameEnvKey: "", passwordEnvKey: "", bearerTokenEnvKey: "", verifyTls: true, timeoutSeconds: "30",
  osirixVersion: "", dicomwebServerEnabled: false,
};

function formFromResponse(data: OhifConfigurationResponse): FormState {
  const settings = data.configuration.settings;
  const endpoint = data.configuration.webEndpoint;
  return {
    enabled: settings.enabled, ohifPublicBaseUrl: settings.ohifPublicBaseUrl,
    selectedPacsNodeId: settings.selectedPacsNodeId ? String(settings.selectedPacsNodeId) : "",
    accessStrategy: settings.accessStrategy, orthancGatewayEnabled: settings.orthancGatewayEnabled,
    orthancModalityKey: settings.orthancModalityKey || "", openMode: settings.openMode,
    allowPriorStudies: settings.allowPriorStudies, maxPriorStudies: String(settings.maxPriorStudies),
    launchTokenTtlSeconds: String(settings.launchTokenTtlSeconds), cacheRetentionHours: String(settings.cacheRetentionHours),
    retrievalTimeoutSeconds: String(settings.retrievalTimeoutSeconds), webEnabled: endpoint?.enabled ?? false,
    dicomwebBaseUrl: endpoint?.dicomwebBaseUrl || "", qidoRoot: endpoint?.qidoRoot || "", wadoRsRoot: endpoint?.wadoRsRoot || "",
    wadoUriRoot: endpoint?.wadoUriRoot || "", authType: endpoint?.authType || "none",
    usernameEnvKey: endpoint?.usernameEnvKey || "", passwordEnvKey: endpoint?.passwordEnvKey || "",
    bearerTokenEnvKey: endpoint?.bearerTokenEnvKey || "", verifyTls: endpoint?.verifyTls ?? true,
    timeoutSeconds: String(endpoint?.timeoutSeconds ?? 30), osirixVersion: endpoint?.osirixVersion || "",
    dicomwebServerEnabled: endpoint?.dicomwebServerEnabled ?? false,
  };
}

const inputClass = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm";
const labelClass = "grid gap-1 text-sm font-medium text-foreground";

export default function OhifViewerSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [accessionNumber, setAccessionNumber] = useState("");
  const [studyInstanceUid, setStudyInstanceUid] = useState("");
  const [seriesInstanceUid, setSeriesInstanceUid] = useState("");
  const [sopInstanceUid, setSopInstanceUid] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const query = useQuery({ queryKey: ["ohif", "configuration"], queryFn: () => api<OhifConfigurationResponse>("/ohif/admin/configuration") });
  useEffect(() => { if (query.data) setForm(formFromResponse(query.data)); }, [query.data]);
  const selectedNode = useMemo(() => query.data?.pacsNodes.find((node) => Number(node.id) === Number(form.selectedPacsNodeId)) ?? null, [form.selectedPacsNodeId, query.data?.pacsNodes]);

  const save = useMutation({
    mutationFn: () => api<OhifConfigurationResponse>("/ohif/admin/configuration", {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          enabled: form.enabled, ohifPublicBaseUrl: form.ohifPublicBaseUrl,
          selectedPacsNodeId: form.selectedPacsNodeId ? Number(form.selectedPacsNodeId) : null,
          accessStrategy: form.accessStrategy, orthancGatewayEnabled: form.orthancGatewayEnabled,
          orthancModalityKey: form.orthancModalityKey || null, openMode: form.openMode,
          allowPriorStudies: form.allowPriorStudies, maxPriorStudies: Number(form.maxPriorStudies),
          launchTokenTtlSeconds: Number(form.launchTokenTtlSeconds), cacheRetentionHours: Number(form.cacheRetentionHours),
          retrievalTimeoutSeconds: Number(form.retrievalTimeoutSeconds),
        },
        webEndpoint: {
          enabled: form.webEnabled, dicomwebBaseUrl: form.dicomwebBaseUrl, qidoRoot: form.qidoRoot,
          wadoRsRoot: form.wadoRsRoot, wadoUriRoot: form.wadoUriRoot || null, authType: form.authType,
          usernameEnvKey: form.usernameEnvKey || null, passwordEnvKey: form.passwordEnvKey || null,
          bearerTokenEnvKey: form.bearerTokenEnvKey || null, verifyTls: form.verifyTls,
          timeoutSeconds: Number(form.timeoutSeconds), osirixVersion: form.osirixVersion || null,
          dicomwebServerEnabled: form.dicomwebServerEnabled,
        },
      }),
    }),
    onSuccess: async (data) => { setForm(formFromResponse(data)); setMessage("OHIF Viewer settings saved."); await queryClient.invalidateQueries({ queryKey: ["ohif"] }); },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.status === 403) onReAuthRequired(["ohif", "configuration"]);
      else setMessage(error.message);
    },
  });

  const diagnostic = useMutation({
    mutationFn: (action: string) => api<{ message?: string; resultCount?: number }>("/ohif/admin/diagnostics", {
      method: "POST", body: JSON.stringify({ action, accessionNumber, studyInstanceUid, seriesInstanceUid, sopInstanceUid, appointmentId }),
    }),
    onSuccess: (result) => { setMessage(result.message || "Diagnostic completed."); queryClient.invalidateQueries({ queryKey: ["ohif", "configuration"] }); },
    onError: (error: Error) => setMessage(error.message),
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading OHIF Viewer settings…</p>;
  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.status === 403) return <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => onReAuthRequired(["ohif", "configuration"])}>Re-authenticate to manage OHIF Viewer</button>;
    return <p className="text-sm text-red-700">{error instanceof Error ? error.message : "Unable to load OHIF settings."}</p>;
  }

  return <div className="space-y-6">
    <section className="space-y-4 rounded-xl border border-border p-4">
      <div><h4 className="font-semibold">General</h4><p className="text-sm text-muted-foreground">OHIF is disabled by default. RISpro remains authoritative for access, source selection, and audit.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}><span>Enable OHIF Viewer</span><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /></label>
        <label className={labelClass}><span>OHIF public base URL</span><input className={inputClass} value={form.ohifPublicBaseUrl} onChange={(event) => setForm({ ...form, ohifPublicBaseUrl: event.target.value })} /></label>
        <label className={labelClass}><span>Open mode</span><select className={inputClass} value={form.openMode} onChange={(event) => setForm({ ...form, openMode: event.target.value as FormState["openMode"] })}><option value="new_tab">New tab</option><option value="same_tab">Same tab</option></select></label>
        <label className={labelClass}><span>Launch token lifetime (seconds)</span><input type="number" className={inputClass} value={form.launchTokenTtlSeconds} onChange={(event) => setForm({ ...form, launchTokenTtlSeconds: event.target.value })} /></label>
        <label className={labelClass}><span>Allow prior studies</span><input type="checkbox" checked={form.allowPriorStudies} onChange={(event) => setForm({ ...form, allowPriorStudies: event.target.checked })} /></label>
        <label className={labelClass}><span>Maximum priors</span><input type="number" className={inputClass} value={form.maxPriorStudies} onChange={(event) => setForm({ ...form, maxPriorStudies: event.target.value })} /></label>
      </div>
    </section>

    <section className="space-y-4 rounded-xl border border-border p-4">
      <div><h4 className="font-semibold">OHIF image source</h4><p className="text-sm text-muted-foreground">Independent of the general RISpro default PACS. No automatic fallback to another node occurs.</p></div>
      <label className={labelClass}><span>Active PACS node</span><select className={inputClass} value={form.selectedPacsNodeId} onChange={(event) => setForm({ ...form, selectedPacsNodeId: event.target.value })}><option value="">Select a PACS node</option>{query.data?.pacsNodes.filter((node) => node.is_active).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
      {selectedNode && <div className="rounded-lg bg-muted/40 p-3 text-sm"><strong>{selectedNode.name}</strong><p>{selectedNode.host}:{selectedNode.port} · Called AE {selectedNode.called_ae_title} · Calling AE {selectedNode.calling_ae_title}</p><p>Status: {selectedNode.is_active ? "Active" : "Inactive"}</p></div>}
      <label className={labelClass}><span>Access strategy</span><select className={inputClass} value={form.accessStrategy} onChange={(event) => { const accessStrategy = event.target.value as FormState["accessStrategy"]; setForm({ ...form, accessStrategy, orthancGatewayEnabled: accessStrategy === "orthanc_gateway" || form.orthancGatewayEnabled }); }}><option value="native_dicomweb">Native DICOMweb</option><option value="orthanc_gateway">Orthanc retrieval gateway</option></select></label>
    </section>

    {form.accessStrategy === "native_dicomweb" ? <section className="space-y-4 rounded-xl border border-border p-4">
      <div><h4 className="font-semibold">Native DICOMweb</h4><p className="text-sm text-muted-foreground">Credentials are referenced by environment-variable name and are never returned to this page.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}><span>DICOMweb enabled</span><input type="checkbox" checked={form.webEnabled} onChange={(event) => setForm({ ...form, webEnabled: event.target.checked })} /></label>
        <label className={labelClass}><span>OsiriX MD version</span><input className={inputClass} value={form.osirixVersion} onChange={(event) => setForm({ ...form, osirixVersion: event.target.value })} placeholder="Record installed version" /></label>
        <label className={labelClass}><span>DICOMweb base URL</span><input className={inputClass} value={form.dicomwebBaseUrl} onChange={(event) => setForm({ ...form, dicomwebBaseUrl: event.target.value })} /></label>
        <label className={labelClass}><span>QIDO-RS root</span><input className={inputClass} value={form.qidoRoot} onChange={(event) => setForm({ ...form, qidoRoot: event.target.value })} /></label>
        <label className={labelClass}><span>WADO-RS root</span><input className={inputClass} value={form.wadoRsRoot} onChange={(event) => setForm({ ...form, wadoRsRoot: event.target.value })} /></label>
        <label className={labelClass}><span>Optional WADO-URI root</span><input className={inputClass} value={form.wadoUriRoot} onChange={(event) => setForm({ ...form, wadoUriRoot: event.target.value })} /></label>
        <label className={labelClass}><span>Authentication</span><select className={inputClass} value={form.authType} onChange={(event) => setForm({ ...form, authType: event.target.value as FormState["authType"] })}><option value="none">None</option><option value="basic">Basic (environment references)</option><option value="bearer">Bearer token (environment reference)</option></select></label>
        {form.authType === "basic" && <><label className={labelClass}><span>Username environment key</span><input className={inputClass} value={form.usernameEnvKey} onChange={(event) => setForm({ ...form, usernameEnvKey: event.target.value.toUpperCase() })} /></label><label className={labelClass}><span>Password environment key</span><input className={inputClass} value={form.passwordEnvKey} onChange={(event) => setForm({ ...form, passwordEnvKey: event.target.value.toUpperCase() })} /></label></>}
        {form.authType === "bearer" && <label className={labelClass}><span>Bearer-token environment key</span><input className={inputClass} value={form.bearerTokenEnvKey} onChange={(event) => setForm({ ...form, bearerTokenEnvKey: event.target.value.toUpperCase() })} /></label>}
        <label className={labelClass}><span>Verify TLS</span><input type="checkbox" checked={form.verifyTls} onChange={(event) => setForm({ ...form, verifyTls: event.target.checked })} /></label>
        <label className={labelClass}><span>Timeout (seconds)</span><input type="number" className={inputClass} value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })} /></label>
      </div>
    </section> : <section className="space-y-4 rounded-xl border border-border p-4">
      <div><h4 className="font-semibold">Orthanc retrieval gateway</h4><p className="text-sm text-muted-foreground">Reuses the existing Orthanc connection. Orthanc is a temporary cache, not the source archive. Cache deletion is controlled by the server-side `OHIF_CACHE_CLEANUP_ENABLED` gate and requires a proven OHIF-owned Orthanc resource.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}><span>Gateway enabled</span><input type="checkbox" checked={form.orthancGatewayEnabled} onChange={(event) => setForm({ ...form, orthancGatewayEnabled: event.target.checked })} /></label>
        <label className={labelClass}><span>Orthanc modality key</span><input className={inputClass} value={form.orthancModalityKey} onChange={(event) => setForm({ ...form, orthancModalityKey: event.target.value })} placeholder="Configured remote modality key" /></label>
        <label className={labelClass}><span>Retrieval timeout (seconds)</span><input type="number" className={inputClass} value={form.retrievalTimeoutSeconds} onChange={(event) => setForm({ ...form, retrievalTimeoutSeconds: event.target.value })} /></label>
        <label className={labelClass}><span>Cache retention (hours)</span><input type="number" className={inputClass} value={form.cacheRetentionHours} onChange={(event) => setForm({ ...form, cacheRetentionHours: event.target.value })} /></label>
      </div>
    </section>}

    <section className="space-y-3 rounded-xl border border-border p-4">
      <div><h4 className="font-semibold">Diagnostics</h4><p className="text-sm text-muted-foreground">Tests are separate so QIDO success is never presented as WADO success.</p></div>
      <div className="grid gap-3 md:grid-cols-2"><input className={inputClass} value={accessionNumber} onChange={(event) => setAccessionNumber(event.target.value)} placeholder="Known accession for search test" /><input className={inputClass} value={studyInstanceUid} onChange={(event) => setStudyInstanceUid(event.target.value)} placeholder="Known StudyInstanceUID for WADO" /><input className={inputClass} value={seriesInstanceUid} onChange={(event) => setSeriesInstanceUid(event.target.value)} placeholder="Known SeriesInstanceUID for frame test" /><input className={inputClass} value={sopInstanceUid} onChange={(event) => setSopInstanceUid(event.target.value)} placeholder="Known SOPInstanceUID for frame test" /><input className={inputClass} inputMode="numeric" value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)} placeholder="Authorized appointment ID for full launch" /></div>
      <div className="flex flex-wrap gap-2">{[
        ["test_ohif_url", "Test OHIF URL"], ["test_source", form.accessStrategy === "native_dicomweb" ? "Test QIDO study search" : "Test Orthanc REST + DICOMweb"],
        ["test_pacs_echo", "Test PACS C-ECHO"], ["test_orthanc_rest", "Test Orthanc REST"], ["test_orthanc_dicomweb", "Test Orthanc DICOMweb"],
        ["test_accession", "Test accession resolution"], ["test_wado_metadata", "Test WADO metadata"], ["test_wado_frame", "Test WADO frame"], ["test_full_launch", "Test authorized full launch"],
      ].map(([action, label]) => <button key={action} type="button" disabled={diagnostic.isPending} onClick={() => diagnostic.mutate(action)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{label}</button>)}</div>
      {query.data?.configuration.webEndpoint?.lastTestedAt && <p className="text-xs text-muted-foreground">Last test: {query.data.configuration.webEndpoint.lastTestStatus || "unknown"} · {query.data.configuration.webEndpoint.lastTestMessage || "No summary"}</p>}
    </section>

    {message && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{message}</p>}
    <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{save.isPending ? "Saving…" : "Save OHIF Viewer settings"}</button>
  </div>;
}
