import { useCallback, useEffect, useRef, useState } from "react";

export const RECORDING_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus", "audio/wav"];
const MAX_BYTES = 15 * 1024 * 1024;
export function useAudioRecorder(deviceId?: string) {
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "stopping">("idle");
  const [recording, setRecording] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<"permission" | "unsupported" | "recording" | "empty" | "oversized" | null>(null);
  const [notice, setNotice] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const active = useRef(false);
  const release = useCallback(() => {
    clearInterval(interval.current); clearTimeout(limit.current);
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    stream.current = null;
  }, []);
  const stop = useCallback(() => {
    if (active.current && !recorder.current) {
      generation.current += 1; active.current = false; setPhase("idle");
      setNotice("Recording cancelled before the microphone was ready. Start a new recording when ready.");
    }
    if (recorder.current?.state === "recording") { setPhase("stopping"); recorder.current.stop(); }
    release();
  }, [release]);
  const dispose = useCallback(() => {
    generation.current += 1; active.current = false;
    if (recorder.current) {
      recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.onerror = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
    }
    release();
  }, [release]);
  useEffect(() => dispose, [dispose]);
  const start = useCallback(async () => {
    if (active.current) return;
    setError(null); setNotice(""); recorder.current = null;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setError("unsupported"); return; }
    const mimeType = RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { setError("unsupported"); return; }
    active.current = true;
    const current = ++generation.current;
    setPhase("requesting"); setRecording(null); setDuration(0);
    try {
      let media: MediaStream;
      try { media = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true }); }
      catch (e) {
        if (current !== generation.current) return;
        if (!deviceId || !(e instanceof DOMException) || !["NotFoundError", "OverconstrainedError", "NotReadableError"].includes(e.name)) throw e;
        setNotice("Selected microphone is unavailable. Using the workstation default microphone.");
        media = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (current !== generation.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const instance = new MediaRecorder(media, { mimeType });
      recorder.current = instance;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      instance.ondataavailable = (event) => {
        size += event.data.size;
        if (size > MAX_BYTES) { failed = true; setError("oversized"); stop(); }
        else if (!failed && event.data.size) chunks.push(event.data);
      };
      instance.onerror = () => {
        failed = true; setError("recording"); setRecording(null); stop();
        setPhase("idle"); active.current = false;
      };
      instance.onstop = () => {
        release(); active.current = false; setPhase("idle");
        if (failed) return;
        const blob = new Blob(chunks, { type: instance.mimeType || mimeType });
        if (!blob.size) setError("empty"); else setRecording(blob);
      };
      media.getTracks().forEach((track) => { track.onended = stop; });
      instance.start(1000);
      const started = Date.now();
      setPhase("recording");
      interval.current = setInterval(() => setDuration(Math.min(60, Math.floor((Date.now() - started) / 1000))), 250);
      limit.current = setTimeout(() => { setDuration(60); stop(); }, 60_000);
    } catch (e) {
      if (current !== generation.current) return;
      release(); active.current = false; setPhase("idle");
      setError(e instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(e.name) ? "permission" : "recording");
    }
  }, [deviceId, release, stop]);
  const clear = useCallback(() => { setRecording(null); setDuration(0); setError(null); }, []);
  const cancel = useCallback(() => { dispose(); setPhase("idle"); setRecording(null); setDuration(0); setError(null); setNotice(""); }, [dispose]);
  return { phase, recording, duration, error, notice, start, stop, clear, cancel };
}
