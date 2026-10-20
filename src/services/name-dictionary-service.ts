import type { PoolClient } from "pg";
import { normalizeArabicNameCompact } from "../utils/normalize.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { invalidateCache } from "../utils/cache.js";
import { logAuditEntry } from "./audit-service.js";
import {
  buildNameDictionaryLookup,
  generateEnglishFromDictionaryLookup
} from "../utils/name-generation.js";
import type { UserId } from "../types/http.js";

export interface NameDictionaryRow {
  id: number;
  arabic_text: string;
  english_text: string;
  is_active: boolean;
  created_at: string;
}

export interface NameDictionaryPayload {
  arabicText?: string;
  englishText?: string;
  isActive?: boolean | string | number | null;
}

const MAX_IMPORT_ENTRIES = 50_000;
const DICTIONARY_COLUMNS = "id, arabic_text, english_text, is_active, created_at";

function normalizePayload(payload: NameDictionaryPayload | null | undefined): { arabicText: string; englishText: string; isActive: boolean } {
  const text = (value: unknown, field: string) => {
    if (typeof value !== "string" || !value.trim() || value.length > 1_000 || value.includes("\0")) {
      throw new HttpError(400, `${field} must be non-empty text of at most 1000 characters.`);
    }
    return value.trim();
  };
  const flag = payload?.isActive;
  if (flag != null && flag !== "" && ![true, false, "true", "false", 1, 0].includes(flag)) {
    throw new HttpError(400, "isActive must be true or false.");
  }
  return { arabicText: text(payload?.arabicText, "arabicText"), englishText: text(payload?.englishText, "englishText"),
    isActive: flag !== false && flag !== "false" && flag !== 0 };
}

async function mutateDictionary<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '5s'");
    // Serialize dictionary writers, including alias checks for create-only additions.
    // Reads remain available throughout imports.
    await client.query("lock table name_dictionary in share row exclusive mode");
    const result = await operation(client);
    await client.query("commit");
    invalidateCache("name_dictionary");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => { discardClient = true; });
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function listNameDictionary({ includeInactive = false }: { includeInactive?: boolean } = {}): Promise<NameDictionaryRow[]> {
  const query = {
    text: `select ${DICTIONARY_COLUMNS} from name_dictionary ${includeInactive ? "" : "where is_active = true"} order by arabic_text asc`,
    query_timeout: 8_000
  };
  const { rows } = await pool.query<NameDictionaryRow>(query);
  return rows;
}

async function upsertWithClient(client: PoolClient, payload: ReturnType<typeof normalizePayload>, currentUserId: UserId): Promise<NameDictionaryRow> {
  const previous = await client.query<NameDictionaryRow>(`select ${DICTIONARY_COLUMNS} from name_dictionary where arabic_text = $1`, [payload.arabicText]);
  const { rows } = await client.query<NameDictionaryRow>(
    `insert into name_dictionary (arabic_text, english_text, is_active) values ($1, $2, $3)
     on conflict (arabic_text) do update set english_text = excluded.english_text, is_active = excluded.is_active
     returning ${DICTIONARY_COLUMNS}`, [payload.arabicText, payload.englishText, payload.isActive]);
  const entry = rows[0]!;
  await logAuditEntry({ entityType: "name_dictionary", entityId: entry.id, actionType: "upsert",
    oldValues: previous.rows[0] ?? null, newValues: entry, changedByUserId: currentUserId }, client);
  return entry;
}

export async function upsertNameDictionary(payload: NameDictionaryPayload | null | undefined, currentUserId: UserId): Promise<NameDictionaryRow> {
  const normalized = normalizePayload(payload);
  return mutateDictionary((client) => upsertWithClient(client, normalized, currentUserId));
}

export async function createMissingNameDictionaryEntry(payload: NameDictionaryPayload | null | undefined, currentUserId: UserId): Promise<NameDictionaryRow> {
  const normalized = normalizePayload(payload);
  if (!normalized.isActive) throw new HttpError(400, "New registration mappings must be active.");
  return mutateDictionary(async (client) => {
    const existing = await client.query<{ arabic_text: string }>("select arabic_text from name_dictionary");
    const key = normalizeArabicNameCompact(normalized.arabicText);
    if (existing.rows.some((entry) => normalizeArabicNameCompact(entry.arabic_text) === key)) {
      throw new HttpError(409, "This name mapping already exists. Reload the dictionary; changes require supervisor re-authentication.");
    }
    return upsertWithClient(client, normalized, currentUserId);
  });
}

function entryIdNumber(entryId: UserId): number {
  const id = Number(entryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "entryId must be a positive whole number.");
  return id;
}

export async function updateNameDictionaryEntry(entryId: UserId, payload: NameDictionaryPayload | null | undefined, currentUserId: UserId): Promise<NameDictionaryRow> {
  const id = entryIdNumber(entryId);
  return mutateDictionary(async (client) => {
    const existing = (await client.query<NameDictionaryRow>(`select ${DICTIONARY_COLUMNS} from name_dictionary where id = $1`, [id])).rows[0];
    if (!existing) throw new HttpError(404, "Dictionary entry not found.");
    const normalized = normalizePayload({ arabicText: payload?.arabicText ?? existing.arabic_text, englishText: payload?.englishText ?? existing.english_text, isActive: payload?.isActive ?? existing.is_active });
    const entry = (await client.query<NameDictionaryRow>(`update name_dictionary set arabic_text = $2, english_text = $3, is_active = $4 where id = $1 returning ${DICTIONARY_COLUMNS}`,
      [id, normalized.arabicText, normalized.englishText, normalized.isActive])).rows[0]!;
    await logAuditEntry({ entityType: "name_dictionary", entityId: entry.id, actionType: "update", oldValues: existing,
      newValues: entry, changedByUserId: currentUserId }, client);
    return entry;
  });
}

export async function deleteNameDictionaryEntry(entryId: UserId, currentUserId: UserId): Promise<NameDictionaryRow> {
  const id = entryIdNumber(entryId);
  return mutateDictionary(async (client) => {
    const entry = (await client.query<NameDictionaryRow>(`delete from name_dictionary where id = $1 returning ${DICTIONARY_COLUMNS}`, [id])).rows[0];
    if (!entry) throw new HttpError(404, "Dictionary entry not found.");
    await logAuditEntry({ entityType: "name_dictionary", entityId: entry.id, actionType: "delete", oldValues: entry, newValues: null, changedByUserId: currentUserId }, client);
    return entry;
  });
}

export async function importNameDictionaryEntries(entries: Array<NameDictionaryPayload | null | undefined>, currentUserId: UserId): Promise<NameDictionaryRow[]> {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_IMPORT_ENTRIES) {
    throw new HttpError(400, `entries must contain between 1 and ${MAX_IMPORT_ENTRIES} mappings.`);
  }
  // Validate every row before acquiring a connection or modifying anything.
  const normalized = entries.map((entry, index) => {
    try { return normalizePayload(entry); }
    catch (error) { throw new HttpError(400, `CSV row ${index + 1}: ${error instanceof Error ? error.message : "Invalid mapping."}`); }
  });
  // Exact duplicate Arabic keys use the last row, matching the previous upsert semantics.
  const unique = [...new Map(normalized.map((entry) => [entry.arabicText, entry])).values()];
  return mutateDictionary(async (client) => {
    const imported: NameDictionaryRow[] = [];
    // Serial writes bound DB load; one connection and one transaction for the file.
    for (const entry of unique) imported.push(await upsertWithClient(client, entry, currentUserId));
    return imported;
  });
}

export async function applyNameDictionaryToPatients(currentUserId: UserId): Promise<{
  scannedCount: number;
  updatedCount: number;
  skippedMissingTokensCount: number;
}> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query("begin");
    const { rows: dictionaryRows } = await client.query<NameDictionaryRow>(
      `
        select id, arabic_text, english_text, is_active, created_at
        from name_dictionary
        where is_active = true
        order by arabic_text asc
      `
    );
    const { rows: patientRows } = await client.query<{ id: number; arabic_full_name: string; english_full_name: string | null }>(
      `
        select id, arabic_full_name, english_full_name
        from patients
        where coalesce(arabic_full_name, '') <> ''
        order by id for update
      `
    );
    const dictionaryLookup = buildNameDictionaryLookup(dictionaryRows);

    let updatedCount = 0;
    let skippedMissingTokensCount = 0;

    for (const patient of patientRows) {
      const generated = generateEnglishFromDictionaryLookup(patient.arabic_full_name, dictionaryLookup);
      if (generated.missingTokens.length > 0 || !generated.englishName.trim()) {
        skippedMissingTokensCount += 1;
        continue;
      }
      if (String(patient.english_full_name || "").trim() === generated.englishName.trim()) continue;

      await client.query(
        `
          update patients
          set english_full_name = $2, updated_at = now(), updated_by_user_id = $3
          where id = $1
        `,
        [patient.id, generated.englishName.trim(), currentUserId]
      );

      await logAuditEntry({ entityType: "patient", entityId: patient.id, actionType: "name_dictionary_update",
        oldValues: { englishFullName: patient.english_full_name }, newValues: { englishFullName: generated.englishName.trim() },
        changedByUserId: currentUserId }, client);

      const revokedIdentityDocuments =
        await client.query<{ id: number }>(
          `
            update documents
            set
              identity_verified_at = null,
              identity_verified_by_user_id = null
            where patient_id = $1
              and document_type = 'patient_identity_document'
              and identity_verified_at is not null
            returning id
          `,
          [patient.id]
        );

      for (const document of revokedIdentityDocuments.rows) {
        await logAuditEntry(
          {
            entityType: "patient_identity_document",
            entityId: Number(document.id),
            actionType:
              "identity_verification_revoked_after_name_dictionary_update",
            oldValues: {
              patientId: patient.id,
              documentId: Number(document.id),
            },
            newValues: null,
            changedByUserId: currentUserId,
          },
          client
        );
      }

      updatedCount += 1;
    }

    await logAuditEntry(
      {
        entityType: "name_dictionary",
        entityId: 0,
        actionType: "apply_to_patients",
        oldValues: null,
        newValues: { scannedCount: patientRows.length, updatedCount, skippedMissingTokensCount },
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return { scannedCount: patientRows.length, updatedCount, skippedMissingTokensCount };
  } catch (error) {
    await client.query("rollback").catch(() => { discardClient = true; });
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function listUnresolvedNameDictionaryPatients(): Promise<{
  scannedCount: number;
  unresolvedCount: number;
  patients: Array<{
    id: number;
    arabicFullName: string;
    englishFullName: string | null;
    missingTokens: string[];
  }>;
}> {
  const { rows: dictionaryRows } = await pool.query<NameDictionaryRow>(
    `
      select id, arabic_text, english_text, is_active, created_at
      from name_dictionary
      where is_active = true
      order by arabic_text asc
    `
  );
  const { rows: patientRows } = await pool.query<{ id: number; arabic_full_name: string; english_full_name: string | null }>(
    `
      select id, arabic_full_name, english_full_name
      from patients
      where coalesce(arabic_full_name, '') <> ''
    `
  );
  const dictionaryLookup = buildNameDictionaryLookup(dictionaryRows);
  const patients = patientRows.flatMap((patient) => {
    const generated = generateEnglishFromDictionaryLookup(patient.arabic_full_name, dictionaryLookup);
    return generated.missingTokens.length > 0
      ? [{
        id: patient.id,
        arabicFullName: patient.arabic_full_name,
        englishFullName: patient.english_full_name,
        missingTokens: generated.missingTokens
      }]
      : [];
  });

  return {
    scannedCount: patientRows.length,
    unresolvedCount: patients.length,
    patients
  };
}
