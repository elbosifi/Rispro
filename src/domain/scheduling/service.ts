import type { DbExecutor } from "../../types/db.js";
import { pool } from "../../db/pool.js";
import { evaluateSchedulingCandidate } from "./evaluator.js";
import type {
  ExamTypeScheduleRule,
  ModalityBlockedRule,
  SchedulingCandidateInput,
  SchedulingDecisionContext,
  SchedulingResult
} from "./types.js";

// ---------------------------------------------------------------------------
// Malformed-rule detection
// ---------------------------------------------------------------------------

function hasValue<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isMalformedBlockedRule(row: BlockedRuleRow): boolean {
  if (row.rule_type === "specific_date") return !row.specific_date;
  if (row.rule_type === "date_range") return !row.start_date || !row.end_date || row.start_date > row.end_date;
  if (row.rule_type === "yearly_recurrence") {
    return !hasValue(row.recur_start_month)
      || !hasValue(row.recur_start_day)
      || !hasValue(row.recur_end_month)
      || !hasValue(row.recur_end_day);
  }
  return true; // unknown rule_type is malformed
}

function isMalformedExamRule(row: ExamRuleRow): boolean {
  if (row.rule_type === "specific_date") return !row.specific_date;
  if (row.rule_type === "date_range") return !row.start_date || !row.end_date || row.start_date > row.end_date;
  if (row.rule_type === "weekly_recurrence") {
    if (!row.start_date || !row.end_date || row.start_date > row.end_date) return true;
    if (!hasValue(row.weekday)) return true;
    if (row.alternate_weeks && !row.recurrence_anchor_date && !row.start_date) return true;
    return false;
  }
  return true; // unknown rule_type is malformed
}

interface CountRow {
  total_count: number | string | null;
  oncology_count: number | string | null;
  non_oncology_count: number | string | null;
}

interface LimitRow {
  case_category: "oncology" | "non_oncology";
  daily_limit: number;
}

interface BlockedRuleRow {
  id: number;
  rule_type: "specific_date" | "date_range" | "yearly_recurrence";
  specific_date: string | null;
  start_date: string | null;
  end_date: string | null;
  recur_start_month: number | null;
  recur_start_day: number | null;
  recur_end_month: number | null;
  recur_end_day: number | null;
  is_overridable: boolean;
}

interface ExamRuleRow {
  id: number;
  rule_type: "specific_date" | "date_range" | "weekly_recurrence";
  effect_mode: "hard_restriction" | "restriction_overridable";
  specific_date: string | null;
  start_date: string | null;
  end_date: string | null;
  weekday: number | null;
  alternate_weeks: boolean;
  recurrence_anchor_date: string | null;
  exam_type_id: number | null;
}

export async function evaluateSchedulingCandidateWithDb(
  input: SchedulingCandidateInput,
  client: DbExecutor = pool
): Promise<SchedulingResult> {
  const excludeAppointmentId = input.appointmentId || null;
  const excludeSql = excludeAppointmentId ? "and appointments.id <> $4" : "";
  const countParams: unknown[] = [input.modalityId, input.scheduledDate, "cancelled"];
  if (excludeAppointmentId) {
    countParams.push(excludeAppointmentId);
  }

  const [
    modalityResult,
    examTypeResult,
    limitsResult,
    blockedResult,
    examRulesResult,
    countsResult,
    specialQuotaResult,
    specialQuotaConsumedResult,
    globalCapacityResult
  ] = await Promise.all([
    client.query("select id from modalities where id = $1 and is_active = true limit 1", [input.modalityId]),
    input.examTypeId
      ? client.query("select id, modality_id from exam_types where id = $1 and is_active = true limit 1", [input.examTypeId])
      : Promise.resolve({ rows: [] }),
    client.query<LimitRow>(
      `
        select case_category, daily_limit
        from modality_category_daily_limits
        where modality_id = $1 and is_active = true
      `,
      [input.modalityId]
    ),
    client.query<BlockedRuleRow>(
      `
        select id, rule_type, specific_date, start_date, end_date, recur_start_month, recur_start_day, recur_end_month, recur_end_day, is_overridable
        from modality_blocked_rules
        where modality_id = $1 and is_active = true
      `,
      [input.modalityId]
    ),
    client.query<ExamRuleRow>(
      `
        select
          rules.id,
          rules.rule_type,
          rules.effect_mode,
          rules.specific_date,
          rules.start_date,
          rules.end_date,
          rules.weekday,
          rules.alternate_weeks,
          rules.recurrence_anchor_date,
          items.exam_type_id
        from exam_type_schedule_rules rules
        left join exam_type_schedule_rule_items items on items.rule_id = rules.id
        where rules.modality_id = $1
          and rules.is_active = true
      `,
      [input.modalityId]
    ),
    client.query<CountRow>(
      `
        select
          count(*) filter (where appointments.status <> $3) as total_count,
          count(*) filter (where appointments.status <> $3 and appointments.case_category = 'oncology') as oncology_count,
          count(*) filter (where appointments.status <> $3 and appointments.case_category = 'non_oncology') as non_oncology_count
        from appointments
        where appointments.modality_id = $1
          and appointments.appointment_date = $2::date
          ${excludeSql}
      `,
      countParams
    ),
    input.examTypeId
      ? client.query(
          `
            select daily_extra_slots
            from exam_type_special_quotas
            where exam_type_id = $1 and is_active = true
            limit 1
          `,
          [input.examTypeId]
        )
      : Promise.resolve({ rows: [] }),
    input.examTypeId
      ? client.query(
          `
            select coalesce(sum(consumed_slots), 0) as consumed_slots
            from appointment_quota_consumptions
            where modality_id = $1
              and exam_type_id = $2
              and appointment_date = $3::date
              and released_at is null
              ${excludeAppointmentId ? "and appointment_id <> $4" : ""}
          `,
          excludeAppointmentId
            ? [input.modalityId, input.examTypeId, input.scheduledDate, excludeAppointmentId]
            : [input.modalityId, input.examTypeId, input.scheduledDate]
        )
      : Promise.resolve({ rows: [] }),
    client.query(
      `
        select daily_capacity
        from modalities
        where id = $1
        limit 1
      `,
      [input.modalityId]
    )
  ]);

  const examRow = (examTypeResult.rows?.[0] as { id: number; modality_id: number } | undefined) || null;
  const limitMap = new Map<"oncology" | "non_oncology", number>();
  for (const row of limitsResult.rows) {
    limitMap.set(row.case_category, Number(row.daily_limit));
  }

  const groupedExamRules = new Map<number, ExamTypeScheduleRule>();
  for (const row of examRulesResult.rows) {
    const existing = groupedExamRules.get(row.id);
    if (existing) {
      if (row.exam_type_id) existing.allowedExamTypeIds.push(Number(row.exam_type_id));
      continue;
    }
    groupedExamRules.set(row.id, {
      id: row.id,
      ruleType: row.rule_type,
      effectMode: row.effect_mode,
      specificDate: row.specific_date,
      startDate: row.start_date,
      endDate: row.end_date,
      weekday: row.weekday === null ? null : Number(row.weekday),
      alternateWeeks: Boolean(row.alternate_weeks),
      recurrenceAnchorDate: row.recurrence_anchor_date,
      allowedExamTypeIds: row.exam_type_id ? [Number(row.exam_type_id)] : []
    });
  }

  const counts = (countsResult.rows[0] as CountRow | undefined) || {
    total_count: 0,
    oncology_count: 0,
    non_oncology_count: 0
  };
  const specialQuotaRow = specialQuotaResult.rows?.[0] as { daily_extra_slots?: number | string } | undefined;
  const specialConsumedRow = specialQuotaConsumedResult.rows?.[0] as { consumed_slots?: number | string } | undefined;
  const modalityCapacityRow = globalCapacityResult.rows?.[0] as { daily_capacity?: number | string } | undefined;

  // Detect malformed rule rows — these must block scheduling entirely.
  const malformedRuleConfig =
    blockedResult.rows.some(isMalformedBlockedRule) ||
    examRulesResult.rows.some(isMalformedExamRule);

  const context: SchedulingDecisionContext = {
    integrity: {
      modalityExists: modalityResult.rows.length > 0,
      examTypeExists: input.examTypeId ? Boolean(examRow) : true,
      examTypeBelongsToModality: input.examTypeId ? Boolean(examRow && Number(examRow.modality_id) === Number(input.modalityId)) : true,
      malformedRuleConfig
    },
    blockedRules: blockedResult.rows.map((row): ModalityBlockedRule => ({
      id: row.id,
      ruleType: row.rule_type,
      specificDate: row.specific_date,
      startDate: row.start_date,
      endDate: row.end_date,
      recurStartMonth: row.recur_start_month === null ? null : Number(row.recur_start_month),
      recurStartDay: row.recur_start_day === null ? null : Number(row.recur_start_day),
      recurEndMonth: row.recur_end_month === null ? null : Number(row.recur_end_month),
      recurEndDay: row.recur_end_day === null ? null : Number(row.recur_end_day),
      isOverridable: Boolean(row.is_overridable)
    })),
    examTypeRules: Array.from(groupedExamRules.values()),
    capacity: {
      standardDailyCapacity:
        modalityCapacityRow?.daily_capacity === undefined || modalityCapacityRow?.daily_capacity === null
          ? null
          : Number(modalityCapacityRow.daily_capacity),
      categoryLimits: {
        oncology: limitMap.has("oncology") ? Number(limitMap.get("oncology")) : null,
        nonOncology: limitMap.has("non_oncology") ? Number(limitMap.get("non_oncology")) : null
      },
      bookedTotals: {
        total: Number(counts.total_count || 0),
        oncology: Number(counts.oncology_count || 0),
        nonOncology: Number(counts.non_oncology_count || 0)
      },
      specialQuotaLimit:
        specialQuotaRow?.daily_extra_slots === undefined || specialQuotaRow?.daily_extra_slots === null
          ? null
          : Number(specialQuotaRow.daily_extra_slots),
      specialQuotaConsumed: Number(specialConsumedRow?.consumed_slots || 0)
    }
  };

  return evaluateSchedulingCandidate(input, context);
}
