import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { buildAppointmentSlipData } from "./print-utils";

const toStringMock = vi.hoisted(() => vi.fn().mockResolvedValue("<svg data-testid=\"qr-image\"></svg>"));
vi.mock("qrcode", () => ({
  default: {
    toString: toStringMock,
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
    modalityGeneralInstructionAr: null,
    modalityGeneralInstructionEn: null,
    examNameAr: "فحص",
    examNameEn: "CT Head",
    examSpecificInstructionAr: "تجهيز عربي",
    examSpecificInstructionEn: "English prep",
    priorityNameAr: "عادي",
    priorityNameEn: "Routine",
    modalitySlotNumber: 7,
    publicCancelToken: "signed-token",
    ...overrides,
  };
}

describe("appointment slip QR payloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds the cancellation QR payload from the public token when present", () => {
    const slip = buildAppointmentSlipData(makeAppointment());

    expect(slip.queueQrPayload).toBe("http://localhost:3000/public/cancel-appointment?t=signed-token");
    expect(slip.accessionBarcodePayload).toBe("V2-45");
  });

  it("falls back to the accession number when no public token exists", () => {
    const slip = buildAppointmentSlipData(makeAppointment({ publicCancelToken: null }));

    expect(slip.queueQrPayload).toBe("V2-45");
  });
});
