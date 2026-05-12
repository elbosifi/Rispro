import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RosterAssignmentRow } from "./roster-types.js";
import type { DoctorRosterFacts } from "./roster-conflicts.js";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "../../..");
process.env.DATABASE_URL ??= "postgresql://localhost/rispro_test";
process.env.JWT_SECRET ??= "test-secret";

function assignment(overrides: Partial<RosterAssignmentRow> = {}): RosterAssignmentRow {
  return {
    id: 1,
    rosterWeekId: 1,
    date: "2027-01-04",
    modalityId: 10,
    modalityCode: "CT",
    modalityNameEn: "CT",
    modalityNameAr: "CT",
    dutyType: "ct_protocol_day",
    sessionName: "day",
    startTime: "08:00:00",
    endTime: "14:00:00",
    teamName: "CT Team",
    status: "active",
    createdAt: "",
    updatedAt: "",
    members: [],
    ...overrides,
  };
}

function doctor(overrides: Partial<DoctorRosterFacts> = {}): DoctorRosterFacts {
  return {
    doctorId: 7,
    displayName: "Dr Test",
    doctorRole: "specialist",
    modalityIds: new Set([10]),
    unavailableDates: new Map(),
    leaveDates: new Map(),
    ...overrides,
  };
}

describe("Doctor Portal availability and roster conflict wiring", () => {
  it("adds availability and leave tables with bounded enum checks", () => {
    const migration = readFileSync(join(rootDir, "src", "db", "migrations", "069_doctor_portal_availability_leave.sql"), "utf8");
    assert.match(migration, /doctor_portal\.doctor_availability/);
    assert.match(migration, /availability_status in \(/);
    assert.match(migration, /doctor_portal\.doctor_leave_requests/);
    assert.match(migration, /leave_type in \(/);
  });

  it("mounts availability and leave endpoints under Doctor Portal only", () => {
    const index = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "index.ts"), "utf8");
    const routes = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "availability-routes.ts"), "utf8");
    assert.match(index, /router\.use\("\/availability", doctorAvailabilityRouter\)/);
    assert.match(index, /router\.use\("\/leave", doctorLeaveRouter\)/);
    assert.match(routes, /"\/my"/);
    assert.match(routes, /"\/team"/);
    assert.doesNotMatch(routes, /appointments|booking|capacity/i);
  });

  it("detects unavailable, leave, modality, junior lead, and specialist conflicts", async () => {
    const { evaluateRosterConflicts } = await import("./roster-conflicts.js");
    const doctors = new Map<number, DoctorRosterFacts>([
      [7, doctor({ unavailableDates: new Map([["2027-01-04", "unavailable"]]), leaveDates: new Map([["2027-01-04", "annual_leave"]]), modalityIds: new Set() })],
      [8, doctor({ doctorId: 8, displayName: "Dr Junior", doctorRole: "resident", modalityIds: new Set([10]) })],
    ]);
    const conflicts = evaluateRosterConflicts([
      assignment({
        members: [
          { id: 1, rosterAssignmentId: 1, doctorId: 7, displayName: "Dr Test", doctorRole: "specialist", teamRole: "specialist", createdAt: "", updatedAt: "" },
          { id: 2, rosterAssignmentId: 1, doctorId: 8, displayName: "Dr Junior", doctorRole: "resident", teamRole: "lead", createdAt: "", updatedAt: "" },
        ],
      }),
    ], doctors);
    assert.ok(conflicts.some((conflict) => conflict.code === "doctor_unavailable"));
    assert.ok(conflicts.some((conflict) => conflict.code === "doctor_on_leave"));
    assert.ok(conflicts.some((conflict) => conflict.code === "missing_modality_permission"));
    assert.ok(conflicts.some((conflict) => conflict.code === "junior_lead"));
  });

  it("detects overlapping assignments and publish-blocking empty required teams", async () => {
    const { evaluateRosterConflicts } = await import("./roster-conflicts.js");
    const doctors = new Map<number, DoctorRosterFacts>([[7, doctor()]]);
    const conflicts = evaluateRosterConflicts([
      assignment({ id: 1, members: [{ id: 1, rosterAssignmentId: 1, doctorId: 7, displayName: "Dr Test", doctorRole: "specialist", teamRole: "lead", createdAt: "", updatedAt: "" }] }),
      assignment({ id: 2, startTime: "10:00:00", endTime: "16:00:00", members: [{ id: 2, rosterAssignmentId: 2, doctorId: 7, displayName: "Dr Test", doctorRole: "specialist", teamRole: "specialist", createdAt: "", updatedAt: "" }] }),
      assignment({ id: 3, dutyType: "configured_required_duty", requiresSpecialist: true, modalityId: 11, members: [] }),
    ], doctors);
    assert.ok(conflicts.some((conflict) => conflict.code === "overlapping_assignment"));
    assert.ok(conflicts.some((conflict) => conflict.code === "required_team_empty" && conflict.severity === "error"));
  });

  it("blocks roster publish when error-level conflicts exist", () => {
    const service = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-service.ts"), "utf8");
    assert.match(service, /validateRosterWeekConflicts/);
    assert.match(service, /roster_publish_blocked/);
    assert.match(service, /Roster has publish-blocking conflicts/);
  });
});
