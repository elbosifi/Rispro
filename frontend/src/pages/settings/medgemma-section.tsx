import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Checkbox, ErrorState, Input, LoadingState, Switch, Textarea } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { MEDGEMMA_TASKS, getMedGemmaSettings, saveMedGemmaSettings, testMedGemmaConnection, type MedGemmaHealth, type MedGemmaSettings, type MedGemmaTask } from "@/lib/medgemma-api";
import { isReAuthRequiredError } from "./settings-page.helpers";

export default function MedGemmaSection({ onReAuthRequired, reauthVersion = 0 }: { onReAuthRequired: (key: string[]) => void; reauthVersion?: number }) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<MedGemmaSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [removeApiKey, setRemoveApiKey] = useState(false);
  const [health, setHealth] = useState<MedGemmaHealth | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [instructionTask, setInstructionTask] = useState<MedGemmaTask>("cleanup_dictation");
  const load = useCallback(async () => {
    try { const result = await getMedGemmaSettings(); setSettings(result.settings); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : t("medgemma.actionError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  // Re-authentication permits another explicit action without discarding unsaved edits.
  useEffect(() => { if (reauthVersion) setError(""); }, [reauthVersion]);
  const act = async (test: boolean) => {
    if (!settings) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (test) setHealth(await testMedGemmaConnection());
      else { const result = await saveMedGemmaSettings(settings, apiKey, removeApiKey); setSettings(result.settings); setApiKey(""); setRemoveApiKey(false); setDirty(false); setHealth(null); setMessage(t("medgemma.saved")); }
    } catch (e) {
      if (isReAuthRequiredError(e)) onReAuthRequired(["medgemma", "settings"]);
      setError(e instanceof Error ? e.message : t("medgemma.actionError"));
    } finally { setBusy(false); }
  };
  if (!settings) return error ? <ErrorState message={error} onRetry={() => void load()} /> : <LoadingState message={t("medgemma.loading")} />;
  const ollama = settings.provider === "ollama";
  const encryptionRequired = !ollama && !settings.encryptionReady;
  const status = health?.status ?? (!(ollama ? settings.ollamaBaseUrl : settings.baseUrl) ? "not_configured" : !settings.enabled ? "disabled" : null);
  const change = <K extends keyof MedGemmaSettings>(key: K, value: MedGemmaSettings[K]) => { setSettings({ ...settings, [key]: value }); setDirty(true); setHealth(null); setMessage(""); };
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{t("medgemma.settingsDescription")}</p>
    <label className="block">{t("medgemma.provider")}<select className="input-premium mt-1 w-full" value={settings.provider} disabled={busy} onChange={(e) => change("provider", e.target.value as MedGemmaSettings["provider"])}><option value="standalone">{t("medgemma.standaloneProvider")}</option><option value="ollama">Ollama</option></select></label>
    <div className="flex items-center gap-3"><span dir="ltr" className="inline-flex"><Switch id="medgemma-enabled" aria-label={t("medgemma.enable")} checked={settings.enabled} disabled={busy || (encryptionRequired && !settings.enabled)} onChange={(e) => change("enabled", e.target.checked)} /></span><label htmlFor="medgemma-enabled">{t("medgemma.enable")}</label></div>
    {encryptionRequired && <p role="alert" className="text-sm text-destructive">{t("medgemma.encryptionMissing")}</p>}
    {ollama && <p className="text-sm text-muted-foreground">{t("medgemma.ollamaHint")}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      {ollama ? <>
        <label>{t("medgemma.ollamaServerAddress")}<Input dir="ltr" type="url" className="mt-1 w-full" placeholder="http://192.168.1.50:11434" value={settings.ollamaBaseUrl} disabled={busy} onChange={(e) => change("ollamaBaseUrl", e.target.value)} /></label>
        <label>{t("medgemma.ollamaModelName")}<Input dir="ltr" className="mt-1 w-full" maxLength={200} value={settings.ollamaModel} disabled={busy} onChange={(e) => change("ollamaModel", e.target.value)} /></label>
      </> : <label>{t("medgemma.serverAddress")}<Input dir="ltr" type="url" className="mt-1 w-full" placeholder="https://medgemma.example.org:8000" value={settings.baseUrl} disabled={busy} onChange={(e) => change("baseUrl", e.target.value)} /></label>}
      <label>{t("medgemma.timeout")}<Input type="number" min={10} max={600} className="mt-1 w-full" value={settings.timeoutSeconds} disabled={busy} onChange={(e) => change("timeoutSeconds", Number(e.target.value))} /></label>
      {!ollama && <>
      <div><label>{t("medgemma.apiKey")}<Input dir="ltr" type="password" autoComplete="new-password" className="mt-1 w-full" placeholder={t("medgemma.keepKey")} value={apiKey} disabled={busy || removeApiKey || !settings.encryptionReady} onChange={(e) => { setApiKey(e.target.value); setDirty(true); }} /></label><p className="mt-1 text-sm">{settings.apiKeyConfigured ? t("medgemma.keyConfigured") : t("medgemma.keyNotConfigured")}</p></div>
      <label className="flex items-center gap-2"><Checkbox checked={removeApiKey} disabled={busy || !settings.apiKeyConfigured} onChange={(e) => { setRemoveApiKey(e.target.checked); setApiKey(""); setDirty(true); }} />{t("medgemma.removeKey")}</label>
      </>}
    </div>
    <label className="flex items-start gap-2"><Checkbox className="mt-1 shrink-0" checked={settings.allowInsecureHttp} disabled={busy} onChange={(e) => change("allowInsecureHttp", e.target.checked)} /><span className="text-sm">{t("medgemma.httpAcknowledgement")}</span></label>
    <div className="space-y-3 border-t border-border pt-4">
      <h2 className="font-semibold">{t("medgemma.aiInstructions")}</h2>
      <p className="text-sm text-muted-foreground">{t("medgemma.instructionsHint")}</p>
      <label className="block">{t("medgemma.instructionPreset")}<select className="input-premium mt-1 w-full" value={instructionTask} disabled={busy} onChange={(e) => setInstructionTask(e.target.value as MedGemmaTask)}>{MEDGEMMA_TASKS.map((task) => <option key={task} value={task}>{t(`medgemma.task.${task}`)}</option>)}</select></label>
      <label className="block">{t("medgemma.systemInstructions")}<Textarea rows={8} dir="auto" className="mt-1 min-h-48 w-full" maxLength={8000} value={settings.instructions[instructionTask]} disabled={busy} onChange={(e) => change("instructions", { ...settings.instructions, [instructionTask]: e.target.value })} /></label>
      <Button variant="secondary" disabled={busy} onClick={() => change("instructions", { ...settings.instructions, [instructionTask]: settings.instructionDefaults[instructionTask] })}>{t("medgemma.restoreDefault")}</Button>
      <div className="grid gap-4 md:grid-cols-2">
        <label>{t("medgemma.temperature")}<Input type="number" min={0} max={1} step={0.1} className="mt-1 w-full" value={settings.temperature} disabled={busy} onChange={(e) => change("temperature", Number(e.target.value))} /></label>
        <label>{t("medgemma.maxTokens")}<Input type="number" min={128} max={8192} className="mt-1 w-full" value={settings.maxGeneratedTokens} disabled={busy} onChange={(e) => change("maxGeneratedTokens", Number(e.target.value))} /></label>
      </div>
    </div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void act(false)}>{t("medgemma.save")}</Button><Button variant="secondary" disabled={busy || dirty} onClick={() => void act(true)}>{t("medgemma.testConnection")}</Button></div>
    {dirty && <p className="text-sm text-muted-foreground">{t("medgemma.saveBeforeTest")}</p>}
    <div role="status" aria-live="polite" className="space-y-1 text-sm"><p>{t("medgemma.connectionStatus")}: {busy ? t("medgemma.working") : status ? t(`medgemma.status.${status}`) : t("medgemma.notTested")}</p>{health?.model && <p>{t("medgemma.model")}: {health.model}</p>}{health?.message && <p>{health.message}</p>}{message && <p>{message}</p>}</div>
    <p className="text-sm text-muted-foreground">{t("medgemma.healthCaveat")}</p>
    {error && <ErrorState message={error} />}
    <Link className="text-accent underline" to="/doctor/medgemma-test">{t("medgemma.openConsole")}</Link>
  </div>;
}
