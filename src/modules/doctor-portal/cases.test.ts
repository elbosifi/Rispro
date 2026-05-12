import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { classifyCaseRule, isRosterMatch, nextWorkingDay } from "./case-assignment-rules.js";

const root = process.cwd();

describe("Doctor Portal report worklist rules", () => {
  it("keeps report cases unassigned by default and uses generic reporting classification", () => {
    const booking = {
      appointmentId: 1,
      bookingDate: "2027-01-07",
      modalityId: 10,
      modalityCode: "CT",
      modalityName: "CT",
      examTypeName: "CT Brain",
      sessionName: null,
    };
    const rule = classifyCaseRule(booking);

    assert.equal(rule.assignmentType, "reporting");
    assert.deepEqual(rule.allowedDutyTypes, []);
    assert.equal(rule.expectedReportingDate, "2027-01-07");
    assert.equal(isRosterMatch(booking, {
      id: 5,
      date: "2027-01-07",
      modalityId: 10,
      modalityCode: "CT",
      modalityName: "CT",
      dutyType: "configured_reporting_duty",
      sessionName: null,
    }, rule), true);
  });

  it("still exposes next working day utility for callers that explicitly need it", () => {
    assert.equal(nextWorkingDay("2027-01-07"), "2027-01-10");
  });
});

describe("Doctor Portal case assignment wiring", () => {
  it("adds direct doctor assignment without appointment lifecycle hooks", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/cases-routes.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/cases-repository.ts`, "utf8");

    assert.match(routes, /"\/:appointmentId\/assign-doctor"/);
    assert.match(repo, /assigned_doctor_id/i);
    assert.match(repo, /b\.requires_report = true/i);
    assert.match(repo, /no_report_case_not_assignable/);
    assert.doesNotMatch(`${routes}\n${repo}`, /createBooking|updateBookingForReschedule|capacity|protocol_text/i);
  });
});
