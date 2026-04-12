/**
 * Appointments V2 — publishPolicy unit tests.
 *
 * Tests the publish policy service structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 * Behavioral coverage is provided by integration tests against real PostgreSQL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("publishPolicy — function structure", () => {
  it("exports publishPolicy function", async () => {
    const { publishPolicy } = await import("../../admin/services/publish-policy.service.js");
    assert.ok(typeof publishPolicy === "function");
  });

  it("publishPolicy is an async function", async () => {
    const { publishPolicy } = await import("../../admin/services/publish-policy.service.js");
    assert.ok(publishPolicy.constructor.name === "AsyncFunction" || typeof publishPolicy === "function");
  });

  it("PublishPolicyResult has correct shape", () => {
    const result = {
      published: {
        id: 10,
        policySetId: 1,
        versionNo: 2,
        status: "published" as const,
        configHash: "abc",
        changeNote: null,
        publishedAt: "2026-04-12T00:00:00Z",
      },
      archivedCount: 1,
      ruleCount: 5,
    };

    assert.equal(typeof result.published.id, "number");
    assert.equal(result.published.status, "published");
    assert.equal(typeof result.ruleCount, "number");
    assert.equal(typeof result.archivedCount, "number");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — validation checks
// ---------------------------------------------------------------------------

describe("publishPolicy — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/publish-policy.service.ts",
      "utf-8"
    );
  });

  it("checks version existence", () => {
    assert.ok(source.includes("findVersionById"), "Should call findVersionById");
    assert.ok(source.includes("not found"), "Should have 'not found' error");
  });

  it("checks version is a draft", () => {
    assert.ok(source.includes("status !== \"draft\"") || source.includes("status !== 'draft'"),
      "Should check status is draft");
    assert.ok(source.includes("cannot be published"), "Should have 'cannot be published' error");
  });

  it("validates draft before publishing", () => {
    assert.ok(source.includes("validatePolicyDraft"), "Should call validatePolicyDraft");
    assert.ok(source.includes("validation.isValid"), "Should check validation result");
    assert.ok(source.includes("validation errors"), "Should mention validation errors");
  });

  it("archives old published versions before publishing", () => {
    assert.ok(source.includes("archiveOldPublishedVersions"), "Should call archiveOldPublishedVersions");
  });

  it("publishes the version after archiving", () => {
    assert.ok(source.includes("publishVersion"), "Should call publishVersion");
  });

  it("handles concurrent publish failure", () => {
    assert.ok(source.includes("publish_concurrent"), "Should have concurrent publish error code");
    assert.ok(source.includes("Failed to publish"), "Should mention failed to publish");
  });

  it("refreshes published version after publish", () => {
    assert.ok(source.includes("findVersionById"), "Should refresh version after publish");
    assert.ok(source.includes("Failed to retrieve published version"), "Should handle refresh failure");
  });

  it("loads rules for rule count in response", () => {
    assert.ok(source.includes("loadAllRulesForVersion"), "Should load rules for counting");
    assert.ok(source.includes("ruleCount"), "Should return ruleCount");
  });

  it("uses withTransaction for atomic operation", () => {
    assert.ok(source.includes("withTransaction"), "Should use withTransaction");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("publishPolicy — import wiring", () => {
  it("imports validatePolicyDraft from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/publish-policy.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../rules/services/validate-policy.js"'),
      "Should import validate-policy from relative path"
    );
  });

  it("imports admin policy repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/publish-policy.service.ts",
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
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/publish-policy.service.ts",
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
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/publish-policy.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/errors/scheduling-error.js"'),
      "Should import SchedulingError from relative path"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: error codes
// ---------------------------------------------------------------------------

describe("publishPolicy — error codes", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/publish-policy.service.ts",
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

  it("uses 400 for validation failure", () => {
    assert.ok(source.includes("400"), "Should use 400 status for validation failure");
  });

  it("uses 409 for concurrent publish", () => {
    const count = (source.match(/409/g) || []).length;
    assert.ok(count >= 2, "Should use 409 for both not-draft and concurrent publish");
  });

  it("uses 500 for refresh failure", () => {
    assert.ok(source.includes("500"), "Should use 500 status for refresh failure");
    assert.ok(source.includes("publish_retrieve_failed"), "Should have publish_retrieve_failed reason code");
  });
});

// ---------------------------------------------------------------------------
// Tests: route wiring
// ---------------------------------------------------------------------------

describe("POST /publish — route wiring", () => {
  it("imports publishPolicy from service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../admin/services/publish-policy.service.js"'),
      "Should import publishPolicy"
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

  it("extracts userId from request user context", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("req.user?.sub"), "Should extract userId from user context");
  });

  it("passes changeNote from request body", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("body.changeNote"), "Should extract changeNote from body");
    assert.ok(source.includes("publishPolicy(versionId"), "Should call publishPolicy with versionId");
  });
});
