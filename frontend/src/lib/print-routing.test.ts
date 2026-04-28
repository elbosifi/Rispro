import { describe, expect, it } from "vitest";
import { buildAppointmentPrintUrl } from "./print-routing";

describe("buildAppointmentPrintUrl", () => {
  it("builds a preview url by default", () => {
    expect(buildAppointmentPrintUrl(42)).toBe("/print?appointmentId=42");
  });

  it("builds an autoprint url when requested", () => {
    expect(buildAppointmentPrintUrl(42, { autoprint: true })).toBe("/print?appointmentId=42&autoprint=1");
  });

  it("accepts string ids safely", () => {
    expect(buildAppointmentPrintUrl("99")).toBe("/print?appointmentId=99");
  });
});
