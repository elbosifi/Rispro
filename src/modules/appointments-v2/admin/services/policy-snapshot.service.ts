/**
 * Appointments V2 — Policy snapshot loader.
 *
 * Builds typed V2 policy snapshots for admin APIs.
 */

import type { PoolClient } from "pg";
import type {
  PolicySnapshotDto,
  PolicyCategoryDailyLimitDto,
  PolicyModalityBlockedRuleDto,
  PolicyExamTypeRuleDto,
  PolicyExamTypeSpecialQuotaDto,
  PolicyExamMixQuotaRuleDto,
  PolicySpecialReasonCodeDto,
} from "../../api/dto/admin-scheduling.dto.js";

const EMPTY_SNAPSHOT: PolicySnapshotDto = {
  categoryDailyLimits: [],
  modalityBlockedRules: [],
  examTypeRules: [],
  examTypeSpecialQuotas: [],
  examMixQuotaRules: [],
  specialReasonCodes: [],
};

export async function loadPolicySnapshot(
  client: PoolClient,
  versionId: number | null
): Promise<PolicySnapshotDto> {
  if (!versionId) {
    const specialReasonCodes = await listSpecialReasonCodes(client);
    return {
      ...EMPTY_SNAPSHOT,
      specialReasonCodes,
    };
  }

  const [
    categoryDailyLimits,
    modalityBlockedRules,
    examTypeRules,
    examTypeSpecialQuotas,
    examMixQuotaRules,
    specialReasonCodes,
  ] = await Promise.all([
    listCategoryDailyLimits(client, versionId),
    listModalityBlockedRules(client, versionId),
    listExamTypeRules(client, versionId),
    listExamTypeSpecialQuotas(client, versionId),
    listExamMixQuotaRules(client, versionId),
    listSpecialReasonCodes(client),
  ]);

  return {
    categoryDailyLimits,
    modalityBlockedRules,
    examTypeRules,
    examTypeSpecialQuotas,
    examMixQuotaRules,
    specialReasonCodes,
  };
}

async function listCategoryDailyLimits(
  client: PoolClient,
  versionId: number
): Promise<PolicyCategoryDailyLimitDto[]> {
  const SQL = `
    select
      id,
      modality_id as "modalityId",
      case_category as "caseCategory",
      daily_limit as "dailyLimit",
      is_active as "isActive"
    from appointments_v2.category_daily_limits
    where policy_version_id = $1
    order by id asc
  `;
  const result = await client.query<PolicyCategoryDailyLimitDto>(SQL, [versionId]);
  return result.rows;
}

async function listModalityBlockedRules(
  client: PoolClient,
  versionId: number
): Promise<PolicyModalityBlockedRuleDto[]> {
  const SQL = `
    select
      id,
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
    order by id asc
  `;
  const result = await client.query<PolicyModalityBlockedRuleDto>(SQL, [versionId]);
  return result.rows;
}

async function listExamTypeRules(
  client: PoolClient,
  versionId: number
): Promise<PolicyExamTypeRuleDto[]> {
  const SQL = `
    select
      etr.id,
      etr.modality_id as "modalityId",
      etr.rule_type as "ruleType",
      etr.effect_mode as "effectMode",
      etr.specific_date::text as "specificDate",
      etr.start_date::text as "startDate",
      etr.end_date::text as "endDate",
      etr.weekday,
      etr.alternate_weeks as "alternateWeeks",
      etr.recurrence_anchor_date::text as "recurrenceAnchorDate",
      etr.title,
      etr.notes,
      etr.is_active as "isActive",
      coalesce(array_agg(etri.exam_type_id order by etri.exam_type_id)
        filter (where etri.exam_type_id is not null), '{}') as "examTypeIds"
    from appointments_v2.exam_type_rules etr
    left join appointments_v2.exam_type_rule_items etri on etri.rule_id = etr.id
    where etr.policy_version_id = $1
    group by etr.id
    order by etr.id asc
  `;
  const result = await client.query<PolicyExamTypeRuleDto>(SQL, [versionId]);
  return result.rows.map((row) => ({
    ...row,
    examTypeIds: Array.isArray(row.examTypeIds) ? row.examTypeIds.map(Number) : [],
  }));
}

async function listExamTypeSpecialQuotas(
  client: PoolClient,
  versionId: number
): Promise<PolicyExamTypeSpecialQuotaDto[]> {
  const SQL = `
    select
      id,
      exam_type_id as "examTypeId",
      daily_extra_slots as "dailyExtraSlots",
      is_active as "isActive"
    from appointments_v2.exam_type_special_quotas
    where policy_version_id = $1
    order by id asc
  `;
  const result = await client.query<PolicyExamTypeSpecialQuotaDto>(SQL, [versionId]);
  return result.rows;
}

async function listExamMixQuotaRules(
  client: PoolClient,
  versionId: number
): Promise<PolicyExamMixQuotaRuleDto[]> {
  const SQL = `
    select
      emqr.id,
      emqr.modality_id as "modalityId",
      emqr.title,
      emqr.rule_type as "ruleType",
      emqr.specific_date::text as "specificDate",
      emqr.start_date::text as "startDate",
      emqr.end_date::text as "endDate",
      emqr.weekday,
      emqr.alternate_weeks as "alternateWeeks",
      emqr.recurrence_anchor_date::text as "recurrenceAnchorDate",
      emqr.daily_limit as "dailyLimit",
      emqr.is_active as "isActive",
      coalesce(array_agg(emqri.exam_type_id order by emqri.exam_type_id)
        filter (where emqri.exam_type_id is not null), '{}') as "examTypeIds"
    from appointments_v2.exam_mix_quota_rules emqr
    left join appointments_v2.exam_mix_quota_rule_items emqri on emqri.rule_id = emqr.id
    where emqr.policy_version_id = $1
    group by emqr.id
    order by emqr.id asc
  `;
  const result = await client.query<PolicyExamMixQuotaRuleDto>(SQL, [versionId]);
  return result.rows.map((row) => ({
    ...row,
    examTypeIds: Array.isArray(row.examTypeIds) ? row.examTypeIds.map(Number) : [],
  }));
}

async function listSpecialReasonCodes(
  client: PoolClient
): Promise<PolicySpecialReasonCodeDto[]> {
  const SQL = `
    select
      code,
      label_ar as "labelAr",
      label_en as "labelEn",
      is_active as "isActive"
    from appointments_v2.special_reason_codes
    order by code asc
  `;
  const result = await client.query<PolicySpecialReasonCodeDto>(SQL);
  return result.rows;
}
