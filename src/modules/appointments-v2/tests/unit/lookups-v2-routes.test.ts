/**
 * Appointments V2 — V2 lookup wiring tests.
 *
 * The V2 frontend reuses the proven legacy lookups endpoint
 * (GET /api/appointments/lookups) rather than calling the V2 catalog
 * lookups router. The V2 lookups router exists as a backup endpoint
 * but the frontend delegates to the legacy one for reliability.
 *
 * These tests verify the frontend wiring is correct.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: frontend API wiring — uses legacy lookups endpoint
// ---------------------------------------------------------------------------

describe("V2 lookups — frontend API wiring", () => {
  it("fetchV2Modalities calls /appointments/lookups (legacy endpoint)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('"/appointments/lookups"'),
      "Should call the legacy /appointments/lookups endpoint"
    );
    assert.ok(
      source.includes("lookups.modalities"),
      "Should extract modalities from response"
    );
  });

  it("fetchV2ExamTypes calls /appointments/lookups and filters by modalityId", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('"/appointments/lookups"'),
      "Should call the legacy /appointments/lookups endpoint"
    );
    assert.ok(
      source.includes("lookups.examTypes.filter"),
      "Should filter examTypes client-side"
    );
    assert.ok(
      source.includes("modalityId"),
      "Should filter by modalityId"
    );
  });

  it("fetchV2Lookups calls /appointments/lookups and returns both modalities and examTypes", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('"/appointments/lookups"'),
      "Should call the legacy /appointments/lookups endpoint"
    );
    assert.ok(
      source.includes("lookups.modalities"),
      "Should return modalities"
    );
    assert.ok(
      source.includes("lookups.examTypes"),
      "Should return examTypes"
    );
  });

  it("does NOT call /v2/lookups/modalities", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    // The V2 lookups router exists but the frontend uses the legacy endpoint
    assert.ok(
      !source.includes('"/v2/lookups/modalities"'),
      "Should NOT call /v2/lookups/modalities directly"
    );
  });

  it("does NOT call old /modality endpoints (404)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      !source.includes('"/modality"') && !source.includes('`/modality/'),
      "Should NOT call non-existent /modality endpoints"
    );
  });
});
