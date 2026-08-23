import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { directPrintRegistrationRows } from "./registration-list-printing";

const mockDirectPrintRegistrationList = vi.fn();
const mockLoadSettings = vi.fn();
const mockPushToast = vi.fn();

vi.mock("@/services/printing/direct-print-service", () => ({
  directPrintRegistrationList: (...args: unknown[]) => mockDirectPrintRegistrationList(...args),
}));
vi.mock("@/services/printing/workstation-printer-settings", () => ({
  loadQzPrinterSettings: () => mockLoadSettings(),
}));
vi.mock("@/lib/toast", () => ({ pushToast: (...args: unknown[]) => mockPushToast(...args) }));

const rows = [{ id: 7, arabicFullName: "Patient", accessionNumber: "ACC-7" }] as never[];
const desktopProfile = { documentType: "A4_LANDSCAPE_DOCUMENT", enabled: true, printerName: "RISPRO Landscape" };
const desktopUserAgent = navigator.userAgent;

function mockPrintWindow() {
  const print = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print } as unknown as Window);
  return print;
}

function mockBlockedPrintWindow() {
  vi.spyOn(window, "open").mockReturnValue(null);
}

describe("directPrintRegistrationRows", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    mockDirectPrintRegistrationList.mockReset();
    mockLoadSettings.mockReset();
    mockPushToast.mockReset();
    mockLoadSettings.mockReturnValue({ browserPrintFallbackEnabled: false, profiles: [desktopProfile] });
  });

  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: desktopUserAgent });
  });

  it("uses browser printing without QZ or a warning when the landscape profile is disabled", async () => {
    const print = mockPrintWindow();
    mockLoadSettings.mockReturnValue({ profiles: [{ ...desktopProfile, enabled: false }] });

    await directPrintRegistrationRows(rows, "today");

    expect(mockDirectPrintRegistrationList).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledOnce();
    expect(mockPushToast).not.toHaveBeenCalled();
  });

  it("shows a centered browser-blocked warning when browser printing is blocked before QZ", async () => {
    mockBlockedPrintWindow();
    mockLoadSettings.mockReturnValue({ profiles: [{ ...desktopProfile, enabled: false }] });

    await directPrintRegistrationRows(rows, "today");

    expect(mockDirectPrintRegistrationList).not.toHaveBeenCalled();
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ placement: "center", title: "Browser printing blocked" }), 10_000);
  });

  it("uses browser printing without QZ when mobile", async () => {
    const print = mockPrintWindow();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone) Mobile" });

    await directPrintRegistrationRows(rows, "today");

    expect(mockDirectPrintRegistrationList).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledOnce();
  });

  it("warns in the center and automatically uses browser printing when the enabled profile has no printer", async () => {
    const print = mockPrintWindow();
    mockLoadSettings.mockReturnValue({ profiles: [{ ...desktopProfile, printerName: "" }] });

    await directPrintRegistrationRows(rows, "today");

    expect(mockDirectPrintRegistrationList).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledOnce();
    expect(mockPushToast.mock.calls[0][0]).toMatchObject({ placement: "center", title: "Direct printing unavailable" });
    expect(mockPushToast.mock.calls[0][0]).not.toHaveProperty("action");
  });

  it("automatically falls back after a safe QZ failure", async () => {
    const print = mockPrintWindow();
    mockDirectPrintRegistrationList.mockResolvedValue({ success: false, errorCode: "QZ_CONNECTION_FAILED", message: "QZ unavailable" });

    await directPrintRegistrationRows(rows, "today");

    expect(print).toHaveBeenCalledOnce();
    expect(mockPushToast.mock.calls[0][0]).toMatchObject({ placement: "center" });
    expect(mockPushToast.mock.calls[0][0]).not.toHaveProperty("action");
  });

  it("does not claim browser printing opened when the safe QZ fallback popup is blocked", async () => {
    mockBlockedPrintWindow();
    mockDirectPrintRegistrationList.mockResolvedValue({ success: false, errorCode: "QZ_CONNECTION_FAILED", message: "QZ unavailable" });

    await directPrintRegistrationRows(rows, "today");

    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Browser printing blocked", placement: "center" }), 10_000);
    expect(mockPushToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: "The configured direct printer could not be used. Browser printing has been opened instead." }), 10_000);
  });

  it("keeps direct printing when QZ succeeds", async () => {
    mockDirectPrintRegistrationList.mockResolvedValue({ success: true, printerName: "RISPRO Landscape" });

    await directPrintRegistrationRows(rows, "today");

    expect(mockDirectPrintRegistrationList).toHaveBeenCalledWith([7], "today");
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it.each(["PRINT_STATUS_UNKNOWN", "DUPLICATE_PRINT"])("does not browser print for %s", async (errorCode) => {
    const print = mockPrintWindow();
    mockDirectPrintRegistrationList.mockResolvedValue({ success: false, errorCode, message: errorCode });

    await directPrintRegistrationRows(rows, "today");

    expect(print).not.toHaveBeenCalled();
    expect(mockPushToast.mock.calls[0][0]).not.toHaveProperty("action");
  });
});
