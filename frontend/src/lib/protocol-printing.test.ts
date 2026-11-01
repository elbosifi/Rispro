import { afterEach, describe, expect, it, vi } from "vitest";
import { pushToast } from "./toast";
import { buildModalityProtocolPrintSheet, formatModalityCtPhaseTiming, printProtocolSheet, type ProtocolPrintSheet } from "./protocol-printing";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { ModalityProtocolAssignment } from "@/types/api";

vi.mock("./toast", () => ({ pushToast: vi.fn() }));

const sheet: ProtocolPrintSheet = {
  patientName: "Protocol Patient",
  mrn: "MRN-1",
  accession: "ACC-1",
  appointmentDateTime: "2026-07-03 09:00",
  modality: "MRI",
  exam: "MRI Brain",
  category: "oncology",
  clinicalNotes: "Headache",
  protocolName: "MRI Brain Routine",
  versionNumber: "1.0",
  scanner: "MR 3T",
  assignedBy: "Dr. Protocol",
  assignedAt: "2026-07-03T08:00:00Z",
  protocolInstructions: "Run axial FLAIR",
  contrastInstructions: "No contrast",
  mriSequences: [
    {
      orderIndex: 1,
      scanner: "MR 3T",
      sequence: "Axial FLAIR",
      vendorSequenceName: "T2 FLAIR TRA",
      plane: "Axial",
      coverage: "Whole brain",
      bValuesTiming: null,
      notes: "Motion correction if needed",
      isRequired: true,
    },
  ],
};

function mockPrintWindow() {
  return {
    document: {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    },
    opener: window,
    focus: vi.fn(),
    print: vi.fn(),
  };
}

describe("printProtocolSheet", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    [{ timingType: "MANUAL", timingOverride: "Delayed scan at 5 minutes", presetContrastStatus: "NON_CONTRAST" }, "Delayed scan at 5 minutes"],
    [{ timingType: "NON_CONTRAST" }, "Non-contrast"],
    [{ timingType: "FIXED_DELAY_INJECTION_START", delaySeconds: 70 }, "70 sec after start of IV contrast"],
    [{ timingType: "FIXED_DELAY_INJECTION_END", delaySeconds: 30 }, "30 sec after completion of IV contrast"],
    [{ timingType: "BOLUS_TRACKING", bolusTrackingSite: "Aorta", triggerHu: 120, postTriggerDelaySeconds: 8 }, "Bolus tracking · Aorta · 120 HU · +8 sec"],
    [{ presetTimingType: "FIXED_DELAY", presetDelaySeconds: 70 }, "Legacy fixed delay, 70 sec"],
    [{ timingType: "FIXED_DELAY_INJECTION_START" }, "Delay after start of IV contrast"],
    [{ timingOverride: "Manual legacy override", presetContrastStatus: "NON_CONTRAST" }, "Manual legacy override"],
    [{ presetInstructions: "Breath hold" }, "Timing not specified"],
  ])("formats authoritative CT timing %#", (overrides, expected) => {
    const timing = { timingType: null, timingOverride: null, delaySeconds: null, ...overrides };
    expect(formatModalityCtPhaseTiming(timing)).toBe(expected);
  });

  it.each(["CT", "MRI"] as const)("prints customized %s free text without library acquisition rows", (modality) => {
    const printWindow = mockPrintWindow();
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const assignment = {
      modality, protocolId: 1, protocolName: "Library protocol", versionNumber: "2.1", freeTextProtocol: "Active custom prescription",
      protocolNotes: "Patient prep", contrastNotes: "Doctor contrast note", libraryPreparationNotes: "Current library prep",
      ctPhases: [{ orderIndex: 1, customPhaseName: "Original phase" }],
      mriSequences: [{ orderIndex: 1, sequencePresetName: "Original sequence" }],
    } as unknown as ModalityProtocolAssignment;
    const appointment = { patientId: 1, englishFullName: "Test patient" } as AppointmentWithDetails;
    const result = buildModalityProtocolPrintSheet(appointment, assignment);
    printProtocolSheet(result);
    const html = String(printWindow.document.write.mock.calls[0]?.[0]);
    expect(html).toContain("Customized protocol — active instructions");
    expect(html).toContain("Active custom prescription");
    expect(html).toContain("Reference protocol");
    expect(html).toContain("Library protocol v2.1");
    expect(html).toContain("Patient prep");
    expect(html).toContain("Doctor contrast note");
    expect(html).toContain("Current library reference — not an assignment-time snapshot");
    expect(html).toContain("Current library prep");
    expect(html).not.toContain("Original phase");
    expect(html).not.toContain("Original sequence");
    expect(html).not.toContain("<table");
  });

  it("prints standalone free text without a structured table", () => {
    const printWindow = mockPrintWindow();
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const assignment = { modality: "MRI", protocolId: null, freeTextProtocol: "Free prescription", protocolNotes: "Prepare patient", contrastNotes: "No contrast", ctPhases: [], mriSequences: [] } as unknown as ModalityProtocolAssignment;
    printProtocolSheet(buildModalityProtocolPrintSheet({ patientId: 1 } as AppointmentWithDetails, assignment));
    const html = String(printWindow.document.write.mock.calls[0]?.[0]);
    expect(html).toContain("Free prescription");
    expect(html).toContain("Prepare patient");
    expect(html).toContain("No contrast");
    expect(html).not.toContain("<table");
  });

  it("retains saved CT acquisition rows and their structured timing", () => {
    const printWindow = mockPrintWindow();
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    const assignment = { modality: "CT", protocolId: 1, protocolName: "CT Liver", versionNumber: "1.0", freeTextProtocol: null, protocolNotes: "Patient prep", contrastNotes: "Contrast note", ctPhases: [{ orderIndex: 1, customPhaseName: "Arterial", timingType: "FIXED_DELAY_INJECTION_START", delaySeconds: 70, timingOverride: null, isRequired: true }], mriSequences: [] } as unknown as ModalityProtocolAssignment;
    printProtocolSheet(buildModalityProtocolPrintSheet({ patientId: 1 } as AppointmentWithDetails, assignment));
    const html = String(printWindow.document.write.mock.calls[0]?.[0]);
    expect(html).toContain("CT phases");
    expect(html).toContain("Arterial");
    expect(html).toContain("70 sec after start of IV contrast");
    expect(html).toContain("Patient prep");
    expect(html).toContain("Contrast note");
  });

  it("writes a self-contained protocol sheet into a writable print window", () => {
    const printWindow = mockPrintWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);

    printProtocolSheet(sheet);

    expect(openSpy).toHaveBeenCalledWith("", "_blank", "width=980,height=900");
    expect(printWindow.document.open).toHaveBeenCalledOnce();
    expect(printWindow.document.write).toHaveBeenCalledOnce();
    expect(printWindow.document.close).toHaveBeenCalledOnce();
    const html = String(printWindow.document.write.mock.calls[0]?.[0] ?? "");
    expect(html).toContain("RISpro / Protocol Sheet");
    expect(html).toContain('<body dir="ltr" lang="en">');
    expect(html).toContain("html, body { direction: ltr; text-align: left; }");
    expect(html).toContain("window.print()");
    expect(html).toContain("window.close()");
    expect(html).toContain(">Print</button>");
    expect(html).toContain(">Close</button>");
    expect(html).toContain(".toolbar { display: none; }");
    expect(printWindow.focus).not.toHaveBeenCalled();
    expect(printWindow.print).not.toHaveBeenCalled();
  });

  it("warns and triggers a toast when the print window is blocked", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(window, "open").mockReturnValue(null);

    const result = printProtocolSheet(sheet);

    expect(result).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith("Unable to open protocol print window. Check popup blocker settings.");
    expect(pushToast).toHaveBeenCalledWith({
      type: "error",
      title: "Popup blocked",
      message: "Please allow popups for RISpro to print protocol sheets.",
    });
  });

  it("does not add a version suffix to a free-text protocol", () => {
    const printWindow = mockPrintWindow();
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    printProtocolSheet({ ...sheet, protocolName: "Free-text protocol", versionNumber: null, protocolInstructions: "Complete free text" });
    const html = String(printWindow.document.write.mock.calls[0]?.[0] ?? "");
    expect(html).toContain("Free-text protocol");
    expect(html).toContain("Complete free text");
    expect(html).not.toContain("Free-text protocol v");
  });

  it("prints CT columns in the LTR acquisition order", () => {
    const printWindow = mockPrintWindow();
    vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);
    printProtocolSheet({
      ...sheet,
      modality: "CT",
      ctPhases: [{
        orderIndex: 1,
        phase: "Portal venous",
        timing: "Delay 70s",
        coverage: "Abdomen",
        reconstruction: "Soft tissue",
        isRequired: true,
        instructions: "Breath hold",
      }],
      mriSequences: undefined,
    });
    const html = String(printWindow.document.write.mock.calls[0]?.[0] ?? "");
    expect(html.indexOf("<th>Order</th>")).toBeLessThan(html.indexOf("<th>Phase</th>"));
    expect(html.indexOf("<th>Phase</th>")).toBeLessThan(html.indexOf("<th>Timing</th>"));
    expect(html.indexOf("<th>Timing</th>")).toBeLessThan(html.indexOf("<th>Coverage</th>"));
    expect(html.indexOf("<th>Coverage</th>")).toBeLessThan(html.indexOf("<th>Reconstruction</th>"));
    expect(html.indexOf("<th>Reconstruction</th>")).toBeLessThan(html.indexOf("<th>Required</th>"));
    expect(html.indexOf("<th>Required</th>")).toBeLessThan(html.indexOf("<th>Instructions</th>"));
  });
});
