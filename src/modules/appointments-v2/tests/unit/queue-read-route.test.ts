import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const routeSource = readFileSync(new URL("../../api/routes/read-v2-routes.ts", import.meta.url), "utf8");

describe("V2 queue read DTO", () => {
  it("projects the existing booking modality ID for stable queue filtering", () => {
    assert.match(routeSource, /p\.national_id,\s*b\.modality_id,\s*m\.name_ar as modality_name_ar/);
  });
});
