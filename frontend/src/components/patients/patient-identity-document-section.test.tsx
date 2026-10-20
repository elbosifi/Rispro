import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { PatientIdentityDocumentSection } from "./patient-identity-document-section";

const {
  fetchState,
  uploadDocument,
  verifyDocument,
  revokeDocument,
  fetchIntegrationStatus,
  scanAppointmentRequest,
  resolveEffectiveNaps2Endpoint,
  pushToast,
  currentUser,
} = vi.hoisted(() => ({
  fetchState: vi.fn(),
  uploadDocument: vi.fn(),
  verifyDocument: vi.fn(),
  revokeDocument: vi.fn(),
  fetchIntegrationStatus: vi.fn(),
  scanAppointmentRequest: vi.fn(),
  resolveEffectiveNaps2Endpoint: vi.fn(),
  pushToast: vi.fn(),
  currentUser: { role: "receptionist" as string },
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: currentUser }),
}));
vi.mock("@/lib/api/patient-identity-documents", () => ({
  fetchPatientIdentityDocument: fetchState,
  uploadPatientIdentityDocument: uploadDocument,
  verifyPatientIdentityDocument: verifyDocument,
  revokePatientIdentityDocument: revokeDocument,
}));
vi.mock("@/lib/api-hooks", () => ({ fetchIntegrationStatus }));
vi.mock("@/lib/naps2-webscan", () => ({ scanAppointmentRequest }));
vi.mock("@/services/scanning/workstation-naps2-settings", () => ({ resolveEffectiveNaps2Endpoint }));
vi.mock("@/lib/toast", () => ({ pushToast }));

function renderSection(patientId = 7) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <PatientIdentityDocumentSection patientId={patientId} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe("PatientIdentityDocumentSection", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.removeItem("rispro-language");
  });

  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    currentUser.role = "receptionist";
    fetchState.mockReset();
    uploadDocument.mockReset();
    verifyDocument.mockReset();
    revokeDocument.mockReset();
    fetchIntegrationStatus.mockReset();
    scanAppointmentRequest.mockReset();
    resolveEffectiveNaps2Endpoint.mockReset();
    pushToast.mockReset();
    fetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEnabled: false } });
    resolveEffectiveNaps2Endpoint.mockReturnValue({ endpoint: "http://localhost:9801", source: "localhost" });
    uploadDocument.mockResolvedValue(undefined);
  });

  it("shows Scan Paper for an authorized role when NAPS2 is enabled", async () => {
    fetchState.mockResolvedValue({ status: "not_uploaded", document: null });
    fetchIntegrationStatus.mockResolvedValue({
      scanner: { naps2WebScanEnabled: true },
    });

    renderSection();

    expect(await screen.findByRole("button", { name: "Scan Paper" })).toBeTruthy();
  });

  it("passes workstation scanner settings and uploads one scanned PDF for the current patient", async () => {
    const scannedFile = new File(["scanned-pdf"], "identity.pdf", { type: "application/pdf" });
    fetchState
      .mockResolvedValueOnce({ status: "not_uploaded", document: null })
      .mockResolvedValue({
        status: "pending",
        document: {
          id: 12,
          originalFilename: "patient-7-identity.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-20T10:00:00.000Z",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
        },
      });
    fetchIntegrationStatus.mockResolvedValue({
      scanner: {
        naps2WebScanEnabled: true,
        naps2WebScanEndpoint: "http://scanner:9803",
        naps2WebScanAllowedOrigins: ["http://scanner:9803"],
        scanDpi: "300",
        scanColorMode: "color",
        scannerSource: "duplex",
      },
    });
    resolveEffectiveNaps2Endpoint.mockReturnValue({ endpoint: "http://workstation:9803", source: "workstation" });
    scanAppointmentRequest.mockResolvedValue({
      file: scannedFile,
      files: [scannedFile],
      pageCount: 1,
      source: "naps2_webscan",
    });

    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => {
      expect(resolveEffectiveNaps2Endpoint).toHaveBeenCalledWith("http://scanner:9803");
      expect(scanAppointmentRequest).toHaveBeenCalledWith({
        endpoint: "http://workstation:9803",
        allowedOrigins: ["http://scanner:9803"],
        dpi: 300,
        colorMode: "color",
        source: "duplex",
        fileName: "patient-7-identity.pdf",
      });
      expect(uploadDocument).toHaveBeenCalledWith(7, scannedFile, "naps2_webscan");
    });
    expect(await screen.findByText("Awaiting verification")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Verified identity" })).toBeNull();
  });

  it("requires the replacement confirmation before scanning a verified ID", async () => {
    const scannedFile = new File(["scanned-pdf"], "replacement.pdf", { type: "application/pdf" });
    fetchState
      .mockResolvedValueOnce({
        status: "verified",
        document: {
          id: 9,
          originalFilename: "national-id.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-19T10:00:00.000Z",
          verifiedAt: "2026-10-19T10:05:00.000Z",
          verifiedByUserId: 3,
          verifiedByName: "Supervisor",
        },
      })
      .mockResolvedValue({
        status: "pending",
        document: {
          id: 10,
          originalFilename: "replacement.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-20T10:00:00.000Z",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
        },
      });
    fetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEnabled: true } });
    scanAppointmentRequest.mockResolvedValue({ file: scannedFile, files: [scannedFile], pageCount: 1, source: "naps2_webscan" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledWith(7, scannedFile, "naps2_webscan"));
    expect(confirm).toHaveBeenCalledWith("Replacing the ID will reset identity verification. Continue?");
    expect(await screen.findByText("Awaiting verification")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Verified identity" })).toBeNull();
  });

  it("rejects multiple scanned files before uploading any file", async () => {
    const firstFile = new File(["first"], "first.pdf", { type: "application/pdf" });
    const secondFile = new File(["second"], "second.pdf", { type: "application/pdf" });
    fetchState.mockResolvedValue({ status: "not_uploaded", document: null });
    fetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEnabled: true } });
    scanAppointmentRequest.mockResolvedValue({
      file: firstFile,
      files: [firstFile, secondFile],
      pageCount: 2,
      source: "naps2_webscan",
    });

    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => {
      expect(uploadDocument).not.toHaveBeenCalled();
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
        message: "Scanning returned multiple files. Ask the scanner operator to scan one combined PDF and try again.",
      }));
    });
  });

  it("does not upload a scan if the drawer switches patients while scanning", async () => {
    let resolveScan!: (result: unknown) => void;
    const scanPromise = new Promise((resolve) => {
      resolveScan = resolve;
    });
    const scannedFile = new File(["scanned-pdf"], "identity.pdf", { type: "application/pdf" });
    fetchState.mockImplementation(async (id: number) => ({
      status: "not_uploaded",
      document: null,
      id,
    }));
    fetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEnabled: true } });
    scanAppointmentRequest.mockReturnValue(scanPromise);

    const rendered = renderSection(7);
    fireEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <LanguageProvider>
          <PatientIdentityDocumentSection patientId={8} />
        </LanguageProvider>
      </QueryClientProvider>,
    );
    resolveScan({ file: scannedFile, files: [scannedFile], pageCount: 1, source: "naps2_webscan" });

    await waitFor(() => {
      expect(uploadDocument).not.toHaveBeenCalled();
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
        message: "The patient drawer changed during scanning. The scanned file was not uploaded.",
      }));
    });
  });

  it("does not change verification when scanning or upload fails", async () => {
    const verifiedState = {
      status: "verified" as const,
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: "2026-10-19T10:05:00.000Z",
        verifiedByUserId: 3,
        verifiedByName: "Supervisor",
      },
    };
    fetchState.mockResolvedValue(verifiedState);
    fetchIntegrationStatus.mockResolvedValue({ scanner: { naps2WebScanEnabled: true } });
    scanAppointmentRequest.mockRejectedValueOnce(new Error("scanner offline"));
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const firstRender = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "scanner offline" })));
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(await firstRender.findByRole("img", { name: "Verified identity" })).toBeTruthy();

    cleanup();
    pushToast.mockReset();
    const scannedFile = new File(["scanned-pdf"], "identity.pdf", { type: "application/pdf" });
    scanAppointmentRequest.mockResolvedValue({ file: scannedFile, files: [scannedFile], pageCount: 1, source: "naps2_webscan" });
    uploadDocument.mockRejectedValueOnce(new Error("upload failed"));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ message: "upload failed" })));
    expect(await screen.findByRole("img", { name: "Verified identity" })).toBeTruthy();
    expect(fetchState).toHaveBeenCalledTimes(2);
  });

  it("does not expose Scan Paper to unauthorized roles", async () => {
    currentUser.role = "doctor";
    renderSection();
    expect(screen.queryByRole("button", { name: "Scan Paper" })).toBeNull();
    expect(fetchIntegrationStatus).not.toHaveBeenCalled();
  });

  it("requires the confirmation checkbox before verification", async () => {
    fetchState.mockResolvedValue({
      status: "pending",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
      },
    });
    verifyDocument.mockResolvedValue({ status: "verified", document: null });

    renderSection();
    const verifyButton = await screen.findByRole("button", { name: "Verify Identity" });
    expect(verifyButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(verifyButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(verifyButton);
    await waitFor(() => expect(verifyDocument).toHaveBeenCalledWith(7, 9));
  });

  it("does not show revoke to receptionists", async () => {
    fetchState.mockResolvedValue({
      status: "verified",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: "2026-10-19T10:05:00.000Z",
        verifiedByUserId: 3,
        verifiedByName: "Supervisor",
      },
    });

    renderSection();
    await screen.findByRole("img", { name: "Verified identity" });
    expect(screen.queryByRole("button", { name: "Revoke Verification" })).toBeNull();
  });

  it("shows revoke to supervisors", async () => {
    currentUser.role = "supervisor";
    fetchState.mockResolvedValue({
      status: "verified",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: "2026-10-19T10:05:00.000Z",
        verifiedByUserId: 3,
        verifiedByName: "Supervisor",
      },
    });

    renderSection();
    expect(await screen.findByRole("button", { name: "Revoke Verification" })).toBeTruthy();
  });

  it("confirmation resets when a newer identity document is loaded", async () => {
    fetchState
      .mockResolvedValueOnce({
        status: "pending",
        document: {
          id: 9,
          originalFilename: "national-id-9.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-19T10:00:00.000Z",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
        },
      })
      .mockResolvedValueOnce({
        status: "pending",
        document: {
          id: 10,
          originalFilename: "national-id-10.pdf",
          mimeType: "application/pdf",
          uploadedAt: "2026-10-19T10:01:00.000Z",
          verifiedAt: null,
          verifiedByUserId: null,
          verifiedByName: null,
        },
      });

    const { queryClient } = renderSection(7);
    const verifyButton = await screen.findByRole("button", { name: "Verify Identity" });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;

    fireEvent.click(checkbox);
    expect(verifyButton.hasAttribute("disabled")).toBe(false);

    await queryClient.invalidateQueries({ queryKey: ["patient-identity-document", 7] });
    await screen.findByText("national-id-10.pdf");

    await waitFor(() => {
      expect(checkbox.checked).toBe(false);
      expect(verifyButton.hasAttribute("disabled")).toBe(true);
    });

    fireEvent.click(checkbox);
    expect(verifyButton.hasAttribute("disabled")).toBe(false);
  });

  it("confirmation does not transfer between patients", async () => {
    fetchState.mockImplementation(async (patientId: number) => ({
      status: "pending",
      document: {
        id: patientId === 7 ? 9 : 11,
        originalFilename: `national-id-${patientId}.pdf`,
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
      },
    }));

    const rendered = renderSection(7);
    const verifyButton = await screen.findByRole("button", { name: "Verify Identity" });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(verifyButton.hasAttribute("disabled")).toBe(false);

    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <LanguageProvider>
          <PatientIdentityDocumentSection patientId={8} />
        </LanguageProvider>
      </QueryClientProvider>,
    );

    await screen.findByText("national-id-8.pdf");
    const currentCheckbox = screen.getByRole("checkbox") as HTMLInputElement;
    const currentVerifyButton = screen.getByRole("button", { name: "Verify Identity" });
    await waitFor(() => {
      expect(currentCheckbox.checked).toBe(false);
      expect(currentVerifyButton.hasAttribute("disabled")).toBe(true);
    });
    expect(verifyDocument).not.toHaveBeenCalled();
  });

  it("invalidates appointment badge queries after verification", async () => {
    fetchState.mockResolvedValue({
      status: "pending",
      document: {
        id: 9,
        originalFilename: "national-id.pdf",
        mimeType: "application/pdf",
        uploadedAt: "2026-10-19T10:00:00.000Z",
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
      },
    });
    verifyDocument.mockResolvedValue({ status: "verified", document: null });

    const { queryClient } = renderSection();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify Identity" }));

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["registrations"] });
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["appointment-manage-modal"] });
    });
  });
});
