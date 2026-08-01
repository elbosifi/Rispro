import { describe, expect, it } from "vitest";
import { canAccessWorkstationPrinting } from "./workstation-printing-access";

describe("workstation printing access", () => {
  it.each(["receptionist", "supervisor", "modality_staff", "doctor", "super_admin"] as const)("allows printing role %s", (role) => expect(canAccessWorkstationPrinting(role)).toBe(true));
  it("does not broaden access to administrative settings", () => expect(canAccessWorkstationPrinting("administrative")).toBe(false));
});
