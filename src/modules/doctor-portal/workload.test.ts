import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { defaultWorkloadUnits } from "./workload-rules.js";

const root = process.cwd();

describe("Doctor Portal workload default rules", () => {
  it("uses conservative CT defaults", () => {
    assert.equal(defaultWorkloadUnits({ modalityCode: "CT", modalityName: "CT", examTypeName: "CT Brain", assignmentType: "protocol", requiresReport: true }), 1);
    assert.equal(defaultWorkloadUnits({ modalityCode: "CT", modalityName: "CT", examTypeName: "CT oncology body multiphase", assignmentType: "protocol", requiresReport: true }), 2);
  });

  it("uses conservative MRI defaults", () => {
    assert.equal(defaultWorkloadUnits({ modalityCode: "MRI", modalityName: "MRI", examTypeName: "MRI Brain", assignmentType: "reporting", requiresReport: true }), 2);
    assert.equal(defaultWorkloadUnits({ modalityCode: "MRI", modalityName: "MRI", examTypeName: "MRI prostate", assignmentType: "reporting", requiresReport: true }), 3);
  });

  it("uses ultrasound and mammography defaults", () => {
    assert.equal(defaultWorkloadUnits({ modalityCode: "US", modalityName: "Ultrasound", examTypeName: "Abdomen", assignmentType: "ultrasound_operator", requiresReport: true }), 1);
    assert.equal(defaultWorkloadUnits({ modalityCode: "MG", modalityName: "Mammography", examTypeName: "Breast", assignmentType: "mammography_episode", requiresReport: true }), 2);
  });

  it("does not count no-report reporting work as pending reporting load", () => {
    assert.equal(defaultWorkloadUnits({ modalityCode: "CT", modalityName: "CT", examTypeName: "CT Brain", assignmentType: "reporting", requiresReport: false }), 0);
  });
});

describe("Doctor Portal workload schema and wiring", () => {
  it("creates team workload tables without individual productivity fields", () => {
    const migration = readFileSync(`${root}/src/db/migrations/068_doctor_portal_workload_units.sql`, "utf8");

    assert.match(migration, /doctor_portal\.workload_unit_catalog/i);
    assert.match(migration, /doctor_portal\.case_workload_units/i);
    assert.match(migration, /case_workload_units_active_unique/i);
    assert.match(migration, /roster_assignment_id/i);
    assert.doesNotMatch(migration, /doctor_id|salary|payment|revenue|leaderboard/i);
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

  it("enforces doctor-scoped viewing and manager/admin mutations", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/workload-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/workload-repository.ts`, "utf8");

    assert.match(service, /requireWorkloadDoctor/);
    assert.match(service, /requireWorkloadManager/);
    assert.match(service, /requireWorkloadAdmin/);
    assert.match(repo, /doctor_roster_members/);
    assert.match(repo, /status = 'superseded'/);
    assert.match(repo, /defaultedNoCatalogRuleCount/);
  });

  it("returns grouped team totals and no individual doctor totals", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/workload-repository.ts`, "utf8");

    assert.match(repo, /group by cwu\.roster_assignment_id/);
    assert.match(repo, /teamName/);
    assert.match(repo, /pendingCount/);
    assert.match(repo, /overdueCount/);
    assert.doesNotMatch(repo, /group by .*doctor_id|doctorName|individual/i);
  });
});
