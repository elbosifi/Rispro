import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDoctorCapabilities } from "./capabilities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..", "..");

describe("Doctor Portal capabilities", () => {
  it("returns no module capabilities without an active profile", () => {
    assert.deepEqual(
      deriveDoctorCapabilities({ appRole: "doctor", hasActiveProfile: false, canSupervise: true }),
      []
    );
  });

  it("maps an active profile to normal doctor capability", () => {
    assert.deepEqual(
      deriveDoctorCapabilities({ appRole: "doctor", hasActiveProfile: true, canSupervise: false }),
      ["doctor"]
    );
  });

  it("maps can_supervise to doctor_supervisor", () => {
    assert.deepEqual(
      deriveDoctorCapabilities({ appRole: "doctor", hasActiveProfile: true, canSupervise: true }),
      ["doctor", "doctor_supervisor"]
    );
  });

  it("maps super_admin with active profile to doctor_admin", () => {
    assert.deepEqual(
      deriveDoctorCapabilities({ appRole: "super_admin", hasActiveProfile: true, canSupervise: true }),
      ["doctor", "doctor_supervisor", "doctor_admin"]
    );
  });
});

describe("Doctor Portal wiring", () => {
  it("mounts the Doctor Portal API separately from appointments", () => {
    const source = readFileSync(join(rootDir, "src", "app.ts"), "utf8");
    assert.match(source, /app\.use\("\/api\/doctor", createDoctorPortalRouter\(\)\)/);
    assert.match(source, /app\.use\("\/api\/v2", v2Router\)/);
  });

  it("does not add appointment create or reschedule endpoints to the Doctor Portal router", () => {
    const source = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "index.ts"), "utf8");
    assert.doesNotMatch(source, /createBooking|rescheduleBooking|\/appointments|\/v2\/appointments/);
  });

  it("exposes /me and keeps profile admin endpoints permission guarded", () => {
    const source = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "index.ts"), "utf8");
    assert.match(source, /router\.get\(\s*"\/me"/);
    assert.match(source, /router\.get\(\s*"\/profiles",\s*requireDoctorCapability\("doctor_admin"\)/);
    assert.match(source, /router\.post\(\s*"\/profiles",\s*requireDoctorCapability\("doctor_admin"\)/);
  });

  it("creates only Phase 1 Doctor Portal identity tables", () => {
    const migration = readFileSync(join(rootDir, "src", "db", "migrations", "064_doctor_portal_identity.sql"), "utf8");
    assert.match(migration, /create\s+schema\s+if\s+not\s+exists\s+doctor_portal/i);
    assert.match(migration, /doctor_portal\.doctor_profiles/i);
    assert.match(migration, /doctor_portal\.doctor_modality_permissions/i);
    assert.match(migration, /doctor_portal\.doctor_module_audit_events/i);
    assert.doesNotMatch(migration, /doctor_roster|case_team_assignments|appointment_protocols|workload_unit/i);
  });

  it("creates Phase 2 roster tables without case assignment, protocol, or workload tables", () => {
    const migration = readFileSync(join(rootDir, "src", "db", "migrations", "065_doctor_portal_roster.sql"), "utf8");
    assert.match(migration, /doctor_portal\.doctor_roster_weeks/i);
    assert.match(migration, /doctor_portal\.doctor_roster_assignments/i);
    assert.match(migration, /doctor_portal\.doctor_roster_members/i);
    assert.match(migration, /ct_protocol_day/i);
    assert.match(migration, /mri_supervision_reporting/i);
    assert.match(migration, /mammography_session/i);
    assert.doesNotMatch(migration, /case_team_assignments|appointment_protocols|workload_unit|salary|rvu/i);
  });

  it("mounts roster endpoints under /api/doctor/roster only", () => {
    const source = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "index.ts"), "utf8");
    const routes = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-routes.ts"), "utf8");
    assert.match(source, /router\.use\("\/roster", doctorRosterRouter\)/);
    assert.match(routes, /"\/weeks"/);
    assert.match(routes, /"\/my"/);
    assert.match(routes, /"\/assignments"/);
    assert.match(routes, /"\/weeks\/:id\/publish"/);
    assert.match(routes, /"\/weeks\/:id\/copy-previous"/);
    assert.doesNotMatch(routes, /createBooking|rescheduleBooking|case_team|appointment_protocols|workload|rvu|salary/i);
  });

  it("enforces supervisor or admin capability before roster mutations", () => {
    const service = readFileSync(join(rootDir, "src", "modules", "doctor-portal", "roster-service.ts"), "utf8");
    assert.match(service, /requireRosterDoctor/);
    assert.match(service, /requireRosterManager/);
    assert.match(service, /doctor_supervisor/);
    assert.match(service, /doctor_admin/);
    assert.match(service, /Only draft roster weeks can be edited in Phase 2/);
    assert.match(service, /Past roster edits are blocked in Phase 2/);
  });
});
