import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const restrictionSource = readFileSync(
  new URL("../../../../services/patient-no-show-restriction-service.ts", import.meta.url),
  "utf8"
);
const createSource = readFileSync(
  new URL("../../booking/services/create-booking.service.ts", import.meta.url),
  "utf8"
);
const statusSource = readFileSync(
  new URL("../../booking/services/status-booking.service.ts", import.meta.url),
  "utf8"
);
const patientRoutesSource = readFileSync(
  new URL("../../../../routes/patients.ts", import.meta.url),
  "utf8"
);

describe("patient no-show restriction source guards", () => {
  it("blocks receptionist booking with the required message and reason code", () => {
    assert.match(restrictionSource, /NO_SHOW_BOOKING_BLOCKED_MESSAGE/);
    assert.match(restrictionSource, /patient_no_show_booking_blocked/);
    assert.match(restrictionSource, /cannot be booked by reception/);
  });

  it("requires supervisor or super admin authorization with a reason", () => {
    assert.match(restrictionSource, /role === "supervisor" \|\| role === "super_admin"/);
    assert.match(restrictionSource, /no_show_authorization_reason_required/);
    assert.match(restrictionSource, /booking_restriction_authorized/);
  });

  it("enforces restriction inside create booking service", () => {
    assert.match(createSource, /isNoShowBookingBlocked/);
    assert.match(createSource, /authorizeNoShowBookingRestriction/);
    assert.match(createSource, /noShowAuthorizationReason/);
    assert.match(createSource, /authenticateSupervisor/);
  });

  it("activates restriction when an appointment is marked no-show", () => {
    assert.match(statusSource, /activateNoShowRestrictionForBooking/);
    assert.match(statusSource, /targetStatus === "no-show"/);
    assert.match(restrictionSource, /no_show_count = no_show_count \+ 1/);
    assert.match(restrictionSource, /no_show_booking_blocked = true/);
  });

  it("exposes a supervised patient-profile authorization endpoint", () => {
    assert.match(patientRoutesSource, /\/:patientId\/no-show\/authorize-booking/);
    assert.match(patientRoutesSource, /requireAnyRole\(\["supervisor", "super_admin"\]\)/);
  });
});
