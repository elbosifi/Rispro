/*
 * LEGACY APPOINTMENTS / SCHEDULING MODULE
 * This file belongs to the legacy scheduling system.
 * Do not add new scheduling features here.
 * New scheduling and booking work must go into Appointments V2.
 * Legacy code may only receive:
 * - critical bug containment
 * - temporary compatibility fixes explicitly requested
 * - reference-only maintenance
 */

import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import type { UnknownRecord, UserId } from "../types/http.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { validateIsoDate } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";

import type { PoolClient } from "pg";

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").toLowerCase();
  if (["1", "true", "yes", "enabled", "on"].includes(raw)) return true;
  if (["0", "false", "no", "disabled", "off"].includes(raw)) return false;
  return fallback;
}

function toNullableDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return validateIsoDate(raw, "date");
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

// ---------------------------------------------------------------------------
// Helpers for authoritative section saves
// ---------------------------------------------------------------------------

async function deactivateAllRows(
  client: PoolClient,
  table: string,
  actingUserId: UserId
): Promise<void> {
  await client.query(
    `update ${table} set is_active = false, updated_by_user_id = $1, updated_at = now() where is_active = true`,
    [actingUserId]
  );
}

// ---------------------------------------------------------------------------
// Section A: modality_category_daily_limits
// ---------------------------------------------------------------------------

async function syncCategoryLimits(
  client: PoolClient,
  rows: UnknownRecord[],
  actingUserId: UserId
): Promise<void> {
  if (rows.length === 0) {
    await deactivateAllRows(client, "modality_category_daily_limits", actingUserId);
    return;
  }

  const keepIds: number[] = [];

  for (const row of rows) {
    const modalityId = normalizePositiveInteger(row.modalityId ?? row.modality_id, "modalityId") as number;
    const category = String(row.caseCategory ?? row.case_category ?? "").trim();
    const limit = Number(row.dailyLimit ?? row.daily_limit ?? 0);
    if (!["oncology", "non_oncology"].includes(category)) {
      throw new HttpError(400, "caseCategory must be oncology or non_oncology.");
    }

    const existingId = normalizePositiveInteger(row.id, "id") as number | null;

    if (existingId) {
      const result = await client.query<{ id: number }>(
        `
          update modality_category_daily_limits
          set modality_id = $2, case_category = $3, daily_limit = $4,
              is_active = $5, updated_by_user_id = $6, updated_at = now()
          where id = $1
          returning id
        `,
        [existingId, modalityId, category, Math.max(0, Math.floor(limit)), toBool(row.isActive ?? row.is_active, true), actingUserId]
      );
      keepIds.push(Number(result.rows[0]?.id || existingId));
    } else {
      const result = await client.query<{ id: number }>(
        `
          insert into modality_category_daily_limits (
            modality_id, case_category, daily_limit, is_active, created_by_user_id, updated_by_user_id
          ) values ($1, $2, $3, $4, $5, $5)
          on conflict (modality_id, case_category)
          do update set daily_limit = excluded.daily_limit, is_active = excluded.is_active,
                        updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
          returning id
        `,
        [modalityId, category, Math.max(0, Math.floor(limit)), toBool(row.isActive ?? row.is_active, true), actingUserId]
      );
      keepIds.push(Number(result.rows[0]?.id));
    }
  }

  await client.query(
    `
      update modality_category_daily_limits
      set is_active = false, updated_by_user_id = $1, updated_at = now()
      where id <> all($2::bigint[])
    `,
    [actingUserId, keepIds]
  );
}

// ---------------------------------------------------------------------------
// Section B: modality_blocked_rules
// ---------------------------------------------------------------------------

async function syncBlockedRules(
  client: PoolClient,
  rows: UnknownRecord[],
  actingUserId: UserId
): Promise<void> {
  if (rows.length === 0) {
    await deactivateAllRows(client, "modality_blocked_rules", actingUserId);
    return;
  }

  const keepIds: number[] = [];

  for (const row of rows) {
    const modalityId = normalizePositiveInteger(row.modalityId ?? row.modality_id, "modalityId") as number;
    const ruleType = String(row.ruleType ?? row.rule_type ?? "").trim();
    const existingId = normalizePositiveInteger(row.id, "id") as number | null;

    if (existingId) {
      const result = await client.query<{ id: number }>(
        `
          update modality_blocked_rules
          set modality_id = $2, rule_type = $3,
              specific_date = $4::date, start_date = $5::date, end_date = $6::date,
              recur_start_month = $7, recur_start_day = $8, recur_end_month = $9, recur_end_day = $10,
              is_overridable = $11, is_active = $12, title = nullif($13, ''), notes = nullif($14, ''),
              updated_by_user_id = $15, updated_at = now()
          where id = $1
          returning id
        `,
        [
          existingId, modalityId, ruleType,
          toNullableDate(row.specificDate ?? row.specific_date),
          toNullableDate(row.startDate ?? row.start_date),
          toNullableDate(row.endDate ?? row.end_date),
          row.recurStartMonth != null ? Number(row.recurStartMonth) : null,
          row.recurStartDay != null ? Number(row.recurStartDay) : null,
          row.recurEndMonth != null ? Number(row.recurEndMonth) : null,
          row.recurEndDay != null ? Number(row.recurEndDay) : null,
          toBool(row.isOverridable ?? row.is_overridable, false),
          toBool(row.isActive ?? row.is_active, true),
          String(row.title ?? ""),
          String(row.notes ?? ""),
          actingUserId
        ]
      );
      keepIds.push(Number(result.rows[0]?.id || existingId));
    } else {
      const result = await client.query<{ id: number }>(
        `
          insert into modality_blocked_rules (
            modality_id, rule_type, specific_date, start_date, end_date,
            recur_start_month, recur_start_day, recur_end_month, recur_end_day,
            is_overridable, is_active, title, notes, created_by_user_id, updated_by_user_id
          )
          values ($1, $2, $3::date, $4::date, $5::date, $6, $7, $8, $9, $10, $11, nullif($12, ''), nullif($13, ''), $14, $14)
          returning id
        `,
        [
          modalityId, ruleType,
          toNullableDate(row.specificDate ?? row.specific_date),
          toNullableDate(row.startDate ?? row.start_date),
          toNullableDate(row.endDate ?? row.end_date),
          row.recurStartMonth != null ? Number(row.recurStartMonth) : null,
          row.recurStartDay != null ? Number(row.recurStartDay) : null,
          row.recurEndMonth != null ? Number(row.recurEndMonth) : null,
          row.recurEndDay != null ? Number(row.recurEndDay) : null,
          toBool(row.isOverridable ?? row.is_overridable, false),
          toBool(row.isActive ?? row.is_active, true),
          String(row.title ?? ""),
          String(row.notes ?? ""),
          actingUserId
        ]
      );
      keepIds.push(Number(result.rows[0]?.id));
    }
  }

  await client.query(
    `
      update modality_blocked_rules
      set is_active = false, updated_by_user_id = $1, updated_at = now()
      where id <> all($2::bigint[])
    `,
    [actingUserId, keepIds]
  );
}

// ---------------------------------------------------------------------------
// Section C: exam_type_schedule_rules + exam_type_schedule_rule_items
// ---------------------------------------------------------------------------

async function syncExamRules(
  client: PoolClient,
  rows: UnknownRecord[],
  actingUserId: UserId
): Promise<void> {
  if (rows.length === 0) {
    await deactivateAllRows(client, "exam_type_schedule_rules", actingUserId);
    return;
  }

  const keepRuleIds: number[] = [];

  for (const row of rows) {
    const modalityId = normalizePositiveInteger(row.modalityId ?? row.modality_id, "modalityId") as number;
    const ruleType = String(row.ruleType ?? row.rule_type ?? "").trim();
    const existingId = normalizePositiveInteger(row.id, "id") as number | null;

    let ruleId: number;

    if (existingId) {
      const result = await client.query<{ id: number }>(
        `
          update exam_type_schedule_rules
          set modality_id = $2, rule_type = $3, effect_mode = $4,
              specific_date = $5::date, start_date = $6::date, end_date = $7::date,
              weekday = $8, alternate_weeks = $9, recurrence_anchor_date = $10::date,
              title = nullif($11, ''), notes = nullif($12, ''), is_active = $13,
              updated_by_user_id = $14, updated_at = now()
          where id = $1
          returning id
        `,
        [
          existingId, modalityId, ruleType,
          String(row.effectMode ?? row.effect_mode ?? "restriction_overridable"),
          toNullableDate(row.specificDate ?? row.specific_date),
          toNullableDate(row.startDate ?? row.start_date),
          toNullableDate(row.endDate ?? row.end_date),
          row.weekday === undefined || row.weekday === null || row.weekday === "" ? null : Number(row.weekday),
          toBool(row.alternateWeeks ?? row.alternate_weeks, false),
          toNullableDate(row.recurrenceAnchorDate ?? row.recurrence_anchor_date),
          String(row.title ?? ""),
          String(row.notes ?? ""),
          toBool(row.isActive ?? row.is_active, true),
          actingUserId
        ]
      );
      ruleId = Number(result.rows[0]?.id || existingId);
    } else {
      const result = await client.query<{ id: number }>(
        `
          insert into exam_type_schedule_rules (
            modality_id, rule_type, effect_mode, specific_date, start_date, end_date,
            weekday, alternate_weeks, recurrence_anchor_date, title, notes, is_active, created_by_user_id, updated_by_user_id
          ) values (
            $1, $2, $3, $4::date, $5::date, $6::date, $7, $8, $9::date, nullif($10, ''), nullif($11, ''), $12, $13, $13
          )
          returning id
        `,
        [
          modalityId, ruleType,
          String(row.effectMode ?? row.effect_mode ?? "restriction_overridable"),
          toNullableDate(row.specificDate ?? row.specific_date),
          toNullableDate(row.startDate ?? row.start_date),
          toNullableDate(row.endDate ?? row.end_date),
          row.weekday === undefined || row.weekday === null || row.weekday === "" ? null : Number(row.weekday),
          toBool(row.alternateWeeks ?? row.alternate_weeks, false),
          toNullableDate(row.recurrenceAnchorDate ?? row.recurrence_anchor_date),
          String(row.title ?? ""),
          String(row.notes ?? ""),
          toBool(row.isActive ?? row.is_active, true),
          actingUserId
        ]
      );
      ruleId = Number(result.rows[0]?.id);
    }
    keepRuleIds.push(ruleId);

    // Replace only this rule's items.
    const examTypeIdsRaw = Array.isArray(row.examTypeIds) ? row.examTypeIds : Array.isArray(row.exam_type_ids) ? row.exam_type_ids : [];
    const examTypeIds = examTypeIdsRaw
      .map((v: unknown) => normalizePositiveInteger(v, "examTypeId"))
      .filter((v: unknown): v is number => v !== null);

    await client.query(`delete from exam_type_schedule_rule_items where rule_id = $1`, [ruleId]);
    for (const examTypeId of examTypeIds) {
      await client.query(
        `insert into exam_type_schedule_rule_items (rule_id, exam_type_id) values ($1, $2)`,
        [ruleId, examTypeId]
      );
    }
  }

  await client.query(
    `
      update exam_type_schedule_rules
      set is_active = false, updated_by_user_id = $1, updated_at = now()
      where id <> all($2::bigint[])
    `,
    [actingUserId, keepRuleIds]
  );
}

// ---------------------------------------------------------------------------
// Section D: exam_type_special_quotas
// ---------------------------------------------------------------------------

async function syncSpecialQuotas(
  client: PoolClient,
  rows: UnknownRecord[],
  actingUserId: UserId
): Promise<void> {
  if (rows.length === 0) {
    await deactivateAllRows(client, "exam_type_special_quotas", actingUserId);
    return;
  }

  const keepIds: number[] = [];

  for (const row of rows) {
    const examTypeId = normalizePositiveInteger(row.examTypeId ?? row.exam_type_id, "examTypeId") as number;
    const dailyExtraSlots = Math.max(0, Math.floor(Number(row.dailyExtraSlots ?? row.daily_extra_slots ?? 0)));
    const existingId = normalizePositiveInteger(row.id, "id") as number | null;

    if (existingId) {
      const result = await client.query<{ id: number }>(
        `
          update exam_type_special_quotas
          set exam_type_id = $2, daily_extra_slots = $3, is_active = $4,
              updated_by_user_id = $5, updated_at = now()
          where id = $1
          returning id
        `,
        [existingId, examTypeId, dailyExtraSlots, toBool(row.isActive ?? row.is_active, true), actingUserId]
      );
      keepIds.push(Number(result.rows[0]?.id || existingId));
    } else {
      const result = await client.query<{ id: number }>(
        `
          insert into exam_type_special_quotas (
            exam_type_id, daily_extra_slots, is_active, created_by_user_id, updated_by_user_id
          ) values ($1, $2, $3, $4, $4)
          on conflict (exam_type_id)
          do update set daily_extra_slots = excluded.daily_extra_slots, is_active = excluded.is_active,
                        updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
          returning id
        `,
        [examTypeId, dailyExtraSlots, toBool(row.isActive ?? row.is_active, true), actingUserId]
      );
      keepIds.push(Number(result.rows[0]?.id));
    }
  }

  await client.query(
    `
      update exam_type_special_quotas
      set is_active = false, updated_by_user_id = $1, updated_at = now()
      where id <> all($2::bigint[])
    `,
    [actingUserId, keepIds]
  );
}

// ---------------------------------------------------------------------------
// Section E: special_reason_codes
// ---------------------------------------------------------------------------

async function syncSpecialReasons(
  client: PoolClient,
  rows: UnknownRecord[],
  actingUserId: UserId
): Promise<void> {
  if (rows.length === 0) {
    await deactivateAllRows(client, "special_reason_codes", actingUserId);
    return;
  }

  const payloadCodes: string[] = [];

  for (const row of rows) {
    const code = String(row.code ?? "").trim();
    if (!code) {
      throw new HttpError(400, "Special reason code is required.");
    }
    payloadCodes.push(code);
    await client.query(
      `
        insert into special_reason_codes (
          code, label_ar, label_en, is_active, created_by_user_id, updated_by_user_id
        ) values ($1, $2, $3, $4, $5, $5)
        on conflict (code)
        do update set
          label_ar = excluded.label_ar,
          label_en = excluded.label_en,
          is_active = excluded.is_active,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [code, String(row.labelAr ?? row.label_ar ?? ""), String(row.labelEn ?? row.label_en ?? ""), toBool(row.isActive ?? row.is_active, true), actingUserId]
    );
  }

  await client.query(
    `
      update special_reason_codes
      set is_active = false, updated_by_user_id = $1, updated_at = now()
      where code <> all($2::text[])
    `,
    [actingUserId, payloadCodes]
  );
}

// ---------------------------------------------------------------------------
// Section F: patient_identifier_types
// ---------------------------------------------------------------------------

async function syncIdentifierTypes(
  client: PoolClient,
  rows: UnknownRecord[],
  actingUserId: UserId
): Promise<void> {
  const builtinCodes = ["national_id", "passport", "other"];
  if (rows.length === 0) {
    await client.query(
      `
        update patient_identifier_types
        set is_active = false, updated_by_user_id = $1, updated_at = now()
        where code <> all($2::text[])
      `,
      [actingUserId, builtinCodes]
    );
    return;
  }

  const payloadCodes = new Set<string>();
  for (const row of rows) {
    const code = String(row.code ?? "").trim();
    if (!code) {
      throw new HttpError(400, "Identifier type code is required.");
    }
    payloadCodes.add(code);

    await client.query(
      `
        insert into patient_identifier_types (
          code, label_ar, label_en, is_active, created_by_user_id, updated_by_user_id
        ) values ($1, $2, $3, $4, $5, $5)
        on conflict (code)
        do update set
          label_ar = excluded.label_ar,
          label_en = excluded.label_en,
          is_active = excluded.is_active,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [code, String(row.labelAr ?? row.label_ar ?? ""), String(row.labelEn ?? row.label_en ?? ""), toBool(row.isActive ?? row.is_active, true), actingUserId]
    );
  }

  const keepCodes = [...payloadCodes, ...builtinCodes];
  await client.query(
    `
      update patient_identifier_types
      set is_active = false, updated_by_user_id = $1, updated_at = now()
      where code <> all($2::text[])
    `,
    [actingUserId, keepCodes]
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSchedulingEngineConfiguration(): Promise<Record<string, unknown>> {
  const [
    categoryLimits,
    blockedRules,
    examRules,
    examRuleItems,
    specialQuotas,
    specialReasons,
    identifierTypes
  ] = await Promise.all([
    pool.query(`
      select id, modality_id, case_category, daily_limit, is_active
      from modality_category_daily_limits
      order by modality_id asc, case_category asc
    `),
    pool.query(`
      select id, modality_id, rule_type, specific_date, start_date, end_date,
             recur_start_month, recur_start_day, recur_end_month, recur_end_day,
             is_overridable, is_active, title, notes
      from modality_blocked_rules
      order by modality_id asc, id asc
    `),
    pool.query(`
      select id, modality_id, rule_type, effect_mode, specific_date, start_date, end_date,
             weekday, alternate_weeks, recurrence_anchor_date, title, notes, is_active
      from exam_type_schedule_rules
      order by modality_id asc, id asc
    `),
    pool.query(`
      select rule_id, exam_type_id
      from exam_type_schedule_rule_items
      order by rule_id asc, exam_type_id asc
    `),
    pool.query(`
      select id, exam_type_id, daily_extra_slots, is_active
      from exam_type_special_quotas
      order by exam_type_id asc
    `),
    pool.query(`
      select code, label_ar, label_en, is_active
      from special_reason_codes
      order by code asc
    `),
    pool.query(`
      select id, code, label_ar, label_en, is_active
      from patient_identifier_types
      order by id asc
    `)
  ]);

  const itemsByRuleId = (examRuleItems.rows as Array<{ rule_id: number; exam_type_id: number }>).reduce<Record<string, number[]>>(
    (acc, row) => {
      const key = String(row.rule_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push(Number(row.exam_type_id));
      return acc;
    },
    {}
  );

  return {
    categoryLimits: categoryLimits.rows,
    blockedRules: blockedRules.rows,
    examRules: examRules.rows.map((rule) => ({
      ...rule,
      exam_type_ids: itemsByRuleId[String((rule as { id: number }).id)] || []
    })),
    specialQuotas: specialQuotas.rows,
    specialReasons: specialReasons.rows,
    identifierTypes: identifierTypes.rows
  };
}

export async function saveSchedulingEngineConfiguration(
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<Record<string, unknown>> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const categoryLimits = asRecordArray(payload.categoryLimits);
    const blockedRulesPayload = asRecordArray(payload.blockedRules);
    const examRulesPayload = asRecordArray(payload.examRules);
    const specialQuotas = asRecordArray(payload.specialQuotas);
    const specialReasons = asRecordArray(payload.specialReasons);
    const identifierTypes = asRecordArray(payload.identifierTypes);

    await syncCategoryLimits(client, categoryLimits, currentUserId);
    await syncBlockedRules(client, blockedRulesPayload, currentUserId);
    await syncExamRules(client, examRulesPayload, currentUserId);
    await syncSpecialQuotas(client, specialQuotas, currentUserId);
    await syncSpecialReasons(client, specialReasons, currentUserId);
    await syncIdentifierTypes(client, identifierTypes, currentUserId);

    await logAuditEntry(
      {
        entityType: "scheduling_configuration",
        entityId: null,
        actionType: "bulk_save",
        oldValues: null,
        newValues: payload,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    return getSchedulingEngineConfiguration();
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
