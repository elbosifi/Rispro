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

  it("fetchV2SpecialReasonCodes calls /v2/lookups/special-reason-codes", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/api.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('"/v2/lookups/special-reason-codes"'),
      "Should call /v2/lookups/special-reason-codes"
    );
  });
});

describe("V2 lookups backend — special reason codes query", () => {
  it("filters special reason codes to active rows only", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/lookups-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes("where is_active = true"),
      "Should return only active special reason codes"
    );
  });

  it("orders special reason codes deterministically by code asc", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/lookups-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes("order by code asc"),
      "Should order special reason codes by code asc"
    );
  });
});
