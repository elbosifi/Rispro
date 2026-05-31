import { describe, expect, it } from "vitest";

import source from "../components/CreateAppointmentTab.tsx?raw";
import drawerSource from "@/components/patients/patient-drawer.tsx?raw";

describe("no-show restriction UI source guards", () => {
  it("splits no-show warnings from cancelled appointment information", () => {
    expect(source).toContain('item.status === "no-show"');
    expect(source).toContain('item.status === "cancelled"');
    expect(source).toContain("appointments.create.previousCancelledAppointments");
    expect(source).toContain("border-sky-200");
  });

  it("shows the active no-show booking restriction and requires authorization reason", () => {
    expect(source).toContain("patientNoShowSummary?.bookingRestricted");
    expect(source).toContain("appointments.create.noShowRestrictionBlocked");
    expect(source).toContain("noShowAuthorizationReason");
    expect(source).toContain("appointments.create.noShowAuthorizationReasonRequired");
  });

  it("shows patient profile no-show state and supervised authorization action", () => {
    expect(drawerSource).toContain("No-show booking restriction");
    expect(drawerSource).toContain("summary.noShow.noShowCount");
    expect(drawerSource).toContain("summary.noShow.bookingRestricted");
    expect(drawerSource).toContain("Authorize booking after no-show");
    expect(drawerSource).toContain("authorizePatientNoShowBooking");
  });
});
