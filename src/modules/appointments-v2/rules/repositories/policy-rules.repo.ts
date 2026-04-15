/**
 * Appointments V2 — Policy rules repository.
 *
 * Queries versioned rule tables under the appointments_v2 schema.
 * Stage 3 scaffold: SQL templates ready for parameterization.
 */

import type { PoolClient } from "pg";
import type {
  ModalityBlockedRuleRow,
  ExamTypeRuleRow,
  CategoryDailyLimitRow,
  ExamTypeSpecialQuotaRow,
} from "../models/rule-types.js";

const LOAD_BLOCKED_RULES_SQL = `
  select id,
         policy_version_id as "policyVersionId",
         modality_id as "modalityId",
         rule_type as "ruleType",
         specific_date::text as "specificDate",
         start_date::text as "startDate",
         end_date::text as "endDate",
         recur_start_month as "recurStartMonth",
         recur_start_day as "recurStartDay",
         recur_end_month as "recurEndMonth",
         recur_end_day as "recurEndDay",
         is_overridable as "isOverridable",
         is_active as "isActive",
         title,
         notes
  from appointments_v2.modality_blocked_rules
  where policy_version_id = $1
    and modality_id = $2
    and is_active = true
`;

export async function loadModalityBlockedRules(
  client: PoolClient,
  policyVersionId: number,
  modalityId: number
): Promise<ModalityBlockedRuleRow[]> {
  const result = await client.query<ModalityBlockedRuleRow>(LOAD_BLOCKED_RULES_SQL, [
    policyVersionId,
    modalityId,
  ]);
  return result.rows;
}

const LOAD_EXAM_RULES_SQL = `
  select id,
         policy_version_id as "policyVersionId",
         modality_id as "modalityId",
         rule_type as "ruleType",
         effect_mode as "effectMode",
         specific_date::text as "specificDate",
         start_date::text as "startDate",
         end_date::text as "endDate",
         weekday,
         alternate_weeks as "alternateWeeks",
         recurrence_anchor_date::text as "recurrenceAnchorDate",
         title,
         notes,
         is_active as "isActive"
  from appointments_v2.exam_type_rules
  where policy_version_id = $1
    and modality_id = $2
    and is_active = true
`;

export async function loadExamTypeRules(
  client: PoolClient,
  policyVersionId: number,
  modalityId: number
): Promise<ExamTypeRuleRow[]> {
  const result = await client.query<ExamTypeRuleRow>(LOAD_EXAM_RULES_SQL, [
    policyVersionId,
    modalityId,
  ]);
  return result.rows;
}

const LOAD_CATEGORY_LIMITS_SQL = `
  select id,
         policy_version_id as "policyVersionId",
         modality_id as "modalityId",
         case_category as "caseCategory",
         daily_limit as "dailyLimit",
         is_active as "isActive"
  from appointments_v2.category_daily_limits
  where policy_version_id = $1
    and modality_id = $2
    and is_active = true
`;

export async function loadCategoryDailyLimits(
  client: PoolClient,
  policyVersionId: number,
  modalityId: number
): Promise<CategoryDailyLimitRow[]> {
  const result = await client.query<CategoryDailyLimitRow>(LOAD_CATEGORY_LIMITS_SQL, [
    policyVersionId,
    modalityId,
  ]);
  return result.rows;
}

const LOAD_SPECIAL_QUOTAS_SQL = `
  select id,
         policy_version_id as "policyVersionId",
         exam_type_id as "examTypeId",
         daily_extra_slots as "dailyExtraSlots",
         is_active as "isActive"
  from appointments_v2.exam_type_special_quotas
  where policy_version_id = $1
    and is_active = true
`;

export async function loadExamTypeSpecialQuotas(
  client: PoolClient,
  policyVersionId: number
): Promise<ExamTypeSpecialQuotaRow[]> {
  const result = await client.query<ExamTypeSpecialQuotaRow>(LOAD_SPECIAL_QUOTAS_SQL, [
    policyVersionId,
  ]);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Exam type rule items (many-to-many join between exam_type_rules and exam_types)
// ---------------------------------------------------------------------------

const LOAD_EXAM_RULE_ITEM_EXAM_TYPE_IDS_SQL = `
  select etri.exam_type_id as "examTypeId"
  from appointments_v2.exam_type_rule_items etri
  inner join appointments_v2.exam_type_rules etr
    on etri.rule_id = etr.id
  where etr.policy_version_id = $1
    and etr.modality_id = $2
    and etr.is_active = true
`;

export async function loadExamTypeRuleItemExamTypeIds(
  client: PoolClient,
  policyVersionId: number,
  modalityId: number
): Promise<number[]> {
  const result = await client.query<{ examTypeId: number }>(
    LOAD_EXAM_RULE_ITEM_EXAM_TYPE_IDS_SQL,
    [policyVersionId, modalityId]
  );
  return result.rows.map((row) => Number(row.examTypeId));
}

/**
 * Load all exam type rule item IDs for a policy version (all modalities).
 * Used by compilePolicy for admin/audit purposes.
 */
const LOAD_ALL_EXAM_RULE_ITEM_EXAM_TYPE_IDS_SQL = `
  select distinct etri.exam_type_id as "examTypeId"
  from appointments_v2.exam_type_rule_items etri
  inner join appointments_v2.exam_type_rules etr
    on etri.rule_id = etr.id
  where etr.policy_version_id = $1
    and etr.is_active = true
`;

export async function loadAllExamTypeRuleItemExamTypeIds(
  client: PoolClient,
  policyVersionId: number
): Promise<number[]> {
  const result = await client.query<{ examTypeId: number }>(
    LOAD_ALL_EXAM_RULE_ITEM_EXAM_TYPE_IDS_SQL,
    [policyVersionId]
  );
  return result.rows.map((row) => Number(row.examTypeId));
}
