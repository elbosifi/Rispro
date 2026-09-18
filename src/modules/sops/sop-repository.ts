import { pool } from "../../db/pool.js";
import type { DbExecutor } from "../../types/db.js";
import type { SopDocument, SopFilters, SopSummary, SopVersion } from "./types.js";

interface SopRow {
  id: number;
  code: string;
  title: string;
  category: string;
  status: string;
  current_version: string | null;
  draft_version: string | null;
  current_effective_date: string | null;
  created_by_user_id: number;
  created_by_name: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
  updated_at: string;
}

interface SopVersionRow {
  id: number;
  sop_id: number;
  version: string;
  status: string;
  content_json: SopDocument;
  change_summary: string;
  effective_date: string | null;
  created_by_user_id: number;
  created_by_name: string | null;
  created_by_username: string | null;
  created_at: string;
  updated_by_user_id: number | null;
  updated_by_name: string | null;
  updated_at: string;
  published_by_user_id: number | null;
  published_by_name: string | null;
  published_by_username: string | null;
  published_at: string | null;
}

const SOP_SELECT = `
  select s.id, s.code, s.title, s.category, s.status, s.current_version,
         draft.version as draft_version,
         to_char(current_version.effective_date, 'YYYY-MM-DD') as current_effective_date,
         s.created_by_user_id,
         created_by.full_name as created_by_name,
         created_by.username as created_by_username,
         s.created_at, s.updated_by_user_id,
         updated_by.full_name as updated_by_name,
         s.updated_at
  from sops s
  join users created_by on created_by.id = s.created_by_user_id
  left join users updated_by on updated_by.id = s.updated_by_user_id
  left join sop_versions draft on draft.sop_id = s.id and draft.status = 'draft'
  left join sop_versions current_version on current_version.sop_id = s.id and current_version.version = s.current_version
`;

const VERSION_SELECT = `
  select v.id, v.sop_id, v.version, v.status, v.content_json, v.change_summary,
         to_char(v.effective_date, 'YYYY-MM-DD') as effective_date, v.created_by_user_id,
         created_by.full_name as created_by_name,
         created_by.username as created_by_username,
         v.created_at, v.updated_by_user_id,
         updated_by.full_name as updated_by_name,
         v.updated_at, v.published_by_user_id,
         published_by.full_name as published_by_name,
         published_by.username as published_by_username,
         v.published_at
  from sop_versions v
  join users created_by on created_by.id = v.created_by_user_id
  left join users updated_by on updated_by.id = v.updated_by_user_id
  left join users published_by on published_by.id = v.published_by_user_id
`;

function toSummary(row: SopRow): SopSummary {
  return {
    id: Number(row.id), code: row.code, title: row.title, category: row.category as SopSummary["category"],
    status: row.status as SopSummary["status"], currentVersion: row.current_version, draftVersion: row.draft_version,
    currentEffectiveDate: row.current_effective_date, createdByUserId: Number(row.created_by_user_id), createdByName: row.created_by_name,
    createdAt: row.created_at, updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id), updatedByName: row.updated_by_name, updatedAt: row.updated_at,
  };
}

function toVersion(row: SopVersionRow): SopVersion {
  return {
    id: Number(row.id), sopId: Number(row.sop_id), version: row.version, status: row.status as SopVersion["status"],
    contentJson: row.content_json, changeSummary: row.change_summary, effectiveDate: row.effective_date,
    createdByUserId: Number(row.created_by_user_id), createdByName: row.created_by_name, createdByUsername: row.created_by_username,
    createdAt: row.created_at, updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id), updatedByName: row.updated_by_name,
    updatedAt: row.updated_at, publishedByUserId: row.published_by_user_id == null ? null : Number(row.published_by_user_id), publishedByName: row.published_by_name,
    publishedByUsername: row.published_by_username, publishedAt: row.published_at,
  };
}

export async function listSopSummaries(filters: SopFilters, includeAll: boolean, executor: DbExecutor = pool): Promise<SopSummary[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (!includeAll) where.push("s.status = 'published'");
  if (filters.search?.trim()) { const value = add(`%${filters.search.trim()}%`); where.push(`(s.code ilike ${value} or s.title ilike ${value})`); }
  if (filters.category?.trim()) where.push(`s.category = ${add(filters.category.trim())}`);
  if (filters.status?.trim()) where.push(`s.status = ${add(filters.status.trim())}`);
  const result = await executor.query<SopRow>(`${SOP_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by s.updated_at desc, s.id desc`, values);
  return result.rows.map(toSummary);
}

export async function findSop(id: number, executor: DbExecutor = pool): Promise<SopSummary | null> {
  const result = await executor.query<SopRow>(`${SOP_SELECT} where s.id = $1 limit 1`, [id]);
  return result.rows[0] ? toSummary(result.rows[0]) : null;
}

export async function findSopByCode(code: string, executor: DbExecutor = pool): Promise<SopSummary | null> {
  const result = await executor.query<SopRow>(`${SOP_SELECT} where lower(s.code) = lower($1) limit 1`, [code]);
  return result.rows[0] ? toSummary(result.rows[0]) : null;
}

export async function listSopVersions(sopId: number, includeAll: boolean, executor: DbExecutor = pool): Promise<SopVersion[]> {
  const visibility = includeAll ? "" : "and v.status in ('published', 'superseded')";
  const result = await executor.query<SopVersionRow>(`${VERSION_SELECT} where v.sop_id = $1 ${visibility} order by v.created_at desc, v.id desc`, [sopId]);
  return result.rows.map(toVersion);
}

export async function findSopVersion(sopId: number, version: string, includeAll: boolean, executor: DbExecutor = pool): Promise<SopVersion | null> {
  const visibility = includeAll ? "" : "and v.status in ('published', 'superseded')";
  const result = await executor.query<SopVersionRow>(`${VERSION_SELECT} where v.sop_id = $1 and v.version = $2 ${visibility} limit 1`, [sopId, version]);
  return result.rows[0] ? toVersion(result.rows[0]) : null;
}

export async function getSopDetail(sopId: number, includeAll: boolean, executor: DbExecutor = pool): Promise<{ sop: SopSummary; versions: SopVersion[] } | null> {
  const sop = await findSop(sopId, executor);
  if (!sop) return null;
  return { sop, versions: await listSopVersions(sopId, includeAll, executor) };
}

export async function insertSop(input: { code: string; title: string; category: string; version: string; contentJson: SopDocument; changeSummary: string; effectiveDate: string | null; actorUserId: number }, executor: DbExecutor = pool): Promise<{ sop: SopSummary; version: SopVersion }> {
  const sopResult = await executor.query<{ id: number }>(`insert into sops(code, title, category, status, created_by_user_id, updated_by_user_id) values($1, $2, $3, 'draft', $4, $4) returning id`, [input.code, input.title, input.category, input.actorUserId]);
  const sopId = Number(sopResult.rows[0]!.id);
  await executor.query(`insert into sop_versions(sop_id, version, content_json, change_summary, effective_date, created_by_user_id, updated_by_user_id) values($1, $2, $3::jsonb, $4, $5, $6, $6)`, [sopId, input.version, JSON.stringify(input.contentJson), input.changeSummary, input.effectiveDate, input.actorUserId]);
  const detail = await getSopDetail(sopId, true, executor);
  if (!detail) throw new Error("Created SOP could not be reloaded.");
  return { sop: detail.sop, version: detail.versions[0]! };
}

export async function updateSopDraft(input: { sopId: number; version: string; title: string; category: string; contentJson: SopDocument; changeSummary: string; effectiveDate: string | null; actorUserId: number }, executor: DbExecutor = pool): Promise<{ sop: SopSummary; version: SopVersion }> {
  await executor.query(`update sops set title=$2, category=$3, updated_by_user_id=$4, updated_at=now() where id=$1`, [input.sopId, input.title, input.category, input.actorUserId]);
  await executor.query(`update sop_versions set content_json=$3::jsonb, change_summary=$4, effective_date=$5, updated_by_user_id=$6, updated_at=now() where sop_id=$1 and version=$2 and status='draft'`, [input.sopId, input.version, JSON.stringify(input.contentJson), input.changeSummary, input.effectiveDate, input.actorUserId]);
  const detail = await getSopDetail(input.sopId, true, executor);
  if (!detail) throw new Error("Updated SOP could not be reloaded.");
  const version = detail.versions.find((item) => item.version === input.version);
  if (!version) throw new Error("Updated SOP draft could not be reloaded.");
  return { sop: detail.sop, version };
}

export async function insertSopRevision(input: { sopId: number; version: string; changeSummary: string; effectiveDate: string | null; actorUserId: number; contentJson: SopDocument }, executor: DbExecutor = pool): Promise<SopVersion> {
  await executor.query(`insert into sop_versions(sop_id, version, status, content_json, change_summary, effective_date, created_by_user_id, updated_by_user_id) values($1, $2, 'draft', $3::jsonb, $4, $5, $6, $6)`, [input.sopId, input.version, JSON.stringify(input.contentJson), input.changeSummary, input.effectiveDate, input.actorUserId]);
  const version = await findSopVersion(input.sopId, input.version, true, executor);
  if (!version) throw new Error("Created SOP revision could not be reloaded.");
  return version;
}

export async function publishSopVersion(sopId: number, version: string, actorUserId: number, executor: DbExecutor = pool): Promise<{ sop: SopSummary; version: SopVersion }> {
  await executor.query(`update sop_versions set status='superseded' where sop_id=$1 and status='published'`, [sopId]);
  await executor.query(`update sop_versions set status='published', published_by_user_id=$3, published_at=now(), updated_by_user_id=$3, updated_at=now() where sop_id=$1 and version=$2 and status='draft'`, [sopId, version, actorUserId]);
  await executor.query(`update sops set status='published', current_version=$2, updated_by_user_id=$3, updated_at=now() where id=$1`, [sopId, version, actorUserId]);
  const detail = await getSopDetail(sopId, true, executor);
  if (!detail) throw new Error("Published SOP could not be reloaded.");
  const published = detail.versions.find((item) => item.version === version);
  if (!published) throw new Error("Published SOP version could not be reloaded.");
  return { sop: detail.sop, version: published };
}

export async function archiveSop(sopId: number, actorUserId: number, executor: DbExecutor = pool): Promise<SopSummary> {
  await executor.query(`update sops set status='archived', updated_by_user_id=$2, updated_at=now() where id=$1`, [sopId, actorUserId]);
  const sop = await findSop(sopId, executor);
  if (!sop) throw new Error("Archived SOP could not be reloaded.");
  return sop;
}
