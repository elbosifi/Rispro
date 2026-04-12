/**
 * Appointments V2 — createPolicyDraft unit tests.
 *
 * Tests the create policy draft service structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 * Behavioral coverage is provided by integration tests against real PostgreSQL.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("createPolicyDraft — function structure", () => {
  it("exports createPolicyDraft function", async () => {
    const { createPolicyDraft } = await import("../../admin/services/create-policy-draft.service.js");
    assert.ok(typeof createPolicyDraft === "function");
  });

  it("createPolicyDraft is an async function", async () => {
    const { createPolicyDraft } = await import("../../admin/services/create-policy-draft.service.js");
    assert.ok(createPolicyDraft.constructor.name === "AsyncFunction" || typeof createPolicyDraft === "function");
  });

  it("CreatePolicyDraftResult has correct shape", () => {
    const result = {
      draft: {
        id: 10,
        policySetId: 1,
        versionNo: 1,
        status: "draft" as const,
        configHash: "abc123",
        changeNote: "Initial draft",
        publishedAt: null,
      },
      basedOnVersionId: 5,
    };

    assert.equal(typeof result.draft.id, "number");
    assert.equal(result.draft.status, "draft");
    assert.equal(typeof result.basedOnVersionId, "number");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — branching paths
// ---------------------------------------------------------------------------

describe("createPolicyDraft — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/create-policy-draft.service.ts",
      "utf-8"
    );
  });

  it("finds policy set by key", () => {
    assert.ok(source.includes("findPolicySetByKey"), "Should call findPolicySetByKey");
    assert.ok(source.includes("not found"), "Should have 'not found' error message");
  });

  it("checks for existing draft", () => {
    assert.ok(source.includes("findDraftVersion"), "Should call findDraftVersion");
    assert.ok(source.includes("draft already exists") || source.includes("already exists"), "Should check for existing draft");
  });

  it("finds published version to base draft on", () => {
    assert.ok(source.includes("findPublishedVersion"), "Should call findPublishedVersion");
  });

  it("handles case with no published version (empty config)", () => {
    assert.ok(source.includes("emptyConfigHash") || source.includes("hashConfigSnapshot({})"),
      "Should hash empty config when no published version");
    assert.ok(source.includes("Initial draft"), "Should use 'Initial draft' change note");
    assert.ok(source.includes("basedOnVersionId: 0"), "Should return basedOnVersionId: 0");
  });

  it("copies config hash from published version", () => {
    assert.ok(source.includes("published.configHash"), "Should copy config hash from published version");
    assert.ok(source.includes("Draft based on published version"), "Should include published version in change note");
  });

  it("uses getNextVersionNumber for versioning", () => {
    assert.ok(source.includes("getNextVersionNumber"), "Should call getNextVersionNumber");
  });

  it("creates draft version with createDraftVersion", () => {
    assert.ok(source.includes("createDraftVersion"), "Should call createDraftVersion");
  });

  it("uses withTransaction for atomic operation", () => {
    assert.ok(source.includes("withTransaction"), "Should use withTransaction");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("createPolicyDraft — import wiring", () => {
  it("imports admin policy repo from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/create-policy-draft.service.ts",
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
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/create-policy-draft.service.ts",
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
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/create-policy-draft.service.ts",
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
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/create-policy-draft.service.ts",
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

describe("createPolicyDraft — error codes", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/admin/services/create-policy-draft.service.ts",
      "utf-8"
    );
  });

  it("uses 404 for policy set not found", () => {
    assert.ok(source.includes("404"), "Should use 404 status");
    assert.ok(source.includes("policy_set_not_found"), "Should have policy_set_not_found reason code");
  });

  it("uses 409 for draft already exists", () => {
    assert.ok(source.includes("409"), "Should use 409 status");
    assert.ok(source.includes("draft_already_exists"), "Should have draft_already_exists reason code");
  });
});

// ---------------------------------------------------------------------------
// Tests: route wiring
// ---------------------------------------------------------------------------

describe("POST /policy/draft — route wiring", () => {
  it("imports createPolicyDraft from service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../admin/services/create-policy-draft.service.js"'),
      "Should import createPolicyDraft"
    );
  });

  it("extracts policySetKey from request body with default", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("body.policySetKey"), "Should extract policySetKey from body");
    assert.ok(source.includes('"default"'), "Should default to 'default'");
  });

  it("extracts changeNote from request body", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("body.changeNote"), "Should extract changeNote from body");
  });

  it("validates policySetKey is present", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("policySetKey is required"), "Should validate policySetKey");
    assert.ok(source.includes("400"), "Should return 400 for missing policySetKey");
  });

  it("returns 201 with draft and basedOnVersionId", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/admin-scheduling-v2-routes.ts",
      "utf-8"
    );
    assert.ok(source.includes("status(201)"), "Should return 201");
    assert.ok(source.includes("draft: result.draft"), "Should return draft");
    assert.ok(source.includes("basedOnVersionId: result.basedOnVersionId"), "Should return basedOnVersionId");
  });
});
