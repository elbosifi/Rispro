import { api } from "./api-client";

export const MEDGEMMA_TASKS = ["cleanup_dictation", "correct_terminology", "format_radiology_report", "review_radiology_report"] as const;
export type MedGemmaTask = typeof MEDGEMMA_TASKS[number];
export interface MedGemmaSettings {
  provider: "standalone" | "ollama";
  ollamaBaseUrl: string;
  ollamaModel: string;
  enabled: boolean;
  baseUrl: string;
  timeoutSeconds: number;
  allowInsecureHttp: boolean;
  apiKeyConfigured: boolean;
  encryptionReady: boolean;
  instructions: Record<MedGemmaTask, string>;
  instructionDefaults: Record<MedGemmaTask, string>;
  temperature: number;
  maxGeneratedTokens: number;
}
export interface MedGemmaHealth { status: "connected" | "unavailable" | "disabled" | "not_configured"; model?: string; message?: string }
export interface MedGemmaResult { text: string; processing_seconds: number }
export const getMedGemmaSettings = () => api<{ settings: MedGemmaSettings }>("/medgemma/settings");
export const saveMedGemmaSettings = (settings: MedGemmaSettings, apiKey: string, removeApiKey: boolean) => api<{ settings: MedGemmaSettings }>("/medgemma/settings", { method: "PUT", body: JSON.stringify({ provider: settings.provider, ollamaBaseUrl: settings.ollamaBaseUrl, ollamaModel: settings.ollamaModel, enabled: settings.enabled, baseUrl: settings.baseUrl, timeoutSeconds: settings.timeoutSeconds, allowInsecureHttp: settings.allowInsecureHttp, instructions: settings.instructions, temperature: settings.temperature, maxGeneratedTokens: settings.maxGeneratedTokens, apiKey: settings.provider === "ollama" ? "" : apiKey, removeApiKey: settings.provider === "ollama" ? false : removeApiKey }) });
export const testMedGemmaConnection = () => api<MedGemmaHealth>("/medgemma/test-connection", { method: "POST" });
export const getMedGemmaHealth = () => api<MedGemmaHealth>("/medgemma/health");
// Allow the saved backend timeout (up to 600 seconds) to complete.
export const generateMedGemmaText = (task: MedGemmaTask, text: string, instructionsOverride?: string) => api<MedGemmaResult>("/medgemma/generate", { method: "POST", body: JSON.stringify({ task, text, ...(instructionsOverride?.trim() ? { instructionsOverride } : {}) }) }, 630_000);
export const cleanupMedGemmaDictation = (text: string) => generateMedGemmaText("cleanup_dictation", text);
