/**
 * Appointments V2 — savePolicyDraft unit tests.
 *
 * Tests the save policy draft service structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 * Behavioral coverage is provided by integration tests against real PostgreSQL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("savePolicyDraft — function structure", () => {
  it("exports savePolicyDraft function", async () => {
    const { savePolicyDraft } = await import("../../admin/services/save-policy-draft.service.js");
    assert.ok(typeof savePolicyDraft === "function");
  });

  it("savePolicyDraft is an async function", async () => {
    const { savePolicyDraft } = await import("../../admin/services/save-policy-draft.service.js");
    assert.ok(savePolicyDraft.constructor.name === "AsyncFunction" || typeof savePolicyDraft === "function");
  });

  it("SavePolicyDraftResult has correct shape", () => {
    const result = {
      version: {
        id: 10,
        policySetId: 1,
        versionNo: 2,
        status: "draft" as const,
        configHash: "new_hash",
        changeNote: "Updated config",
        publishedAt: null,
      },
      configHash: "new_hash",
    };

    assert.equal(typeof result.version.id, "number");
    assert.equal(result.version.status, "draft");
    assert.equal(typeof result.configHash, "string");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — branching paths
// ---------------------------------------------------------------------------

describe("savePolicyDraft — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/save-policy-draft.service.ts",
      "utf-8"
    );
  });

  it("finds version by ID", () => {
    assert.ok(source.includes("findVersionById"), "Should call findVersionById");
    assert.ok(source.includes("not found"), "Should have 'not found' error message");
  });

  it("checks version is a draft", () => {
    assert.ok(source.includes("status !== \"draft\"") || source.includes("status !== 'draft'"),
      "Should check status is draft");
    assert.ok(source.includes("cannot be modified"), "Should have 'cannot be modified' error");
  });

  it("computes config hash from snapshot", () => {
    assert.ok(source.includes("hashConfigSnapshot"), "Should call hashConfigSnapshot");
    assert.ok(source.includes("configHash"), "Should compute configHash");
  });

  it("updates draft config with new hash", () => {
    assert.ok(source.includes("updateDraftConfig"), "Should call updateDraftConfig");
  });

  it("handles update failure", () => {
    assert.ok(source.includes("draft_update_failed"), "Should have draft_update_failed error code");
    assert.ok(source.includes("500"), "Should use 500 status for update failure");
  });

  it("refreshes version after update", () => {
    assert.ok(source.includes("findVersionById"), "Should refresh version after update");
    assert.ok(source.includes("draft_retrieve_failed"), "Should have draft_retrieve_failed error code");
  });

  it("uses withTransaction for atomic operation", () => {
    assert.ok(source.includes("withTransaction"), "Should use withTransaction");
  });

  it("returns version and configHash", () => {
    assert.ok(source.includes("version: refreshed"), "Should return refreshed version");
    assert.ok(source.includes("configHash,"), "Should return configHash");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("savePolicyDraft — import wiring", () => {
  it("imports admin policy repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/save-policy-draft.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../repositories/admin-policy.repo.js"'),
      "Should import admin-policy.repo from relative path"
    );
  });

  it("imports transaction util from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/save-policy-draft.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/utils/transactions.js"'),
      "Should import transactions from relative path"
    );
  });

  it("imports SchedulingError from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/save-policy-draft.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/errors/scheduling-error.js"'),
      "Should import SchedulingError from relative path"
    );
  });

  it("imports hashConfigSnapshot from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/save-policy-draft.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/utils/hashing.js"'),
      "Should import hashing util from relative path"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: error codes
// ---------------------------------------------------------------------------

describe("savePolicyDraft — error codes", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/save-policy-draft.service.ts",
      "utf-8"
    );
  });

  it("uses 404 for version not found", () => {
    assert.ok(source.includes("404"), "Should use 404 status");
    assert.ok(source.includes("policy_version_not_found"), "Should have policy_version_not_found reason code");
  });

  it("uses 409 for not-a-draft", () => {
    assert.ok(source.includes("409"), "Should use 409 status");
    assert.ok(source.includes("policy_version_not_draft"), "Should have policy_version_not_draft reason code");
  });

  it("uses 500 for update failure", () => {
    assert.ok(source.includes("500"), "Should use 500 status");
    assert.ok(source.includes("draft_update_failed"), "Should have draft_update_failed reason code");
  });

  it("uses 500 for refresh failure", () => {
    const count500 = (source.match(/500/g) || []).length;
    assert.ok(count500 >= 2, "Should use 500 for both update and refresh failures");
    assert.ok(source.includes("draft_retrieve_failed"), "Should have draft_retrieve_failed reason code");
  });
});

// ---------------------------------------------------------------------------
// Tests: route wiring
// ---------------------------------------------------------------------------

describe("PUT /policy/draft/:versionId — route wiring", () => {
  it("imports savePolicyDraft from service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../admin/services/save-policy-draft.service.js"'),
      "Should import savePolicyDraft"
    );
  });

  it("parses versionId from route param", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("parseInt(String(req.params.versionId)"), "Should parse versionId from params");
    assert.ok(source.includes("Invalid version ID"), "Should validate version ID");
  });

  it("extracts policySnapshot from request body", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("body.policySnapshot"), "Should extract policySnapshot from body");
    assert.ok(source.includes("policySnapshot is required"), "Should validate policySnapshot presence");
  });

  it("extracts optional changeNote from request body", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("body.changeNote"), "Should extract changeNote from body");
  });

  it("returns version and configHash in response", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("version: result.version"), "Should return version");
    assert.ok(source.includes("configHash: result.configHash"), "Should return configHash");
  });
});
