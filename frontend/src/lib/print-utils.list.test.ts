import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { filterVisibleAppointments, printAppointmentList } from "./print-utils";

function makeAppointment(status: AppointmentWithDetails["status"]): AppointmentWithDetails {
  return {
    id: status === "scheduled" ? 1 : 2,
    patientId: 10,
    modalityId: 3,
    examTypeId: null,
    reportingPriorityId: null,
    accessionNumber: `V2-${status}`,
    requiresReport: false,
    studyInstanceUid: null,
    appointmentDate: "2026-04-25",
    bookingTime: null,
    dailySequence: 1,
    status,
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
    createdAt: "2026-04-25",
    updatedAt: "2026-04-25",
    arabicFullName: "مريض اختبار",
    englishFullName: "Test Patient",
    nationalId: null,
    mrn: null,
    ageYears: 40,
    sex: "M",
    phone1: null,
    modalityNameAr: "أشعة",
    modalityNameEn: "Radiology",
    modalityCode: "RAD",
    modalityGeneralInstructionAr: null,
    modalityGeneralInstructionEn: null,
    examNameAr: null,
    examNameEn: "Exam",
    examSpecificInstructionAr: null,
    examSpecificInstructionEn: null,
    priorityNameAr: null,
    priorityNameEn: "Routine",
    modalitySlotNumber: null,
    publicCancelToken: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("print list helpers", () => {
  it("filters cancelled and discontinued appointments out of list printing", () => {
    const appointments = [
      makeAppointment("scheduled"),
      makeAppointment("cancelled"),
      makeAppointment("discontinued"),
    ];

    const visible = filterVisibleAppointments(appointments);

    expect(visible).toHaveLength(1);
    expect(visible[0].status).toBe("scheduled");
  });

  it("adds logo and hospital name to the printed list header", () => {
    const write = vi.fn();
    const close = vi.fn();
    const focus = vi.fn();
    const print = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({
      document: { write, close } as any,
      focus,
      print,
    } as unknown as Window);

    printAppointmentList([makeAppointment("scheduled")], "2026-04-25");

    expect(open).toHaveBeenCalled();
    const html = write.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(html).toContain("/assets/nccb-logo.png");
    expect(html).toContain("National Cancer Center Benghazi");
    expect(html).toContain("المركز الوطني للأورام بنغازي");
  });
});
