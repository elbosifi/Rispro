import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

describe("Doctor Portal Reporting Assignment Board foundation", () => {
  it("adds saved views and Reporting Board settings migration", () => {
    const migration = readFileSync(`${root}/src/db/migrations/087_doctor_portal_reporting_board.sql`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_board_saved_views/);
    assert.match(migration, /token text not null unique/);
    assert.match(migration, /notification_settings_json jsonb not null default '\{\}'::jsonb/);
    assert.match(migration, /doctor_portal_reporting_board/);
    assert.match(migration, /"enabledModalityCodes": \["CT", "MR"\]/);
  });

  it("wires authenticated Reporting Board routes under Doctor Portal", () => {
    const index = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");

    assert.match(index, /router\.use\("\/reporting-board", doctorReportingBoardRouter\)/);
    assert.match(routes, /"\/settings"/);
    assert.match(routes, /"\/cases"/);
    assert.match(routes, /"\/saved-views"/);
    assert.match(routes, /"\/saved-views\/token\/:token"/);
    assert.match(routes, /"\/bulk-assign-next"/);
  });

  it("keeps saved view token loading authenticated and owner-scoped", () => {
    const index = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(index, /router\.use\(requireAuth\)/);
    assert.match(repo, /where token = \$1 and owner_user_id = \$2 and active = true/);
    assert.doesNotMatch(index, /patient|public/i);
  });

  it("restricts cutoff settings updates to super_admin", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");

    assert.match(service, /actor\.appRole !== "super_admin"/);
    assert.match(service, /Only super_admin can update Reporting Board settings/);
  });

  it("case list defaults to report-required CT/MR scope and priority ordering", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(service, /await requireRosterManager\(actor\)/);
    assert.match(service, /defaultRequiresReport/);
    assert.match(service, /enabledModalityCodes/);
    assert.match(repo, /b\.requires_report = \$\$\{values\.length\}/);
    assert.match(repo, /rp\.code as "reportingPriorityCode"/);
    assert.match(repo, /rp\.name_en as "reportingPriorityName"/);
    assert.match(repo, /rp\.sort_order as "reportingPrioritySortOrder"/);
    assert.match(repo, /order by rp\.sort_order asc nulls last, b\.booking_date asc, b\.booking_time asc nulls first, b\.id asc/);
  });

  it("uses SonicDICOM status without crashing board case listing", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");

    assert.match(service, /checkSonicDicomReportStatus/);
    assert.match(service, /catch \{\s*status = "unavailable";\s*\}/);
    assert.match(service, /reportStatus === "required_not_final"/);
    assert.match(service, /row\.reportStatus !== "final"/);
  });

  it("bulk assign chooses next backend cases, requires reason, skips assigned by default, and audits", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(service, /reason is required/);
    assert.match(service, /assignmentStatus: input\.unassignedOnly === false \? rawFilters\.assignmentStatus : "unassigned"/);
    assert.match(service, /eligible\.slice\(0, input\.count\)/);
    assert.match(repo, /for update of b/);
    assert.match(repo, /doctorCanReportAllModalities/);
    assert.match(repo, /result\.rows\.length === uniqueModalityIds\.length/);
    assert.match(repo, /reporting_board_bulk_case_assigned/);
    assert.match(repo, /reporting_board_bulk_assign_completed/);
  });

  it("saved view tokens are active-only and owner scoped unless loaded by a manager", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(repo, /where token = \$1 and owner_user_id = \$2 and active = true/);
    assert.match(repo, /where token = \$1 and active = true/);
    assert.match(service, /moduleCapabilities\.includes\("doctor_supervisor"\)/);
    assert.match(service, /findActiveSavedViewByToken\(token\)/);
  });
});
