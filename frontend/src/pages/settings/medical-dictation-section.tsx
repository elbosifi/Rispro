import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Checkbox, ErrorState, Input, LoadingState, Switch } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { getDictationSettings, saveDictationSettings, testDictationConnection, type DictationHealth, type MedicalDictationSettings } from "@/lib/medical-dictation-api";
import { isReAuthRequiredError } from "./settings-page.helpers";

export default function MedicalDictationSection({ onReAuthRequired, reauthVersion = 0 }: { onReAuthRequired: (key: string[]) => void; reauthVersion?: number }) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<MedicalDictationSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [removeApiKey, setRemoveApiKey] = useState(false);
  const [health, setHealth] = useState<DictationHealth | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const load = useCallback(async () => {
    try { const result = await getDictationSettings(); setSettings(result.settings); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : t("dictation.actionError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  // Re-authentication permits another explicit action without discarding unsaved edits.
  useEffect(() => { if (reauthVersion) setError(""); }, [reauthVersion]);
  const act = async (test: boolean) => {
    if (!settings) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (test) setHealth(await testDictationConnection());
      else { const result = await saveDictationSettings(settings, apiKey, removeApiKey); setSettings(result.settings); setApiKey(""); setRemoveApiKey(false); setDirty(false); setHealth(null); setMessage(t("dictation.saved")); }
    } catch (e) {
      if (isReAuthRequiredError(e)) onReAuthRequired(["medical-dictation", "settings"]);
      setError(e instanceof Error ? e.message : t("dictation.actionError"));
    } finally { setBusy(false); }
  };
  if (!settings) return error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState message={t("dictation.loading")} />;
  const status = health?.status ?? (!settings.baseUrl ? "not_configured" : !settings.enabled ? "disabled" : null);
  const change = <K extends keyof MedicalDictationSettings>(key: K, value: MedicalDictationSettings[K]) => { setSettings({ ...settings, [key]: value }); setDirty(true); setHealth(null); setMessage(""); };
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{t("dictation.settingsDescription")}</p>
    <div className="flex items-center gap-3"><span dir="ltr" className="inline-flex"><Switch id="dictation-enabled" aria-label={t("dictation.enable")} checked={settings.enabled} disabled={busy || (!settings.encryptionReady && !settings.enabled)} onChange={(e) => change("enabled", e.target.checked)} /></span><label htmlFor="dictation-enabled">{t("dictation.enable")}</label></div>
    {!settings.encryptionReady && <p role="alert" className="text-sm text-destructive">{t("dictation.encryptionMissing")}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <label>{t("dictation.serverAddress")}<Input dir="ltr" type="url" className="mt-1 w-full" placeholder="https://medasr.example.org:8000" value={settings.baseUrl} disabled={busy} onChange={(e) => change("baseUrl", e.target.value)} /></label>
      <label>{t("dictation.timeout")}<Input type="number" min={10} max={600} className="mt-1 w-full" value={settings.timeoutSeconds} disabled={busy} onChange={(e) => change("timeoutSeconds", Number(e.target.value))} /></label>
      <div><label>{t("dictation.apiKey")}<Input dir="ltr" type="password" autoComplete="new-password" className="mt-1 w-full" placeholder={t("dictation.keepKey")} value={apiKey} disabled={busy || removeApiKey || !settings.encryptionReady} onChange={(e) => { setApiKey(e.target.value); setDirty(true); }} /></label><p className="mt-1 text-sm">{settings.apiKeyConfigured ? t("dictation.keyConfigured") : t("dictation.keyNotConfigured")}</p></div>
      <label className="flex items-center gap-2"><Checkbox checked={removeApiKey} disabled={busy || !settings.apiKeyConfigured} onChange={(e) => { setRemoveApiKey(e.target.checked); setApiKey(""); setDirty(true); }} />{t("dictation.removeKey")}</label>
    </div>
    <label className="flex items-start gap-2"><Checkbox className="mt-1 shrink-0" checked={settings.allowInsecureHttp} disabled={busy} onChange={(e) => change("allowInsecureHttp", e.target.checked)} /><span className="text-sm">{t("dictation.httpAcknowledgement")}</span></label>
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void act(false)}>{t("dictation.save")}</Button><Button variant="secondary" disabled={busy || dirty} onClick={() => void act(true)}>{t("dictation.testConnection")}</Button></div>
    {dirty && <p className="text-sm text-muted-foreground">{t("dictation.saveBeforeTest")}</p>}
    <div role="status" aria-live="polite" className="space-y-1 text-sm"><p>{t("dictation.connectionStatus")}: {busy ? t("dictation.working") : status ? t(`dictation.status.${status}`) : t("dictation.notTested")}</p>{health?.model && <p>{t("dictation.model")}: {health.model}</p>}{health?.message && <p>{health.message}</p>}{message && <p>{message}</p>}</div>
    <p className="text-sm text-muted-foreground">{t("dictation.healthCaveat")}</p>
    {error && <ErrorState message={error} />}
    <Link className="text-accent underline" to="/doctor/dictation-test">{t("dictation.openConsole")}</Link>
  </div>;
}
