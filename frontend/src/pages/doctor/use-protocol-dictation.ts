import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { transcribeDictation } from "@/lib/medical-dictation-api";
import { cleanupMedicalDictation } from "@/lib/medical-dictation-cleanup";
import type { ProtocolDictationTarget } from "./protocol-dictation-fields";

/** One recording at a time, delivered directly to the existing Protocoling field. */
export function useProtocolDictation(deviceId: string, onInsert: (target: ProtocolDictationTarget, text: string) => boolean) {
  const recorder = useAudioRecorder(deviceId);
  const [target, setTarget] = useState<ProtocolDictationTarget | null>(null);
  const targetRef = useRef<ProtocolDictationTarget | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const attempted = useRef<Blob | null>(null);
  const insert = useRef(onInsert);
  useLayoutEffect(() => { insert.current = onInsert; }, [onInsert]);
  useEffect(() => () => { generation.current++; targetRef.current = null; }, []);
  const cancel = () => {
    generation.current++; running.current = false; inFlight.current = false; targetRef.current = null; setTarget(null);
    setProcessing(false); setError(""); recorder.cancel();
  };
  const start = (destination: ProtocolDictationTarget) => {
    if (running.current) return;
    cancel(); running.current = true; targetRef.current = destination; setTarget(destination);
    void recorder.start();
  };
  const stop = () => { if (running.current) recorder.stop(); };
  const transcribe = async () => {
    const destination = targetRef.current;
    const audio = recorder.recording;
    if (!destination || !audio || inFlight.current) return;
    const current = generation.current;
    running.current = true; inFlight.current = true; setProcessing(true); setError("");
    try {
      const result = await transcribeDictation(audio);
      if (current !== generation.current) return;
      const cleaned = cleanupMedicalDictation(result.text);
      if (!cleaned.trim()) throw new Error("No speech was recognized. Try recording again.");
      if (!insert.current(destination, cleaned)) throw new Error("The dictation field is no longer available. Select a field and record again.");
      targetRef.current = null; setTarget(null); recorder.clear();
    } catch (e) {
      if (current === generation.current) setError(e instanceof Error ? e.message : "MedASR transcription failed. Try again.");
    } finally {
      if (current === generation.current) { running.current = false; inFlight.current = false; setProcessing(false); }
    }
  };
  useEffect(() => {
    if (recorder.error || (recorder.phase === "idle" && recorder.notice && !recorder.recording)) running.current = false;
    if (recorder.recording && attempted.current !== recorder.recording && targetRef.current) {
      attempted.current = recorder.recording;
      void transcribe();
    }
  });
  const busy = recorder.phase !== "idle" || processing || Boolean(target && !error && !recorder.error && (recorder.recording || !recorder.notice));
  return { target, start, stop, cancel, retry: transcribe, error, processing, phase: recorder.phase,
    busy, duration: recorder.duration, recorderError: recorder.error,
    notice: recorder.notice, canRetry: Boolean(error && recorder.recording && target) };
}
