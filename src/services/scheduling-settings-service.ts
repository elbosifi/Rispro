import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import type { UnknownRecord, UserId } from "../types/http.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { validateIsoDate } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";

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

function toNullableText(value: unknown): string | null {
  const raw = String(value || "").trim();
  return raw || null;
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? (value as UnknownRecord[]) : [];
}

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
    const blockedRules = asRecordArray(payload.blockedRules);
    const examRules = asRecordArray(payload.examRules);
    const specialQuotas = asRecordArray(payload.specialQuotas);
    const specialReasons = asRecordArray(payload.specialReasons);
    const identifierTypes = asRecordArray(payload.identifierTypes);

    if (categoryLimits.length > 0) {
      await client.query(`delete from modality_category_daily_limits`);
      for (const row of categoryLimits) {
        const modalityId = normalizePositiveInteger(row.modalityId, "modalityId") as number;
        const category = String(row.caseCategory || "").trim();
        const limit = Number(row.dailyLimit || 0);
        if (!["oncology", "non_oncology"].includes(category)) {
          throw new HttpError(400, "caseCategory must be oncology or non_oncology.");
        }
        await client.query(
          `
            insert into modality_category_daily_limits (
              modality_id, case_category, daily_limit, is_active, created_by_user_id, updated_by_user_id
            ) values ($1, $2, $3, $4, $5, $5)
          `,
          [modalityId, category, Math.max(0, Math.floor(limit)), toBool(row.isActive, true), currentUserId]
        );
      }
    }

    if (blockedRules.length > 0) {
      await client.query(`delete from modality_blocked_rules`);
      for (const row of blockedRules) {
        const modalityId = normalizePositiveInteger(row.modalityId, "modalityId") as number;
        const ruleType = String(row.ruleType || "").trim();
        await client.query(
          `
            insert into modality_blocked_rules (
              modality_id, rule_type, specific_date, start_date, end_date,
              recur_start_month, recur_start_day, recur_end_month, recur_end_day,
              is_overridable, is_active, title, notes, created_by_user_id, updated_by_user_id
            )
            values ($1, $2, $3::date, $4::date, $5::date, $6, $7, $8, $9, $10, $11, nullif($12, ''), nullif($13, ''), $14, $14)
          `,
          [
            modalityId,
            ruleType,
            toNullableDate(row.specificDate),
            toNullableDate(row.startDate),
            toNullableDate(row.endDate),
            row.recurStartMonth ? Number(row.recurStartMonth) : null,
            row.recurStartDay ? Number(row.recurStartDay) : null,
            row.recurEndMonth ? Number(row.recurEndMonth) : null,
            row.recurEndDay ? Number(row.recurEndDay) : null,
            toBool(row.isOverridable, false),
            toBool(row.isActive, true),
            String(row.title || ""),
            String(row.notes || ""),
            currentUserId
          ]
        );
      }
    }

    if (examRules.length > 0) {
      await client.query(`delete from exam_type_schedule_rule_items`);
      await client.query(`delete from exam_type_schedule_rules`);
      for (const row of examRules) {
        const modalityId = normalizePositiveInteger(row.modalityId, "modalityId") as number;
        const ruleType = String(row.ruleType || "").trim();
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
            modalityId,
            ruleType,
            String(row.effectMode || "restriction_overridable"),
            toNullableDate(row.specificDate),
            toNullableDate(row.startDate),
            toNullableDate(row.endDate),
            row.weekday === undefined || row.weekday === null || row.weekday === "" ? null : Number(row.weekday),
            toBool(row.alternateWeeks, false),
            toNullableDate(row.recurrenceAnchorDate),
            String(row.title || ""),
            String(row.notes || ""),
            toBool(row.isActive, true),
            currentUserId
          ]
        );
        const insertedRuleId = Number(result.rows[0]?.id);
        const examTypeIds = Array.isArray(row.examTypeIds) ? row.examTypeIds : Array.isArray(row.exam_type_ids) ? row.exam_type_ids : [];
        for (const examTypeIdRaw of examTypeIds) {
          const examTypeId = normalizePositiveInteger(examTypeIdRaw, "examTypeId") as number;
          await client.query(
            `insert into exam_type_schedule_rule_items (rule_id, exam_type_id) values ($1, $2)`,
            [insertedRuleId, examTypeId]
          );
        }
      }
    }

    if (specialQuotas.length > 0) {
      await client.query(`delete from exam_type_special_quotas`);
      for (const row of specialQuotas) {
        const examTypeId = normalizePositiveInteger(row.examTypeId, "examTypeId") as number;
        const dailyExtraSlots = Math.max(0, Math.floor(Number(row.dailyExtraSlots || 0)));
        await client.query(
          `
            insert into exam_type_special_quotas (
              exam_type_id, daily_extra_slots, is_active, created_by_user_id, updated_by_user_id
            ) values ($1, $2, $3, $4, $4)
          `,
          [examTypeId, dailyExtraSlots, toBool(row.isActive, true), currentUserId]
        );
      }
    }

    if (specialReasons.length > 0) {
      await client.query(`delete from special_reason_codes`);
      for (const row of specialReasons) {
        const code = String(row.code || "").trim();
        if (!code) {
          throw new HttpError(400, "Special reason code is required.");
        }
        await client.query(
          `
            insert into special_reason_codes (
              code, label_ar, label_en, is_active, created_by_user_id, updated_by_user_id
            ) values ($1, $2, $3, $4, $5, $5)
          `,
          [code, String(row.labelAr || row.label_ar || ""), String(row.labelEn || row.label_en || ""), toBool(row.isActive, true), currentUserId]
        );
      }
    }

    if (identifierTypes.length > 0) {
      await client.query(`delete from patient_identifier_types where code not in ('national_id', 'passport', 'other')`);
      for (const row of identifierTypes) {
        const code = String(row.code || "").trim();
        if (!code) {
          throw new HttpError(400, "Identifier type code is required.");
        }
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
          [code, String(row.labelAr || row.label_ar || ""), String(row.labelEn || row.label_en || ""), toBool(row.isActive, true), currentUserId]
        );
      }
    }

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
