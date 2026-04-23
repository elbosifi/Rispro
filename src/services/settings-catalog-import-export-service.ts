import { pool } from "../db/pool.js";
import { logAuditEntry } from "./audit-service.js";
import { buildWorkbookBuffer, parseWorksheet, readWorkbookFromBase64 } from "./workbook-service.js";
import { HttpError } from "../utils/http-error.js";
import type { DbExecutor } from "../types/db.js";
import type { UserId } from "../types/http.js";

interface ModalityCatalogRow {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  daily_capacity: number | null;
  general_instruction_ar: string | null;
  general_instruction_en: string | null;
  is_active: boolean;
  safety_warning_ar: string | null;
  safety_warning_en: string | null;
  safety_warning_enabled: boolean;
}

interface ExamTypeCatalogRow {
  id: number;
  modality_id: number;
  modality_code: string;
  code: string;
  name_ar: string;
  name_en: string;
  specific_instruction_ar: string | null;
  specific_instruction_en: string | null;
  duration_minutes: number | null;
  is_active: boolean;
}

interface ImportValidationError {
  sheet: "Modalities" | "ExamTypes";
  rowNumber: number;
  column: string | null;
  message: string;
}

interface ImportSummary {
  modalitiesCreated: number;
  modalitiesUpdated: number;
  examTypesCreated: number;
  examTypesUpdated: number;
  skipped: number;
  errors: ImportValidationError[];
}

interface NormalizedModalityRow {
  rowNumber: number;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  dailyCapacity: number;
  active: boolean;
  safetyWarningEnabled: boolean;
  safetyWarningEn: string;
  safetyWarningAr: string;
}

interface NormalizedExamTypeRow {
  rowNumber: number;
  modalityCode: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  durationMinutes: number | null;
  active: boolean;
}

const MODALITIES_SHEET = "Modalities";
const EXAM_TYPES_SHEET = "ExamTypes";

const MODALITY_COLUMNS = [
  "code",
  "name_en",
  "name_ar",
  "description_en",
  "description_ar",
  "daily_capacity",
  "active",
  "safety_warning_enabled",
  "safety_warning_en",
  "safety_warning_ar"
] as const;

const EXAM_TYPE_COLUMNS = [
  "modality_code",
  "code",
  "name_en",
  "name_ar",
  "description_en",
  "description_ar",
  "duration_minutes",
  "active"
] as const;

function normalizeHeader(header: string): string {
  return String(header || "").trim().toLowerCase();
}

function asTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function keyForCode(value: string): string {
  return value.trim().toLowerCase();
}

function parseRequiredString(
  value: unknown,
  sheet: "Modalities" | "ExamTypes",
  rowNumber: number,
  column: string,
  errors: ImportValidationError[]
): string {
  const clean = asTrimmedString(value);
  if (!clean) {
    errors.push({ sheet, rowNumber, column, message: `${column} is required.` });
  }
  return clean;
}

function parseBooleanCell(
  value: unknown,
  sheet: "Modalities" | "ExamTypes",
  rowNumber: number,
  column: string,
  errors: ImportValidationError[]
): boolean | null {
  const raw = asTrimmedString(value).toLowerCase();

  if (["true", "false", "1", "0", "yes", "no", "enabled", "disabled", "on", "off"].includes(raw)) {
    return ["true", "1", "yes", "enabled", "on"].includes(raw);
  }

  errors.push({
    sheet,
    rowNumber,
    column,
    message: `${column} must be one of: true, false, yes, no, 1, 0, enabled, disabled.`
  });
  return null;
}

function parseOptionalNonNegativeInteger(
  value: unknown,
  sheet: "Modalities" | "ExamTypes",
  rowNumber: number,
  column: string,
  errors: ImportValidationError[]
): number | null {
  const raw = asTrimmedString(value);
  if (!raw) return null;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    errors.push({ sheet, rowNumber, column, message: `${column} must be a non-negative whole number.` });
    return null;
  }

  return parsed;
}

function ensureRequiredSheets(sheetNames: string[]): void {
  const normalizedNames = new Set(sheetNames.map((name) => name.trim()));
  const missing = [MODALITIES_SHEET, EXAM_TYPES_SHEET].filter((sheet) => !normalizedNames.has(sheet));
  if (missing.length > 0) {
    throw new HttpError(400, "Workbook is missing required sheets.", {
      errors: missing.map((sheet) => ({
        sheet,
        rowNumber: 1,
        column: null,
        message: `Required sheet '${sheet}' was not found.`
      }))
    });
  }
}

function indexSheetColumns(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers) {
    const clean = normalizeHeader(header);
    if (clean) {
      map.set(clean, header);
    }
  }
  return map;
}

function ensureRequiredColumns(
  headers: string[],
  requiredColumns: readonly string[],
  sheet: "Modalities" | "ExamTypes"
): Map<string, string> {
  const headerMap = indexSheetColumns(headers);
  const missing = requiredColumns.filter((column) => !headerMap.has(column));

  if (missing.length > 0) {
    throw new HttpError(400, `Sheet '${sheet}' is missing required columns.`, {
      errors: missing.map((column) => ({
        sheet,
        rowNumber: 1,
        column,
        message: `Required column '${column}' is missing.`
      }))
    });
  }

  return headerMap;
}

function getCell(values: Record<string, unknown>, headerMap: Map<string, string>, column: string): unknown {
  const originalHeader = headerMap.get(column);
  return originalHeader ? values[originalHeader] : "";
}

function normalizeModalityRows(
  rows: Array<{ rowNumber: number; values: Record<string, unknown> }>,
  headerMap: Map<string, string>,
  errors: ImportValidationError[]
): NormalizedModalityRow[] {
  const normalized: NormalizedModalityRow[] = [];
  const seenCodes = new Map<string, number>();

  for (const row of rows) {
    const code = parseRequiredString(getCell(row.values, headerMap, "code"), MODALITIES_SHEET, row.rowNumber, "code", errors);
    const nameEn = parseRequiredString(getCell(row.values, headerMap, "name_en"), MODALITIES_SHEET, row.rowNumber, "name_en", errors);
    const nameAr = parseRequiredString(getCell(row.values, headerMap, "name_ar"), MODALITIES_SHEET, row.rowNumber, "name_ar", errors);
    const active = parseBooleanCell(getCell(row.values, headerMap, "active"), MODALITIES_SHEET, row.rowNumber, "active", errors);
    const rawSafetyWarningEnabled = getCell(row.values, headerMap, "safety_warning_enabled");
    const safetyWarningEnabled =
      parseBooleanCell(
        rawSafetyWarningEnabled === undefined || rawSafetyWarningEnabled === null || asTrimmedString(rawSafetyWarningEnabled) === ""
          ? "true"
          : rawSafetyWarningEnabled,
        MODALITIES_SHEET,
        row.rowNumber,
        "safety_warning_enabled",
        errors
      ) ?? true;
    const dailyCapacity =
      parseOptionalNonNegativeInteger(
        getCell(row.values, headerMap, "daily_capacity"),
        MODALITIES_SHEET,
        row.rowNumber,
        "daily_capacity",
        errors
      ) ?? 0;

    const codeKey = keyForCode(code);
    const existingCodeRow = seenCodes.get(codeKey);
    if (codeKey && existingCodeRow) {
      errors.push({
        sheet: MODALITIES_SHEET,
        rowNumber: row.rowNumber,
        column: "code",
        message: `Duplicate modality code '${code}' also appears on row ${existingCodeRow}.`
      });
    } else if (codeKey) {
      seenCodes.set(codeKey, row.rowNumber);
    }

    normalized.push({
      rowNumber: row.rowNumber,
      code,
      nameEn,
      nameAr,
      descriptionEn: asTrimmedString(getCell(row.values, headerMap, "description_en")),
      descriptionAr: asTrimmedString(getCell(row.values, headerMap, "description_ar")),
      dailyCapacity,
      active: Boolean(active),
      safetyWarningEnabled,
      safetyWarningEn: asTrimmedString(getCell(row.values, headerMap, "safety_warning_en")),
      safetyWarningAr: asTrimmedString(getCell(row.values, headerMap, "safety_warning_ar"))
    });
  }

  return normalized;
}

function normalizeExamTypeRows(
  rows: Array<{ rowNumber: number; values: Record<string, unknown> }>,
  headerMap: Map<string, string>,
  errors: ImportValidationError[]
): NormalizedExamTypeRow[] {
  const normalized: NormalizedExamTypeRow[] = [];
  const seenKeys = new Map<string, number>();

  for (const row of rows) {
    const modalityCode = parseRequiredString(
      getCell(row.values, headerMap, "modality_code"),
      EXAM_TYPES_SHEET,
      row.rowNumber,
      "modality_code",
      errors
    );
    const code = parseRequiredString(getCell(row.values, headerMap, "code"), EXAM_TYPES_SHEET, row.rowNumber, "code", errors);
    const nameEn = parseRequiredString(getCell(row.values, headerMap, "name_en"), EXAM_TYPES_SHEET, row.rowNumber, "name_en", errors);
    const nameAr = parseRequiredString(getCell(row.values, headerMap, "name_ar"), EXAM_TYPES_SHEET, row.rowNumber, "name_ar", errors);
    const active = parseBooleanCell(getCell(row.values, headerMap, "active"), EXAM_TYPES_SHEET, row.rowNumber, "active", errors);
    const durationMinutes = parseOptionalNonNegativeInteger(
      getCell(row.values, headerMap, "duration_minutes"),
      EXAM_TYPES_SHEET,
      row.rowNumber,
      "duration_minutes",
      errors
    );

    const uniqueKey = `${keyForCode(modalityCode)}::${keyForCode(code)}`;
    const existingKeyRow = seenKeys.get(uniqueKey);
    if (uniqueKey !== "::" && existingKeyRow) {
      errors.push({
        sheet: EXAM_TYPES_SHEET,
        rowNumber: row.rowNumber,
        column: "code",
        message: `Duplicate exam type code '${code}' for modality '${modalityCode}' also appears on row ${existingKeyRow}.`
      });
    } else if (uniqueKey !== "::") {
      seenKeys.set(uniqueKey, row.rowNumber);
    }

    normalized.push({
      rowNumber: row.rowNumber,
      modalityCode,
      code,
      nameEn,
      nameAr,
      descriptionEn: asTrimmedString(getCell(row.values, headerMap, "description_en")),
      descriptionAr: asTrimmedString(getCell(row.values, headerMap, "description_ar")),
      durationMinutes,
      active: Boolean(active)
    });
  }

  return normalized;
}

async function listModalitiesForCatalog(executor: DbExecutor = pool): Promise<ModalityCatalogRow[]> {
  const { rows } = await executor.query<ModalityCatalogRow>(
    `
      select
        id,
        code,
        name_ar,
        name_en,
        daily_capacity,
        general_instruction_ar,
        general_instruction_en,
        is_active,
        safety_warning_ar,
        safety_warning_en,
        safety_warning_enabled
      from modalities
      order by name_en asc, code asc
    `
  );

  return rows;
}

async function listExamTypesForCatalog(executor: DbExecutor = pool): Promise<ExamTypeCatalogRow[]> {
  const { rows } = await executor.query<ExamTypeCatalogRow>(
    `
      select
        et.id,
        et.modality_id,
        m.code as modality_code,
        et.code,
        et.name_ar,
        et.name_en,
        et.specific_instruction_ar,
        et.specific_instruction_en,
        et.duration_minutes,
        et.is_active
      from exam_types et
      join modalities m on m.id = et.modality_id
      order by m.code asc, et.code asc, et.name_en asc
    `
  );

  return rows;
}

export async function exportCatalogWorkbook(): Promise<{ buffer: Buffer; filename: string }> {
  const [modalities, examTypes] = await Promise.all([listModalitiesForCatalog(), listExamTypesForCatalog()]);

  const buffer = await buildWorkbookBuffer([
    {
      name: MODALITIES_SHEET,
      headers: [...MODALITY_COLUMNS],
      rows: modalities.map((row) => ({
        code: row.code,
        name_en: row.name_en,
        name_ar: row.name_ar,
        description_en: row.general_instruction_en ?? "",
        description_ar: row.general_instruction_ar ?? "",
        daily_capacity: row.daily_capacity ?? 0,
        active: row.is_active,
        safety_warning_enabled: row.safety_warning_enabled,
        safety_warning_en: row.safety_warning_en ?? "",
        safety_warning_ar: row.safety_warning_ar ?? ""
      }))
    },
    {
      name: EXAM_TYPES_SHEET,
      headers: [...EXAM_TYPE_COLUMNS],
      rows: examTypes.map((row) => ({
        modality_code: row.modality_code,
        code: row.code,
        name_en: row.name_en,
        name_ar: row.name_ar,
        description_en: row.specific_instruction_en ?? "",
        description_ar: row.specific_instruction_ar ?? "",
        duration_minutes: row.duration_minutes ?? "",
        active: row.is_active
      }))
    }
  ]);

  return {
    buffer,
    filename: "rispro-modalities-exam-types.xlsx"
  };
}

function modalityHasChanges(existing: ModalityCatalogRow, incoming: NormalizedModalityRow): boolean {
  return (
    existing.code !== incoming.code ||
    existing.name_en !== incoming.nameEn ||
    existing.name_ar !== incoming.nameAr ||
    (existing.general_instruction_en ?? "") !== incoming.descriptionEn ||
    (existing.general_instruction_ar ?? "") !== incoming.descriptionAr ||
    Number(existing.daily_capacity ?? 0) !== incoming.dailyCapacity ||
    existing.is_active !== incoming.active ||
    existing.safety_warning_enabled !== incoming.safetyWarningEnabled ||
    (existing.safety_warning_en ?? "") !== incoming.safetyWarningEn ||
    (existing.safety_warning_ar ?? "") !== incoming.safetyWarningAr
  );
}

function examTypeHasChanges(existing: ExamTypeCatalogRow, incoming: NormalizedExamTypeRow, modalityId: number): boolean {
  return (
    existing.modality_id !== modalityId ||
    existing.code !== incoming.code ||
    existing.name_en !== incoming.nameEn ||
    existing.name_ar !== incoming.nameAr ||
    (existing.specific_instruction_en ?? "") !== incoming.descriptionEn ||
    (existing.specific_instruction_ar ?? "") !== incoming.descriptionAr ||
    (existing.duration_minutes ?? null) !== incoming.durationMinutes ||
    existing.is_active !== incoming.active
  );
}

async function insertModality(
  executor: DbExecutor,
  row: NormalizedModalityRow,
  changedByUserId: UserId
): Promise<ModalityCatalogRow> {
  const { rows } = await executor.query<ModalityCatalogRow>(
    `
      insert into modalities (
        code,
        name_ar,
        name_en,
        daily_capacity,
        general_instruction_ar,
        general_instruction_en,
        is_active,
        safety_warning_ar,
        safety_warning_en,
        safety_warning_enabled
      )
      values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, nullif($8, ''), nullif($9, ''), $10)
      returning
        id,
        code,
        name_ar,
        name_en,
        daily_capacity,
        general_instruction_ar,
        general_instruction_en,
        is_active,
        safety_warning_ar,
        safety_warning_en,
        safety_warning_enabled
    `,
    [
      row.code,
      row.nameAr,
      row.nameEn,
      row.dailyCapacity,
      row.descriptionAr,
      row.descriptionEn,
      row.active,
      row.safetyWarningAr,
      row.safetyWarningEn,
      row.safetyWarningEnabled
    ]
  );
  const created = rows[0];
  if (!created) throw new HttpError(500, "Failed to create modality during import.");

  await logAuditEntry(
    {
      entityType: "modality",
      entityId: created.id,
      actionType: "create",
      oldValues: null,
      newValues: created,
      changedByUserId
    },
    executor
  );

  return created;
}

async function updateModalityRow(
  executor: DbExecutor,
  existing: ModalityCatalogRow,
  row: NormalizedModalityRow,
  changedByUserId: UserId
): Promise<ModalityCatalogRow> {
  const { rows } = await executor.query<ModalityCatalogRow>(
    `
      update modalities
      set
        code = $2,
        name_ar = $3,
        name_en = $4,
        daily_capacity = $5,
        general_instruction_ar = nullif($6, ''),
        general_instruction_en = nullif($7, ''),
        is_active = $8,
        safety_warning_ar = nullif($9, ''),
        safety_warning_en = nullif($10, ''),
        safety_warning_enabled = $11,
        updated_at = now()
      where id = $1
      returning
        id,
        code,
        name_ar,
        name_en,
        daily_capacity,
        general_instruction_ar,
        general_instruction_en,
        is_active,
        safety_warning_ar,
        safety_warning_en,
        safety_warning_enabled
    `,
    [
      existing.id,
      row.code,
      row.nameAr,
      row.nameEn,
      row.dailyCapacity,
      row.descriptionAr,
      row.descriptionEn,
      row.active,
      row.safetyWarningAr,
      row.safetyWarningEn,
      row.safetyWarningEnabled
    ]
  );
  const updated = rows[0];
  if (!updated) throw new HttpError(500, "Failed to update modality during import.");

  await logAuditEntry(
    {
      entityType: "modality",
      entityId: existing.id,
      actionType: "update",
      oldValues: existing,
      newValues: updated,
      changedByUserId
    },
    executor
  );

  return updated;
}

async function insertExamType(
  executor: DbExecutor,
  row: NormalizedExamTypeRow,
  modalityId: number,
  changedByUserId: UserId
): Promise<ExamTypeCatalogRow> {
  const { rows } = await executor.query<ExamTypeCatalogRow>(
    `
      insert into exam_types (
        modality_id,
        code,
        name_ar,
        name_en,
        specific_instruction_ar,
        specific_instruction_en,
        duration_minutes,
        is_active
      )
      values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, $8)
      returning
        id,
        modality_id,
        $9::text as modality_code,
        code,
        name_ar,
        name_en,
        specific_instruction_ar,
        specific_instruction_en,
        duration_minutes,
        is_active
    `,
    [modalityId, row.code, row.nameAr, row.nameEn, row.descriptionAr, row.descriptionEn, row.durationMinutes, row.active, row.modalityCode]
  );
  const created = rows[0];
  if (!created) throw new HttpError(500, "Failed to create exam type during import.");

  await logAuditEntry(
    {
      entityType: "exam_type",
      entityId: created.id,
      actionType: "create",
      oldValues: null,
      newValues: created,
      changedByUserId
    },
    executor
  );

  return created;
}

async function updateExamTypeRow(
  executor: DbExecutor,
  existing: ExamTypeCatalogRow,
  row: NormalizedExamTypeRow,
  modalityId: number,
  changedByUserId: UserId
): Promise<ExamTypeCatalogRow> {
  const { rows } = await executor.query<ExamTypeCatalogRow>(
    `
      update exam_types
      set
        modality_id = $2,
        code = $3,
        name_ar = $4,
        name_en = $5,
        specific_instruction_ar = nullif($6, ''),
        specific_instruction_en = nullif($7, ''),
        duration_minutes = $8,
        is_active = $9,
        updated_at = now()
      where id = $1
      returning
        id,
        modality_id,
        $10::text as modality_code,
        code,
        name_ar,
        name_en,
        specific_instruction_ar,
        specific_instruction_en,
        duration_minutes,
        is_active
    `,
    [
      existing.id,
      modalityId,
      row.code,
      row.nameAr,
      row.nameEn,
      row.descriptionAr,
      row.descriptionEn,
      row.durationMinutes,
      row.active,
      row.modalityCode
    ]
  );
  const updated = rows[0];
  if (!updated) throw new HttpError(500, "Failed to update exam type during import.");

  await logAuditEntry(
    {
      entityType: "exam_type",
      entityId: existing.id,
      actionType: "update",
      oldValues: existing,
      newValues: updated,
      changedByUserId
    },
    executor
  );

  return updated;
}

export async function importCatalogWorkbook(
  fileContentBase64: string,
  changedByUserId: UserId
): Promise<ImportSummary> {
  const { XLSX, workbook, sheetNames } = await readWorkbookFromBase64(fileContentBase64);
  ensureRequiredSheets(sheetNames);

  const modalitiesSheet = parseWorksheet(XLSX, workbook.Sheets[MODALITIES_SHEET], MODALITIES_SHEET);
  const examTypesSheet = parseWorksheet(XLSX, workbook.Sheets[EXAM_TYPES_SHEET], EXAM_TYPES_SHEET);

  const modalityHeaderMap = ensureRequiredColumns(modalitiesSheet.headers, MODALITY_COLUMNS, MODALITIES_SHEET);
  const examTypeHeaderMap = ensureRequiredColumns(examTypesSheet.headers, EXAM_TYPE_COLUMNS, EXAM_TYPES_SHEET);

  const errors: ImportValidationError[] = [];
  const normalizedModalities = normalizeModalityRows(modalitiesSheet.rows, modalityHeaderMap, errors);
  const normalizedExamTypes = normalizeExamTypeRows(examTypesSheet.rows, examTypeHeaderMap, errors);

  const [existingModalities, existingExamTypes] = await Promise.all([listModalitiesForCatalog(), listExamTypesForCatalog()]);
  const existingModalityMap = new Map(existingModalities.map((row) => [keyForCode(row.code), row]));
  const workbookModalityKeys = new Set(normalizedModalities.map((row) => keyForCode(row.code)));

  for (const row of normalizedExamTypes) {
    const modalityKey = keyForCode(row.modalityCode);
    if (!workbookModalityKeys.has(modalityKey) && !existingModalityMap.has(modalityKey)) {
      errors.push({
        sheet: EXAM_TYPES_SHEET,
        rowNumber: row.rowNumber,
        column: "modality_code",
        message: `Unknown modality_code '${row.modalityCode}'.`
      });
    }
  }

  if (errors.length > 0) {
    throw new HttpError(400, "Workbook validation failed.", { errors });
  }

  const client = await pool.connect();
  const summary: ImportSummary = {
    modalitiesCreated: 0,
    modalitiesUpdated: 0,
    examTypesCreated: 0,
    examTypesUpdated: 0,
    skipped: 0,
    errors: []
  };

  try {
    await client.query("begin");

    const liveModalities = new Map(existingModalities.map((row) => [keyForCode(row.code), row]));

    for (const row of normalizedModalities) {
      const existing = liveModalities.get(keyForCode(row.code));
      if (!existing) {
        const created = await insertModality(client, row, changedByUserId);
        liveModalities.set(keyForCode(created.code), created);
        summary.modalitiesCreated += 1;
        continue;
      }

      if (!modalityHasChanges(existing, row)) {
        summary.skipped += 1;
        continue;
      }

      const updated = await updateModalityRow(client, existing, row, changedByUserId);
      liveModalities.set(keyForCode(updated.code), updated);
      summary.modalitiesUpdated += 1;
    }

    const liveExamTypes = new Map(
      existingExamTypes.map((row) => [`${keyForCode(row.modality_code)}::${keyForCode(row.code)}`, row])
    );

    for (const row of normalizedExamTypes) {
      const modality = liveModalities.get(keyForCode(row.modalityCode));
      if (!modality) {
        throw new HttpError(400, "Workbook validation failed.", {
          errors: [
            {
              sheet: EXAM_TYPES_SHEET,
              rowNumber: row.rowNumber,
              column: "modality_code",
              message: `Unknown modality_code '${row.modalityCode}'.`
            }
          ]
        });
      }

      const key = `${keyForCode(row.modalityCode)}::${keyForCode(row.code)}`;
      const existing = liveExamTypes.get(key);

      if (!existing) {
        const created = await insertExamType(client, row, modality.id, changedByUserId);
        liveExamTypes.set(key, created);
        summary.examTypesCreated += 1;
        continue;
      }

      if (!examTypeHasChanges(existing, row, modality.id)) {
        summary.skipped += 1;
        continue;
      }

      const updated = await updateExamTypeRow(client, existing, row, modality.id, changedByUserId);
      liveExamTypes.set(key, updated);
      summary.examTypesUpdated += 1;
    }

    await client.query("commit");
    return summary;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export type { ImportSummary as CatalogImportSummary, ImportValidationError as CatalogImportValidationError };
