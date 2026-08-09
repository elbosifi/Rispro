import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import type { UserId } from "../types/http.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModalityRow {
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
  safety_workflow_type: "standard_acknowledgement" | "mri_primary_implant_screening";
}

export interface ExamTypeRow {
  id: number;
  modality_id: number;
  code: string;
  name_ar: string;
  name_en: string;
  specific_instruction_ar: string | null;
  specific_instruction_en: string | null;
  duration_minutes: number | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function pgErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "";
  }
  return String((error as { code?: unknown }).code || "");
}

function toSchedulingConflictError(error: unknown): HttpError | null {
  const code = pgErrorCode(error);
  if (code === "40001") {
    return new HttpError(409, "Scheduling conflict detected. Please retry booking.");
  }
  if (code === "55P03") {
    return new HttpError(409, "Scheduling lock conflict. Please retry booking.");
  }
  if (code === "23505") {
    return new HttpError(409, "A concurrent booking changed availability. Please retry.");
  }
  return null;
}

function normalizeDailyCapacity(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "dailyCapacity must be 0 or a positive whole number.");
  }

  return parsed;
}

function normalizeExamTypeCode(value: unknown): string {
  const clean = String(value || "").trim();

  if (!clean) {
    throw new HttpError(400, "code is required.");
  }

  return clean;
}

function normalizeDurationMinutes(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, "durationMinutes must be empty or a non-negative whole number.");
  }

  return parsed;
}

function toModalityRow(row: Record<string, unknown>): ModalityRow {
  return {
    id: Number(row.id),
    code: String(row.code),
    name_ar: String(row.name_ar),
    name_en: String(row.name_en),
    daily_capacity: row.daily_capacity === null ? null : Number(row.daily_capacity),
    general_instruction_ar: row.general_instruction_ar === null ? null : String(row.general_instruction_ar),
    general_instruction_en: row.general_instruction_en === null ? null : String(row.general_instruction_en),
    is_active: Boolean(row.is_active),
    safety_warning_ar:
      "safety_warning_ar" in row && row.safety_warning_ar !== null
        ? String(row.safety_warning_ar)
        : (undefined as unknown as null),
    safety_warning_en:
      "safety_warning_en" in row && row.safety_warning_en !== null
        ? String(row.safety_warning_en)
        : (undefined as unknown as null),
    safety_warning_enabled:
      "safety_warning_enabled" in row ? Boolean(row.safety_warning_enabled) : (undefined as unknown as boolean),
    safety_workflow_type:
      row.safety_workflow_type === "mri_primary_implant_screening"
        ? "mri_primary_implant_screening"
        : "standard_acknowledgement"
  };
}

function toExamTypeRow(row: Record<string, unknown>): ExamTypeRow {
  return {
    id: Number(row.id),
    modality_id: Number(row.modality_id),
    code: String(row.code),
    name_ar: String(row.name_ar),
    name_en: String(row.name_en),
    specific_instruction_ar: row.specific_instruction_ar === null ? null : String(row.specific_instruction_ar),
    specific_instruction_en: row.specific_instruction_en === null ? null : String(row.specific_instruction_en),
    duration_minutes: row.duration_minutes === null ? null : Number(row.duration_minutes),
    is_active: Boolean(row.is_active)
  };
}

// ---------------------------------------------------------------------------
// Exam Type functions
// ---------------------------------------------------------------------------

export async function listExamTypesForSettings({
  includeInactive = false
}: { includeInactive?: boolean } = {}): Promise<{
  modalities: ModalityRow[];
  examTypes: ExamTypeRow[];
}> {
  const modalityWhereClause = includeInactive ? "" : "where is_active = true";
  const examTypeWhereClause = includeInactive ? "" : "where is_active = true";
  const [modalitiesResult, examTypesResult] = await Promise.all([
    pool.query(`
      select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active
      from modalities
      ${modalityWhereClause}
      order by name_en asc
    `),
    pool.query(`
      select id, modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en, is_active
      , code, duration_minutes
      from exam_types
      ${examTypeWhereClause}
      order by name_en asc, name_ar asc
    `)
  ]);

  return {
    modalities: modalitiesResult.rows.map((row) => toModalityRow(row)),
    examTypes: examTypesResult.rows.map((row) => toExamTypeRow(row))
  };
}

export async function createExamType(
  payload: Record<string, unknown>,
  currentUserId: UserId | null = null
): Promise<ExamTypeRow> {
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId") as number;
  const code = normalizeExamTypeCode(payload.code || payload.nameEn);
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const specificInstructionAr = String(payload.specificInstructionAr || "").trim();
  const specificInstructionEn = String(payload.specificInstructionEn || "").trim();
  const durationMinutes = normalizeDurationMinutes(payload.durationMinutes);
  const nextIsActive =
    payload.isActive === undefined && payload.is_active === undefined
      ? undefined
      : Boolean(payload.isActive ?? payload.is_active);

  if (!nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr and nameEn are required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows } = await client.query(
      `
        insert into exam_types (
          modality_id,
          code,
          name_ar,
          name_en,
          specific_instruction_ar,
          specific_instruction_en,
          duration_minutes
        )
        values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7)
        returning id, modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
      `,
      [modalityId, code, nameAr, nameEn, specificInstructionAr, specificInstructionEn, durationMinutes]
    );
    const createdExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to create exam type."
    );

    if (currentUserId) {
      await logAuditEntry(
        {
          entityType: "exam_type",
          entityId: createdExamType.id,
          actionType: "create",
          oldValues: null,
          newValues: createdExamType,
          changedByUserId: currentUserId
        },
        client
      );
    }

    await client.query("commit");
    return createdExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateExamType(
  examTypeId: number | string,
  payload: Record<string, unknown>,
  currentUserId: UserId
): Promise<ExamTypeRow> {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId") as number;
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId") as number;
  const code = normalizeExamTypeCode(payload.code || payload.nameEn);
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const specificInstructionAr = String(payload.specificInstructionAr || "").trim();
  const specificInstructionEn = String(payload.specificInstructionEn || "").trim();
  const durationMinutes = normalizeDurationMinutes(payload.durationMinutes);
  const nextIsActive =
    payload.isActive === undefined && payload.is_active === undefined
      ? null
      : Boolean(payload.isActive ?? payload.is_active);

  if (!nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr and nameEn are required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
        from exam_types
        where id = $1
        limit 1
      `,
      [cleanExamTypeId]
    );

    const existing = existingResult.rows[0] as ExamTypeRow | undefined;

    if (!existing) {
      throw new HttpError(404, "Exam type not found.");
    }

    const { rows } = await client.query(
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
        returning id, modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
      `,
      [cleanExamTypeId, modalityId, code, nameAr, nameEn, specificInstructionAr, specificInstructionEn, durationMinutes, nextIsActive ?? existing.is_active]
    );
    const updatedExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to update exam type."
    );

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "update",
        oldValues: existing,
        newValues: updatedExamType,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return updatedExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExamType(
  examTypeId: number | string,
  currentUserId: UserId
): Promise<ExamTypeRow> {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
        from exam_types
        where id = $1
        limit 1
      `,
      [cleanExamTypeId]
    );

    const existing = existingResult.rows[0] as ExamTypeRow | undefined;

    if (!existing || !existing.is_active) {
      throw new HttpError(404, "Exam type not found.");
    }

    const { rows } = await client.query(
      `
        update exam_types
        set
          is_active = false,
          updated_at = now()
        where id = $1
        returning id, modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
      `,
      [cleanExamTypeId]
    );
    const deletedExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to delete exam type."
    );

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "delete",
        oldValues: existing,
        newValues: deletedExamType,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return deletedExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function hardDeleteExamType(
  examTypeId: number | string,
  currentUserId: UserId
): Promise<ExamTypeRow> {
  const cleanExamTypeId = normalizePositiveInteger(examTypeId, "examTypeId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select
          id,
          modality_id,
          code,
          name_ar,
          name_en,
          specific_instruction_ar,
          specific_instruction_en,
          duration_minutes,
          is_active
        from exam_types
        where id = $1
        limit 1
      `,
      [cleanExamTypeId]
    );

    const existing = existingResult.rows[0] as ExamTypeRow | undefined;

    if (!existing) {
      throw new HttpError(404, "Exam type not found.");
    }

    await client.query(`delete from exam_type_rule_items where exam_type_id = $1`, [cleanExamTypeId]);
    await client.query(`delete from exam_type_rules where exam_type_id = $1`, [cleanExamTypeId]);
    await client.query(`delete from appointment_exam_type_history where exam_type_id = $1`, [cleanExamTypeId]);
    await client.query(`delete from appointments where exam_type_id = $1`, [cleanExamTypeId]);

    const { rows } = await client.query(
      `
        delete from exam_types
        where id = $1
        returning id, modality_id, code, name_ar, name_en, specific_instruction_ar, specific_instruction_en, duration_minutes, is_active
      `,
      [cleanExamTypeId]
    );
    const hardDeletedExamType = requireRow<ExamTypeRow>(
      rows[0] as ExamTypeRow | undefined,
      "Failed to hard delete exam type."
    );

    await logAuditEntry(
      {
        entityType: "exam_type",
        entityId: cleanExamTypeId,
        actionType: "hard_delete",
        oldValues: existing,
        newValues: hardDeletedExamType,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return hardDeletedExamType;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Modality functions
// ---------------------------------------------------------------------------

export async function listModalitiesForSettings({
  includeInactive = false
}: { includeInactive?: boolean } = {}): Promise<{ modalities: ModalityRow[] }> {
  const whereClause = includeInactive ? "" : "where is_active = true";
  const { rows } = await pool.query(`
    select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled, safety_workflow_type
    from modalities
    ${whereClause}
    order by name_en asc
  `);

  return { modalities: rows as unknown as ModalityRow[] };
}

export async function createModality(
  payload: Record<string, unknown>,
  currentUserId: UserId | null = null
): Promise<ModalityRow> {
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";
  const safetyWarningAr = String(payload.safetyWarningAr || "").trim();
  const safetyWarningEn = String(payload.safetyWarningEn || "").trim();
  const safetyWarningEnabled = payload.safetyWarningEnabled !== false;
  let safetyWorkflowType = payload.safetyWorkflowType;
  if (safetyWorkflowType !== undefined && safetyWorkflowType !== "standard_acknowledgement" && safetyWorkflowType !== "mri_primary_implant_screening") {
    throw new HttpError(400, "safetyWorkflowType is invalid.");
  }

  if (!code || !nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr, and nameEn are required.");
  }
  if (safetyWarningEnabled && !safetyWarningAr && !safetyWarningEn) {
    throw new HttpError(400, "Safety warning text is required when modality safety warning is enabled.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows } = await client.query(
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
          safety_warning_enabled, safety_workflow_type
        )
        values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, nullif($8, ''), nullif($9, ''), $10, $11)
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled, safety_workflow_type
      `,
      [code, nameAr, nameEn, dailyCapacity, generalInstructionAr, generalInstructionEn, isActive, safetyWarningAr, safetyWarningEn, safetyWarningEnabled, safetyWorkflowType ?? "standard_acknowledgement"]
    );
    const createdModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to create modality."
    );

    if (currentUserId) {
      await logAuditEntry(
        {
          entityType: "modality",
          entityId: createdModality.id,
          actionType: "create",
          oldValues: null,
          newValues: createdModality,
          changedByUserId: currentUserId
        },
        client
      );
    }

    await client.query("commit");
    return createdModality;
  } catch (error) {
    await client.query("rollback");
    const mapped = toSchedulingConflictError(error);
    throw mapped || error;
  } finally {
    client.release();
  }
}

export async function updateModality(
  modalityId: number | string,
  payload: Record<string, unknown>,
  currentUserId: UserId
): Promise<ModalityRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId") as number;
  const code = String(payload.code || "").trim();
  const nameAr = String(payload.nameAr || "").trim();
  const nameEn = String(payload.nameEn || "").trim();
  const dailyCapacity = normalizeDailyCapacity(payload.dailyCapacity);
  const generalInstructionAr = String(payload.generalInstructionAr || "").trim();
  const generalInstructionEn = String(payload.generalInstructionEn || "").trim();
  const isActive = String(payload.isActive || "enabled") === "enabled";
  const safetyWarningAr = String(payload.safetyWarningAr || "").trim();
  const safetyWarningEn = String(payload.safetyWarningEn || "").trim();
  const safetyWarningEnabled =
    payload.safetyWarningEnabled !== undefined ? Boolean(payload.safetyWarningEnabled) : true;
  let safetyWorkflowType = payload.safetyWorkflowType;
  if (safetyWorkflowType !== undefined && safetyWorkflowType !== "standard_acknowledgement" && safetyWorkflowType !== "mri_primary_implant_screening") {
    throw new HttpError(400, "safetyWorkflowType is invalid.");
  }

  if (!code || !nameAr || !nameEn) {
    throw new HttpError(400, "code, nameAr, and nameEn are required.");
  }
  if (safetyWarningEnabled && !safetyWarningAr && !safetyWarningEn) {
    throw new HttpError(400, "Safety warning text is required when modality safety warning is enabled.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
      `
        select id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled, safety_workflow_type
        from modalities
        where id = $1
        limit 1
      `,
      [cleanModalityId]
    );

    const existing = existingResult.rows[0] as ModalityRow | undefined;

    if (!existing) {
      throw new HttpError(404, "Modality not found.");
    }
    safetyWorkflowType ??= existing.safety_workflow_type;

    const { rows } = await client.query(
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
          safety_warning_enabled = $11, safety_workflow_type = $12,
          updated_at = now()
        where id = $1
        returning id, code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en, is_active, safety_warning_ar, safety_warning_en, safety_warning_enabled, safety_workflow_type
      `,
      [cleanModalityId, code, nameAr, nameEn, dailyCapacity, generalInstructionAr, generalInstructionEn, isActive, safetyWarningAr, safetyWarningEn, safetyWarningEnabled, safetyWorkflowType]
    );
    const updatedModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to update modality."
    );

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "update",
        oldValues: existing,
        newValues: updatedModality,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return updatedModality;
  } catch (error) {
    await client.query("rollback");
    const mapped = toSchedulingConflictError(error);
    throw mapped || error;
  } finally {
    client.release();
  }
}

export async function deactivateModality(
  modalityId: number | string,
  currentUserId: UserId
): Promise<ModalityRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
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
        where id = $1
        limit 1
      `,
      [cleanModalityId]
    );

    const existing = existingResult.rows[0] as ModalityRow | undefined;

    if (!existing || !existing.is_active) {
      throw new HttpError(404, "Modality not found.");
    }

    const { rows } = await client.query(
      `
        update modalities
        set
          is_active = false,
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
      [cleanModalityId]
    );
    const deletedModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to delete modality."
    );

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "deactivate",
        oldValues: existing,
        newValues: deletedModality,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return deletedModality;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function hardDeleteModality(
  modalityId: number | string,
  currentUserId: UserId
): Promise<ModalityRow> {
  const cleanModalityId = normalizePositiveInteger(modalityId, "modalityId") as number;
  const client = await pool.connect();

  try {
    await client.query("begin");

    const existingResult = await client.query(
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
        where id = $1
        limit 1
      `,
      [cleanModalityId]
    );

    const existing = existingResult.rows[0] as ModalityRow | undefined;

    if (!existing) {
      throw new HttpError(404, "Modality not found.");
    }

    await client.query(`delete from exam_type_rule_items where exam_type_id in (select id from exam_types where modality_id = $1)`, [cleanModalityId]);
    await client.query(`delete from exam_type_rules where exam_type_id in (select id from exam_types where modality_id = $1)`, [cleanModalityId]);
    await client.query(`delete from exam_types where modality_id = $1`, [cleanModalityId]);
    await client.query(`delete from modality_rule_items where modality_id = $1`, [cleanModalityId]);
    await client.query(`delete from modality_rules where modality_id = $1`, [cleanModalityId]);
    await client.query(`delete from appointment_exam_type_history where modality_id = $1`, [cleanModalityId]);
    await client.query(`delete from appointments where modality_id = $1`, [cleanModalityId]);

    const { rows } = await client.query(
      `
        delete from modalities
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
      [cleanModalityId]
    );
    const hardDeletedModality = requireRow<ModalityRow>(
      rows[0] as ModalityRow | undefined,
      "Failed to hard delete modality."
    );

    await logAuditEntry(
      {
        entityType: "modality",
        entityId: cleanModalityId,
        actionType: "hard_delete",
        oldValues: existing,
        newValues: hardDeletedModality,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return hardDeletedModality;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
