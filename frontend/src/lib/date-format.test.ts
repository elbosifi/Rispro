import { describe, expect, it } from "vitest";
import { isoToTripoliDateTimeLocal, tripoliDateTimeLocalToIso } from "./date-format";

describe("Tripoli datetime-local conversion", () => {
  it("converts a Tripoli wall-clock time to an explicit ISO instant", () => {
    expect(tripoliDateTimeLocalToIso("2026-09-01T10:00")).toBe("2026-09-01T08:00:00.000Z");
  });

  it("converts an ISO instant back to the same Tripoli wall-clock time", () => {
    expect(isoToTripoliDateTimeLocal("2026-09-01T08:00:00.000Z")).toBe("2026-09-01T10:00");
  });

  it("keeps a blank datetime-local value nullable", () => {
    expect(tripoliDateTimeLocalToIso("")).toBeNull();
  });
});
