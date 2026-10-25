import { api } from "./api-client";

export interface MedicalDictationSettings {
  enabled: boolean;
  baseUrl: string;
  timeoutSeconds: number;
  allowInsecureHttp: boolean;
  apiKeyConfigured: boolean;
  encryptionReady: boolean;
}
export type DictationStatus = "not_configured" | "disabled" | "connected" | "unavailable" | "error";
export interface DictationHealth { status: DictationStatus; model?: string; message?: string; credentialsValidated: false }
export interface TranscriptionResult { text: string; processing_seconds: number }
export const getDictationSettings = () => api<{ settings: MedicalDictationSettings }>("/medical-dictation/settings");
export const saveDictationSettings = (settings: MedicalDictationSettings, apiKey: string, removeApiKey: boolean) => api<{ settings: MedicalDictationSettings }>("/medical-dictation/settings", { method: "PUT", body: JSON.stringify({ enabled: settings.enabled, baseUrl: settings.baseUrl, timeoutSeconds: settings.timeoutSeconds, allowInsecureHttp: settings.allowInsecureHttp, apiKey, removeApiKey }) });
export const testDictationConnection = () => api<DictationHealth>("/medical-dictation/test-connection", { method: "POST" });
export const getDictationHealth = () => api<DictationHealth>("/medical-dictation/health");
export function transcribeDictation(recording: Blob, signal?: AbortSignal): Promise<TranscriptionResult> {
  const form = new FormData();
  const extension = recording.type.includes("mp4") ? "m4a" : recording.type.includes("ogg") ? "ogg" : recording.type.includes("wav") ? "wav" : "webm";
  form.append("file", recording, `dictation.${extension}`);
  // The backend's saved timeout (up to 600 seconds) is authoritative.
  return api<TranscriptionResult>("/medical-dictation/transcribe", { method: "POST", body: form, signal }, 630_000);
}
