import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkstationPrintingPage from "./workstation-printing-page";
import { WORKSTATION_NAPS2_SETTINGS_KEY } from "@/services/scanning/workstation-naps2-settings";

const { mockPushToast, mockGetNaps2WebScanStatus, mockFetchIntegrationStatus } = vi.hoisted(() => ({
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
vi.mock("@/lib/naps2-webscan", () => ({ getNaps2WebScanStatus: (endpoint: string) => mockGetNaps2WebScanStatus(endpoint) }));

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("WorkstationPrintingPage", () => {
  beforeEach(() => {
    localStorage.clear();
    mockPushToast.mockReset();
    mockGetNaps2WebScanStatus.mockReset();
    mockGetNaps2WebScanStatus.mockResolvedValue({ available: true, endpoint: "http://scanner:9801", kind: "naps2_direct" });
    mockFetchIntegrationStatus.mockReset();
    mockFetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEndpoint: "http://system-scanner:9801" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(readyManifest)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    fireEvent.click(screen.getByRole("button", { name: "Reset to system default" }));
    expect(localStorage.getItem(WORKSTATION_NAPS2_SETTINGS_KEY)).toBeNull();
    expect(await screen.findByText("System default")).toBeTruthy();
  });

  it("shows automatic localhost separately when no endpoint is configured", async () => {
    mockFetchIntegrationStatus.mockResolvedValueOnce({ scanner: { naps2WebScanEndpoint: "" } });
    render(<WorkstationPrintingPage />);
    expect(await screen.findByText("Automatic localhost probe")).toBeTruthy();
    expect(screen.getByText("http://127.0.0.1:9801, then http://localhost:9801")).toBeTruthy();
  });

  it("rejects malformed origins and tests the normalized entered origin", async () => {
    render(<WorkstationPrintingPage />);
    const input = screen.getByLabelText("NAPS2 eSCL endpoint");
    fireEvent.change(input, { target: { value: "http://scanner:9801/eSCL" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workstation endpoint" }));
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Invalid NAPS2 endpoint" }));

    fireEvent.change(input, { target: { value: "http://scanner:9801/" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(mockGetNaps2WebScanStatus).toHaveBeenCalledWith("http://scanner:9801"));
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "NAPS2 connection available" }));
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
});
