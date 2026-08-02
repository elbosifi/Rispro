import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkstationPrintingPage from "./workstation-printing-page";

const mockPushToast = vi.fn();
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

function response(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("WorkstationPrintingPage", () => {
  beforeEach(() => {
    mockPushToast.mockReset();
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
