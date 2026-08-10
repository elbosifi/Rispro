import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card } from "@/components/shared";
import { api } from "@/lib/api-client";

type Settings = { enabled: boolean; autoExportClinicalDocuments: boolean; autoRouteEnabled: boolean; autoRouteDestinationKey: string; autoRouteDestinationKeys: string[]; baseUrl: string; username: string; timeoutSeconds: number; verifyTls: boolean; displayName: string; passwordConfigured: boolean };
type PacsDestination = { key: string; aet: string; host: string; port: number | null; configurationError?: string | null };
const isReauthError = (error: unknown) => /re-?authentication|reauth|403/i.test(error instanceof Error ? error.message : String(error || ""));

export default function AuthoritativeOrthancSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [password, setPassword] = useState("");
  const [destinationToAdd, setDestinationToAdd] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["authoritative-orthanc", "settings"], queryFn: () => api<{ settings: Settings }>("/integrations/authoritative-orthanc/settings") });
  const destinationsQuery = useQuery({ queryKey: ["pacs", "orthanc-modalities"], queryFn: () => api<{ modalities: PacsDestination[] }>("/pacs/orthanc-modalities") });
  const settings = draft || query.data?.settings || null;
  const save = useMutation({
    mutationFn: () => api<{ settings: Settings }>("/integrations/authoritative-orthanc/settings", { method: "PUT", body: JSON.stringify({ ...settings, password }) }),
    onSuccess: ({ settings: next }) => { setDraft(next); setPassword(""); setMessage("Authoritative Orthanc settings saved."); void queryClient.invalidateQueries({ queryKey: ["authoritative-orthanc"] }); },
    onError: (error: Error) => { if (isReauthError(error)) onReAuthRequired(["authoritative_orthanc"]); setMessage(error.message); }
  });
  const test = useMutation({
    mutationFn: () => api<{ system: { name: string | null; version: string | null; apiVersion: string | null }; testedAt: string }>("/integrations/authoritative-orthanc/test", { method: "POST" }),
    onSuccess: (result) => setMessage(`Connected${result.system.name ? ` to ${result.system.name}` : ""}${result.system.version ? ` - Orthanc ${result.system.version}` : ""}${result.system.apiVersion ? ` - API ${result.system.apiVersion}` : ""} - ${new Date(result.testedAt).toLocaleString()}`),
    onError: (error: Error) => setMessage(error.message)
  });
  if (!settings) return <Card className="p-4">Loading Authoritative Orthanc settings...</Card>;
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...settings, [key]: value });
  const selectedDestinationKeys = settings.autoRouteDestinationKeys?.length ? settings.autoRouteDestinationKeys : settings.autoRouteDestinationKey ? [settings.autoRouteDestinationKey] : [];
  const setSelectedDestinationKeys = (keys: string[]) => setDraft({ ...settings, autoRouteDestinationKeys: keys, autoRouteDestinationKey: keys[0] || "" });
  const validDestinations = selectedDestinationKeys.length > 0 && selectedDestinationKeys.every((key) => destinationsQuery.data?.modalities.some((item) => item.key === key && item.aet && item.host && item.port != null && !item.configurationError));
  const destinationReauthRequired = isReauthError(destinationsQuery.error);
  return <Card className="space-y-4 p-4" data-testid="authoritative-orthanc-settings">
    <div><h2 className="text-lg font-semibold">Authoritative Orthanc</h2><p className="text-sm text-muted-foreground">Connection used to verify RISpro-linked studies and export approved scanned clinical documents as DICOM Secondary Capture series. RISpro does not upload original modality images or create a replacement study; it adds only the approved scanned-document series to the matched study.</p></div>
    <div className="grid gap-3 md:grid-cols-2">
      <label><input type="checkbox" checked={settings.enabled} onChange={(event) => setDraft({ ...settings, enabled: event.target.checked, autoRouteEnabled: event.target.checked ? settings.autoRouteEnabled : false })} /> Enable Orthanc connection</label>
      <label className="md:col-span-2"><span className="flex items-center gap-2"><input aria-label="Automatically send approved scanned documents to PACS" type="checkbox" checked={settings.autoExportClinicalDocuments} disabled={!settings.enabled} onChange={(event) => change("autoExportClinicalDocuments", event.target.checked)} /> Automatically send approved scanned documents to PACS</span><span className="mt-1 block text-xs text-muted-foreground">When enabled, eligible scanned clinical documents are added to the matched completed study as DICOM Secondary Capture. Turning this off pauses automatic document sending. Eligible documents will resume when it is enabled again.</span></label>
      <fieldset className="space-y-2 rounded-lg border p-3 md:col-span-2"><legend className="px-1 font-medium">DICOM Auto-routing</legend>
        <label className="flex items-center gap-2"><input aria-label="Enable stable-series auto-routing" type="checkbox" checked={settings.autoRouteEnabled} disabled={!settings.enabled} onChange={(event) => change("autoRouteEnabled", event.target.checked)} /> Enable stable-series auto-routing</label>
        {selectedDestinationKeys.length ? <ul className="space-y-2" aria-label="Selected auto-routing destinations">{selectedDestinationKeys.map((key, index) => { const destination = destinationsQuery.data?.modalities.find((item) => item.key === key); return <li key={key} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"><span>{index + 1}. {key}{destination ? ` — ${destination.aet} — ${destination.host}:${destination.port}` : " — unavailable"}</span><button type="button" className="btn-secondary text-xs" disabled={!settings.autoRouteEnabled} onClick={() => setSelectedDestinationKeys(selectedDestinationKeys.filter((item) => item !== key))}>Remove</button></li>; })}</ul> : <p className="text-xs text-muted-foreground">No destinations selected.</p>}
        <div className="flex flex-wrap items-end gap-2"><label className="min-w-64 flex-1">Add destination<select aria-label="Add auto-routing destination" className="input w-full" value={destinationToAdd} disabled={!settings.autoRouteEnabled} onChange={(event) => setDestinationToAdd(event.target.value)}><option value="">Select an existing PACS connection</option>{destinationsQuery.data?.modalities.filter((destination) => !selectedDestinationKeys.includes(destination.key)).map((destination) => <option key={destination.key} value={destination.key} disabled={!destination.aet || !destination.host || destination.port == null || Boolean(destination.configurationError)}>{destination.key} — {destination.aet || "missing AET"} — {destination.host || "missing host"}:{destination.port ?? "missing port"}</option>)}</select></label><button type="button" className="btn-secondary" disabled={!settings.autoRouteEnabled || !destinationToAdd} onClick={() => { setSelectedDestinationKeys([...selectedDestinationKeys, destinationToAdd]); setDestinationToAdd(""); }}>Add destination</button></div>
        {destinationReauthRequired ? <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700"><span>Recent supervisor re-authentication is required to load PACS destinations.</span><button type="button" className="btn-secondary text-xs" onClick={() => onReAuthRequired(["pacs", "orthanc-modalities"])}>Re-authenticate</button></div> : destinationsQuery.error ? <p className="text-xs text-red-600">Could not load existing PACS destinations: {(destinationsQuery.error as Error).message}</p> : <p className="text-xs text-muted-foreground">Each selected PACS connection is copied to a descriptive managed <code>rispro_route_</code> modality alias in Authoritative Orthanc.</p>}
      </fieldset>
      <label>Display name<input className="input w-full" value={settings.displayName} onChange={(event) => change("displayName", event.target.value)} /></label>
      <label className="md:col-span-2">Base URL<input className="input w-full" placeholder="http://orthanc-host:8042" value={settings.baseUrl} onChange={(event) => change("baseUrl", event.target.value)} /></label>
      <label>Username<input className="input w-full" value={settings.username} onChange={(event) => change("username", event.target.value)} /></label>
      <label>Password<input className="input w-full" type="password" value={password} placeholder={settings.passwordConfigured ? "Configured - leave empty to retain" : "Not configured"} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Timeout (seconds)<input className="input w-full" type="number" min="1" max="120" value={settings.timeoutSeconds} onChange={(event) => change("timeoutSeconds", Number(event.target.value))} /></label>
      <label><input type="checkbox" checked={settings.verifyTls} onChange={(event) => change("verifyTls", event.target.checked)} /> Verify TLS certificate</label>
    </div>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    <div className="flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending || (settings.autoRouteEnabled && !validDestinations)}>Save</Button><Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !settings.enabled}>Test Connection</Button></div>
  </Card>;
}
