/**
 * Appointments V2 — Policy version repository.
 *
 * Queries the appointments_v2.policy_versions table.
 * Stage 3 scaffold: queries are written as template strings, ready for parameterization.
 */

import type { PoolClient } from "pg";

export interface PolicyVersionRow {
  id: number;
  policySetId: number;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  changeNote: string | null;
  publishedAt: string | null;
}

const FIND_PUBLISHED_SQL = `
  select id, policy_set_id as "policySetId", version_no as "versionNo",
         status, config_hash as "configHash", published_at as "publishedAt"
  from appointments_v2.policy_versions
  where policy_set_id = (select id from appointments_v2.policy_sets where key = $1)
    and status = 'published'
  order by version_no desc
  limit 1
`;

export async function findPublishedPolicyVersion(
  client: PoolClient,
  policySetKey: string
): Promise<PolicyVersionRow | null> {
  const result = await client.query<PolicyVersionRow>(FIND_PUBLISHED_SQL, [policySetKey]);
  return result.rows[0] ?? null;
}
