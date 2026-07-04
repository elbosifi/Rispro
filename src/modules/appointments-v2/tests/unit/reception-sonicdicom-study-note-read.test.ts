import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

describe("Reception SonicDICOM study-note read contract", () => {
  it("attaches SonicDICOM study notes to appointment read responses without exposing SQL", () => {
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");
    const frontendTypes = readFileSync(`${root}/frontend/src/types/api.ts`, "utf8");
    const mapper = readFileSync(`${root}/frontend/src/lib/mappers.ts`, "utf8");

    assert.match(routes, /fetchSonicDicomStudyNotes/);
    assert.match(routes, /attachSonicDicomStudyNotesToAppointments/);
    assert.match(routes, /catch \{\s*return rows\.map\(withEmptySonicDicomStudyNote\);\s*\}/);
    assert.doesNotMatch(routes, /sonicDicomSqlPassword|sonicDicomSqlUsername/);
    assert.match(frontendTypes, /sonicDicomStudyNote\?: string \| null/);
    assert.match(frontendTypes, /sonicDicomStudyNoteCheckedAt\?: string \| null/);
    assert.match(mapper, /sonicDicomStudyNote: strOrNull\(raw, "sonicDicomStudyNote"\)/);
  });
});
