/**
 * Appointments V2 — Save policy draft service.
 *
 * Authoritatively replaces the draft config snapshot (D006).
 * The config hash is recalculated from the provided snapshot.
 * Omitted rules are implicitly deactivated — only what's in the
 * new snapshot will be active when published.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { hashConfigSnapshot } from "../../shared/utils/hashing.js";
import {
  findVersionById,
  updateDraftConfig,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";
import type { PolicySnapshotDto } from "../../api/dto/admin-scheduling.dto.js";

export interface SavePolicyDraftResult {
  version: PolicyVersionRow;
  configHash: string;
}

export async function savePolicyDraft(
  versionId: number,
  policySnapshot: PolicySnapshotDto,
  userId: number,
  changeNote: string | null = null
): Promise<SavePolicyDraftResult> {
  return withTransaction(async (client) => {
    return savePolicyDraftInternal(client, versionId, policySnapshot, userId, changeNote);
  });
}

async function savePolicyDraftInternal(
  client: PoolClient,
  versionId: number,
  policySnapshot: PolicySnapshotDto,
  userId: number,
  changeNote: string | null
): Promise<SavePolicyDraftResult> {
  // 1. Find the version
  const version = await findVersionById(client, versionId);
  if (!version) {
    throw new SchedulingError(
      404,
      `Policy version ${versionId} not found.`,
      ["policy_version_not_found"]
    );
  }

  // 2. Must be a draft
  if (version.status !== "draft") {
    throw new SchedulingError(
      409,
      `Policy version ${versionId} is '${version.status}' and cannot be modified. Only drafts can be saved.`,
      ["policy_version_not_draft"]
    );
  }

  // 3. Compute the config hash
  const configHash = hashConfigSnapshot(policySnapshot);

  // 4. Update the draft
  const updated = await updateDraftConfig(client, versionId, configHash, changeNote);
  if (!updated) {
    throw new SchedulingError(
      500,
      "Failed to update draft configuration.",
      ["draft_update_failed"]
    );
  }

  // 5. Return the updated version
  const refreshed = await findVersionById(client, versionId);
  if (!refreshed) {
    throw new SchedulingError(
      500,
      "Failed to retrieve updated draft.",
      ["draft_retrieve_failed"]
    );
  }

  return {
    version: refreshed,
    configHash,
  };
}
