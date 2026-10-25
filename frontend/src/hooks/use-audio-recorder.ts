import { useCallback, useEffect, useRef, useState } from "react";

export const RECORDING_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus", "audio/wav"];
const MAX_BYTES = 15 * 1024 * 1024;
type MicrophonePolicy = { allowsFeature: (feature: string) => boolean };
export function useAudioRecorder(deviceId?: string) {
  const [phase, setPhase] = useState<"idle" | "requesting" | "recording" | "stopping">("idle");
  const [recording, setRecording] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<"permission" | "policy" | "insecure" | "unavailable" | "unsupported" | "recording" | "empty" | "silent" | "oversized" | null>(null);
  const [level, setLevel] = useState(0);
  const [meterAvailable, setMeterAvailable] = useState(false);
  const [notice, setNotice] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const active = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const release = useCallback(() => {
    clearInterval(interval.current); clearTimeout(limit.current);
    clearInterval(meterTimer.current);
    if (audioContext.current) void audioContext.current.close().catch(() => {});
    audioContext.current = null;
    stream.current?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    stream.current = null;
  }, []);
  const stop = useCallback(() => {
    if (active.current && !recorder.current) {
      generation.current += 1; active.current = false; setPhase("idle");
      setNotice("Recording cancelled before the microphone was ready. Start a new recording when ready.");
    }
    if (recorder.current?.state === "recording") {
      setPhase("stopping");
      try { recorder.current.stop(); }
      catch { active.current = false; setPhase("idle"); setError("recording"); }
    }
    setLevel(0);
    release();
  }, [release]);
  const dispose = useCallback(() => {
    generation.current += 1; active.current = false;
    if (recorder.current) {
      recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.onerror = null;
      if (recorder.current.state !== "inactive") { try { recorder.current.stop(); } catch { /* Still release the device. */ } }
    }
    release();
  }, [release]);
  useEffect(() => dispose, [dispose]);
  const start = useCallback(async () => {
    if (active.current) return;
    setError(null); setNotice(""); setRecording(null); setLevel(0); setMeterAvailable(false); recorder.current = null;
    if (window.isSecureContext === false) { setError("insecure"); return; }
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function" || !navigator.mediaDevices?.getUserMedia) { setError("unsupported"); return; }
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
      let samples = 0;
      let peak = 0;
      // Meter the same stream we record. Never connect it to the speakers.
      // Metering is optional: unavailable/suspended Web Audio must not reject valid audio.
      try {
        const context = new AudioContext(); audioContext.current = context;
        const source = context.createMediaStreamSource(media);
        const analyser = context.createAnalyser(); analyser.fftSize = 2048;
        source.connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const measure = () => {
          if (current !== generation.current || context.state !== "running") return;
          analyser.getFloatTimeDomainData(data);
          const rms = Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
          samples++; peak = Math.max(peak, rms);
          setMeterAvailable(true); setLevel(Math.min(1, rms * 5));
        };
        void context.resume().catch(() => {});
        meterTimer.current = setInterval(measure, 100);
      } catch { /* Recording remains available without a level meter. */ }
      instance.ondataavailable = (event) => {
        if (current !== generation.current) return;
        size += event.data.size;
        if (size > MAX_BYTES) { failed = true; setError("oversized"); stop(); }
        else if (!failed && event.data.size) chunks.push(event.data);
      };
      instance.onerror = () => {
        if (current !== generation.current) return;
        failed = true; setError("recording"); setRecording(null); stop();
        setPhase("idle"); active.current = false;
      };
      instance.onstop = () => {
        if (current !== generation.current) return;
        release(); active.current = false; setPhase("idle"); setLevel(0);
        if (failed) return;
        const blob = new Blob(chunks, { type: instance.mimeType || mimeType });
        if (!blob.size) setError("empty");
        else {
          setRecording(blob);
          // Conservative silence detection, not speech recognition. Keep the blob for local playback.
          if (samples >= 3 && peak < 0.002) setError("silent");
        }
      };
      media.getTracks().forEach((track) => { track.onended = () => { failed = true; setError("unavailable"); stop(); }; });
      instance.start(1000);
      const started = Date.now();
      setPhase("recording");
      interval.current = setInterval(() => setDuration(Math.min(60, Math.floor((Date.now() - started) / 1000))), 250);
      limit.current = setTimeout(() => { setDuration(60); stop(); }, 60_000);
    } catch (e) {
      if (current !== generation.current) return;
      release(); active.current = false; setPhase("idle");
      const policyDocument = document as Document & { permissionsPolicy?: MicrophonePolicy; featurePolicy?: MicrophonePolicy };
      const policy = policyDocument.permissionsPolicy ?? policyDocument.featurePolicy;
      setError(e instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(e.name)
        ? policy?.allowsFeature("microphone") === false ? "policy" : "permission"
        : e instanceof DOMException && ["NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError"].includes(e.name) ? "unavailable" : "recording");
    }
  }, [deviceId, release, stop]);
  const clear = useCallback(() => { setRecording(null); setDuration(0); setError(null); }, []);
  const cancel = useCallback(() => { dispose(); setPhase("idle"); setRecording(null); setDuration(0); setError(null); setNotice(""); setLevel(0); }, [dispose]);
  return { phase, recording, duration, error, notice, level, meterAvailable, start, stop, clear, cancel };
}
