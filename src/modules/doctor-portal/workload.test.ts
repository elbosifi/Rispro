import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

describe("Doctor Portal workload schema and wiring", () => {
  it("uses configured workload rules and does not hardcode fallback points", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/workload-repository.ts`, "utf8");

    assert.match(repo, /workload_unit_catalog/i);
    assert.match(repo, /cwu\.assignment_type = 'reporting'/i);
    assert.match(repo, /cwu\.requires_report = true/i);
    assert.match(repo, /defaultedNoCatalogRuleCount/);
    assert.doesNotMatch(repo, /defaultWorkloadUnits/);
  });

  it("creates team workload tables without individual productivity fields", () => {
    const migration = readFileSync(`${root}/src/db/migrations/068_doctor_portal_workload_units.sql`, "utf8");

    assert.match(migration, /doctor_portal\.workload_unit_catalog/i);
    assert.match(migration, /doctor_portal\.case_workload_units/i);
    assert.match(migration, /case_workload_units_active_unique/i);
    assert.match(migration, /roster_assignment_id/i);
    assert.doesNotMatch(migration, /salary|payment|revenue|leaderboard/i);
  });

  it("mounts workload endpoints and keeps appointment scheduling untouched", () => {
    const portalRouter = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/workload-routes.ts`, "utf8");

    assert.match(portalRouter, /router\.use\("\/workload", doctorWorkloadRouter\)/);
    assert.match(routes, /"\/summary"/);
    assert.match(routes, /"\/calculate"/);
    assert.match(routes, /"\/catalog"/);
    assert.doesNotMatch(routes, /createBooking|rescheduleBooking|capacity|salary|payment|revenue/i);
  });
});
