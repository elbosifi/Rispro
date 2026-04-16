/**
 * Appointments V2 — Admin policy repository.
 *
 * Queries appointments_v2.policy_sets and appointments_v2.policy_versions.
 * Extended for Stage 7: draft retrieval, version numbering, archiving, config loading.
 */

import type { PoolClient } from "pg";

const FIND_POLICY_SET_SQL = `
  select id, key, name, created_at as "createdAt"
  from appointments_v2.policy_sets
  where key = $1
`;

const FIND_ALL_POLICY_SETS_SQL = `
  select id, key, name, created_at as "createdAt"
  from appointments_v2.policy_sets
  order by key
`;

const CREATE_DRAFT_SQL = `
  insert into appointments_v2.policy_versions (
    policy_set_id, version_no, status, config_hash,
    created_by_user_id, published_by_user_id, change_note
  ) values ($1, $2, 'draft', $3, $4, null, $5)
  returning id, policy_set_id as "policySetId", version_no as "versionNo",
    status, config_hash as "configHash", change_note as "changeNote",
    created_at as "createdAt", published_at as "publishedAt"
`;

const FIND_PUBLISHED_SQL = `
  select pv.id, pv.policy_set_id as "policySetId", pv.version_no as "versionNo",
    pv.status, pv.config_hash as "configHash", pv.change_note as "changeNote",
    pv.created_at as "createdAt", pv.published_at as "publishedAt"
  from appointments_v2.policy_versions pv
  join appointments_v2.policy_sets ps on ps.id = pv.policy_set_id
  where ps.key = $1 and pv.status = 'published'
  order by pv.version_no desc
  limit 1
`;

const FIND_DRAFT_SQL = `
  select pv.id, pv.policy_set_id as "policySetId", pv.version_no as "versionNo",
    pv.status, pv.config_hash as "configHash", pv.change_note as "changeNote",
    pv.created_at as "createdAt", pv.published_at as "publishedAt"
  from appointments_v2.policy_versions pv
  join appointments_v2.policy_sets ps on ps.id = pv.policy_set_id
  where ps.key = $1 and pv.status = 'draft'
  order by pv.version_no desc
  limit 1
`;

const FIND_VERSION_BY_ID_SQL = `
  select pv.id, pv.policy_set_id as "policySetId", pv.version_no as "versionNo",
    pv.status, pv.config_hash as "configHash", pv.change_note as "changeNote",
    pv.created_at as "createdAt", pv.published_at as "publishedAt"
  from appointments_v2.policy_versions pv
  where pv.id = $1
`;

const GET_NEXT_VERSION_NO_SQL = `
  select coalesce(max(version_no), 0) + 1 as "nextVersion"
  from appointments_v2.policy_versions
  where policy_set_id = $1
`;

const PUBLISH_SQL = `
  update appointments_v2.policy_versions
  set status = 'published',
      published_at = now(),
      published_by_user_id = $1
  where id = $2 and status = 'draft'
  returning id
`;

const ARCHIVE_OLD_PUBLISHED_SQL = `
  update appointments_v2.policy_versions
  set status = 'archived'
  where policy_set_id = $1 and status = 'published' and id <> $2
`;

const UPDATE_DRAFT_CONFIG_SQL = `
  update appointments_v2.policy_versions
  set config_hash = $1, change_note = $2
  where id = $3 and status = 'draft'
  returning id
`;

const LOAD_ALL_RULES_FOR_VERSION_SQL = `
  select
    'category_daily_limit' as rule_type,
    cdl.id, cdl.modality_id as "modalityId", cdl.case_category as "caseCategory",
    cdl.daily_limit as "dailyLimit", cdl.is_active as "isActive"
  from appointments_v2.category_daily_limits cdl
  where cdl.policy_version_id = $1
  union all
  select
    'modality_blocked' as rule_type,
    mbr.id, mbr.modality_id as "modalityId", null as "caseCategory",
    null as "dailyLimit", mbr.is_active as "isActive"
  from appointments_v2.modality_blocked_rules mbr
  where mbr.policy_version_id = $1
  union all
  select
    'exam_type_rule' as rule_type,
    etr.id, etr.modality_id as "modalityId", null as "caseCategory",
    null as "dailyLimit", etr.is_active as "isActive"
  from appointments_v2.exam_type_rules etr
  where etr.policy_version_id = $1
  union all
  select
    'special_quota' as rule_type,
    etsq.id, null as "modalityId", null as "caseCategory",
    etsq.daily_extra_slots as "dailyLimit", etsq.is_active as "isActive"
  from appointments_v2.exam_type_special_quotas etsq
  where etsq.policy_version_id = $1
  union all
  select
    'exam_mix_quota' as rule_type,
    emqr.id, emqr.modality_id as "modalityId", null as "caseCategory",
    emqr.daily_limit as "dailyLimit", emqr.is_active as "isActive"
  from appointments_v2.exam_mix_quota_rules emqr
  where emqr.policy_version_id = $1
`;

export interface PolicySetRow {
  id: number;
  key: string;
  name: string;
}

export interface PolicyVersionRow {
  id: number;
  policySetId: number;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export async function findPolicySetByKey(
  client: PoolClient,
  key: string
): Promise<PolicySetRow | null> {
  const result = await client.query<PolicySetRow>(FIND_POLICY_SET_SQL, [key]);
  return result.rows[0] ?? null;
}

export async function findAllPolicySets(
  client: PoolClient
): Promise<PolicySetRow[]> {
  const result = await client.query<PolicySetRow>(FIND_ALL_POLICY_SETS_SQL);
  return result.rows;
}

export async function createDraftVersion(
  client: PoolClient,
  policySetId: number,
  nextVersionNo: number,
  configHash: string,
  createdByUserId: number,
  changeNote: string | null = null
): Promise<PolicyVersionRow> {
  const result = await client.query<PolicyVersionRow>(CREATE_DRAFT_SQL, [
    policySetId,
    nextVersionNo,
    configHash,
    createdByUserId,
    changeNote,
  ]);
  return result.rows[0];
}

export async function findPublishedVersion(
  client: PoolClient,
  policySetKey: string
): Promise<PolicyVersionRow | null> {
  const result = await client.query<PolicyVersionRow>(FIND_PUBLISHED_SQL, [policySetKey]);
  return result.rows[0] ?? null;
}

export async function findDraftVersion(
  client: PoolClient,
  policySetKey: string
): Promise<PolicyVersionRow | null> {
  const result = await client.query<PolicyVersionRow>(FIND_DRAFT_SQL, [policySetKey]);
  return result.rows[0] ?? null;
}

export async function findVersionById(
  client: PoolClient,
  versionId: number
): Promise<PolicyVersionRow | null> {
  const result = await client.query<PolicyVersionRow>(FIND_VERSION_BY_ID_SQL, [versionId]);
  return result.rows[0] ?? null;
}

export async function getNextVersionNumber(
  client: PoolClient,
  policySetId: number
): Promise<number> {
  const result = await client.query<{ nextVersion: number }>(GET_NEXT_VERSION_NO_SQL, [
    policySetId,
  ]);
  return result.rows[0]?.nextVersion ?? 1;
}

export async function publishVersion(
  client: PoolClient,
  versionId: number,
  publishedByUserId: number
): Promise<{ id: number } | null> {
  const result = await client.query<{ id: number }>(PUBLISH_SQL, [
    publishedByUserId,
    versionId,
  ]);
  return result.rows[0] ?? null;
}

export async function archiveOldPublishedVersions(
  client: PoolClient,
  policySetId: number,
  newlyPublishedVersionId: number
): Promise<void> {
  await client.query(ARCHIVE_OLD_PUBLISHED_SQL, [
    policySetId,
    newlyPublishedVersionId,
  ]);
}

export async function updateDraftConfig(
  client: PoolClient,
  versionId: number,
  configHash: string,
  changeNote: string | null
): Promise<{ id: number } | null> {
  const result = await client.query<{ id: number }>(UPDATE_DRAFT_CONFIG_SQL, [
    configHash,
    changeNote,
    versionId,
  ]);
  return result.rows[0] ?? null;
}

export interface PolicyRuleRow {
  ruleType: string;
  id: number;
  modalityId: number | null;
  caseCategory: string | null;
  dailyLimit: number | null;
  isActive: boolean;
}

export async function loadAllRulesForVersion(
  client: PoolClient,
  policyVersionId: number
): Promise<PolicyRuleRow[]> {
  const result = await client.query<PolicyRuleRow>(LOAD_ALL_RULES_FOR_VERSION_SQL, [
    policyVersionId,
  ]);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Rule persistence (authoritative replace)
// ---------------------------------------------------------------------------

const DELETE_EXAM_TYPE_RULE_ITEMS_SQL = `
  delete from appointments_v2.exam_type_rule_items
  where rule_id in (
    select id from appointments_v2.exam_type_rules where policy_version_id = $1
  )
`;

const DELETE_EXAM_TYPE_RULES_SQL = `
  delete from appointments_v2.exam_type_rules
  where policy_version_id = $1
`;

const DELETE_EXAM_MIX_QUOTA_RULE_ITEMS_SQL = `
  delete from appointments_v2.exam_mix_quota_rule_items
  where rule_id in (
    select id from appointments_v2.exam_mix_quota_rules where policy_version_id = $1
  )
`;

const DELETE_EXAM_MIX_QUOTA_RULES_SQL = `
  delete from appointments_v2.exam_mix_quota_rules
  where policy_version_id = $1
`;

const DELETE_EXAM_TYPE_SPECIAL_QUOTAS_SQL = `
  delete from appointments_v2.exam_type_special_quotas
  where policy_version_id = $1
`;

const DELETE_MODALITY_BLOCKED_RULES_SQL = `
  delete from appointments_v2.modality_blocked_rules
  where policy_version_id = $1
`;

const DELETE_CATEGORY_DAILY_LIMITS_SQL = `
  delete from appointments_v2.category_daily_limits
  where policy_version_id = $1
`;

const INSERT_CATEGORY_DAILY_LIMIT_SQL = `
  insert into appointments_v2.category_daily_limits (
    policy_version_id, modality_id, case_category, daily_limit, is_active
  ) values ($1, $2, $3, $4, $5)
  returning id, modality_id as "modalityId", case_category as "caseCategory",
    daily_limit as "dailyLimit", is_active as "isActive"
`;

const INSERT_MODALITY_BLOCKED_RULE_SQL = `
  insert into appointments_v2.modality_blocked_rules (
    policy_version_id, modality_id, rule_type, specific_date, start_date, end_date,
    recur_start_month, recur_start_day, recur_end_month, recur_end_day,
    is_overridable, is_active, title, notes
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  returning id, modality_id as "modalityId", rule_type as "ruleType",
    specific_date::text as "specificDate", start_date::text as "startDate",
    end_date::text as "endDate", recur_start_month as "recurStartMonth",
    recur_start_day as "recurStartDay", recur_end_month as "recurEndMonth",
    recur_end_day as "recurEndDay", is_overridable as "isOverridable",
    is_active as "isActive", title, notes
`;

const INSERT_EXAM_TYPE_RULE_SQL = `
  insert into appointments_v2.exam_type_rules (
    policy_version_id, modality_id, rule_type, effect_mode, specific_date,
    start_date, end_date, weekday, alternate_weeks, recurrence_anchor_date,
    title, notes, is_active
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  returning id, modality_id as "modalityId", rule_type as "ruleType",
    effect_mode as "effectMode", specific_date::text as "specificDate",
    start_date::text as "startDate", end_date::text as "endDate",
    weekday, alternate_weeks as "alternateWeeks",
    recurrence_anchor_date::text as "recurrenceAnchorDate",
    title, notes, is_active as "isActive"
`;

const INSERT_EXAM_TYPE_RULE_ITEM_SQL = `
  insert into appointments_v2.exam_type_rule_items (rule_id, exam_type_id)
  values ($1, $2)
`;

const INSERT_EXAM_TYPE_SPECIAL_QUOTA_SQL = `
  insert into appointments_v2.exam_type_special_quotas (
    policy_version_id, exam_type_id, daily_extra_slots, is_active
  ) values ($1, $2, $3, $4)
  returning id, exam_type_id as "examTypeId", daily_extra_slots as "dailyExtraSlots",
    is_active as "isActive"
`;

const INSERT_EXAM_MIX_QUOTA_RULE_SQL = `
  insert into appointments_v2.exam_mix_quota_rules (
    policy_version_id, modality_id, title, rule_type, specific_date, start_date, end_date,
    weekday, alternate_weeks, recurrence_anchor_date, daily_limit, is_active
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  returning id,
    modality_id as "modalityId",
    title,
    rule_type as "ruleType",
    specific_date::text as "specificDate",
    start_date::text as "startDate",
    end_date::text as "endDate",
    weekday,
    alternate_weeks as "alternateWeeks",
    recurrence_anchor_date::text as "recurrenceAnchorDate",
    daily_limit as "dailyLimit",
    is_active as "isActive"
`;

const INSERT_EXAM_MIX_QUOTA_RULE_ITEM_SQL = `
  insert into appointments_v2.exam_mix_quota_rule_items (rule_id, exam_type_id)
  values ($1, $2)
`;

const UPSERT_SPECIAL_REASON_CODE_SQL = `
  insert into appointments_v2.special_reason_codes (code, label_ar, label_en, is_active, updated_at, updated_by_user_id)
  values ($1, $2, $3, $4, now(), $5)
  on conflict (code) do update set
    label_ar = excluded.label_ar,
    label_en = excluded.label_en,
    is_active = excluded.is_active,
    updated_at = now(),
    updated_by_user_id = excluded.updated_by_user_id
`;

const DELETE_UNUSED_SPECIAL_REASON_CODES_SQL = `
  delete from appointments_v2.special_reason_codes
  where code <> all($1::text[])
`;

export async function deleteAllRulesForVersion(
  client: PoolClient,
  policyVersionId: number
): Promise<void> {
  // Delete in FK order: children first, then parents
  await client.query(DELETE_EXAM_TYPE_RULE_ITEMS_SQL, [policyVersionId]);
  await client.query(DELETE_EXAM_MIX_QUOTA_RULE_ITEMS_SQL, [policyVersionId]);
  await client.query(DELETE_EXAM_TYPE_RULES_SQL, [policyVersionId]);
  await client.query(DELETE_EXAM_MIX_QUOTA_RULES_SQL, [policyVersionId]);
  await client.query(DELETE_EXAM_TYPE_SPECIAL_QUOTAS_SQL, [policyVersionId]);
  await client.query(DELETE_MODALITY_BLOCKED_RULES_SQL, [policyVersionId]);
  await client.query(DELETE_CATEGORY_DAILY_LIMITS_SQL, [policyVersionId]);
}

export interface InsertedCategoryDailyLimit {
  id: number;
  modalityId: number;
  caseCategory: string;
  dailyLimit: number;
  isActive: boolean;
}

export async function insertCategoryDailyLimit(
  client: PoolClient,
  policyVersionId: number,
  rule: { modalityId: number; caseCategory: string; dailyLimit: number; isActive: boolean }
): Promise<InsertedCategoryDailyLimit> {
  const result = await client.query<InsertedCategoryDailyLimit>(INSERT_CATEGORY_DAILY_LIMIT_SQL, [
    policyVersionId,
    rule.modalityId,
    rule.caseCategory,
    rule.dailyLimit,
    rule.isActive,
  ]);
  return result.rows[0];
}

export interface InsertedModalityBlockedRule {
  id: number;
  modalityId: number;
  ruleType: string;
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  recurStartMonth: number | null;
  recurStartDay: number | null;
  recurEndMonth: number | null;
  recurEndDay: number | null;
  isOverridable: boolean;
  isActive: boolean;
  title: string | null;
  notes: string | null;
}

export async function insertModalityBlockedRule(
  client: PoolClient,
  policyVersionId: number,
  rule: {
    modalityId: number;
    ruleType: string;
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    recurStartMonth: number | null;
    recurStartDay: number | null;
    recurEndMonth: number | null;
    recurEndDay: number | null;
    isOverridable: boolean;
    isActive: boolean;
    title: string | null;
    notes: string | null;
  }
): Promise<InsertedModalityBlockedRule> {
  const result = await client.query<InsertedModalityBlockedRule>(INSERT_MODALITY_BLOCKED_RULE_SQL, [
    policyVersionId,
    rule.modalityId,
    rule.ruleType,
    rule.specificDate || null,
    rule.startDate || null,
    rule.endDate || null,
    rule.recurStartMonth,
    rule.recurStartDay,
    rule.recurEndMonth,
    rule.recurEndDay,
    rule.isOverridable,
    rule.isActive,
    rule.title || null,
    rule.notes || null,
  ]);
  return result.rows[0];
}

export interface InsertedExamTypeRule {
  id: number;
  modalityId: number;
  ruleType: string;
  effectMode: string;
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  title: string | null;
  notes: string | null;
  isActive: boolean;
}

export async function insertExamTypeRule(
  client: PoolClient,
  policyVersionId: number,
  rule: {
    modalityId: number;
    ruleType: string;
    effectMode: string;
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string | null;
    title: string | null;
    notes: string | null;
    isActive: boolean;
    examTypeIds: number[];
  }
): Promise<InsertedExamTypeRule> {
  const result = await client.query<InsertedExamTypeRule>(INSERT_EXAM_TYPE_RULE_SQL, [
    policyVersionId,
    rule.modalityId,
    rule.ruleType,
    rule.effectMode,
    rule.specificDate || null,
    rule.startDate || null,
    rule.endDate || null,
    rule.weekday,
    rule.alternateWeeks,
    rule.recurrenceAnchorDate || null,
    rule.title || null,
    rule.notes || null,
    rule.isActive,
  ]);
  const insertedRule = result.rows[0];

  // Insert exam type rule items
  for (const examTypeId of rule.examTypeIds) {
    await client.query(INSERT_EXAM_TYPE_RULE_ITEM_SQL, [insertedRule.id, examTypeId]);
  }

  return insertedRule;
}

export interface InsertedExamTypeSpecialQuota {
  id: number;
  examTypeId: number;
  dailyExtraSlots: number;
  isActive: boolean;
}

export async function insertExamTypeSpecialQuota(
  client: PoolClient,
  policyVersionId: number,
  rule: { examTypeId: number; dailyExtraSlots: number; isActive: boolean }
): Promise<InsertedExamTypeSpecialQuota> {
  const result = await client.query<InsertedExamTypeSpecialQuota>(INSERT_EXAM_TYPE_SPECIAL_QUOTA_SQL, [
    policyVersionId,
    rule.examTypeId,
    rule.dailyExtraSlots,
    rule.isActive,
  ]);
  return result.rows[0];
}

export interface InsertedExamMixQuotaRule {
  id: number;
  modalityId: number;
  title: string | null;
  ruleType: "specific_date" | "date_range" | "weekly_recurrence";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  dailyLimit: number;
  isActive: boolean;
}

export async function insertExamMixQuotaRule(
  client: PoolClient,
  policyVersionId: number,
  rule: {
    modalityId: number;
    title: string | null;
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string | null;
    dailyLimit: number;
    isActive: boolean;
    examTypeIds: number[];
  }
): Promise<InsertedExamMixQuotaRule> {
  const result = await client.query<InsertedExamMixQuotaRule>(INSERT_EXAM_MIX_QUOTA_RULE_SQL, [
    policyVersionId,
    rule.modalityId,
    rule.title ?? null,
    rule.ruleType,
    rule.specificDate || null,
    rule.startDate || null,
    rule.endDate || null,
    rule.weekday,
    rule.alternateWeeks,
    rule.recurrenceAnchorDate || null,
    rule.dailyLimit,
    rule.isActive,
  ]);
  const insertedRule = result.rows[0];
  for (const examTypeId of rule.examTypeIds) {
    await client.query(INSERT_EXAM_MIX_QUOTA_RULE_ITEM_SQL, [insertedRule.id, examTypeId]);
  }
  return insertedRule;
}

export async function upsertSpecialReasonCodes(
  client: PoolClient,
  codes: Array<{ code: string; labelAr: string; labelEn: string; isActive: boolean }>,
  userId: number
): Promise<void> {
  for (const c of codes) {
    await client.query(UPSERT_SPECIAL_REASON_CODE_SQL, [
      c.code,
      c.labelAr,
      c.labelEn,
      c.isActive,
      userId,
    ]);
  }

  // Remove codes no longer in the snapshot.
  // When the incoming list is empty, delete ALL codes.
  const codeList = codes.map((c) => c.code);
  if (codeList.length === 0) {
    await client.query(`delete from appointments_v2.special_reason_codes`);
  } else {
    await client.query(DELETE_UNUSED_SPECIAL_REASON_CODES_SQL, [codeList]);
  }
}
