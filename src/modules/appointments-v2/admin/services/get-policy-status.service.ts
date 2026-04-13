/**
 * Appointments V2 — Get policy status service.
 *
 * Returns the current published policy version, any active draft,
 * and their associated rules for a given policy set key.
 */

import { pool } from "../../../../db/pool.js";
import {
  findPolicySetByKey,
  findPublishedVersion,
  findDraftVersion,
} from "../repositories/admin-policy.repo.js";
import { loadPolicySnapshot } from "./policy-snapshot.service.js";
import type { PolicyStatusDto, PolicyVersionDto } from "../../api/dto/admin-scheduling.dto.js";

export async function getPolicyStatus(
  policySetKey: string = "default"
): Promise<PolicyStatusDto> {
  const client = await pool.connect();
  try {
    // 1. Load the policy set
    const policySet = await findPolicySetByKey(client, policySetKey);
    if (!policySet) {
      return {
        policySet: null,
        published: null,
        draft: null,
        publishedSnapshot: {
          categoryDailyLimits: [],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          specialReasonCodes: [],
        },
        draftSnapshot: {
          categoryDailyLimits: [],
          modalityBlockedRules: [],
          examTypeRules: [],
          examTypeSpecialQuotas: [],
          specialReasonCodes: [],
        },
      };
    }

    // 2. Load published version
    const publishedVersion = await findPublishedVersion(client, policySetKey);
    let published: PolicyVersionDto | null = null;

    if (publishedVersion) {
      published = {
        id: publishedVersion.id,
        policySetId: publishedVersion.policySetId,
        versionNo: publishedVersion.versionNo,
        status: publishedVersion.status,
        configHash: publishedVersion.configHash,
        changeNote: publishedVersion.changeNote,
        createdAt: publishedVersion.createdAt,
        publishedAt: publishedVersion.publishedAt,
      };
    }

    // 3. Load draft version
    const draftVersion = await findDraftVersion(client, policySetKey);
    let draft: PolicyVersionDto | null = null;

    if (draftVersion) {
      draft = {
        id: draftVersion.id,
        policySetId: draftVersion.policySetId,
        versionNo: draftVersion.versionNo,
        status: draftVersion.status,
        configHash: draftVersion.configHash,
        changeNote: draftVersion.changeNote,
        createdAt: draftVersion.createdAt,
        publishedAt: draftVersion.publishedAt,
      };
    }

    const [publishedSnapshot, draftSnapshot] = await Promise.all([
      loadPolicySnapshot(client, published?.id ?? null),
      loadPolicySnapshot(client, draft?.id ?? null),
    ]);

    return {
      policySet: {
        id: policySet.id,
        key: policySet.key,
        name: policySet.name,
      },
      published,
      draft,
      publishedSnapshot,
      draftSnapshot,
    };
  } finally {
    client.release();
  }
}
