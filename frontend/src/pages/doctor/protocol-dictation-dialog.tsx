import { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, ErrorState, Textarea } from "@/components/shared";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { transcribeDictation } from "@/lib/medical-dictation-api";
import { cleanupMedicalDictation } from "@/lib/medical-dictation-cleanup";
import { useLanguage } from "@/providers/language-provider";

// Mounted only for one field/session; unmounting releases the existing recorder.
export function ProtocolDictationDialog({ fieldLabel, onInsert, onClose }: {
  fieldLabel: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const recorder = useAudioRecorder();
  const [text, setText] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    // Close before document/window listeners run. React may unmount this dialog
    // synchronously, so a parent shortcut must not receive the same Escape.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
  const transcribe = async () => {
    if (!recorder.recording || processing) return;
    setProcessing(true); setText(null); setError("");
    try {
      const result = await transcribeDictation(recorder.recording);
      if (active.current) setText(cleanupMedicalDictation(result.text));
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : t("dictation.actionError"));
    } finally {
      if (active.current) setProcessing(false);
    }
  };
  const recordingBusy = recorder.phase !== "idle";
  const title = `Dictate ${fieldLabel.toLowerCase()}`;
  return <Dialog open onClose={onClose}>
    <DialogContent maxWidth="520px" aria-label={title} className="doctor-protocols-page">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <p role="timer" aria-live="off" className="text-sm tabular-nums">{t("dictation.duration", { seconds: recorder.duration })}</p>
        <p role="status" className="text-sm">{processing ? t("dictation.processing") : recorder.phase === "requesting" ? t("dictation.microphoneWaiting") : recorder.phase === "recording" ? t("dictation.recordingActive") : recorder.phase === "stopping" ? t("dictation.working") : recorder.recording ? t("dictation.recordingReady") : t("dictation.recordingHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={recordingBusy || processing} onClick={() => { setText(null); setError(""); void recorder.start(); }}>{t("dictation.start")}</Button>
          <Button type="button" size="sm" variant="secondary" disabled={recorder.phase !== "recording"} onClick={recorder.stop}>{t("dictation.stop")}</Button>
          <Button type="button" size="sm" disabled={!recorder.recording || recordingBusy || processing} onClick={() => void transcribe()}>{t("dictation.transcribe")}</Button>
        </div>
        <label className="block text-sm font-semibold" htmlFor="protocol-dictation-preview">{t("dictation.basicCleanedText")}</label>
        <Textarea id="protocol-dictation-preview" dir="auto" rows={5} className="w-full" value={text ?? ""} disabled={text === null || processing || recordingBusy} onChange={(event) => setText(event.target.value)} />
        {recorder.error && <ErrorState role="alert" className="p-2" message={t(`dictation.recorderError.${recorder.error}`)} />}
        {error && <ErrorState role="alert" className="p-2" message={error} />}
      </div>
      <DialogFooter className="flex-wrap">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={processing || recordingBusy || !text?.trim()} onClick={() => { if (text?.trim()) onInsert(text); }}>Insert Text</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
