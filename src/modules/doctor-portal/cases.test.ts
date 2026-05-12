import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { classifyCaseRule, isRosterMatch, nextWorkingDay } from "./case-assignment-rules.js";

const root = process.cwd();

describe("Doctor Portal case assignment rules", () => {
  it("assigns CT to protocol team with next working day expected reporting date", () => {
    const rule = classifyCaseRule({
      appointmentId: 1,
      bookingDate: "2027-01-07",
      modalityId: 10,
      modalityCode: "CT",
      modalityName: "CT",
      examTypeName: "CT Brain",
      sessionName: null,
    });

    assert.equal(rule.assignmentType, "protocol");
    assert.deepEqual(rule.allowedDutyTypes, ["ct_protocol_day"]);
    assert.equal(rule.expectedReportingDate, "2027-01-10");
  });

  it("assigns MRI to same-day MRI supervision/reporting team", () => {
    const booking = {
      appointmentId: 2,
      bookingDate: "2027-01-04",
      modalityId: 11,
      modalityCode: "MRI",
      modalityName: "MRI",
      examTypeName: "MRI Spine",
      sessionName: null,
    };
    const rule = classifyCaseRule(booking);

    assert.equal(rule.assignmentType, "reporting");
    assert.equal(rule.expectedReportingDate, "2027-01-04");
    assert.equal(isRosterMatch(booking, {
      id: 5,
      date: "2027-01-04",
      modalityId: 11,
      modalityCode: "MRI",
      modalityName: "MRI",
      dutyType: "mri_supervision_reporting",
      sessionName: null,
    }, rule), true);
  });

  it("uses ultrasound session matching when a session signal exists", () => {
    const booking = {
      appointmentId: 3,
      bookingDate: "2027-01-04",
      modalityId: 12,
      modalityCode: "US",
      modalityName: "Ultrasound",
      examTypeName: "Abdomen US",
      sessionName: "term 2",
    };
    const rule = classifyCaseRule(booking);

    assert.equal(rule.assignmentType, "ultrasound_operator");
    assert.equal(isRosterMatch(booking, {
      id: 6,
      date: "2027-01-04",
      modalityId: 12,
      modalityCode: "US",
      modalityName: "Ultrasound",
      dutyType: "ultrasound_term_2",
      sessionName: "term 2",
    }, rule), true);
    assert.equal(isRosterMatch(booking, {
      id: 7,
      date: "2027-01-04",
      modalityId: 12,
      modalityCode: "US",
      modalityName: "Ultrasound",
      dutyType: "ultrasound_term_2",
      sessionName: "term 1",
    }, rule), false);
  });

  it("falls back safely for ultrasound when no session signal exists", () => {
    const booking = {
      appointmentId: 4,
      bookingDate: "2027-01-04",
      modalityId: 12,
      modalityCode: "US",
      modalityName: "Ultrasound",
      examTypeName: "Abdomen US",
      sessionName: null,
    };
    const rule = classifyCaseRule(booking);

    assert.equal(rule.requiresSessionMatch, false);
    assert.equal(isRosterMatch(booking, {
      id: 8,
      date: "2027-01-04",
      modalityId: 12,
      modalityCode: "US",
      modalityName: "Ultrasound",
      dutyType: "ultrasound_term_1",
      sessionName: "term 1",
    }, rule), true);
  });

  it("assigns mammography and breast ultrasound as mammography episodes", () => {
    const rule = classifyCaseRule({
      appointmentId: 5,
      bookingDate: "2027-01-04",
      modalityId: 12,
      modalityCode: "US",
      modalityName: "Ultrasound",
      examTypeName: "Breast complementary ultrasound",
      sessionName: null,
    });

    assert.equal(rule.assignmentType, "mammography_episode");
    assert.deepEqual(rule.allowedDutyTypes, ["mammography_session"]);
  });

  it("calculates next working day across Friday and Saturday", () => {
    assert.equal(nextWorkingDay("2027-01-07"), "2027-01-10");
  });
});

describe("Doctor Portal case assignment wiring", () => {
  it("adds only the Phase 3 case assignment table", () => {
    const migration = readFileSync(`${root}/src/db/migrations/066_doctor_portal_case_team_assignments.sql`, "utf8");

    assert.match(migration, /doctor_portal\.case_team_assignments/i);
    assert.match(migration, /appointments_v2\.bookings\(id\)/i);
    assert.match(migration, /case_team_assignments_active_unique/i);
    assert.doesNotMatch(migration, /appointment_protocols|workload_unit|rvu|salary/i);
  });

  it("mounts Doctor Portal cases without appointment create or reschedule hooks", () => {
    const portalRouter = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const caseRoutes = readFileSync(`${root}/src/modules/doctor-portal/cases-routes.ts`, "utf8");
    const caseRepo = readFileSync(`${root}/src/modules/doctor-portal/cases-repository.ts`, "utf8");

    assert.match(portalRouter, /router\.use\("\/cases", doctorCasesRouter\)/);
    assert.match(caseRoutes, /"\/my"/);
    assert.match(caseRoutes, /"\/team"/);
    assert.match(caseRoutes, /"\/unassigned"/);
    assert.match(caseRoutes, /"\/assign"/);
    assert.match(caseRoutes, /"\/:appointmentId\/reassign"/);
    assert.match(caseRepo, /on conflict \(appointment_id, assignment_type\) where status = 'active'/i);
    assert.match(caseRepo, /eventType:\s*"case_reassigned"/);
    assert.match(caseRepo, /reason:\s*input\.reason/);
    assert.doesNotMatch(`${caseRoutes}\n${caseRepo}`, /createBooking|updateBookingForReschedule|capacity|protocol_text|workload_unit/i);
  });

  it("enforces doctor access and manager-only assignment mutation", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/cases-service.ts`, "utf8");

    assert.match(service, /requireRosterDoctor\(actor\)/);
    assert.match(service, /requireRosterManager\(actor\)/);
    assert.match(service, /runDoctorCaseAssignment/);
    assert.match(service, /correctDoctorCaseAssignment/);
    assert.match(service, /Correction reason is required/);
  });
});
