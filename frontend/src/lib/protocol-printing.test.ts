import { afterEach, describe, expect, it, vi } from "vitest";
import { printProtocolSheet, type ProtocolPrintSheet } from "./protocol-printing";

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

  it("writes a self-contained protocol sheet into a writable print window", () => {
    const printWindow = mockPrintWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(printWindow as unknown as Window);

    printProtocolSheet(sheet);

    expect(openSpy).toHaveBeenCalledWith("", "_blank", "width=980,height=900");
    expect(printWindow.document.open).toHaveBeenCalledOnce();
    expect(printWindow.document.write).toHaveBeenCalledOnce();
    expect(printWindow.document.close).toHaveBeenCalledOnce();
    const html = String(printWindow.document.write.mock.calls[0]?.[0] ?? "");
    expect(html).toContain("NCCB / RISpro Protocol Sheet");
    expect(html).toContain("window.print()");
    expect(html).toContain("window.close()");
    expect(html).toContain(">Print</button>");
    expect(html).toContain(">Close</button>");
    expect(html).toContain(".toolbar { display: none; }");
    expect(printWindow.focus).not.toHaveBeenCalled();
    expect(printWindow.print).not.toHaveBeenCalled();
  });

  it("warns when the print window is blocked", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(window, "open").mockReturnValue(null);

    printProtocolSheet(sheet);

    expect(warnSpy).toHaveBeenCalledWith("Unable to open protocol print window. Check popup blocker settings.");
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
});
