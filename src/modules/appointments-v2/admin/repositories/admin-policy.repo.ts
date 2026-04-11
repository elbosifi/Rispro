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
  select coalesce(max(version_no), 0) + 1 as next_version
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
