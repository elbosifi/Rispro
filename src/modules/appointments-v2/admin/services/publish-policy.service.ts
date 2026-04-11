/**
 * Appointments V2 — Publish policy service.
 *
 * Publishes a draft version with optimistic concurrency check.
 * Archives any previously published version (D007: only one published per set).
 * Validates the draft before publishing.
 */

import type { PoolClient } from "pg";
import { withTransaction } from "../../shared/utils/transactions.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import {
  findVersionById,
  findPolicySetByKey,
  publishVersion,
  archiveOldPublishedVersions,
  loadAllRulesForVersion,
  type PolicyVersionRow,
} from "../repositories/admin-policy.repo.js";
import { validatePolicyDraft } from "../../rules/services/validate-policy.js";
import { pool } from "../../../../db/pool.js";

export interface PublishPolicyResult {
  published: PolicyVersionRow;
  archivedCount: number;
  ruleCount: number;
}

export async function publishPolicy(
  versionId: number,
  userId: number,
  changeNote: string | null = null
): Promise<PublishPolicyResult> {
  return withTransaction(async (client) => {
    return publishPolicyInternal(client, versionId, userId, changeNote);
  });
}

async function publishPolicyInternal(
  client: PoolClient,
  versionId: number,
  userId: number,
  changeNote: string | null
): Promise<PublishPolicyResult> {
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
      `Policy version ${versionId} is '${version.status}' and cannot be published. Only drafts can be published.`,
      ["policy_version_not_draft"]
    );
  }

  // 3. Validate the draft before publishing
  const validation = await validatePolicyDraft(versionId);
  if (!validation.isValid) {
    throw new SchedulingError(
      400,
      `Policy draft has validation errors: ${validation.errors.join("; ")}`,
      validation.errors.map((e: string) => `validation_${e}`),
      { warnings: validation.warnings }
    );
  }

  // 4. Load rules for counting (for the response)
  const rules = await loadAllRulesForVersion(client, versionId);

  // 5. Publish the version
  const published = await publishVersion(client, versionId, userId);
  if (!published) {
    throw new SchedulingError(
      409,
      `Failed to publish policy version ${versionId}. It may have been published by another user.`,
      ["publish_concurrent"]
    );
  }

  // 6. Archive old published versions (D007: only one published per set)
  await archiveOldPublishedVersions(client, version.policySetId, versionId);

  // 7. Get the refreshed version
  const refreshed = await findVersionById(client, versionId);
  if (!refreshed) {
    throw new SchedulingError(500, "Failed to retrieve published version.", ["publish_retrieve_failed"]);
  }

  return {
    published: refreshed,
    archivedCount: 0, // Hard to count from archive query; could be improved
    ruleCount: rules.length,
  };
}
