import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeLibyanPhone } from "../utils/normalize.js";
import {
  isValidNationalId,
  deriveSexFromNationalId,
  deriveDobFromNationalId,
  calculateAgeFromDob
} from "../utils/national-id.js";
import { generateEnglishFromDictionary, type NameDictionaryLookup } from "../utils/name-generation.js";
import { createPatient, type PatientPayload } from "./patient-service.js";
import type { OptionalUserId, UnknownRecord, UserId } from "../types/http.js";
import type { PoolClient } from "pg";
import { parseWorksheet, readWorkbookFromBase64 } from "./workbook-service.js";

interface SettingsRow {
  setting_key: string;
  setting_value?: { value?: unknown } | null;
}

interface ImportBatchRow {
  id: number;
  source_filename: string;
  source_sheet_name: string | null;
  patient_category: "oncology" | "non_oncology" | null;
  imported_by_user_id: number | null;
  imported_at: string;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  migrated_rows: number;
  created_at: string;
  updated_at: string;
}

interface ImportStagingRow {
  id: number;
  batch_id: number;
  row_number: number;
  arabic_full_name: string | null;
  english_full_name: string | null;
  national_id: string | null;
  phone: string | null;
  derived_birth_date: string | null;
  derived_age_years: number | null;
  derived_sex: string | null;
  validation_status: string;
  validation_message: string | null;
  matched_existing_patient_id: number | null;
  is_selected_for_migration: boolean;
  migrated_patient_id: number | null;
  raw_row_json: UnknownRecord | null;
  created_at: string;
  updated_at: string;
}

interface RawParsedRow {
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface PreviewMapping {
  arabic_full_name: string;
  national_id: string;
  phone?: string;
}

export interface CreateBatchInput {
  sourceFilename: string;
  sourceSheetName?: string | null;
  patientCategory?: "oncology" | "non_oncology" | null;
  rows: RawParsedRow[];
  mapping: PreviewMapping;
}

export interface ParsedWorkbookPreview {
  sheetNames: string[];
  selectedSheetName: string;
  headers: string[];
  rows: RawParsedRow[];
}

async function loadNameDictionary(client: { query: PoolClient["query"] }): Promise<NameDictionaryLookup[]> {
  const { rows } = await client.query<NameDictionaryLookup>(
    `
      select arabic_text, english_text
      from name_dictionary
      where is_active = true
      order by arabic_text asc
    `
  );

  return rows;
}

async function isPhoneRequired(client: { query: PoolClient["query"] }): Promise<boolean> {
  const { rows } = await client.query<SettingsRow>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'patient_registration'
        and setting_key = 'phone1_required'
      limit 1
    `
  );

  const raw = String(rows[0]?.setting_value?.value ?? "required").trim().toLowerCase();
  return raw !== "optional";
}

function normalizeNationalId(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeArabicFullName(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizePhone(value: unknown): string {
  return normalizeLibyanPhone(String(value || ""));
}

function normalizeBatchCategory(value: unknown): "oncology" | "non_oncology" | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (raw === "oncology") return "oncology";
  if (raw === "non_oncology") return "non_oncology";
  throw new HttpError(400, "patientCategory must be 'oncology' or 'non_oncology'.");
}

async function findExistingPatientByNationalId(
  client: { query: PoolClient["query"] },
  nationalId: string
): Promise<number | null> {
  const { rows } = await client.query<{ id: number }>(
    `
      select p.id
      from patients p
      where p.national_id = $1
      limit 1
    `,
    [nationalId]
  );

  return rows[0]?.id ? Number(rows[0].id) : null;
}

function mapSexToCreatePatientValue(sex: string | null): string | undefined {
  if (!sex) return undefined;
  if (sex === "M") return "M";
  if (sex === "F") return "F";
  return undefined;
}

function mapStagingRow(row: ImportStagingRow): ImportStagingRow {
  const rawDob = row.derived_birth_date as unknown;
  const formatDateParts = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const normalizedDob =
    rawDob instanceof Date
      ? formatDateParts(rawDob)
      : rawDob == null
        ? null
        : String(rawDob).slice(0, 10);

  return {
    ...row,
    id: Number(row.id),
    batch_id: Number(row.batch_id),
    row_number: Number(row.row_number),
    derived_birth_date: normalizedDob,
    derived_age_years: row.derived_age_years == null ? null : Number(row.derived_age_years),
    matched_existing_patient_id:
      row.matched_existing_patient_id == null ? null : Number(row.matched_existing_patient_id),
    migrated_patient_id: row.migrated_patient_id == null ? null : Number(row.migrated_patient_id),
  };
}

async function recomputeBatchCounters(client: PoolClient, batchId: number): Promise<void> {
  const { rows } = await client.query<{
    total_rows: number;
    valid_rows: number;
    invalid_rows: number;
    duplicate_rows: number;
    migrated_rows: number;
  }>(
    `
      select
        count(*)::int as total_rows,
        count(*) filter (where validation_status = 'valid')::int as valid_rows,
        count(*) filter (where validation_status = 'invalid')::int as invalid_rows,
        count(*) filter (where validation_status = 'duplicate')::int as duplicate_rows,
        count(*) filter (where validation_status = 'migrated')::int as migrated_rows
      from patient_import_staging_rows
      where batch_id = $1
    `,
    [batchId]
  );

  const summary = rows[0];
  if (!summary) return;

  await client.query(
    `
      update patient_import_batches
      set
        total_rows = $2,
        valid_rows = $3,
        invalid_rows = $4,
        duplicate_rows = $5,
        migrated_rows = $6,
        updated_at = now()
      where id = $1
    `,
    [
      batchId,
      Number(summary.total_rows || 0),
      Number(summary.valid_rows || 0),
      Number(summary.invalid_rows || 0),
      Number(summary.duplicate_rows || 0),
      Number(summary.migrated_rows || 0),
    ]
  );
}

export async function parseWorkbookBase64(
  fileContentBase64: string,
  selectedSheetName?: string
): Promise<ParsedWorkbookPreview> {
  const { XLSX, workbook, sheetNames } = await readWorkbookFromBase64(fileContentBase64);

  const selectedSheet = String(selectedSheetName || "").trim();
  const effectiveSheetName = selectedSheet || sheetNames[0]!;

  if (!sheetNames.includes(effectiveSheetName)) {
    throw new HttpError(400, `Sheet '${effectiveSheetName}' was not found in workbook.`);
  }

  const parsedSheet = parseWorksheet(XLSX, workbook.Sheets[effectiveSheetName], effectiveSheetName);
  const headers = parsedSheet.headers;
  const rows = parsedSheet.rows as RawParsedRow[];

  return {
    sheetNames,
    selectedSheetName: effectiveSheetName,
    headers,
    rows
  };
}

export async function createImportBatchFromParsedRows(
  input: CreateBatchInput,
  importedByUserId: UserId
): Promise<{ batch: ImportBatchRow; summary: Record<string, number> }> {
  const sourceFilename = String(input.sourceFilename || "").trim();
  const sourceSheetName = String(input.sourceSheetName || "").trim() || null;
  const patientCategory = normalizeBatchCategory(input.patientCategory);
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const mapping = input.mapping;

  if (!sourceFilename) {
    throw new HttpError(400, "sourceFilename is required.");
  }

  if (!mapping || !mapping.arabic_full_name || !mapping.national_id) {
    throw new HttpError(400, "Mapping must include arabic_full_name and national_id columns.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const dictionary = await loadNameDictionary(client);
    const phoneRequired = await isPhoneRequired(client);

    const batchRes = await client.query<ImportBatchRow>(
      `
        insert into patient_import_batches (
          source_filename,
          source_sheet_name,
          patient_category,
          imported_by_user_id,
          status
        )
        values ($1, $2, $3, $4, 'staged')
        returning *
      `,
      [sourceFilename, sourceSheetName, patientCategory, importedByUserId]
    );

    const batch = batchRes.rows[0];
    if (!batch) {
      throw new HttpError(500, "Failed to create import batch.");
    }

    for (const row of rows) {
      const rawValues = row.values || {};
      const arabicRaw = rawValues[mapping.arabic_full_name];
      const nationalIdRaw = rawValues[mapping.national_id];
      const phoneRaw = mapping.phone ? rawValues[mapping.phone] : "";

      const arabicName = normalizeArabicFullName(arabicRaw);
      const nationalId = normalizeNationalId(nationalIdRaw);
      const phone = normalizePhone(phoneRaw);

      let validationStatus: "valid" | "invalid" | "duplicate" = "valid";
      let validationMessage = "";
      let matchedExistingPatientId: number | null = null;

      if (!arabicName) {
        validationStatus = "invalid";
        validationMessage = "Arabic full name is required.";
      }

      if (validationStatus === "valid" && !nationalId) {
        validationStatus = "invalid";
        validationMessage = "National ID is required.";
      }

      if (validationStatus === "valid" && !isValidNationalId(nationalId)) {
        validationStatus = "invalid";
        validationMessage = "National ID must be exactly 12 digits.";
      }

      if (validationStatus === "valid" && phoneRequired && phone.length !== 10) {
        validationStatus = "invalid";
        validationMessage = "Phone is required and must be exactly 10 digits.";
      }

      const derivedSex = validationStatus === "valid" ? deriveSexFromNationalId(nationalId) : "";
      const derivedDob = validationStatus === "valid" ? deriveDobFromNationalId(nationalId) : null;
      const derivedAge = derivedDob ? calculateAgeFromDob(derivedDob) : null;

      const transliteration = generateEnglishFromDictionary(arabicName, dictionary);
      const englishName = transliteration.englishName;

      if (validationStatus === "valid") {
        matchedExistingPatientId = await findExistingPatientByNationalId(client, nationalId);
        if (matchedExistingPatientId) {
          validationStatus = "duplicate";
          validationMessage = "Patient with this national ID already exists.";
        }
      }

      await client.query(
        `
          insert into patient_import_staging_rows (
            batch_id,
            row_number,
            arabic_full_name,
            english_full_name,
            national_id,
            phone,
            derived_birth_date,
            derived_age_years,
            derived_sex,
            validation_status,
            validation_message,
            matched_existing_patient_id,
            is_selected_for_migration,
            raw_row_json
          )
          values (
            $1,
            $2,
            nullif($3, ''),
            nullif($4, ''),
            nullif($5, ''),
            nullif($6, ''),
            $7,
            $8,
            nullif($9, ''),
            $10,
            nullif($11, ''),
            $12,
            $13,
            $14::jsonb
          )
        `,
        [
          Number(batch.id),
          Number(row.rowNumber || 0),
          arabicName,
          englishName,
          nationalId,
          phone,
          derivedDob,
          derivedAge,
          derivedSex || "",
          validationStatus,
          validationMessage,
          matchedExistingPatientId,
          validationStatus === "valid",
          JSON.stringify(rawValues || {})
        ]
      );
    }

    await recomputeBatchCounters(client, Number(batch.id));

    const freshBatchRes = await client.query<ImportBatchRow>(
      `
        select *
        from patient_import_batches
        where id = $1
        limit 1
      `,
      [Number(batch.id)]
    );

    const freshBatch = freshBatchRes.rows[0];
    if (!freshBatch) {
      throw new HttpError(500, "Failed to load saved import batch.");
    }

    await client.query("commit");

    return {
      batch: freshBatch,
      summary: {
        totalRows: Number(freshBatch.total_rows || 0),
        validRows: Number(freshBatch.valid_rows || 0),
        invalidRows: Number(freshBatch.invalid_rows || 0),
        duplicateRows: Number(freshBatch.duplicate_rows || 0),
        migratedRows: Number(freshBatch.migrated_rows || 0),
      }
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listImportBatch(batchId: number): Promise<ImportBatchRow> {
  const { rows } = await pool.query<ImportBatchRow>(
    `
      select *
      from patient_import_batches
      where id = $1
      limit 1
    `,
    [batchId]
  );

  const batch = rows[0];
  if (!batch) {
    throw new HttpError(404, "Import batch not found.");
  }

  return batch;
}

export async function listImportRows(batchId: number): Promise<ImportStagingRow[]> {
  const { rows } = await pool.query<ImportStagingRow>(
    `
      select *
      from patient_import_staging_rows
      where batch_id = $1
      order by row_number asc, id asc
    `,
    [batchId]
  );

  return rows.map(mapStagingRow);
}

export async function updateRowSelection(
  batchId: number,
  rowIds: number[],
  selected: boolean,
  actingUserId: OptionalUserId
): Promise<{ updated: number }> {
  const cleanIds = Array.from(new Set(rowIds)).filter((id) => Number.isInteger(id) && id > 0);
  if (cleanIds.length === 0) {
    return { updated: 0 };
  }

  const { rowCount } = await pool.query(
    `
      update patient_import_staging_rows
      set
        is_selected_for_migration = $3,
        updated_at = now()
      where batch_id = $1
        and id = any($2::bigint[])
        and validation_status = 'valid'
    `,
    [batchId, cleanIds, selected]
  );

  if (actingUserId) {
    await pool.query(
      `
        update patient_import_batches
        set updated_at = now()
        where id = $1
      `,
      [batchId]
    ).catch(() => undefined);
  }

  return { updated: Number(rowCount || 0) };
}

export async function confirmBatchMigration(
  batchId: number,
  actingUserId: UserId
): Promise<{ migrated: number; skipped: number }> {
  let migrated = 0;
  let skipped = 0;

  const batchRes = await pool.query<ImportBatchRow>(
    `
      select *
      from patient_import_batches
      where id = $1
      limit 1
    `,
    [batchId]
  );

  const batch = batchRes.rows[0];
  if (!batch) {
    throw new HttpError(404, "Import batch not found.");
  }

  const rowsRes = await pool.query<ImportStagingRow>(
    `
      select *
      from patient_import_staging_rows
      where batch_id = $1
        and validation_status = 'valid'
        and is_selected_for_migration = true
      order by row_number asc, id asc
    `,
    [batchId]
  );

  const rows = rowsRes.rows.map(mapStagingRow);

  for (const row of rows) {
    const nationalId = String(row.national_id || "").trim();
    const existingPatientId = await findExistingPatientByNationalId(pool, nationalId);

    if (existingPatientId) {
      skipped += 1;
      await pool.query(
        `
          update patient_import_staging_rows
          set
            validation_status = 'skipped',
            validation_message = 'already_exists_at_migration_time',
            matched_existing_patient_id = $2,
            is_selected_for_migration = false,
            updated_at = now()
          where id = $1
        `,
        [row.id, existingPatientId]
      );
      continue;
    }

    const payload: PatientPayload = {
      identifierType: "national_id",
      identifierValue: nationalId,
      nationalId,
      nationalIdConfirmation: nationalId,
      category: batch.patient_category || undefined,
      arabicFullName: String(row.arabic_full_name || ""),
      englishFullName: String(row.english_full_name || ""),
      sex: mapSexToCreatePatientValue(row.derived_sex),
      estimatedDateOfBirth: row.derived_birth_date || undefined,
      ageYears: row.derived_age_years == null ? undefined : Number(row.derived_age_years),
      phone1: String(row.phone || ""),
      autoGenerateEnglish: false,
      demographicsEstimated: false,
    };

    let createdPatientId: number | null = null;
    try {
      const created = await createPatient(payload, actingUserId);
      createdPatientId = Number(created.id);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        Number((error as { statusCode?: unknown }).statusCode) === 409
      ) {
        const raceMatchedId = await findExistingPatientByNationalId(pool, nationalId);
        skipped += 1;
        await pool.query(
          `
            update patient_import_staging_rows
            set
              validation_status = 'skipped',
              validation_message = 'already_exists_at_migration_time',
              matched_existing_patient_id = $2,
              is_selected_for_migration = false,
              updated_at = now()
            where id = $1
          `,
          [row.id, raceMatchedId]
        );
        continue;
      }

      throw error;
    }

    if (!createdPatientId) {
      throw new HttpError(500, `Failed to migrate staged row ${row.id}.`);
    }

    migrated += 1;
    await pool.query(
      `
        update patient_import_staging_rows
        set
          validation_status = 'migrated',
          validation_message = null,
          migrated_patient_id = $2,
          is_selected_for_migration = false,
          updated_at = now()
        where id = $1
      `,
      [row.id, createdPatientId]
    );
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    await recomputeBatchCounters(client, batchId);
    await client.query(
      `
        update patient_import_batches
        set
          status = case
            when migrated_rows > 0 then 'migrated'
            else status
          end,
          updated_at = now()
        where id = $1
      `,
      [batchId]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return { migrated, skipped };
}
