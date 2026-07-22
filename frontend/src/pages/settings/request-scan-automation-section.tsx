import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api-client";
import { isReAuthRequiredError } from "./settings-page.helpers";

type Settings = {
  enabled: boolean;
  server: string;
  share: string;
  domain: string;
  username: string;
  passwordConfigured: boolean;
  incomingSubfolder: string;
  processedSubfolder: string;
  failedSubfolder: string;
  pollingIntervalSeconds: number;
  fileReadyDelaySeconds: number;
  password?: string;
};

type RequestScanAutomationSectionProps = {
  onReAuthRequired: (queryKey: string[]) => void;
  reauthVersion?: number;
};

const QUERY_KEY = ["settings", "request-scan-automation"];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/settings/request-scan-automation${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const fallback = path === "/test"
      ? `SMB connection test failed with HTTP ${response.status}.`
      : `Request Scan settings action failed with HTTP ${response.status}.`;
    const data = await response.json().catch(() => null) as { error?: { message?: unknown } | string; message?: unknown } | null;
    const message = data && typeof data.error === "object" && data.error !== null && typeof data.error.message === "string"
      ? data.error.message
      : data && typeof data.error === "string"
        ? data.error
        : data && typeof data.message === "string"
          ? data.message
          : fallback;
    throw new ApiError(message, response.status, data);
  }
  return response.json() as Promise<T>;
}

export default function RequestScanAutomationSection({ onReAuthRequired, reauthVersion = 0 }: RequestScanAutomationSectionProps) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ settings: Settings }>("")
      .then((data) => {
        if (active) setSettings(data.settings);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (isReAuthRequiredError(error)) onReAuthRequired(QUERY_KEY);
        setMessage(error instanceof Error ? error.message : "Request Scan settings action failed");
      });
    return () => { active = false; };
  }, [onReAuthRequired, reauthVersion]);

  if (!settings) return <p>{message ?? "Loading Request Scan Automation settings…"}</p>;

  const change = (key: keyof Settings, value: string | boolean | number) => setSettings({ ...settings, [key]: value });
  const payload = () => ({ ...settings, password });
  const handleError = (error: unknown, fallback: string) => {
    if (isReAuthRequiredError(error)) onReAuthRequired(QUERY_KEY);
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ settings: Settings }>("", { method: "PUT", body: JSON.stringify(payload()) });
      setSettings(result.settings);
      setPassword("");
      setMessage("Settings saved.");
    } catch (error) {
      handleError(error, "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api("/test", { method: "POST", body: JSON.stringify(payload()) });
      setMessage("SMB connection succeeded.");
    } catch (error) {
      handleError(error, "Connection test failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Monitor one SMB Incoming folder for PDF and JPEG appointment requests.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label>Enabled<select className="input-premium mt-1 w-full" value={settings.enabled ? "enabled" : "disabled"} onChange={(event) => change("enabled", event.target.value === "enabled")}><option value="disabled">Disabled</option><option value="enabled">Enabled</option></select></label>
        <label>SMB server<input className="input-premium mt-1 w-full" value={settings.server} onChange={(event) => change("server", event.target.value)} /></label>
        <label>SMB share<input className="input-premium mt-1 w-full" value={settings.share} onChange={(event) => change("share", event.target.value)} /></label>
        <label>Domain/workgroup<input className="input-premium mt-1 w-full" value={settings.domain} onChange={(event) => change("domain", event.target.value)} /></label>
        <label>Username<input className="input-premium mt-1 w-full" value={settings.username} onChange={(event) => change("username", event.target.value)} /></label>
        <label>Password<input type="password" className="input-premium mt-1 w-full" placeholder={settings.passwordConfigured ? "Saved password (leave blank to keep)" : "Password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Incoming subfolder<input className="input-premium mt-1 w-full" value={settings.incomingSubfolder} onChange={(event) => change("incomingSubfolder", event.target.value)} /></label>
        <label>Processed subfolder<input className="input-premium mt-1 w-full" value={settings.processedSubfolder} onChange={(event) => change("processedSubfolder", event.target.value)} /></label>
        <label>Failed subfolder<input className="input-premium mt-1 w-full" value={settings.failedSubfolder} onChange={(event) => change("failedSubfolder", event.target.value)} /></label>
        <label>Polling interval (seconds)<input type="number" min="1" className="input-premium mt-1 w-full" value={settings.pollingIntervalSeconds} onChange={(event) => change("pollingIntervalSeconds", Number(event.target.value))} /></label>
        <label>File-ready delay (seconds)<input type="number" min="1" className="input-premium mt-1 w-full" value={settings.fileReadyDelaySeconds} onChange={(event) => change("fileReadyDelaySeconds", Number(event.target.value))} /></label>
      </div>
      {message && <p className="text-sm">{message}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => void save()}>Save</button>
        <button className="btn-secondary" disabled={busy} onClick={() => void test()}>Test connection</button>
      </div>
    </div>
  );
}
