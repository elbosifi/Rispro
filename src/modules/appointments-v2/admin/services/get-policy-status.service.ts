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
  loadAllRulesForVersion,
} from "../repositories/admin-policy.repo.js";

export interface PolicyStatusResult {
  policySet: { id: number; key: string; name: string } | null;
  published: {
    id: number;
    versionNo: number;
    configHash: string;
    changeNote: string | null;
    publishedAt: string | null;
  } | null;
  draft: {
    id: number;
    versionNo: number;
    configHash: string;
    changeNote: string | null;
    createdAt: string;
  } | null;
  publishedRules: Array<Record<string, unknown>>;
  draftRules: Array<Record<string, unknown>>;
}

export async function getPolicyStatus(
  policySetKey: string = "default"
): Promise<PolicyStatusResult> {
  const client = await pool.connect();
  try {
    // 1. Load the policy set
    const policySet = await findPolicySetByKey(client, policySetKey);
    if (!policySet) {
      return {
        policySet: null,
        published: null,
        draft: null,
        publishedRules: [],
        draftRules: [],
      };
    }

    // 2. Load published version
    const publishedVersion = await findPublishedVersion(client, policySetKey);
    let published: PolicyStatusResult["published"] = null;
    let publishedRules: Array<Record<string, unknown>> = [];

    if (publishedVersion) {
      published = {
        id: publishedVersion.id,
        versionNo: publishedVersion.versionNo,
        configHash: publishedVersion.configHash,
        changeNote: publishedVersion.changeNote,
        publishedAt: publishedVersion.publishedAt,
      };

      // Load rules for published version
      const rules = await loadAllRulesForVersion(client, publishedVersion.id);
      publishedRules = rules.map((r) => ({
        ruleType: r.ruleType,
        id: r.id,
        modalityId: r.modalityId,
        caseCategory: r.caseCategory,
        dailyLimit: r.dailyLimit,
        isActive: r.isActive,
      }));
    }

    // 3. Load draft version
    const draftVersion = await findDraftVersion(client, policySetKey);
    let draft: PolicyStatusResult["draft"] = null;
    let draftRules: Array<Record<string, unknown>> = [];

    if (draftVersion) {
      draft = {
        id: draftVersion.id,
        versionNo: draftVersion.versionNo,
        configHash: draftVersion.configHash,
        changeNote: draftVersion.changeNote,
        createdAt: draftVersion.createdAt,
      };

      // Load rules for draft version
      const rules = await loadAllRulesForVersion(client, draftVersion.id);
      draftRules = rules.map((r) => ({
        ruleType: r.ruleType,
        id: r.id,
        modalityId: r.modalityId,
        caseCategory: r.caseCategory,
        dailyLimit: r.dailyLimit,
        isActive: r.isActive,
      }));
    }

    return {
      policySet: {
        id: policySet.id,
        key: policySet.key,
        name: policySet.name,
      },
      published,
      draft,
      publishedRules,
      draftRules,
    };
  } finally {
    client.release();
  }
}
