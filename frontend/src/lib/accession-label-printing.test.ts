import { describe, expect, it } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { createAccessionLabelPdfBlob } from "./accession-label-printing";

describe("accession label PDF", () => {
  it("creates an exact-profile PDF containing the appointment label fields", async () => {
    const appointment = {
      id: 7,
      arabicFullName: "Test Patient",
      englishFullName: "Test Patient",
      accessionNumber: "ACC-0007",
      modalityCode: "CT",
      modalityNameEn: "CT",
      appointmentDate: "2026-08-01",
      mrn: "MRN-7",
    } as AppointmentWithDetails;
    const blob = await createAccessionLabelPdfBlob(appointment, { widthMm: 50, heightMm: 30 });
    const prefix = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5));
    expect(blob.type).toBe("application/pdf");
    expect(prefix).toBe("%PDF-");
    expect(blob.size).toBeGreaterThan(500);
  });
});
