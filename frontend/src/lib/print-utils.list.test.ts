import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { filterVisibleAppointments } from "./print-utils";
import { prepareAppointmentListHtml, printAppointmentListV2 } from "./registration-list-printing";

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
    address: "tripoli",
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
  it("filters cancelled, discontinued, and voided appointments out of list printing", () => {
    const appointments = [
      makeAppointment("scheduled"),
      makeAppointment("cancelled"),
      makeAppointment("discontinued"),
      makeAppointment("voided"),
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
    const printDocument: Document = Object.create(document);
    Object.assign(printDocument, { write, close });
    const printWindow: Window = Object.create(window);
    Object.defineProperties(printWindow, {
      document: { value: printDocument },
      focus: { value: focus },
      print: { value: print },
    });
    const open = vi.spyOn(window, "open").mockReturnValue(printWindow);

    printAppointmentListV2([makeAppointment("scheduled")], "2026-04-25");

    expect(open).toHaveBeenCalled();
    const html = write.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
    expect(html).toContain("/assets/nccb-logo.png");
    expect(html).toContain("National Cancer Center Benghazi");
    expect(html).toContain("Age: 40");
    expect(html).toContain("City: Tripoli");
    expect(html).toContain("المركز الوطني للأورام بنغازي");
  });

  it("prepares exactly the supplied rows without applying a status filter", () => {
    const html = prepareAppointmentListHtml([makeAppointment("cancelled"), makeAppointment("scheduled")], "Current filters", new Date("2026-08-07T12:00:00Z"));
    expect(html).toContain("V2-cancelled");
    expect(html).toContain("V2-scheduled");
    expect(html).toContain("Total: 2");
    expect(html).toContain("size: 297mm 210mm");
    expect(html).toContain("margin: 12mm");
    expect(html).not.toContain('class="slip"');
  });

  it("preserves a long synthetic row set in exact order for direct Chromium pagination", () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      ...makeAppointment("scheduled"),
      id: index + 1,
      accessionNumber: `LONG-${String(index + 1).padStart(4, "0")}`,
      dailySequence: index + 1,
    }));
    const html = prepareAppointmentListHtml(rows, "Long synthetic list", new Date("2026-08-07T12:00:00Z"), true);
    expect(html).toContain("LONG-0001");
    expect(html).toContain("LONG-0500");
    expect(html.match(/LONG-\d{4}/g)).toHaveLength(500);
    expect(html.indexOf("LONG-0001")).toBeLessThan(html.indexOf("LONG-0500"));
    expect(html).toContain("@page { size: 297mm 210mm; margin: 0; }");
    expect(html).toContain('data-direct-pdf="true"');
    expect(html).toContain("break-inside: avoid");
    expect(html).not.toContain('class="slip"');
  });
});
