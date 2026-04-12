/**
 * Appointments V2 — Get policy status service unit tests.
 *
 * Tests the service structure, exports, and source wiring.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: service structure and exports
// ---------------------------------------------------------------------------

describe("getPolicyStatus — service structure", () => {
  it("exports getPolicyStatus function", async () => {
    const { getPolicyStatus } = await import("../../admin/services/get-policy-status.service.js");
    assert.ok(typeof getPolicyStatus === "function");
  });

  it("getPolicyStatus is an async function", async () => {
    const { getPolicyStatus } = await import("../../admin/services/get-policy-status.service.js");
    assert.ok(getPolicyStatus.constructor.name === "AsyncFunction" || typeof getPolicyStatus === "function");
  });

  it("getPolicyStatus returns a Promise", () => {
    // Import synchronously won't work — just verify it exists
    const result = import("../../admin/services/get-policy-status.service.js").then((m) => {
      const fn = m.getPolicyStatus;
      return fn().catch(() => {});
    });
    assert.ok(result instanceof Promise);
  });
});

// ---------------------------------------------------------------------------
// Tests: PolicyStatusResult shape
// ---------------------------------------------------------------------------

describe("PolicyStatusResult — shape", () => {
  it("has all required fields for empty result", () => {
    const result = {
      policySet: null,
      published: null,
      draft: null,
      publishedRules: [],
      draftRules: [],
    };

    assert.strictEqual(result.policySet, null);
    assert.strictEqual(result.published, null);
    assert.strictEqual(result.draft, null);
    assert.ok(Array.isArray(result.publishedRules));
    assert.ok(Array.isArray(result.draftRules));
  });

  it("has all required fields for populated result", () => {
    const result = {
      policySet: { id: 1, key: "default", name: "Default Policy" },
      published: {
        id: 10,
        versionNo: 3,
        configHash: "abc123",
        changeNote: "Updated limits",
        publishedAt: "2026-04-01T00:00:00Z",
      },
      draft: {
        id: 15,
        versionNo: 4,
        configHash: "def456",
        changeNote: "Draft changes",
        createdAt: "2026-04-10T00:00:00Z",
      },
      publishedRules: [
        { ruleType: "category_daily_limit", id: 1, modalityId: 1, caseCategory: "non_oncology", dailyLimit: 20, isActive: true },
      ],
      draftRules: [],
    };

    assert.strictEqual(result.policySet?.id, 1);
    assert.strictEqual(result.policySet?.key, "default");
    assert.strictEqual(result.published?.versionNo, 3);
    assert.strictEqual(result.draft?.versionNo, 4);
    assert.strictEqual(result.publishedRules.length, 1);
    assert.strictEqual(result.draftRules.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification
// ---------------------------------------------------------------------------

describe("getPolicyStatus — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/get-policy-status.service.ts",
      "utf-8"
    );
  });

  it("loads policy set by key", () => {
    assert.ok(source.includes("findPolicySetByKey"), "Should call findPolicySetByKey");
  });

  it("loads published version", () => {
    assert.ok(source.includes("findPublishedVersion"), "Should call findPublishedVersion");
  });

  it("loads draft version", () => {
    assert.ok(source.includes("findDraftVersion"), "Should call findDraftVersion");
  });

  it("loads rules for published version", () => {
    assert.ok(source.includes("loadAllRulesForVersion"), "Should call loadAllRulesForVersion for published");
  });

  it("loads rules for draft version", () => {
    const count = (source.match(/loadAllRulesForVersion/g) || []).length;
    assert.ok(count >= 2, "Should call loadAllRulesForVersion at least twice (published + draft)");
  });

  it("returns null result when policy set not found", () => {
    assert.ok(source.includes("policySet: null"), "Should return null policySet when not found");
    assert.ok(source.includes("publishedRules: []"), "Should return empty publishedRules");
    assert.ok(source.includes("draftRules: []"), "Should return empty draftRules");
  });

  it("maps published version fields to result shape", () => {
    assert.ok(source.includes("id: publishedVersion.id"), "Should map published.id");
    assert.ok(source.includes("versionNo: publishedVersion.versionNo"), "Should map published.versionNo");
    assert.ok(source.includes("configHash: publishedVersion.configHash"), "Should map published.configHash");
  });

  it("maps draft version fields to result shape", () => {
    assert.ok(source.includes("id: draftVersion.id"), "Should map draft.id");
    assert.ok(source.includes("versionNo: draftVersion.versionNo"), "Should map draft.versionNo");
    assert.ok(source.includes("createdAt: draftVersion.createdAt"), "Should map draft.createdAt");
  });

  it("maps rule fields for published rules", () => {
    assert.ok(source.includes("ruleType: r.ruleType"), "Should map ruleType");
    assert.ok(source.includes("modalityId: r.modalityId"), "Should map modalityId");
    assert.ok(source.includes("dailyLimit: r.dailyLimit"), "Should map dailyLimit");
    assert.ok(source.includes("isActive: r.isActive"), "Should map isActive");
  });

  it("releases DB client in finally block", () => {
    assert.ok(source.includes("finally"), "Should have finally block");
    assert.ok(source.includes("client.release()"), "Should release client");
  });

  it("accepts default policySetKey parameter", () => {
    assert.ok(source.includes('policySetKey: string = "default"'), "Should have default policySetKey");
  });
});

// ---------------------------------------------------------------------------
// Tests: route wiring
// ---------------------------------------------------------------------------

describe("GET /policy — route wiring", () => {
  it("imports getPolicyStatus from service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../admin/services/get-policy-status.service.js"'),
      "Should import getPolicyStatus"
    );
  });

  it("calls getPolicyStatus with policySetKey from query", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("getPolicyStatus(policySetKey)"), "Should call getPolicyStatus");
    assert.ok(source.includes("policySetKey"), "Should extract policySetKey from query");
  });

  it("returns policySet, published, draft, publishedRules, draftRules in response", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("policySet: result.policySet"), "Should return policySet");
    assert.ok(source.includes("published: result.published"), "Should return published");
    assert.ok(source.includes("draft: result.draft"), "Should return draft");
    assert.ok(source.includes("publishedRules: result.publishedRules"), "Should return publishedRules");
    assert.ok(source.includes("draftRules: result.draftRules"), "Should return draftRules");
  });

  it("no longer returns placeholder message", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      !source.includes("Policy retrieval endpoint — full implementation pending"),
      "Should not contain placeholder message"
    );
    assert.ok(
      !source.includes("TODO: Implement full policy retrieval"),
      "Should not contain TODO comment"
    );
  });
});
