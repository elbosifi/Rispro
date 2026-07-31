import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card } from "@/components/shared";
import { api } from "@/lib/api-client";

type Settings = { enabled: boolean; baseUrl: string; username: string; timeoutSeconds: number; verifyTls: boolean; displayName: string; passwordConfigured: boolean };

export default function AuthoritativeOrthancSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["authoritative-orthanc", "settings"], queryFn: () => api<{ settings: Settings }>("/integrations/authoritative-orthanc/settings") });
  const settings = draft || query.data?.settings || null;
  const save = useMutation({
    mutationFn: () => api<{ settings: Settings }>("/integrations/authoritative-orthanc/settings", { method: "PUT", body: JSON.stringify({ ...settings, password }) }),
    onSuccess: ({ settings: next }) => { setDraft(next); setPassword(""); setMessage("Authoritative Orthanc settings saved."); void queryClient.invalidateQueries({ queryKey: ["authoritative-orthanc"] }); },
    onError: (error: Error) => { if (/reauth/i.test(error.message)) onReAuthRequired(["authoritative_orthanc"]); setMessage(error.message); }
  });
  const test = useMutation({
    mutationFn: () => api<{ system: { name: string | null; version: string | null; apiVersion: string | null }; testedAt: string }>("/integrations/authoritative-orthanc/test", { method: "POST" }),
    onSuccess: (result) => setMessage(`Connected${result.system.name ? ` to ${result.system.name}` : ""}${result.system.version ? ` - Orthanc ${result.system.version}` : ""}${result.system.apiVersion ? ` - API ${result.system.apiVersion}` : ""} - ${new Date(result.testedAt).toLocaleString()}`),
    onError: (error: Error) => setMessage(error.message)
  });
  if (!settings) return <Card className="p-4">Loading Authoritative Orthanc settings...</Card>;
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...settings, [key]: value });
  return <Card className="space-y-4 p-4" data-testid="authoritative-orthanc-settings">
    <div><h2 className="text-lg font-semibold">Authoritative Orthanc</h2><p className="text-sm text-muted-foreground">Connection used to verify RISpro-linked studies and export approved scanned clinical documents as DICOM Secondary Capture series. RISpro does not upload original modality images or create a replacement study; it adds only the approved scanned-document series to the matched study.</p></div>
    <div className="grid gap-3 md:grid-cols-2">
      <label><input type="checkbox" checked={settings.enabled} onChange={(event) => change("enabled", event.target.checked)} /> Enabled</label>
      <label>Display name<input className="input w-full" value={settings.displayName} onChange={(event) => change("displayName", event.target.value)} /></label>
      <label className="md:col-span-2">Base URL<input className="input w-full" placeholder="http://orthanc-host:8042" value={settings.baseUrl} onChange={(event) => change("baseUrl", event.target.value)} /></label>
      <label>Username<input className="input w-full" value={settings.username} onChange={(event) => change("username", event.target.value)} /></label>
      <label>Password<input className="input w-full" type="password" value={password} placeholder={settings.passwordConfigured ? "Configured - leave empty to retain" : "Not configured"} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Timeout (seconds)<input className="input w-full" type="number" min="1" max="120" value={settings.timeoutSeconds} onChange={(event) => change("timeoutSeconds", Number(event.target.value))} /></label>
      <label><input type="checkbox" checked={settings.verifyTls} onChange={(event) => change("verifyTls", event.target.checked)} /> Verify TLS certificate</label>
    </div>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    <div className="flex gap-2"><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button><Button variant="secondary" onClick={() => test.mutate()} disabled={test.isPending || !settings.enabled}>Test Connection</Button></div>
  </Card>;
}
