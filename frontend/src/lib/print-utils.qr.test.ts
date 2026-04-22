import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { printAppointmentSlip } from "./print-utils";

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
    priorityNameAr: "عادي",
    priorityNameEn: "Routine",
    modalitySlotNumber: null,
    publicCancelToken: "signed-token",
    ...overrides,
  };
}

describe("printAppointmentSlip A5 preprinted template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders required preprinted fields and queue barcode caption", async () => {
    let writtenHtml = "";
    const documentMock = {
      write: vi.fn((html: string) => {
        writtenHtml = html;
      }),
      close: vi.fn(),
    };
    const printWindowMock = {
      document: documentMock,
      focus: vi.fn(),
      print: vi.fn(),
    };

    vi.spyOn(window, "open").mockReturnValue(printWindowMock as unknown as Window);
    printAppointmentSlip(makeAppointment());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writtenHtml).toContain("@page { size: 148mm 210mm; margin: 0; }");
    expect(writtenHtml).toContain("Patient Name");
    expect(writtenHtml).toContain("MRN / Patient ID");
    expect(writtenHtml).toContain("Appointment No.");
    expect(writtenHtml).toContain("Modality");
    expect(writtenHtml).toContain("Exam");
    expect(writtenHtml).toContain("Date");
    expect(writtenHtml).toContain("Scan to Enter The Queue");
    expect(writtenHtml).toContain("Queue barcode");
  });
});
