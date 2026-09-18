import { HttpError } from "../../utils/http-error.js";
import { SOP_CATEGORIES, SOP_SECTION_DEFINITIONS, type SopCategory } from "./constants.js";
import type { JsonRecord, SopDocument } from "./types.js";

function isRecord(value: unknown): value is JsonRecord { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function contentText(value: unknown): string { if (typeof value === "string") return value; if (Array.isArray(value)) return value.map(contentText).join(" "); if (isRecord(value)) return contentText(value.text) + " " + contentText(value.content); return ""; }

export function requiredText(value: unknown, field: string): string { const text = String(value ?? "").trim(); if (!text) throw new HttpError(400, `${field} is required.`); return text; }
export function normalizeSopCode(value: unknown): string { const code = String(value ?? "").trim().toUpperCase(); if (!code) throw new HttpError(400, "SOP code is required."); if (!/^[A-Z0-9]+(?:-[A-Z0-9]+){1,5}$/.test(code)) throw new HttpError(400, "SOP code must use uppercase letters/numbers separated by hyphens, for example RAD-MRI-001."); return code; }
export function normalizeSopVersion(value: unknown): string { const version = String(value ?? "").trim(); if (!/^\d+\.\d+$/.test(version)) throw new HttpError(400, "Version must use the form 1.0."); return version; }
export function normalizeSopDate(value: unknown): string | null { const date = String(value ?? "").trim(); if (!date) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new HttpError(400, "Effective date must use YYYY-MM-DD."); return date; }
export function normalizeSopCategory(value: unknown): SopCategory { const parsed = requiredText(value, "Category"); if (!(SOP_CATEGORIES as readonly string[]).includes(parsed)) throw new HttpError(400, "Category is invalid."); return parsed as SopCategory; }

export function validateSopDocument(value: unknown, requireMeaningfulRequiredSections = false): SopDocument {
  if (!isRecord(value) || value.type !== "sop" || value.version !== 1 || !Array.isArray(value.sections) || value.sections.length !== SOP_SECTION_DEFINITIONS.length) throw new HttpError(400, "SOP content must contain the standard eight sections in order.");
  const sections = value.sections.map((raw, index) => {
    const definition = SOP_SECTION_DEFINITIONS[index]!;
    if (!isRecord(raw) || raw.key !== definition.key || raw.title !== definition.title || raw.required !== definition.required || !isRecord(raw.content) || raw.content.type !== "doc") throw new HttpError(400, "SOP sections must match the standard template and order.");
    if (requireMeaningfulRequiredSections && definition.required && !contentText(raw.content).trim()) throw new HttpError(400, `${definition.title} must contain meaningful content before publishing.`);
    return { key: definition.key, title: definition.title, required: definition.required, content: raw.content };
  });
  return { type: "sop", version: 1, sections };
}
