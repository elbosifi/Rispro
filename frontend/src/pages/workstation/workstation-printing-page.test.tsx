import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkstationPrintingPage from "./workstation-printing-page";
import { WORKSTATION_NAPS2_SETTINGS_KEY } from "@/services/scanning/workstation-naps2-settings";

const { mockPushToast, mockGetNaps2WebScanStatus, mockFetchIntegrationStatus, mockScan, mockCreateObjectURL, mockRevokeObjectURL } = vi.hoisted(() => ({
  mockCreateObjectURL: vi.fn(),
  mockRevokeObjectURL: vi.fn(),
  mockScan: vi.fn(),
  mockPushToast: vi.fn(),
  mockGetNaps2WebScanStatus: vi.fn(),
  mockFetchIntegrationStatus: vi.fn(),
}));
const readyManifest = {
  ready: true,
  risproOrigin: "https://rispro.example.test",
  qzVersion: "2.2.6",
  qzInstallerArchitecture: "x86_64",
  signingCertificateFingerprint: "AA:BB:CC:DD",
  securePorts: [8181, 8282, 8383, 8484],
  windowsLauncherUrl: "https://rispro.example.test/api/public/printing-bootstrap/windows-launcher",
  windowsScriptUrl: "https://rispro.example.test/api/public/printing-bootstrap/windows-script",
  qzInstallerUrl: "https://rispro.example.test/api/public/printing-bootstrap/qz-installer",
  rootCertificateUrl: "https://rispro.example.test/api/public/printing-bootstrap/root-certificate",
  signingCertificateUrl: "https://rispro.example.test/api/public/printing-bootstrap/signing-certificate",
  windowsScriptSha256: "script-sha256-value",
  qzInstallerSha256: "installer-sha256-value",
};

vi.mock("@/pages/settings/qz-tray-printing-section", () => ({
  default: () => <section data-testid="qz-printer-settings">Existing QZ printer settings</section>,
}));

vi.mock("@/lib/toast", () => ({ pushToast: (...args: unknown[]) => mockPushToast(...args) }));
vi.mock("@/lib/api-hooks", () => ({ fetchIntegrationStatus: () => mockFetchIntegrationStatus() }));
vi.mock("@/lib/naps2-webscan", () => ({
  getNaps2WebScanStatus: (...args: unknown[]) => mockGetNaps2WebScanStatus(...args),
  normalizeNaps2Source: (value: unknown) => ["auto", "feeder", "flatbed", "duplex"].includes(String(value)) ? value : "feeder",
  scanAppointmentRequest: (...args: unknown[]) => mockScan(...args),
}));

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("WorkstationPrintingPage", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mockCreateObjectURL.mockReset().mockReturnValue("blob:naps2-setup") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mockRevokeObjectURL.mockReset() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mockScan.mockReset();
    mockScan.mockResolvedValue({ pageCount: 2, paperSourceUsed: "feeder" });
    mockPushToast.mockReset();
    mockGetNaps2WebScanStatus.mockReset();
    mockGetNaps2WebScanStatus.mockResolvedValue({ available: true, endpoint: "http://scanner:9801", kind: "naps2_direct" });
    mockFetchIntegrationStatus.mockReset();
    mockFetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEnabled: true, naps2WebScanEndpoint: "http://system-scanner:9801" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(readyManifest)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the ready manifest and uses every returned artifact URL", async () => {
    render(<WorkstationPrintingPage />);

    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/public/printing-bootstrap/manifest", { cache: "no-store" });
    expect(screen.getByText(readyManifest.risproOrigin)).toBeTruthy();
    expect(screen.getByText(readyManifest.qzVersion)).toBeTruthy();
    expect(screen.getByText(readyManifest.qzInstallerArchitecture)).toBeTruthy();
    expect(screen.getByText(readyManifest.signingCertificateFingerprint)).toBeTruthy();
    expect(screen.getAllByText("8181, 8282, 8383, 8484").length).toBeGreaterThan(0);

    const primary = screen.getByRole("link", { name: "Download and install RISpro Printing" });
    expect(primary.getAttribute("href")).toBe(readyManifest.windowsLauncherUrl);
    expect(primary.getAttribute("download")).toBe("RISpro-Printing-Setup.cmd");
    expect(screen.getByRole("link", { name: "PowerShell setup script" }).getAttribute("href")).toBe(readyManifest.windowsScriptUrl);
    expect(screen.getByRole("link", { name: "QZ Tray 2.2.6 installer" }).getAttribute("href")).toBe(readyManifest.qzInstallerUrl);
    expect(screen.getByRole("link", { name: "RISpro root certificate" }).getAttribute("href")).toBe(readyManifest.rootCertificateUrl);
    expect(screen.getByRole("link", { name: "RISpro signing certificate" }).getAttribute("href")).toBe(readyManifest.signingCertificateUrl);
    expect(document.querySelector('a[href*="private-key"]')).toBeNull();
    expect(document.body.textContent?.toLowerCase()).not.toContain("private key");
    expect(screen.getByTestId("qz-printer-settings")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Workstation printing and scanning" })).toBeTruthy();
    expect(await screen.findByText("System default")).toBeTruthy();
    expect(screen.getByText("http://system-scanner:9801")).toBeTruthy();
  });

  it("saves, displays, and resets the workstation scanner origin", async () => {
    render(<WorkstationPrintingPage />);
    const input = screen.getByLabelText("NAPS2 eSCL endpoint") as HTMLInputElement;
    fireEvent.change(input, { target: { value: " http://workstation-scanner:9801/ " } });
    fireEvent.click(screen.getByRole("button", { name: "Save workstation endpoint" }));

    expect(JSON.parse(localStorage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY) || "null").endpoint).toBe("http://workstation-scanner:9801");
    expect(await screen.findByText("Workstation override")).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("@echo off\r\nexit /b 0\r\n# RISPRO_NAPS2_POWERSHELL\r\n", { headers: { "Content-Type": "application/octet-stream" } }));
    fireEvent.click(screen.getByRole("button", { name: "Download NAPS2 setup" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/scanner-bootstrap/windows-setup?endpoint=http%3A%2F%2Fworkstation-scanner%3A9801", { cache: "no-store", redirect: "error" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to system default" }));
    expect(localStorage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY)).toBeNull();
    expect(await screen.findByText("System default")).toBeTruthy();
  });

  it("shows automatic localhost separately when no endpoint is configured", async () => {
    mockFetchIntegrationStatus.mockResolvedValueOnce({ scanner: { naps2WebScanEndpoint: "" } });
    render(<WorkstationPrintingPage />);
    expect(await screen.findByText("Automatic localhost discovery")).toBeTruthy();
    expect(screen.getByText("Automatic HTTP loopback discovery, ports 9801–9850")).toBeTruthy();
  });

  it("rejects malformed origins and tests the saved effective origin", async () => {
    render(<WorkstationPrintingPage />);
    const input = screen.getByLabelText("NAPS2 eSCL endpoint");
    fireEvent.change(input, { target: { value: "http://scanner:9801/eSCL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workstation endpoint" }));
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Invalid NAPS2 endpoint" }));

    fireEvent.change(input, { target: { value: "http://scanner:9801/" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workstation endpoint" }));
    await screen.findByText("Workstation override");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(mockGetNaps2WebScanStatus).toHaveBeenCalledWith("http://scanner:9801", undefined));
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("shows diagnostics and reports copy success and failure through toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<WorkstationPrintingPage />);
    await screen.findByText("Ready");

    fireEvent.click(screen.getByText("Advanced diagnostics"));
    expect(screen.getByText(readyManifest.windowsScriptSha256)).toBeTruthy();
    expect(screen.getByText(readyManifest.qzInstallerSha256)).toBeTruthy();
    expect(screen.getAllByText(readyManifest.signingCertificateFingerprint).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Copy manifest URL" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/api/public/printing-bootstrap/manifest"));
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Copied" }));

    writeText.mockRejectedValueOnce(new Error("Clipboard denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy setup log path" }));
    await waitFor(() => expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Copy failed", message: "Clipboard denied" })));
  });

  it("shows the backend reason, disables unavailable downloads, and retries the manifest", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ready: false, reason: "Installer cache is unavailable." }))
      .mockResolvedValueOnce(response(readyManifest));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkstationPrintingPage />);

    expect(await screen.findByText("Installer cache is unavailable.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download and install RISpro Printing" })).toBeNull();
    expect(screen.getByText("Download and install RISpro Printing").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("link", { name: "Download and install RISpro Printing" })).toBeTruthy();
  });
  it("tests the system endpoint immediately after resetting an override", async () => {
    localStorage.setItem(WORKSTATION_NAPS2_SETTINGS_KEY, JSON.stringify({ version: 1, endpoint: "http://old:9801", updatedAt: new Date().toISOString() }));
    render(<WorkstationPrintingPage />);
    await screen.findByText("Workstation override");
    await waitFor(() => expect((screen.getByRole("button", { name: "Test connection" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Reset to system default" }));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(mockGetNaps2WebScanStatus).toHaveBeenCalledWith("http://system-scanner:9801", undefined));
    expect(mockScan).not.toHaveBeenCalled();
  });
  it("keeps global enablement distinct from connection and physical test scan", async () => {
    mockFetchIntegrationStatus.mockResolvedValueOnce({ scanner: {
      naps2WebScanEnabled: true,
      naps2WebScanEndpoint: "http://system-scanner:9801",
      scannerSource: "auto",
      scanDpi: "300",
      scanColorMode: "color",
    } });
    mockScan.mockResolvedValueOnce({ pageCount: 2, paperSourceUsed: "flatbed" });
    render(<WorkstationPrintingPage />);
    expect(screen.getByText("Not tested on this workstation")).toBeTruthy();
    await screen.findByText("Enabled");
    expect(screen.getByText("No test scan completed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download NAPS2 setup" })).toBeTruthy();
    const advanced = screen.getByText("Advanced endpoint override").closest("details")!;
    expect(advanced.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Test scan" }));
    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(1));
    expect(mockScan).toHaveBeenCalledWith(expect.objectContaining({ source: "auto", dpi: 300, colorMode: "color" }));
    expect(await screen.findByText(/Test scan succeeded: 2 pages \(Flatbed; feeder empty\)\./)).toBeTruthy();
    expect(screen.getByText(/No patient document was uploaded or linked/)).toBeTruthy();
  });

  it("shows a server configuration error without creating or downloading a CMD, then supports retry", async () => {
    render(<WorkstationPrintingPage />);
    await screen.findByText("Enabled");
    const message = "Set the RISpro HTTP address in Settings > Documents & Uploads > NAPS2, save, then download again.";
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message, details: null } }), { status: 503, headers: { "Content-Type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: "Download NAPS2 setup" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();

    const script = "@echo off\r\nexit /b 0\r\n# RISPRO_NAPS2_POWERSHELL\r\n";
    vi.mocked(fetch).mockResolvedValueOnce(new Response(script, { headers: { "Content-Type": "application/octet-stream" } }));
    fireEvent.click(screen.getByRole("button", { name: "Download NAPS2 setup" }));
    await waitFor(() => expect(mockCreateObjectURL).toHaveBeenCalledTimes(1));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    const link = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0] as HTMLAnchorElement;
    expect(link.download).toBe("RISpro-NAPS2-Setup.cmd");
    expect(link.href).toBe("blob:naps2-setup");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { type: "application/json", body: '{"error":{"message":"proxy error"}}' },
    { type: "text/html", body: '<html>Sign in</html>' },
    { type: "application/octet-stream", body: '{"error":{"message":"proxy error"}}' },
  ])("rejects a successful HTTP response that contains $type error content", async ({ type, body }) => {
    render(<WorkstationPrintingPage />);
    await screen.findByText("Enabled");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { headers: { "Content-Type": type } }));
    fireEvent.click(screen.getByRole("button", { name: "Download NAPS2 setup" }));
    expect((await screen.findByRole("alert")).textContent).toContain("invalid NAPS2 setup file");
    expect(mockCreateObjectURL).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

});
