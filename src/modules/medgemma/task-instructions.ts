import { HttpError } from "../../utils/http-error.js";
import { CLEANUP_DICTATION_INSTRUCTIONS } from "./cleanup-instructions.js";

export const MEDGEMMA_TASKS = ["cleanup_dictation", "correct_terminology", "format_radiology_report", "review_radiology_report"] as const;
export type MedGemmaTask = typeof MEDGEMMA_TASKS[number];
export const MAX_INSTRUCTION_LENGTH = 8_000;
const preserve = "Preserve negation, laterality, measurements and units, anatomical location, diagnostic uncertainty and all supplied positive findings. Do not introduce or remove clinical findings.";
export const DEFAULT_MEDGEMMA_INSTRUCTIONS: Record<MedGemmaTask, string> = {
  cleanup_dictation: CLEANUP_DICTATION_INSTRUCTIONS,
  correct_terminology: `Correct clear spelling and transcription errors in commonly used radiology and medical terminology.
${preserve}
Preserve numbers and anatomical relationships. Preserve uncertain terms rather than guessing.
Never silently substitute one diagnosis for another.
Return the corrected text first. If corrections remain uncertain, append a section titled "Uncertain corrections for review:" with a short bullet list. Omit this section when there are no uncertain corrections.`,
  format_radiology_report: `Organize the supplied dictated findings into a professional, editable radiology report using concise radiology language, appropriate headings and regional structure.
${preserve}
Improve grammar, punctuation and organization. Do not invent normal findings or infer absent clinical information.
Do not convert observations into unsupported diagnoses. Do not sign or save the report.
Return only the formatted report.`,
  review_radiology_report: `Review the supplied report for potential inconsistencies without rewriting it.
${preserve}
Check for contradictory findings, laterality inconsistencies, measurement discrepancies, negation errors, inconsistent anatomical descriptions, and unclear or unsupported statements.
Return only a plain-text bullet list of potential issues with short explanations, one issue per bullet. If none are identified, return "No potential issues identified." Do not imply that this guarantees clinical correctness.
This is review assistance, not automatic clinical validation.`,
};
export function isMedGemmaTask(value: unknown): value is MedGemmaTask {
  return typeof value === "string" && MEDGEMMA_TASKS.includes(value as MedGemmaTask);
}
export function validateMedGemmaInstructions(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_INSTRUCTION_LENGTH) throw new HttpError(400, "Instructions must contain 1–8,000 characters.");
}
