import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

describe("Doctor Portal protocol schema", () => {
  it("creates protocol and protocol audit tables with versioning", () => {
    const migration = readFileSync(`${root}/src/db/migrations/067_doctor_portal_protocols.sql`, "utf8");

    assert.match(migration, /doctor_portal\.appointment_protocols/i);
    assert.match(migration, /doctor_portal\.appointment_protocol_audit_events/i);
    assert.match(migration, /version integer not null default 1/i);
    assert.match(migration, /unique \(appointment_id\)/i);
    assert.match(migration, /protocol_created/);
    assert.match(migration, /protocol_updated/);
    assert.match(migration, /protocol_assigned/);
    assert.match(migration, /clarification_requested/);
    assert.match(migration, /protocol_cancelled/);
    assert.doesNotMatch(migration, /workload_unit|rvu|salary/i);
  });
});

describe("Doctor Portal protocol backend", () => {
  it("mounts protocol endpoints under /api/doctor/protocols only", () => {
    const portalRouter = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/protocol-routes.ts`, "utf8");

    assert.match(portalRouter, /router\.use\("\/protocols", doctorProtocolsRouter\)/);
    assert.match(routes, /"\/tasks"/);
    assert.match(routes, /"\/:appointmentId"/);
    assert.match(routes, /"\/:appointmentId\/assign"/);
    assert.match(routes, /"\/:appointmentId\/clarification"/);
    assert.match(routes, /"\/:appointmentId\/cancel"/);
    assert.match(routes, /"\/:appointmentId\/audit"/);
    assert.doesNotMatch(routes, /createBooking|rescheduleBooking|updateBookingForReschedule|capacity/i);
  });

  it("enforces protocol permission, modality permission, and roster membership", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/protocol-service.ts`, "utf8");

    assert.match(service, /canAssignProtocols/);
    assert.match(service, /canProtocol/);
    assert.match(service, /appointmentHasDoctorRosterMembership/);
    assert.match(service, /doctor_supervisor/);
    assert.match(service, /doctor_admin/);
  });

  it("increments version and writes audit events on update/actions", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/protocol-repository.ts`, "utf8");

    assert.match(repo, /version = version \+ 1/);
    assert.match(repo, /insertProtocolAudit/);
    assert.match(repo, /protocol_assigned/);
    assert.match(repo, /clarification_requested/);
    assert.match(repo, /protocol_cancelled/);
    assert.match(repo, /listProtocolAuditEvents/);
  });

  it("requires reason for clarification and cancellation", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/protocol-service.ts`, "utf8");

    assert.match(service, /Clarification reason is required/);
    assert.match(service, /Cancellation reason is required/);
  });
});

describe("Doctor Portal protocol read-only integration", () => {
  it("exposes only assigned protocol fields through appointment details and queue reads", () => {
    const bookingRepo = readFileSync(`${root}/src/modules/appointments-v2/booking/repositories/booking.repo.ts`, "utf8");
    const readRoutes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/read-v2-routes.ts`, "utf8");

    assert.match(bookingRepo, /ap\.protocol_status = 'assigned'/);
    assert.match(bookingRepo, /protocol_text/);
    assert.match(bookingRepo, /technologist_notes/);
    assert.match(readRoutes, /ap\.protocol_status = 'assigned'/);
    assert.match(readRoutes, /protocol_assigned_by_doctor_name/);
  });
});
