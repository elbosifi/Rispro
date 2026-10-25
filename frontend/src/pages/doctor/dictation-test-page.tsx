import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, ErrorState, Textarea } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { getDictationHealth, transcribeDictation, type DictationHealth } from "@/lib/medical-dictation-api";
import { setMedGemmaTestText } from "@/lib/medgemma-test-transfer";
import { cleanupMedicalDictation } from "@/lib/medical-dictation-cleanup";

export function DictationTestPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const recorder = useAudioRecorder();
  const [health, setHealth] = useState<DictationHealth | null>(null);
  const [text, setText] = useState("");
  const [processingSeconds, setProcessingSeconds] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"original" | "cleaned" | null>(null);
  const [checking, setChecking] = useState(false);
  const basicCleaned = cleanupMedicalDictation(text);
  const check = useCallback(async () => {
    setChecking(true); setError("");
    try { setHealth(await getDictationHealth()); }
    catch (e) { setHealth(null); setError(e instanceof Error ? e.message : t("dictation.actionError")); }
    finally { setChecking(false); }
  }, [t]);
  useEffect(() => { void check(); }, [check]);
  const transcribe = async () => {
    if (!recorder.recording) return;
    setProcessing(true); setError(""); setCopied(null);
    try { const result = await transcribeDictation(recorder.recording); setText(result.text); setProcessingSeconds(result.processing_seconds); }
    catch (e) { setError(e instanceof Error ? e.message : t("dictation.actionError")); }
    finally { setProcessing(false); }
  };
  const copy = async (source: "original" | "cleaned") => {
    try { await navigator.clipboard.writeText(source === "original" ? text : basicCleaned); setCopied(source); }
    catch { setError(t("dictation.copyError")); }
  };
  const recordingBusy = recorder.phase !== "idle";
  return <div className="mx-auto max-w-4xl space-y-4" data-dictation="off">
    <div><h1 className="text-2xl font-semibold text-foreground">{t("dictation.consoleTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("dictation.testOnly")}</p></div>
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p role="status">{t("dictation.connectionStatus")}: {checking ? t("dictation.loading") : health ? t(`dictation.status.${health.status}`) : t("dictation.status.error")}</p><Button size="sm" variant="secondary" disabled={checking || processing} onClick={() => void check()}>{t("dictation.refresh")}</Button></div>
      {health?.model && <p className="text-sm">{t("dictation.model")}: {health.model}</p>}
      {health?.message && <p className="text-sm">{health.message}</p>}
      {health && health.status !== "connected" && <p className="text-sm text-muted-foreground">{t("dictation.unavailableGuidance")}</p>}
      <p className="text-xs text-muted-foreground">{t("dictation.healthCaveat")}</p>
    </Card>
    <Card className="space-y-3">
      <h2 className="font-semibold">{t("dictation.recording")}</h2>
      <p role="timer" aria-live="off" className="text-sm tabular-nums">{t("dictation.duration", { seconds: recorder.duration })}</p>
      <p role="status" className="text-sm">{recorder.phase === "requesting" ? t("dictation.microphoneWaiting") : recorder.phase === "recording" ? t("dictation.recordingActive") : recorder.phase === "stopping" ? t("dictation.working") : recorder.recording ? t("dictation.recordingReady") : t("dictation.recordingHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={recordingBusy || processing || health?.status !== "connected"} onClick={() => void recorder.start()}>{t("dictation.start")}</Button>
        <Button variant="secondary" disabled={recorder.phase !== "recording"} onClick={recorder.stop}>{t("dictation.stop")}</Button>
        <Button disabled={!recorder.recording || recordingBusy || processing || health?.status !== "connected"} onClick={() => void transcribe()}>{processing ? t("dictation.processing") : t("dictation.transcribe")}</Button>
        <Button variant="secondary" disabled={recordingBusy || processing || !recorder.recording} onClick={recorder.clear}>{t("dictation.clearRecording")}</Button>
      </div>
      {recorder.error && <ErrorState message={t(`dictation.recorderError.${recorder.error}`)} />}
    </Card>
    <Card className="space-y-3">
      <label className="block font-semibold" htmlFor="dictation-text">{t("dictation.transcription")}</label>
      <Textarea id="dictation-text" dir="ltr" className="min-h-48 w-full" value={text} disabled={processing} onChange={(e) => { setText(e.target.value); setCopied(null); }} />
      {processingSeconds !== null && <p className="text-sm">{t("dictation.processingTime", { seconds: processingSeconds })}</p>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={!text || processing} onClick={() => void copy("original")}>{copied === "original" ? t("dictation.copied") : t("dictation.copy")}</Button><Button variant="secondary" disabled={processing || (!text && processingSeconds === null)} onClick={() => { setText(""); setProcessingSeconds(null); setCopied(null); }}>{t("dictation.clearText")}</Button></div>
      <Button variant="secondary" disabled={processing || processingSeconds === null || !text.trim()} onClick={() => { setMedGemmaTestText(text); navigate("/doctor/medgemma-test"); }}>{t("medgemma.sendToMedGemma")}</Button>
    </Card>
    <Card className="space-y-3">
      <label className="block font-semibold" htmlFor="dictation-basic-cleaned">{t("dictation.basicCleanedText")}</label>
      <p className="text-sm text-muted-foreground">{t("dictation.basicCleanupHint")}</p>
      <Textarea rows={6} id="dictation-basic-cleaned" dir="ltr" className="min-h-48 w-full" value={basicCleaned} readOnly />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={processing || !basicCleaned} onClick={() => void copy("cleaned")}>{copied === "cleaned" ? t("dictation.copied") : t("dictation.copyCleaned")}</Button>
        <Button variant="secondary" disabled={processing || !basicCleaned} onClick={() => { setMedGemmaTestText(basicCleaned); navigate("/doctor/medgemma-test"); }}>{t("medgemma.sendCleanedToMedGemma")}</Button>
      </div>
    </Card>
    {processing && <p role="status">{t("dictation.processingHint")}</p>}
    {error && <ErrorState message={error} />}
  </div>;
}
