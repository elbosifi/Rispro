import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeArabicName, normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import type { UserId } from "../types/http.js";

export interface PatientNotAllowedNameWordRow {
  id: number;
  arabic_text: string;
  normalized_arabic_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatientNotAllowedNameWordPayload {
  arabicText?: unknown;
  isActive?: boolean | string | number | null;
}

function normalizeWordText(value: unknown): { arabicText: string; normalizedArabicText: string } {
  const arabicText = String(value || "").trim();
  const normalizedArabicText = normalizeArabicName(arabicText);

  if (!arabicText || !normalizedArabicText) {
    throw new HttpError(400, "arabicText is required.");
  }

  if (normalizedArabicText.split(/\s+/).length !== 1) {
    throw new HttpError(400, "arabicText must be one word.");
  }

  return { arabicText, normalizedArabicText };
}

function normalizeActiveFlag(value: boolean | string | number | null | undefined): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() !== "false";
}

export async function listPatientNotAllowedNameWords(
  { includeInactive = false }: { includeInactive?: boolean } = {}
): Promise<PatientNotAllowedNameWordRow[]> {
  const { rows } = await pool.query<PatientNotAllowedNameWordRow>(
    `
      select id, arabic_text, normalized_arabic_text, is_active, created_at, updated_at
      from patient_not_allowed_name_words
      ${includeInactive ? "" : "where is_active = true"}
      order by arabic_text asc
    `
  );

  return rows;
}

export async function upsertPatientNotAllowedNameWord(
  payload: PatientNotAllowedNameWordPayload | null | undefined,
  currentUserId: UserId
): Promise<PatientNotAllowedNameWordRow> {
  const { arabicText, normalizedArabicText } = normalizeWordText(payload?.arabicText);
  const isActive = normalizeActiveFlag(payload?.isActive);
  const { rows } = await pool.query<PatientNotAllowedNameWordRow>(
    `
      insert into patient_not_allowed_name_words (arabic_text, normalized_arabic_text, is_active)
      values ($1, $2, $3)
      on conflict (normalized_arabic_text)
      do update set arabic_text = excluded.arabic_text, is_active = excluded.is_active, updated_at = now()
      returning id, arabic_text, normalized_arabic_text, is_active, created_at, updated_at
    `,
    [arabicText, normalizedArabicText, isActive]
  );

  const entry = rows[0];
  if (!entry) throw new HttpError(500, "Failed to save not-allowed name word.");

  await logAuditEntry({
    entityType: "patient_not_allowed_name_word",
    entityId: entry.id,
    actionType: "upsert",
    oldValues: null,
    newValues: entry,
    changedByUserId: currentUserId
  });

  return entry;
}

export async function deletePatientNotAllowedNameWord(
  wordId: UserId,
  currentUserId: UserId
): Promise<PatientNotAllowedNameWordRow> {
  const cleanWordId = normalizePositiveInteger(wordId, "wordId") as number;
  const { rows } = await pool.query<PatientNotAllowedNameWordRow>(
    `
      delete from patient_not_allowed_name_words
      where id = $1
      returning id, arabic_text, normalized_arabic_text, is_active, created_at, updated_at
    `,
    [cleanWordId]
  );

  const removed = rows[0];
  if (!removed) throw new HttpError(404, "Not-allowed name word not found.");

  await logAuditEntry({
    entityType: "patient_not_allowed_name_word",
    entityId: removed.id,
    actionType: "delete",
    oldValues: removed,
    newValues: null,
    changedByUserId: currentUserId
  });

  return removed;
}

export function findBlockedArabicNameWord(arabicFullName: string, words: PatientNotAllowedNameWordRow[]): string | null {
  const blockedWords = new Set(words.map((word) => word.normalized_arabic_text).filter(Boolean));
  const nameWords = normalizeArabicName(arabicFullName).split(/\s+/).filter(Boolean);

  for (const word of nameWords) {
    if (blockedWords.has(word)) return word;
  }

  return null;
}
