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
    cdl.daily_limit as "dailyLimit", cdl.is_active as "isActive",
    concat_ws('|', 'category_daily_limit', cdl.modality_id, cdl.case_category) as "identityKey",
    jsonb_build_object(
      'ruleType', 'category_daily_limit',
      'modalityId', cdl.modality_id,
      'caseCategory', cdl.case_category,
      'dailyLimit', cdl.daily_limit,
      'isActive', cdl.is_active
    )::text as "contentKey"
  from appointments_v2.category_daily_limits cdl
  where cdl.policy_version_id = $1
  union all
  select
    'modality_blocked' as rule_type,
    mbr.id, mbr.modality_id as "modalityId", null as "caseCategory",
    null as "dailyLimit", mbr.is_active as "isActive",
    concat_ws('|', 'modality_blocked', mbr.modality_id, mbr.rule_type, coalesce(mbr.specific_date::text, ''), coalesce(mbr.start_date::text, ''), coalesce(mbr.end_date::text, ''), coalesce(mbr.recur_start_month::text, ''), coalesce(mbr.recur_start_day::text, ''), coalesce(mbr.recur_end_month::text, ''), coalesce(mbr.recur_end_day::text, '')) as "identityKey",
    jsonb_build_object(
      'ruleType', 'modality_blocked',
      'modalityId', mbr.modality_id,
      'blockRuleType', mbr.rule_type,
      'specificDate', mbr.specific_date::text,
      'startDate', mbr.start_date::text,
      'endDate', mbr.end_date::text,
      'recurStartMonth', mbr.recur_start_month,
      'recurStartDay', mbr.recur_start_day,
      'recurEndMonth', mbr.recur_end_month,
      'recurEndDay', mbr.recur_end_day,
      'isOverridable', mbr.is_overridable,
      'isActive', mbr.is_active,
      'title', coalesce(mbr.title, ''),
      'notes', coalesce(mbr.notes, '')
    )::text as "contentKey"
  from appointments_v2.modality_blocked_rules mbr
  where mbr.policy_version_id = $1
  union all
  select
    'exam_type_rule' as rule_type,
    etr.id, etr.modality_id as "modalityId", null as "caseCategory",
    null as "dailyLimit", etr.is_active as "isActive",
    case
      when nullif(trim(coalesce(etr.title, '')), '') is not null
        then concat_ws('|', 'exam_type_rule', etr.modality_id, 'title', lower(trim(etr.title)))
      else concat_ws('|', 'exam_type_rule', etr.modality_id, etr.rule_type, coalesce(etr.specific_date::text, ''), coalesce(etr.start_date::text, ''), coalesce(etr.end_date::text, ''), coalesce(etr.weekday::text, ''), coalesce(etr.alternate_weeks::text, ''), coalesce(etr.recurrence_anchor_date::text, ''))
    end as "identityKey",
    jsonb_build_object(
      'ruleType', 'exam_type_rule',
      'modalityId', etr.modality_id,
      'examRuleType', etr.rule_type,
      'effectMode', etr.effect_mode,
      'specificDate', etr.specific_date::text,
      'startDate', etr.start_date::text,
      'endDate', etr.end_date::text,
      'weekday', etr.weekday,
      'alternateWeeks', etr.alternate_weeks,
      'recurrenceAnchorDate', etr.recurrence_anchor_date::text,
      'title', coalesce(etr.title, ''),
      'notes', coalesce(etr.notes, ''),
      'isActive', etr.is_active,
      'examTypeIds', coalesce((
        select jsonb_agg(etri.exam_type_id order by etri.exam_type_id)
        from appointments_v2.exam_type_rule_items etri
        where etri.rule_id = etr.id
      ), '[]'::jsonb)
    )::text as "contentKey"
  from appointments_v2.exam_type_rules etr
  where etr.policy_version_id = $1
  union all
  select
    'special_quota' as rule_type,
    quota.id, quota.modality_id as "modalityId", null as "caseCategory",
    quota.daily_extra_slots as "dailyLimit", quota.is_active as "isActive",
    concat_ws('|', 'special_quota', quota.logical_key) as "identityKey",
    jsonb_build_object(
      'ruleType', 'special_quota',
      'logicalKey', quota.logical_key,
      'modalityId', quota.modality_id,
      'title', coalesce(quota.title, ''),
      'dailyExtraSlots', quota.daily_extra_slots,
      'isActive', quota.is_active,
      'examTypeIds', coalesce((
        select jsonb_agg(membership.exam_type_id order by membership.exam_type_id)
        from appointments_v2.special_quota_rule_exam_types membership
        where membership.quota_rule_id = quota.id
      ), '[]'::jsonb),
      'allowedUserIds', coalesce((
        select jsonb_agg(quota_user.user_id order by quota_user.user_id)
        from appointments_v2.special_quota_rule_users quota_user
        where quota_user.quota_rule_id = quota.id
      ), '[]'::jsonb)
    )::text as "contentKey"
  from appointments_v2.special_quota_rules quota
  where quota.policy_version_id = $1
  union all
  select
    'exam_mix_quota' as rule_type,
    emqr.id, emqr.modality_id as "modalityId", null as "caseCategory",
    emqr.daily_limit as "dailyLimit", emqr.is_active as "isActive",
    case
      when nullif(trim(coalesce(emqr.title, '')), '') is not null
        then concat_ws('|', 'exam_mix_quota', emqr.modality_id, 'title', lower(trim(emqr.title)))
      else concat_ws('|', 'exam_mix_quota', emqr.modality_id, emqr.rule_type, coalesce(emqr.specific_date::text, ''), coalesce(emqr.start_date::text, ''), coalesce(emqr.end_date::text, ''), coalesce(emqr.weekday::text, ''), coalesce(emqr.alternate_weeks::text, ''), coalesce(emqr.recurrence_anchor_date::text, ''))
    end as "identityKey",
    jsonb_build_object(
      'ruleType', 'exam_mix_quota',
      'modalityId', emqr.modality_id,
      'mixRuleType', emqr.rule_type,
      'specificDate', emqr.specific_date::text,
      'startDate', emqr.start_date::text,
      'endDate', emqr.end_date::text,
      'weekday', emqr.weekday,
      'alternateWeeks', emqr.alternate_weeks,
      'recurrenceAnchorDate', emqr.recurrence_anchor_date::text,
      'title', coalesce(emqr.title, ''),
      'dailyLimit', emqr.daily_limit,
      'isActive', emqr.is_active,
      'examTypeIds', coalesce((
        select jsonb_agg(emqri.exam_type_id order by emqri.exam_type_id)
        from appointments_v2.exam_mix_quota_rule_items emqri
        where emqri.rule_id = emqr.id
      ), '[]'::jsonb)
    )::text as "contentKey"
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
  identityKey?: string | null;
  contentKey?: string | null;
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

const DELETE_SPECIAL_QUOTA_RULES_SQL = `
  delete from appointments_v2.special_quota_rules
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

const INSERT_SPECIAL_QUOTA_RULE_SQL = `
  insert into appointments_v2.special_quota_rules (
    policy_version_id, logical_key, modality_id, title, daily_extra_slots, is_active
  ) values ($1, $2::uuid, $3, $4, $5, $6)
  returning id, logical_key::text as "logicalKey", modality_id as "modalityId", title,
    daily_extra_slots as "dailyExtraSlots", is_active as "isActive"
`;

const INSERT_SPECIAL_QUOTA_RULE_EXAM_TYPE_SQL = `
  insert into appointments_v2.special_quota_rule_exam_types (quota_rule_id, exam_type_id)
  values ($1, $2)
  on conflict do nothing
`;

const INSERT_SPECIAL_QUOTA_RULE_USER_SQL = `
  insert into appointments_v2.special_quota_rule_users (quota_rule_id, user_id)
  values ($1, $2)
  on conflict do nothing
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

const DEACTIVATE_UNUSED_SPECIAL_REASON_CODES_SQL = `
  update appointments_v2.special_reason_codes
  set is_active = false,
      updated_at = now(),
      updated_by_user_id = $2
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
  await client.query(DELETE_SPECIAL_QUOTA_RULES_SQL, [policyVersionId]);
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

export interface InsertedSpecialQuotaRule {
  id: number;
  logicalKey: string;
  modalityId: number;
  title: string | null;
  examTypeIds: number[];
  dailyExtraSlots: number;
  allowedUserIds: number[];
  isActive: boolean;
}

export async function insertSpecialQuotaRule(
  client: PoolClient,
  policyVersionId: number,
  rule: {
    logicalKey: string;
    modalityId: number;
    title: string | null;
    examTypeIds: number[];
    dailyExtraSlots: number;
    allowedUserIds?: number[];
    isActive: boolean;
  }
): Promise<InsertedSpecialQuotaRule> {
  const result = await client.query<InsertedSpecialQuotaRule>(INSERT_SPECIAL_QUOTA_RULE_SQL, [
    policyVersionId,
    rule.logicalKey,
    rule.modalityId,
    rule.title || null,
    rule.dailyExtraSlots,
    rule.isActive,
  ]);
  const inserted = result.rows[0];
  const examTypeIds = [...new Set(rule.examTypeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  for (const examTypeId of examTypeIds) {
    await client.query(INSERT_SPECIAL_QUOTA_RULE_EXAM_TYPE_SQL, [inserted.id, examTypeId]);
  }
  const allowedUserIds = [...new Set((rule.allowedUserIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
  for (const userId of allowedUserIds) {
    await client.query(INSERT_SPECIAL_QUOTA_RULE_USER_SQL, [inserted.id, userId]);
  }
  return { ...inserted, examTypeIds, allowedUserIds };
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

  // Removed codes are deactivated, not deleted, so historical bookings can
  // still resolve their labels on appointment slips and audit views.
  const codeList = codes.map((c) => c.code);
  if (codeList.length === 0) {
    await client.query(
      `update appointments_v2.special_reason_codes
       set is_active = false, updated_at = now(), updated_by_user_id = $1`,
      [userId]
    );
  } else {
    await client.query(DEACTIVATE_UNUSED_SPECIAL_REASON_CODES_SQL, [codeList, userId]);
  }
}
