import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider";
import { RequestDocumentsPanel } from "./request-documents-panel";

const mockListAppointmentDocuments = vi.fn<(appointmentId: number, appointmentRefType?: string) => Promise<unknown[]>>(async () => []);
const mockUploadAppointmentDocument = vi.fn<(payload: unknown) => Promise<unknown>>(async () => ({
  id: 1,
  patientId: 9,
  appointmentId: null,
  v2BookingId: 42,
  documentType: "referral_request",
  originalFilename: "scan.pdf",
  storedPath: "documents/scan.pdf",
  mimeType: "application/pdf",
  fileSize: 128,
  storageLocationType: "local_fallback",
  lastMoveAttemptAt: null,
  lastMoveError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
}));
const mockDeleteAppointmentDocument = vi.fn<(documentId: number) => Promise<{ deleted: boolean; documentId: number }>>(
  async () => ({ deleted: true, documentId: 1 })
);
const mockPrepareScanSession = vi.fn<(payload: unknown) => Promise<unknown>>(async () => ({
  preparation: {
    documentType: "appointment_request",
    suggestedFileName: "V2-42-appointment_request.pdf",
    scanFileFormat: "pdf",
    sessionCode: "SCAN-TEST",
    guidance: "Ready to scan",
  },
}));
const mockCreateScanSession = vi.fn<(payload: unknown) => Promise<unknown>>(async () => ({
  launchUrl: "rispro-scanner://scan?token=test-token",
  expiresAt: "2026-01-01T00:15:00.000Z",
  fallbackUploadAllowed: true,
}));
const mockScanAppointmentRequest = vi.fn<(customOptions?: unknown) => Promise<{ file: File; pageCount: number; source: "naps2_webscan" }>>(
  async () => ({
    file: new File([new Blob(["page-1"], { type: "application/pdf" })], "scan.pdf", { type: "application/pdf" }),
    pageCount: 1,
    source: "naps2_webscan",
  })
);
const mockFetchCurrentSession = vi.fn(async () => ({
  id: 1,
  role: "receptionist",
  username: "front",
  fullName: "Front Desk",
}));
const mockFetchIntegrationStatus = vi.fn(async () => ({
  scanner: {
    referralUploadEnabled: true,
    allowedFileTypes: ["pdf", "jpg", "png"],
    documentLinkScope: "patient_and_appointment",
    scannerBridgeMode: "naps2_webscan",
    scannerProfileName: "default",
    scannerSource: "feeder",
    scanDpi: "200",
    scanColorMode: "grayscale",
    scanFileFormat: "pdf",
    bridgeReady: true,
    naps2WebScanEnabled: true,
    naps2WebScanEndpoint: "",
    scannerAppEnabled: false,
    scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
    scanSessionExpiryMinutes: "15",
  },
}));

vi.mock("@/lib/api-hooks", () => ({
  listAppointmentDocuments: (appointmentId: number, appointmentRefType?: string) =>
    mockListAppointmentDocuments(appointmentId, appointmentRefType),
  uploadAppointmentDocument: (payload: unknown) => mockUploadAppointmentDocument(payload),
  deleteAppointmentDocument: (documentId: number) => mockDeleteAppointmentDocument(documentId),
  prepareScanSession: (payload: unknown) => mockPrepareScanSession(payload),
  createScanSession: (payload: unknown) => mockCreateScanSession(payload),
  fetchCurrentSession: () => mockFetchCurrentSession(),
  fetchIntegrationStatus: () => mockFetchIntegrationStatus(),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
}));

vi.mock("@/lib/naps2-webscan", () => ({
  scanAppointmentRequest: (customOptions?: unknown) => mockScanAppointmentRequest(customOptions),
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RequestDocumentsPanel
          appointmentId={42}
          patientId={9}
          appointmentRefType="v2_booking"
          enableLocalScan
        />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function renderPanelWithoutLocalScan() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RequestDocumentsPanel
          appointmentId={42}
          patientId={9}
          appointmentRefType="v2_booking"
        />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

describe("RequestDocumentsPanel local scan flow", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    mockListAppointmentDocuments.mockReset();
    mockUploadAppointmentDocument.mockReset();
    mockDeleteAppointmentDocument.mockReset();
    mockPrepareScanSession.mockReset();
    mockCreateScanSession.mockReset();
    mockScanAppointmentRequest.mockReset();
    mockFetchCurrentSession.mockClear();
    mockFetchIntegrationStatus.mockClear();

    mockListAppointmentDocuments.mockResolvedValue([]);
    mockPrepareScanSession.mockResolvedValue({
      preparation: {
        documentType: "appointment_request",
        suggestedFileName: "V2-42-appointment_request.pdf",
        scanFileFormat: "pdf",
        sessionCode: "SCAN-TEST",
        guidance: "Ready to scan",
      },
    });
    mockCreateScanSession.mockResolvedValue({
      launchUrl: "rispro-scanner://scan?token=test-token",
      expiresAt: "2026-01-01T00:15:00.000Z",
      fallbackUploadAllowed: true,
    });
    mockScanAppointmentRequest.mockResolvedValue({
      file: new File([new Blob(["page-1"], { type: "application/pdf" })], "scan.pdf", { type: "application/pdf" }),
      pageCount: 1,
      source: "naps2_webscan",
    });
    mockUploadAppointmentDocument.mockResolvedValue({
      id: 1,
      patientId: 9,
      appointmentId: null,
      v2BookingId: 42,
      documentType: "referral_request",
      originalFilename: "scan.pdf",
      storedPath: "documents/scan.pdf",
      mimeType: "application/pdf",
      fileSize: 128,
      storageLocationType: "local_fallback",
      lastMoveAttemptAt: null,
      lastMoveError: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchCurrentSession.mockResolvedValue({
      id: 1,
      role: "receptionist",
      username: "front",
      fullName: "Front Desk",
    });
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true,
        allowedFileTypes: ["pdf", "jpg", "png"],
        documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "naps2_webscan",
        scannerProfileName: "default",
        scannerSource: "feeder",
        scanDpi: "200",
        scanColorMode: "grayscale",
        scanFileFormat: "pdf",
        bridgeReady: true,
        naps2WebScanEnabled: true,
        naps2WebScanEndpoint: "",
        scannerAppEnabled: false,
        scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
        scanSessionExpiryMinutes: "15",
      },
    });
  });

  it("prepares scan and uploads a NAPS2 scanned appointment request through existing document upload API", async () => {
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Scan Appointment Request" }));

    await waitFor(() => {
      expect(mockPrepareScanSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(1);
    });

    expect(mockPrepareScanSession).toHaveBeenCalledWith({
      appointmentId: 42,
      patientId: 9,
      documentType: "appointment_request",
      appointmentRefType: "v2_booking",
    });
    expect(mockScanAppointmentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        dpi: 200,
        colorMode: "grayscale",
        source: "feeder",
        endpoint: "",
      })
    );
    expect(mockUploadAppointmentDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 9,
        appointmentId: 42,
        appointmentRefType: "v2_booking",
        documentType: "appointment_request",
        mimeType: "application/pdf",
        source: "naps2_webscan",
      })
    );
  });

  it("shows the NAPS2 scan button when the feature is enabled and user has access", async () => {
    renderPanel();

    expect(await screen.findByRole("button", { name: "Scan Appointment Request" })).toBeTruthy();
  });

  it("creates a durable scan session and shows scanner app fallback actions", async () => {
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true,
        allowedFileTypes: ["pdf", "jpg", "png"],
        documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "naps2_webscan",
        scannerProfileName: "default",
        scannerSource: "feeder",
        scanDpi: "200",
        scanColorMode: "grayscale",
        scanFileFormat: "pdf",
        bridgeReady: true,
        naps2WebScanEnabled: true,
        naps2WebScanEndpoint: "",
        scannerAppEnabled: true,
        scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
        scanSessionExpiryMinutes: "15",
      },
    });

    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => {
      expect(mockCreateScanSession).toHaveBeenCalledWith({
        appointmentId: 42,
        patientId: 9,
        documentType: "appointment_request",
        appointmentRefType: "v2_booking",
      });
    });
    expect(await screen.findByText("Download Scanner App")).toBeTruthy();
    expect(await screen.findByText("Retry Launch")).toBeTruthy();
    expect(await screen.findByText("Use NAPS2.WebScan")).toBeTruthy();
  });

  it("does not show the NAPS2 scan action when local scan is disabled", async () => {
    renderPanelWithoutLocalScan();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Scan Appointment Request" })).toBeNull();
    });
  });

  it("shows manual upload fallback when NAPS2 is unavailable", async () => {
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true,
        allowedFileTypes: ["pdf", "jpg", "png"],
        documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "manual_browser_upload",
        scannerProfileName: "default",
        scannerSource: "feeder",
        scanDpi: "200",
        scanColorMode: "grayscale",
        scanFileFormat: "pdf",
        bridgeReady: false,
        naps2WebScanEnabled: false,
        naps2WebScanEndpoint: "",
        scannerAppEnabled: false,
        scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
        scanSessionExpiryMinutes: "15",
      },
    });

    renderPanel();

    expect(await screen.findByText("NAPS2.WebScan is not available on this workstation. Upload PDF/image instead.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scan Appointment Request" })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach Request" })).toBeTruthy();
  });

  it("passes configured RISpro Scanner Bridge endpoint from integration status to scanner adapter", async () => {
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true,
        allowedFileTypes: ["pdf", "jpg", "png"],
        documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "naps2_webscan",
        scannerProfileName: "default",
        scannerSource: "feeder",
        scanDpi: "200",
        scanColorMode: "grayscale",
        scanFileFormat: "pdf",
        bridgeReady: true,
        naps2WebScanEnabled: true,
        naps2WebScanEndpoint: "http://localhost:9810",
        scannerAppEnabled: false,
        scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
        scanSessionExpiryMinutes: "15",
      },
    });

    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Scan Appointment Request" }));

    await waitFor(() => {
      expect(mockScanAppointmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "http://localhost:9810" })
      );
    });
  });

  it("keeps scan action hidden when only an endpoint is configured but scanning is disabled", async () => {
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true,
        allowedFileTypes: ["pdf", "jpg", "png"],
        documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "manual_browser_upload",
        scannerProfileName: "default",
        scannerSource: "feeder",
        scanDpi: "200",
        scanColorMode: "grayscale",
        scanFileFormat: "pdf",
        bridgeReady: false,
        naps2WebScanEnabled: false,
        naps2WebScanEndpoint: "http://localhost:9810",
        scannerAppEnabled: false,
        scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi",
        scanSessionExpiryMinutes: "15",
      },
    });

    renderPanel();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Scan Appointment Request" })).toBeNull();
    });
  });

  it("keeps failed scanned uploads retryable through the same upload API", async () => {
    mockScanAppointmentRequest.mockResolvedValue({
      file: new File([new Blob(["retry-me"], { type: "application/pdf" })], "scan.pdf", { type: "application/pdf" }),
      pageCount: 1,
      source: "naps2_webscan",
    });
    mockUploadAppointmentDocument
      .mockRejectedValueOnce(new Error("Temporary upload failure"))
      .mockResolvedValueOnce({
        id: 2,
        patientId: 9,
        appointmentId: null,
        v2BookingId: 42,
        documentType: "referral_request",
        originalFilename: "scan.pdf",
        storedPath: "documents/scan.pdf",
        mimeType: "application/pdf",
        fileSize: 128,
        storageLocationType: "local_fallback",
        lastMoveAttemptAt: null,
        lastMoveError: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: "Scan Appointment Request" }));

    await waitFor(() => {
      expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("button", { name: "Retry failed uploads" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Retry failed uploads" }));

    await waitFor(() => {
      expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry failed uploads" })).toBeNull();
    });
  });
});
