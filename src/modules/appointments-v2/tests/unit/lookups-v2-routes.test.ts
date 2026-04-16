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

describe("V2 lookups backend — priorities query", () => {
  it("uses actual reporting_priorities columns (id, code, name_ar, name_en, sort_order)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/lookups-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes("select id, code, name_ar, name_en, sort_order"),
      "Should query actual columns: id, code, name_ar, name_en, sort_order"
    );
  });

  it("does not query nonexistent columns name or is_active", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/lookups-v2-routes.ts",
      "utf-8"
    );
    const prioritiesSection = source.match(/router\.get\(\s*"\/priorities"[\s\S]*?\n\);/);
    assert.ok(prioritiesSection, "Should have priorities endpoint");
    assert.ok(
      !prioritiesSection[0].includes("select id, name,") && !prioritiesSection[0].includes("where is_active"),
      "Should not use nonexistent columns name or is_active in priorities query"
    );
  });

  it("orders priorities by sort_order asc, name_en asc", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/lookups-v2-routes.ts",
      "utf-8"
    );
    assert.ok(
      source.includes("order by sort_order asc, name_en asc"),
      "Should order priorities by sort_order asc, name_en asc"
    );
  });

  it("maps response to frontend DTO with id, name, nameAr, nameEn", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/api/routes/lookups-v2-routes.ts",
      "utf-8"
    );
    const prioritiesSection = source.match(/router\.get\(\s*"\/priorities"[\s\S]*?\n\);/);
    assert.ok(prioritiesSection, "Should have priorities endpoint");
    const section = prioritiesSection[0];
    assert.ok(section.includes("r.id") && section.includes("r.name_en"), "Should map from real columns");
    assert.ok(section.includes("name: r.name_en || r.name_ar"), "Should set name with fallback");
    assert.ok(section.includes("nameAr: r.name_ar") && section.includes("nameEn: r.name_en"), "Should map nameAr and nameEn");
  });
});
