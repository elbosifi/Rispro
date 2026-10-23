import { HttpError } from "../../utils/http-error.js";
import { checkMedGemmaHealth, cleanupMedGemmaDictation } from "./medgemma-client.js";
import { getMedGemmaSettings, resolveMedGemmaSettings } from "./medgemma-settings-service.js";

export interface MedGemmaHealth { status: "connected" | "unavailable" | "disabled" | "not_configured"; model?: string; message?: string }
export async function medGemmaHealth(): Promise<MedGemmaHealth> {
  const saved = await getMedGemmaSettings();
  if (!saved.baseUrl) return { status: "not_configured" };
  if (!saved.enabled) return { status: "disabled" };
  try {
    const settings = await resolveMedGemmaSettings();
    return { status: "connected", ...await checkMedGemmaHealth(settings, settings.apiKey) };
  } catch (error) { return { status: "unavailable", message: error instanceof HttpError ? error.message : "Unable to check MedGemma readiness." }; }
}
export async function generateMedGemmaText(text: string, signal?: AbortSignal) {
  const settings = await resolveMedGemmaSettings();
  return cleanupMedGemmaDictation(settings, settings.apiKey, text, signal);
}
