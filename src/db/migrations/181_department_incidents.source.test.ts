import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
const sql = fs.readFileSync(new URL("./181_department_incidents.sql", import.meta.url), "utf8");
test("migration 181 declares incident lifecycle constraints and document restriction", () => {
  for (const text of ["create table department_incidents", "incident_type in ('equipment','clinical_workflow')", "references equipment(id) on delete restrict", "references patients(id) on delete set null", "status in ('submitted','under_review','action_required','resolved','closed')", "alter table documents add column incident_id", "references department_incidents(id) on delete restrict"]) assert.match(sql, new RegExp(text.replace(/[()]/g, "\\$&"), "i"));
});
