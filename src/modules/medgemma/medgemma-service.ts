import { HttpError } from "../../utils/http-error.js";
import { checkMedGemmaHealth, generateMedGemma } from "./medgemma-client.js";
import type { MedGemmaTask } from "./task-instructions.js";
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
export async function generateMedGemmaText(task: MedGemmaTask, text: string, instructionsOverride?: string, signal?: AbortSignal) {
  const settings = await resolveMedGemmaSettings();
  return generateMedGemma(settings, settings.apiKey, { task, text, instructions: instructionsOverride ?? settings.instructions[task], temperature: settings.temperature, maxGeneratedTokens: settings.maxGeneratedTokens }, signal);
}
