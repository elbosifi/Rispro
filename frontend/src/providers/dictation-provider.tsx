import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { useDictationShortcuts } from "@/hooks/use-dictation-shortcuts";
import { DICTATION_PREFERENCES_CHANGED, loadDictationPreferences } from "@/lib/dictation-preferences";
import { captureDictationTarget, type DictationTarget } from "@/lib/dictation-target";
import { transcribeDictation } from "@/lib/medical-dictation-api";
import { cleanupMedicalDictation } from "@/lib/medical-dictation-cleanup";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import { DictationContext } from "./dictation-context";

/** Mounted once above all workspace routes; shells only render controls for this controller. */
export function DictationProvider({ children, enabled, sessionId }: { children: ReactNode; enabled: boolean; sessionId: number | undefined }) {
  const location = useLocation();
  const { t } = useLanguage();
  const [preferences, setPreferences] = useState(loadDictationPreferences);
  const recorder = useAudioRecorder(preferences.deviceId);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const destination = useRef<DictationTarget | null>(null);
  const remembered = useRef<DictationTarget | null>(null);
  const running = useRef(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const attempted = useRef<Blob | null>(null);
  const controls = (element: Element | null) => Boolean(element?.closest('[data-dictation-toolbar]'));
  const settingsOpen = () => Boolean(document.querySelector('[data-dictation-controls]'));
  const cancel = () => {
    generation.current++; request.current?.abort(); request.current = null;
    destination.current = null; running.current = false; setBusy(false); setProcessing(false); recorder.cancel();
  };
  const start = () => {
    if (!enabled || running.current || settingsOpen()) return;
    const target = captureDictationTarget(document.activeElement) ?? (controls(document.activeElement) ? remembered.current : null);
    if (!target?.valid()) {
      pushToast({ type: "error", title: t("dictation.controlsTitle"), message: t("dictation.selectField") });
      return;
    }
    cancel(); destination.current = target; running.current = true; setBusy(true);
    void recorder.start();
  };
  const stop = () => { if (running.current && !processing) recorder.stop(); };
  const toggle = () => { if (running.current) stop(); else start(); };
  const latest = useRef({ cancel, enabled });
  useLayoutEffect(() => { latest.current = { cancel, enabled }; });
  useLayoutEffect(() => {
    cancel(); remembered.current = null;
    // Every navigation, account change, logout, or lock invalidates pending audio and text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, location.key]);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  useEffect(() => {
    const refresh = () => { latest.current.cancel(); setPreferences(loadDictationPreferences()); };
    window.addEventListener(DICTATION_PREFERENCES_CHANGED, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(DICTATION_PREFERENCES_CHANGED, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => {
    const remember = () => {
      if (!latest.current.enabled || running.current || controls(document.activeElement)) return;
      remembered.current = captureDictationTarget(document.activeElement);
    };
    const focus = () => {
      if (running.current && document.activeElement !== destination.current?.element && !controls(document.activeElement)) latest.current.cancel();
      remember();
    };
    const edit = (event: Event) => {
      if (running.current && destination.current?.element.contains(event.target as Node)) latest.current.cancel();
      remember();
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (running.current && !controls(target) && !destination.current?.element.contains(target)) latest.current.cancel();
    };
    const invalid = () => { if (running.current && !destination.current?.valid()) latest.current.cancel(); };
    const observer = new MutationObserver(invalid);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "readonly", "hidden", "inert", "aria-hidden", "data-dictation-context", "contenteditable", "data-dictation"] });
    document.addEventListener("focusin", focus); document.addEventListener("selectionchange", remember); document.addEventListener("select", remember, true);
    document.addEventListener("input", edit, true); document.addEventListener("pointerdown", pointer, true);
    return () => {
      observer.disconnect(); document.removeEventListener("focusin", focus); document.removeEventListener("selectionchange", remember); document.removeEventListener("select", remember, true);
      document.removeEventListener("input", edit, true); document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  useDictationShortcuts({ enabled, preferences,
    isActive: () => !settingsOpen() && (running.current || Boolean(captureDictationTarget(document.activeElement))), start, stop, toggle, cancel, isRecording: () => running.current });
  useEffect(() => {
    if (recorder.error || (recorder.phase === "idle" && recorder.notice && !recorder.recording)) {
      running.current = false; destination.current = null; setBusy(false);
    }
    if (recorder.error) pushToast({ type: "error", title: t("dictation.controlsTitle"), message: t(`dictation.recorderError.${recorder.error}`) });
    if (recorder.notice) pushToast({ type: "info", title: t("dictation.controlsTitle"), message: recorder.notice });
  }, [recorder.error, recorder.notice, recorder.phase, recorder.recording, t]);
  useEffect(() => {
    const audio = recorder.recording;
    const target = destination.current;
    if (!audio || !target || attempted.current === audio) return;
    attempted.current = audio;
    const current = generation.current;
    const controller = new AbortController(); request.current = controller; setProcessing(true);
    void (async () => {
      try {
        if (!target.valid()) { cancel(); return; }
        const result = await transcribeDictation(audio, controller.signal);
        if (current !== generation.current) return;
        const text = cleanupMedicalDictation(result.text);
        if (!text.trim()) throw new Error(t("dictation.noSpeech"));
        if (!target.valid()) { cancel(); return; }
        // End the session before emitting input; our own insertion must not cancel itself.
        running.current = false;
        if (!target.insert(text)) throw new Error(t("dictation.insertFailed"));
      } catch (error) {
        if (current === generation.current) pushToast({ type: "error", title: t("dictation.controlsTitle"), message: error instanceof Error ? error.message : t("dictation.actionError") });
      } finally {
        if (current === generation.current) cancel();
      }
    })();
    // The blob is attempted once; cancellation is guarded by the generation and abort signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recording]);
  return <DictationContext.Provider value={enabled ? { busy, recording: recorder.phase === "recording" || recorder.phase === "requesting", processing: processing || recorder.phase === "stopping", toggle, cancel } : null}>{children}</DictationContext.Provider>;
}
