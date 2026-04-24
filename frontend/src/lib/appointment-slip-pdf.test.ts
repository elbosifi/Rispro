import { describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { buildAppointmentSlipData, createAppointmentSlipPdfBlob } from "./print-utils";

vi.mock("qrcode", () => ({
  default: {
    toString: vi.fn().mockResolvedValue("<svg />"),
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,Zm9v"),
  },
}));

function makeAppointment(overrides: Partial<AppointmentWithDetails> = {}): AppointmentWithDetails {
  return {
    id: 45,
    patientId: 10,
    modalityId: 2,
    examTypeId: 3,
    reportingPriorityId: 1,
    accessionNumber: "V2-45",
    appointmentDate: "2026-10-01",
    dailySequence: 1,
    status: "scheduled",
    isWalkIn: false,
    isOverbooked: false,
    overbookingReason: null,
    approvedByName: null,
    demographicsEstimated: false,
    notes: null,
    noShowReason: null,
    cancelReason: null,
    arrivedAt: null,
    completedAt: null,
    createdAt: "2026-04-01",
    updatedAt: "2026-04-01",
    arabicFullName: "مريض اختبار",
    englishFullName: "Test Patient",
    nationalId: "123456789012",
    mrn: "MRN-10",
    ageYears: 30,
    sex: "M",
    phone1: "0911111111",
    modalityNameAr: "CT",
    modalityNameEn: "CT",
    modalityCode: "CT",
    modalityGeneralInstructionAr: "Modality prep",
    modalityGeneralInstructionEn: "Modality prep",
    examNameAr: "فحص",
    examNameEn: "CT Head",
    examSpecificInstructionAr: "Exam prep",
    examSpecificInstructionEn: "Exam prep",
    priorityNameAr: "عادي",
    priorityNameEn: "Routine",
    modalitySlotNumber: 7,
    publicCancelToken: null,
    ...overrides,
  };
}

describe("appointment slip PDF", () => {
  it("builds a stable render model", () => {
    const slip = buildAppointmentSlipData(makeAppointment());
    expect(slip.hospitalName).toContain("National Cancer Center");
    expect(slip.patientName).toBe("Test Patient");
    expect(slip.accessionNumber).toBe("V2-45");
    expect(slip.queueQrPayload).toBe("V2-45");
    expect(slip.accessionBarcodePayload).toBe("V2-45");
  });

  it("renders a valid A5 PDF blob in preprinted mode", async () => {
    const blob = await createAppointmentSlipPdfBlob(makeAppointment(), "preprinted");
    expect(blob.type).toBe("application/pdf");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = new TextDecoder().decode(bytes.slice(0, 5));
    expect(header).toBe("%PDF-");

    const pdfText = new TextDecoder().decode(bytes);
    expect(pdfText).toMatch(/\/MediaBox \[0 0 419\.5299999999999727 595\.2799999999999727\]/);
  });
});
