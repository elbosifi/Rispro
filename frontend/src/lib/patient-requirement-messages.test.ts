import { describe, expect, it } from "vitest";
import {
  getPatientRequirementStaffMessageKey,
  getPatientRequirementCheckInMessageKey,
} from "./patient-requirement-messages";

describe("patient requirement message mapping", () => {
  it("maps missing phone to staff and patient-facing messages", () => {
    expect(getPatientRequirementStaffMessageKey(["patient_phone_required"])).toBe("queue.requirements.staffPhoneRequired");
    expect(getPatientRequirementCheckInMessageKey(["patient_phone_required"])).toBe("queue.requirements.checkInPhoneRequired");
  });

  it("maps missing phone and identifier to combined messages", () => {
    const codes = ["patient_phone_required", "patient_primary_identifier_required"];

    expect(getPatientRequirementStaffMessageKey(codes)).toBe("queue.requirements.staffPhoneAndIdentifierRequired");
    expect(getPatientRequirementCheckInMessageKey(codes)).toBe("queue.requirements.checkInPhoneAndIdentifierRequired");
  });
});
