import { useCallback, useEffect, useState } from "react";
import { Button, Card, ErrorState, Textarea } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { cleanupMedGemmaDictation, getMedGemmaHealth, type MedGemmaHealth } from "@/lib/medgemma-api";

export function MedGemmaTestPage() {
  const { t } = useLanguage();
  const [health, setHealth] = useState<MedGemmaHealth | null>(null);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [cleaned, setCleaned] = useState("");
  const [processingSeconds, setProcessingSeconds] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const check = useCallback(async () => {
    setChecking(true); setError("");
    try { setHealth(await getMedGemmaHealth()); }
    catch (e) { setHealth(null); setError(e instanceof Error ? e.message : t("medgemma.actionError")); }
    finally { setChecking(false); }
  }, [t]);
  useEffect(() => { void check(); }, [check]);
  const generate = async () => {
    setProcessing(true); setError(""); setCopied(false); setEditing(false);
    // Preserve the exact submitted text, including after subsequent input edits.
    setOriginal(text); setCleaned(""); setProcessingSeconds(null);
    try {
      const result = await cleanupMedGemmaDictation(text);
      setCleaned(result.text); setProcessingSeconds(result.processing_seconds);
    } catch (e) { setError(e instanceof Error ? e.message : t("medgemma.actionError")); }
    finally { setProcessing(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(cleaned); setCopied(true); }
    catch { setError(t("medgemma.copyError")); }
  };
  return <div className="mx-auto max-w-5xl space-y-4">
    <div><h1 className="text-2xl font-semibold text-foreground">{t("medgemma.consoleTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("medgemma.testOnly")}</p></div>
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p role="status">{t("medgemma.connectionStatus")}: {checking ? t("medgemma.loading") : health ? t(`medgemma.status.${health.status}`) : t("medgemma.status.unavailable")}</p><Button size="sm" variant="secondary" disabled={checking || processing} onClick={() => void check()}>{t("medgemma.refresh")}</Button></div>
      {health?.model && <p className="text-sm">{t("medgemma.model")}: {health.model}</p>}
      {health?.message && <p className="text-sm">{health.message}</p>}
      {health && health.status !== "connected" && <p className="text-sm text-muted-foreground">{t("medgemma.unavailableGuidance")}</p>}
    </Card>
    <Card className="space-y-3">
      <label className="block font-semibold" htmlFor="medgemma-input">{t("medgemma.originalDictation")}</label>
      <Textarea id="medgemma-input" dir="auto" className="min-h-40 w-full" maxLength={32_000} value={text} disabled={processing} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={processing || !text.trim() || health?.status !== "connected"} onClick={() => void generate()}>{processing ? t("medgemma.processing") : t("medgemma.clean")}</Button>
        <Button variant="secondary" disabled={processing || (!text && !original && !cleaned)} onClick={() => { setText(""); setOriginal(""); setCleaned(""); setProcessingSeconds(null); setEditing(false); setCopied(false); setError(""); }}>{t("medgemma.clear")}</Button>
      </div>
      {processing && <p role="status">{t("medgemma.processing")}</p>}
    </Card>
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="min-w-0 space-y-3"><label className="block font-semibold" htmlFor="medgemma-original">{t("medgemma.originalText")}</label><Textarea id="medgemma-original" dir="auto" className="min-h-48 w-full" value={original} readOnly /></Card>
      <Card className="min-w-0 space-y-3">
        <label className="block font-semibold" htmlFor="medgemma-cleaned">{t("medgemma.cleanedText")}</label>
        <Textarea id="medgemma-cleaned" dir="auto" className="min-h-48 w-full" value={cleaned} readOnly={!editing} disabled={processing} onChange={(e) => { setCleaned(e.target.value); setCopied(false); }} />
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={processing || !cleaned} onClick={() => void copy()}>{copied ? t("medgemma.copied") : t("medgemma.copy")}</Button><Button variant="secondary" disabled={processing || processingSeconds === null} aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? t("medgemma.finishEditing") : t("medgemma.edit")}</Button></div>
        {processingSeconds !== null && <p className="text-sm">{t("medgemma.processingTime", { seconds: processingSeconds })}</p>}
      </Card>
    </div>
    <p className="text-sm text-muted-foreground">{t("medgemma.reviewNotice")}</p>
    {error && <ErrorState message={error} />}
  </div>;
}
