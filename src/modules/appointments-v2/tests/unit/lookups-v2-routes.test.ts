/**
 * Appointments V2 — lookup endpoint wiring tests.
 *
 * Verifies V2 frontend lookup calls use the V2 lookup routes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("V2 lookups — frontend API wiring", () => {
  it("fetchV2Modalities calls /v2/lookups/modalities", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('"/v2/lookups/modalities"'),
      "Should call /v2/lookups/modalities"
    );
  });

  it("fetchV2ExamTypes calls /v2/lookups/modalities/:modalityId/exam-types", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      source.includes("/v2/lookups/modalities/${modalityId}/exam-types"),
      "Should call exam-types endpoint by modality"
    );
  });

  it("does not call legacy /appointments/lookups", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      !source.includes('"/appointments/lookups"'),
      "Should not call legacy lookups endpoint"
    );
  });
});

