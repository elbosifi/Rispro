import { HttpError } from "../../utils/http-error.js";
import { checkMedAsrHealth, transcribeMedAsr, type DictationAudio } from "./medasr-client.js";
import { getMedicalDictationSettings, resolveMedicalDictationSettings } from "./medical-dictation-settings-service.js";

export type DictationStatus = "not_configured" | "disabled" | "connected" | "unavailable" | "error";
export interface DictationHealth { status: DictationStatus; model?: string; message?: string; credentialsValidated: false }
export async function medicalDictationHealth(): Promise<DictationHealth> {
  const settings = await getMedicalDictationSettings();
  if (!settings.baseUrl) return { status: "not_configured", credentialsValidated: false };
  if (!settings.enabled) return { status: "disabled", credentialsValidated: false };
  if (!settings.encryptionReady) return { status: "error", message: "Platform credential encryption is unavailable.", credentialsValidated: false };
  try { return { status: "connected", ...await checkMedAsrHealth(settings), credentialsValidated: false }; }
  catch (error) {
    const code = error instanceof HttpError ? (error.details as { code?: string } | null)?.code : undefined;
    return { status: code === "MEDASR_NETWORK" || code === "MEDASR_TIMEOUT" ? "unavailable" : "error", message: error instanceof HttpError ? error.message : "Unable to check MedASR readiness.", credentialsValidated: false };
  }
}
export async function transcribeMedicalDictation(audio: DictationAudio, signal?: AbortSignal) {
  const settings = await resolveMedicalDictationSettings();
  return transcribeMedAsr(settings, settings.apiKey, audio, signal);
}
