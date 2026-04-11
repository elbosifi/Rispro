/**
 * Appointments V2 — Create policy draft service.
 *
 * Creates a new draft version based on the currently published version.
 * Copies the published config hash as the starting point for the draft.
 * D006: Omitted rules from the published version are carried forward;
 * the draft is a clean copy that can then be modified authoritatively.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { hashConfigSnapshot } from "../../shared/utils/hashing.js";
import {
  findPolicySetByKey,
  findPublishedVersion,
  findDraftVersion,
  getNextVersionNumber,
  createDraftVersion,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";

export interface CreatePolicyDraftResult {
  draft: PolicyVersionRow;
  basedOnVersionId: number;
}

export async function createPolicyDraft(
  policySetKey: string,
  userId: number,
  changeNote: string | null = null
): Promise<CreatePolicyDraftResult> {
  return withTransaction(async (client) => {
    return createPolicyDraftInternal(client, policySetKey, userId, changeNote);
  });
}

async function createPolicyDraftInternal(
  client: PoolClient,
  policySetKey: string,
  userId: number,
  changeNote: string | null
): Promise<CreatePolicyDraftResult> {
  // 1. Find the policy set
  const policySet = await findPolicySetByKey(client, policySetKey);
  if (!policySet) {
    throw new SchedulingError(
      404,
      `Policy set '${policySetKey}' not found.`,
      ["policy_set_not_found"]
    );
  }

  // 2. Check if a draft already exists
  const existingDraft = await findDraftVersion(client, policySetKey);
  if (existingDraft) {
    throw new SchedulingError(
      409,
      `A draft already exists for policy set '${policySetKey}' (version ${existingDraft.versionNo}).`,
      ["draft_already_exists"]
    );
  }

  // 3. Find the published version to base the draft on
  const published = await findPublishedVersion(client, policySetKey);
  if (!published) {
    // No published version — create a draft with empty config
    const nextVersion = await getNextVersionNumber(client, policySet.id);
    const emptyConfigHash = hashConfigSnapshot({});
    const draft = await createDraftVersion(
      client,
      policySet.id,
      nextVersion,
      emptyConfigHash,
      userId,
      changeNote ?? "Initial draft (no published version)"
    );
    return { draft, basedOnVersionId: 0 };
  }

  // 4. Create the draft based on published version
  const nextVersion = await getNextVersionNumber(client, policySet.id);
  const draft = await createDraftVersion(
    client,
    policySet.id,
    nextVersion,
    published.configHash,
    userId,
    changeNote ?? `Draft based on published version ${published.versionNo}`
  );

  return { draft, basedOnVersionId: published.id };
}
