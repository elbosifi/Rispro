import { api } from "./api-client";

export interface MedGemmaSettings {
  enabled: boolean;
  baseUrl: string;
  timeoutSeconds: number;
  allowInsecureHttp: boolean;
  apiKeyConfigured: boolean;
  encryptionReady: boolean;
}
export interface MedGemmaHealth { status: "connected" | "unavailable" | "disabled" | "not_configured"; model?: string; message?: string }
export interface MedGemmaResult { text: string; processing_seconds: number }
export const getMedGemmaSettings = () => api<{ settings: MedGemmaSettings }>("/medgemma/settings");
export const saveMedGemmaSettings = (settings: MedGemmaSettings, apiKey: string, removeApiKey: boolean) => api<{ settings: MedGemmaSettings }>("/medgemma/settings", { method: "PUT", body: JSON.stringify({ enabled: settings.enabled, baseUrl: settings.baseUrl, timeoutSeconds: settings.timeoutSeconds, allowInsecureHttp: settings.allowInsecureHttp, apiKey, removeApiKey }) });
export const testMedGemmaConnection = () => api<MedGemmaHealth>("/medgemma/test-connection", { method: "POST" });
export const getMedGemmaHealth = () => api<MedGemmaHealth>("/medgemma/health");
// Allow the saved backend timeout (up to 600 seconds) to complete.
export const cleanupMedGemmaDictation = (text: string) => api<MedGemmaResult>("/medgemma/generate", { method: "POST", body: JSON.stringify({ task: "cleanup_dictation", text }) }, 630_000);
