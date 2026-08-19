import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/providers/language-provider-component";
import { RequestDocumentsPanel } from "./request-documents-panel";
import { saveWorkstationNaps2Settings, WORKSTATION_NAPS2_SETTINGS_KEY } from "@/services/scanning/workstation-naps2-settings";

const mockListAppointmentDocuments = vi.fn<(appointmentId: number, appointmentRefType?: string) => Promise<unknown[]>>(async () => []);
const mockFetchRequestDocumentProtocolPolicy = vi.fn<
  (appointmentId?: number) => Promise<{ requireRequestDocumentForProtocolQueue: boolean; protocolQueueAppliesToAppointment: boolean | null; hasQualifyingRequestDocument: boolean | null }>
>(async () => ({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null }));
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
const mockScanAppointmentRequest = vi.fn<(customOptions?: unknown) => Promise<{ file: File; files?: File[]; pageCount: number; source: "naps2_webscan" }>>(
  async () => ({
    file: new File([new Blob(["page-1"], { type: "application/pdf" })], "scan.pdf", { type: "application/pdf" }),
    pageCount: 1,
    source: "naps2_webscan",
  })
);
const mockListProtocolDocumentAnnotations = vi.fn<(documentId?: number) => Promise<unknown[]>>(async (documentId) => { void documentId; return []; });
const mockCreateProtocolDocumentAnnotation = vi.fn<(documentId: number, payload: unknown) => Promise<unknown>>(async (documentId, payload) => ({ id: 11, documentId, ...(payload as object), createdByUserId: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
const mockUpdateProtocolDocumentAnnotation = vi.fn<(documentId: number, annotationId: number, payload: unknown) => Promise<unknown>>(async (documentId, annotationId, payload) => ({ id: annotationId, documentId, ...(payload as object), createdByUserId: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
const mockDeleteProtocolDocumentAnnotation = vi.fn(async (documentId: number, annotationId: number) => { void documentId; void annotationId; });
const { mockPushToast } = vi.hoisted(() => ({ mockPushToast: vi.fn() }));
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
  fetchRequestDocumentProtocolPolicy: (appointmentId?: number) => mockFetchRequestDocumentProtocolPolicy(appointmentId),
  uploadAppointmentDocument: (payload: unknown) => mockUploadAppointmentDocument(payload),
  deleteAppointmentDocument: (documentId: number) => mockDeleteAppointmentDocument(documentId),
  prepareScanSession: (payload: unknown) => mockPrepareScanSession(payload),
  createScanSession: (payload: unknown) => mockCreateScanSession(payload),
  fetchCurrentSession: () => mockFetchCurrentSession(),
  fetchIntegrationStatus: () => mockFetchIntegrationStatus(),
  listProtocolDocumentAnnotations: (documentId: number) => mockListProtocolDocumentAnnotations(documentId),
  createProtocolDocumentAnnotation: (documentId: number, payload: unknown) => mockCreateProtocolDocumentAnnotation(documentId, payload),
  updateProtocolDocumentAnnotation: (documentId: number, annotationId: number, payload: unknown) => mockUpdateProtocolDocumentAnnotation(documentId, annotationId, payload),
  deleteProtocolDocumentAnnotation: (documentId: number, annotationId: number) => mockDeleteProtocolDocumentAnnotation(documentId, annotationId),
}));

vi.mock("@/lib/toast", () => ({ pushToast: mockPushToast }));

vi.mock("@/lib/naps2-webscan", () => ({
  scanAppointmentRequest: (customOptions?: unknown) => mockScanAppointmentRequest(customOptions),
}));

function renderPanel(options: { previewMode?: "link" | "modal" | "inline"; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; layout?: "default" | "workspace"; supplementaryPanel?: ReactNode; workspaceRailSize?: "standard" | "wide"; supplementaryPanelPlacement?: "before-documents" | "after-documents"; hideSatisfiedProtocolEligibilityStatus?: boolean; enableAnnotations?: boolean; readOnly?: boolean; onDocumentsChanged?: () => void; newDocumentType?: "appointment_request" | "clinical_document" } = {}) {
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

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <RequestDocumentsPanel
          appointmentId={42}
          patientId={9}
          appointmentRefType="v2_booking"
          previewMode={options.previewMode}
          enableLocalScan
          expanded={options.expanded}
          onExpandedChange={options.onExpandedChange}
          layout={options.layout}
          supplementaryPanel={options.supplementaryPanel}
          workspaceRailSize={options.workspaceRailSize}
          supplementaryPanelPlacement={options.supplementaryPanelPlacement}
          hideSatisfiedProtocolEligibilityStatus={options.hideSatisfiedProtocolEligibilityStatus}
          enableAnnotations={options.enableAnnotations}
          readOnly={options.readOnly}
          onDocumentsChanged={options.onDocumentsChanged}
          newDocumentType={options.newDocumentType}
        />
      </LanguageProvider>
    </QueryClientProvider>
  );
  return { ...rendered, queryClient };
}

function renderControlledExpandedPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Harness() {
    const [expanded, setExpanded] = useState(false);
    return (
      <RequestDocumentsPanel
        appointmentId={42}
        patientId={9}
        appointmentRefType="v2_booking"
        previewMode="inline"
        enableLocalScan
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <Harness />
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

function setMobileViewport(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
}

function documentFixture(id: number, filename: string, mimeType: string) {
  return {
    id,
    patientId: 9,
    appointmentId: null,
    v2BookingId: 42,
    documentType: "appointment_request",
    originalFilename: filename,
    storedPath: "",
    mimeType,
    fileSize: 128,
    storageLocationType: "local_fallback",
    source: "manual_upload",
    lastMoveAttemptAt: null,
    lastMoveError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("RequestDocumentsPanel local scan flow", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    localStorage.removeItem(WORKSTATION_NAPS2_SETTINGS_KEY);
    setMobileViewport(false);
    mockListAppointmentDocuments.mockReset();
    mockFetchRequestDocumentProtocolPolicy.mockReset();
    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: false, protocolQueueAppliesToAppointment: null, hasQualifyingRequestDocument: null });
    mockUploadAppointmentDocument.mockReset();
    mockDeleteAppointmentDocument.mockReset();
    mockPrepareScanSession.mockReset();
    mockCreateScanSession.mockReset();
    mockScanAppointmentRequest.mockReset();
    mockListProtocolDocumentAnnotations.mockReset();
    mockCreateProtocolDocumentAnnotation.mockReset();
    mockUpdateProtocolDocumentAnnotation.mockReset();
    mockDeleteProtocolDocumentAnnotation.mockReset();
    mockPushToast.mockReset();
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
    mockListProtocolDocumentAnnotations.mockResolvedValue([]);
    mockCreateProtocolDocumentAnnotation.mockImplementation(async (_documentId: number, payload: unknown) => ({ id: 11, documentId: 1, ...(payload as object), createdByUserId: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }));
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

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

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
        endpoint: undefined,
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

    expect(await screen.findByRole("button", { name: "Scan Paper" })).toBeTruthy();
  });

  it("keeps Scanner Companion optional while direct NAPS2 remains the Scan Paper action", async () => {
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

    await waitFor(() => expect(mockScanAppointmentRequest).toHaveBeenCalledTimes(1));
    expect(mockCreateScanSession).not.toHaveBeenCalled();
    expect(await screen.findByText("Download Scanner App")).toBeTruthy();
    expect(screen.queryByText("Retry Launch")).toBeNull();
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
    expect(screen.getByText("Upload request document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach Request" })).toBeNull();
  });

  it("keeps default manual uploads classified as appointment requests", async () => {
    renderPanel();
    await userEvent.upload(await screen.findByTestId("document-file-input") as HTMLInputElement, new File(["request"], "request.pdf", { type: "application/pdf" }));
    await userEvent.click(await screen.findByRole("button", { name: "Attach Request" }));

    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "appointment_request",
      source: "manual_upload",
    })));
  });

  it("classifies configured manual uploads as clinical documents without changing their source", async () => {
    renderPanel({ newDocumentType: "clinical_document" });
    expect(await screen.findByText("Upload Clinical Document")).toBeTruthy();
    expect(screen.queryByText("Upload request document")).toBeNull();
    await userEvent.upload(await screen.findByTestId("document-file-input") as HTMLInputElement, new File(["clinical"], "clinical.pdf", { type: "application/pdf" }));
    await userEvent.click(await screen.findByRole("button", { name: "Attach Clinical Document" }));

    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "clinical_document",
      source: "manual_upload",
    })));
  });

  it("classifies configured NAPS2 scans and retries as clinical documents", async () => {
    mockUploadAppointmentDocument.mockRejectedValueOnce(new Error("Temporary upload failure")).mockResolvedValueOnce(documentFixture(2, "clinical.pdf", "application/pdf"));
    renderPanel({ newDocumentType: "clinical_document" });

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));
    await waitFor(() => expect(mockPrepareScanSession).toHaveBeenCalledWith(expect.objectContaining({ documentType: "clinical_document" })));
    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenNthCalledWith(1, expect.objectContaining({ documentType: "clinical_document", source: "naps2_webscan" })));
    await userEvent.click(screen.getByRole("button", { name: "Retry failed uploads" }));
    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenNthCalledWith(2, expect.objectContaining({ documentType: "clinical_document", source: "naps2_webscan" })));
  });

  it("creates configured scanner-app sessions as clinical documents", async () => {
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true, allowedFileTypes: ["pdf", "jpg", "png"], documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "manual_browser_upload", scannerProfileName: "default", scannerSource: "feeder", scanDpi: "200",
        scanColorMode: "grayscale", scanFileFormat: "pdf", bridgeReady: true, naps2WebScanEnabled: false,
        naps2WebScanEndpoint: "", scannerAppEnabled: true, scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi", scanSessionExpiryMinutes: "15",
      },
    });
    renderPanel({ newDocumentType: "clinical_document" });

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => expect(mockCreateScanSession).toHaveBeenCalledWith({
      appointmentId: 42,
      patientId: 9,
      documentType: "clinical_document",
      appointmentRefType: "v2_booking",
    }));
  });

  it("localizes clinical-document upload labels in Arabic", async () => {
    localStorage.setItem("rispro-language", "ar");
    renderPanel({ newDocumentType: "clinical_document" });

    expect(await screen.findByText("رفع مستند سريري")).toBeTruthy();
    await userEvent.upload(screen.getByTestId("document-file-input") as HTMLInputElement, new File(["clinical"], "clinical.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "إرفاق المستند السريري" })).toBeTruthy();
  });

  it("hides Attach Request until a file is selected and enables it after selection", async () => {
    renderPanel({ layout: "workspace" });

    expect(await screen.findByText("Upload request document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach Request" })).toBeNull();

    await userEvent.upload(screen.getByTestId("document-file-input") as HTMLInputElement, new File(["request"], "request.pdf", { type: "application/pdf" }));

    const attachButton = await screen.findByRole("button", { name: "Attach Request" });
    expect((attachButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("returns to the file-picker state after upload and supports a second document", async () => {
    renderPanel({ layout: "workspace" });
    const input = await screen.findByTestId("document-file-input") as HTMLInputElement;

    await userEvent.upload(input, new File(["first"], "first.pdf", { type: "application/pdf" }));
    await userEvent.click(await screen.findByRole("button", { name: "Attach Request" }));
    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Upload request document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach Request" })).toBeNull();

    await userEvent.upload(input, new File(["second"], "second.pdf", { type: "application/pdf" }));
    await userEvent.click(await screen.findByRole("button", { name: "Attach Request" }));
    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(2));
  });

  it("reports successful document changes to its parent", async () => {
    const onDocumentsChanged = vi.fn();
    renderPanel({ layout: "workspace", onDocumentsChanged });
    const input = await screen.findByTestId("document-file-input") as HTMLInputElement;

    await userEvent.upload(input, new File(["request"], "request.pdf", { type: "application/pdf" }));
    await userEvent.click(await screen.findByRole("button", { name: "Attach Request" }));

    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalledTimes(1));
  });

  it("refreshes once when a multi-file scan only partially uploads", async () => {
    const onDocumentsChanged = vi.fn();
    const first = new File(["first"], "first.pdf", { type: "application/pdf" });
    const second = new File(["second"], "second.pdf", { type: "application/pdf" });
    mockScanAppointmentRequest.mockResolvedValue({ file: first, files: [first, second], pageCount: 2, source: "naps2_webscan" });
    mockUploadAppointmentDocument
      .mockResolvedValueOnce({ ...documentFixture(11, "first.pdf", "application/pdf"), storedPath: "documents/first.pdf" })
      .mockRejectedValueOnce(new Error("Second upload failed"));

    const { queryClient } = renderPanel({ onDocumentsChanged });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(2));
    expect(onDocumentsChanged).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["appointment-documents", "v2_booking", 42] });
    expect(screen.getByRole("button", { name: "Retry failed uploads" })).toBeTruthy();
  });

  it("does not report a document change when every scanned upload fails", async () => {
    const onDocumentsChanged = vi.fn();
    mockUploadAppointmentDocument.mockRejectedValue(new Error("Upload failed"));
    renderPanel({ onDocumentsChanged });

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(1));
    expect(onDocumentsChanged).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry failed uploads" })).toBeTruthy();
  });

  it("reports successful document deletion to its parent", async () => {
    const onDocumentsChanged = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockFetchCurrentSession.mockResolvedValue({ id: 1, role: "super_admin", username: "admin", fullName: "Admin" });
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(7, "remove.pdf", "application/pdf")]);
    mockDeleteAppointmentDocument.mockResolvedValue({ deleted: true, documentId: 7 });
    renderPanel({ previewMode: "link", onDocumentsChanged });

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDocumentsChanged).toHaveBeenCalledTimes(1));
    expect(mockDeleteAppointmentDocument).toHaveBeenCalledWith(7);
    confirmSpy.mockRestore();
  });

  it("passes configured direct NAPS2 endpoint from integration status to scanner adapter", async () => {
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

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => {
      expect(mockScanAppointmentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "http://localhost:9810", dpi: 200, colorMode: "grayscale", source: "feeder" })
      );
    });
  });

  it("prefers the saved workstation origin over the global scan endpoint", async () => {
    saveWorkstationNaps2Settings("http://workstation-scanner:9801");
    mockFetchIntegrationStatus.mockResolvedValue({
      scanner: {
        referralUploadEnabled: true, allowedFileTypes: ["pdf", "jpg", "png"], documentLinkScope: "patient_and_appointment",
        scannerBridgeMode: "naps2_webscan", scannerProfileName: "default", scannerSource: "duplex", scanDpi: "300",
        scanColorMode: "color", scanFileFormat: "pdf", bridgeReady: true, naps2WebScanEnabled: true,
        naps2WebScanEndpoint: "http://global-scanner:9801", scannerAppEnabled: false,
        scannerAppDownloadUrl: "/assets/downloads/RISproScannerSetup.msi", scanSessionExpiryMinutes: "15",
      },
    });

    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

    await waitFor(() => expect(mockScanAppointmentRequest).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "http://workstation-scanner:9801", dpi: 300, colorMode: "color", source: "duplex",
    })));
  });

  it("keeps scan action hidden when only an endpoint is configured but scanning is disabled", async () => {
    saveWorkstationNaps2Settings("http://workstation-scanner:9801");
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
      expect(screen.queryByRole("button", { name: "Scan Paper" })).toBeNull();
    });
    expect(mockScanAppointmentRequest).not.toHaveBeenCalled();
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

    await userEvent.click(await screen.findByRole("button", { name: "Scan Paper" }));

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

  it("renders the appointment workspace layout with attached-file and supplementary sections", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);

    renderPanel({ layout: "workspace", supplementaryPanel: <section>Images and report</section> });

    expect(await screen.findByTestId("appointment-document-workspace")).toBeTruthy();
    expect(screen.getByText("Attached documents")).toBeTruthy();
    expect(await screen.findByText("request.png")).toBeTruthy();
    expect(screen.getByText("Images and report")).toBeTruthy();
  });

  it("keeps standard workspace geometry by default and supports the wide appointment rail", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    const standard = renderPanel({ layout: "workspace" });
    expect((await screen.findByTestId("appointment-document-workspace")).querySelector(".grid")?.className).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(140px,180px)]");

    standard.unmount();
    renderPanel({ layout: "workspace", workspaceRailSize: "wide" });
    expect((await screen.findByTestId("appointment-document-workspace")).querySelector(".grid")?.className).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
    await userEvent.click(screen.getByRole("button", { name: "Collapse document rail" }));
    expect(screen.getByTestId("appointment-document-workspace").querySelector(".grid")?.className).toContain("lg:grid-cols-[minmax(0,1fr)_44px]");
  });

  it("places supplementary content after documents by default and before documents when requested", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    const after = renderPanel({ layout: "workspace", supplementaryPanel: <section>Images and report</section> });
    const afterRail = await screen.findByTestId("document-rail");
    expect(afterRail.textContent?.indexOf("Attached documents")).toBeLessThan(afterRail.textContent?.indexOf("Images and report") ?? -1);

    after.unmount();
    renderPanel({ layout: "workspace", supplementaryPanelPlacement: "before-documents", supplementaryPanel: <section>Protocol and notes</section> });
    const beforeRail = await screen.findByTestId("document-rail");
    expect(beforeRail.textContent?.indexOf("Protocol and notes")).toBeLessThan(beforeRail.textContent?.indexOf("Attached documents") ?? -1);
  });

  it("shows friendly labels for automated document sources", async () => {
    mockListAppointmentDocuments.mockResolvedValue([
      { ...documentFixture(1, "request.pdf", "application/pdf"), source: "request_scan_automation" },
      { ...documentFixture(2, "clinical.pdf", "application/pdf"), source: "modality_scan_automation" },
    ]);

    renderPanel();

    expect(await screen.findByText(/Request Scan/)).toBeTruthy();
    expect(screen.getByText(/Modality Scan/)).toBeTruthy();
    expect(screen.queryByText(/request_scan_automation/)).toBeNull();
    expect(screen.queryByText(/modality_scan_automation/)).toBeNull();
  });

  it("keeps the document rail narrow and collapsible", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    renderPanel({ layout: "workspace" });

    expect(await screen.findByTestId("document-rail")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Collapse document rail" }));
    expect(screen.queryByTestId("document-rail")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand document rail" }));
    expect(screen.getByTestId("document-rail")).toBeTruthy();
  });

  it("keeps the upload picker connected when the document rail already has documents", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    renderPanel({ layout: "workspace" });

    const input = await screen.findByTestId("document-file-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["second"], "second.pdf", { type: "application/pdf" }));

    expect(await screen.findByRole("button", { name: "Attach Request" })).toBeTruthy();
  });

  it("keeps the request workspace read-only when requested", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    renderPanel({ layout: "workspace", readOnly: true, enableAnnotations: true });

    expect(await screen.findByText("request.png")).toBeTruthy();
    expect(screen.queryByTestId("document-file-input")).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach Request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Document annotation controls" })).toBeNull();
    const image = await screen.findByRole("img", { name: "request.png" });
    fireEvent.load(image);
    expect(screen.queryByLabelText("Annotations for page 1")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Open in new tab" }).length).toBeGreaterThan(0);
  });

  it("keeps the empty-state message and upload action in the document viewer", async () => {
    renderPanel({ layout: "workspace" });

    expect(await screen.findByText("No request documents yet.")).toBeTruthy();
    expect(screen.getByText("Upload request document")).toBeTruthy();
    expect(screen.getAllByText("No request documents yet.")).toHaveLength(1);
  });

  it("selects the first document once and preserves selection after refetch", async () => {
    const documents = [documentFixture(1, "first.png", "image/png"), documentFixture(2, "second.png", "image/png")];
    mockListAppointmentDocuments.mockResolvedValue(documents);
    const rendered = renderPanel({ previewMode: "inline" });

    expect((await screen.findByRole("button", { name: "first.png" })).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByText("second.png"));
    expect(screen.getByRole("button", { name: "second.png" }).getAttribute("aria-pressed")).toBe("true");

    mockListAppointmentDocuments.mockResolvedValue([...documents]);
    await rendered.queryClient.invalidateQueries({ queryKey: ["appointment-documents", "v2_booking", 42] });
    await waitFor(() => expect(screen.getByRole("button", { name: "second.png" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("selects a safely identified uploaded document after the list refetches", async () => {
    const firstDocument = documentFixture(1, "first.png", "image/png");
    const uploadedDocument = documentFixture(2, "uploaded.png", "image/png");
    mockListAppointmentDocuments.mockResolvedValue([firstDocument]);
    mockUploadAppointmentDocument.mockResolvedValue(uploadedDocument);
    const rendered = renderPanel({ previewMode: "inline" });
    await screen.findByRole("button", { name: "first.png" });

    mockListAppointmentDocuments.mockResolvedValue([firstDocument, uploadedDocument]);
    const file = new File(["image"], "uploaded.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("document-file-input") as HTMLInputElement, file);
    await userEvent.click(screen.getByRole("button", { name: "Attach Request" }));
    await rendered.queryClient.invalidateQueries({ queryKey: ["appointment-documents", "v2_booking", 42] });

    await waitFor(() => expect(screen.getByRole("button", { name: "uploaded.png" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("makes upload primary and shows the selected filename and size before attaching", async () => {
    renderPanel({ layout: "workspace" });

    const file = new File([new Uint8Array(2048)], "request.pdf", { type: "application/pdf" });
    await userEvent.upload(await screen.findByTestId("document-file-input") as HTMLInputElement, file);

    expect(await screen.findByText("request.pdf · 2 KB")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Attach Request" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("Scan Paper")).toBeTruthy();
  });

  it("does not mount scanner controls on mobile and keeps upload available", async () => {
    setMobileViewport(true);
    renderPanel({ layout: "workspace" });

    expect(await screen.findByText("Upload request document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scan Appointment Request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan Paper" })).toBeNull();
    expect(screen.queryByText("Download Scanner App")).toBeNull();
    expect(screen.queryByText("Use NAPS2.WebScan")).toBeNull();
  });

  it("does not show upload or scanner actions when the user lacks attachment permission", async () => {
    setMobileViewport(true);
    mockFetchCurrentSession.mockResolvedValue({ id: 2, role: "doctor", username: "doctor", fullName: "Doctor" });
    renderPanel({ layout: "workspace" });

    expect(await screen.findByText("No document has been attached to this appointment.")).toBeTruthy();
    expect(screen.queryByText("Upload request document")).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan Appointment Request" })).toBeNull();
  });

  it("allows modality staff to upload and scan without granting delete permission", async () => {
    mockFetchCurrentSession.mockResolvedValue({ id: 3, role: "modality_staff", username: "tech", fullName: "Technologist" });
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    renderPanel({ newDocumentType: "clinical_document" });

    expect(await screen.findByTestId("document-file-input")).toBeTruthy();
    expect(screen.getByText("Upload Clinical Document")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan Paper" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("keeps upload, delete, and open actions available when inline preview is unsupported", async () => {
    mockFetchCurrentSession.mockResolvedValue({ id: 1, role: "super_admin", username: "admin", fullName: "Admin" });
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(3, "scan.tiff", "image/tiff")]);
    renderPanel({ previewMode: "inline" });

    expect((await screen.findByRole("alert")).textContent).toContain("not supported");
    expect(screen.getByText("Upload request document")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Attach Request" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe("/api/documents/3/view");
  });

  it("collapses controls in expanded review and restores them without changing selection", async () => {
    const documents = [documentFixture(1, "first.png", "image/png"), documentFixture(2, "second.png", "image/png")];
    mockListAppointmentDocuments.mockResolvedValue(documents);
    renderControlledExpandedPanel();

    await userEvent.click(await screen.findByRole("button", { name: "second.png" }));
    await userEvent.click(screen.getByRole("button", { name: "Expand review" }));

    expect(screen.queryByTestId("document-file-input")).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan Appointment Request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Attach Request" })).toBeNull();
    expect((screen.getByRole("combobox", { name: "Attached documents" }) as HTMLSelectElement).value).toBe("2");
    expect(screen.getByRole("button", { name: "Exit expanded review" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Exit expanded review" }));

    expect(screen.getByTestId("document-file-input")).toBeTruthy();
    expect(screen.getByRole("button", { name: "second.png" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("saves annotation creates with pending feedback and clears dirty state after reload", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    let resolveCreate!: (value: unknown) => void;
    mockCreateProtocolDocumentAnnotation.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    renderPanel({ layout: "workspace", enableAnnotations: true });

    const image = await screen.findByRole("img", { name: "request.png" });
    fireEvent.load(image);
    const svg = await screen.findByLabelText("Annotations for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    await userEvent.click(screen.getByRole("button", { name: "Arrow" }));
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 70, clientY: 70, pointerId: 1 });

    const save = screen.getByRole("button", { name: "Save annotations" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(save.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Saving annotations" })).toBeTruthy();
    await userEvent.click(save);
    expect(mockCreateProtocolDocumentAnnotation).toHaveBeenCalledTimes(1);
    resolveCreate({ id: 11, documentId: 1, pageNumber: 1, annotationType: "arrow", geometry: { x1: 0.1, y1: 0.1, x2: 0.7, y2: 0.7 }, textContent: null, style: null, createdByUserId: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    await waitFor(() => expect(screen.queryByText("Unsaved")).toBeNull());
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Annotations saved" }));
  });

  it("keeps annotations dirty and reports a failed save", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.png", "image/png")]);
    mockCreateProtocolDocumentAnnotation.mockRejectedValueOnce(new Error("save failed"));
    renderPanel({ layout: "workspace", enableAnnotations: true });

    const image = await screen.findByRole("img", { name: "request.png" });
    fireEvent.load(image);
    const svg = await screen.findByLabelText("Annotations for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    await userEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 70, clientY: 70, pointerId: 1 });
    await userEvent.click(screen.getByRole("button", { name: "Save annotations" }));

    await waitFor(() => expect(screen.getByText("Unsaved")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Save annotations" })).toBeTruthy();
    expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Annotation save failed" }));
  });

  it("clears only the selected document with confirmation and restores it through undo", async () => {
    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "first.png", "image/png"), documentFixture(2, "second.png", "image/png")]);
    mockListProtocolDocumentAnnotations.mockImplementation(async (documentId?: number) => documentId === 1 ? [{ id: 7, documentId: 1, pageNumber: 1, annotationType: "rectangle", geometry: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, textContent: null, style: null, createdByUserId: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }] : []);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel({ layout: "workspace", enableAnnotations: true });

    const image = await screen.findByRole("img", { name: "first.png" });
    fireEvent.load(image);
    expect(await screen.findByRole("button", { name: "Clear all annotations" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear all annotations" }));
    expect(confirmSpy).toHaveBeenCalledWith("Clear all annotations from this document? This will be applied when annotations are saved.");
    expect(mockDeleteProtocolDocumentAnnotation).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Undo annotation change" }));
    expect(screen.getByLabelText("Annotations for page 1").querySelector("rect")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear all annotations" }));
    await userEvent.click(screen.getByText("second.png"));
    const secondImage = await screen.findByRole("img", { name: "second.png" });
    fireEvent.load(secondImage);
    expect((screen.getByRole("button", { name: "Clear all annotations" }) as HTMLButtonElement).disabled).toBe(true);
    confirmSpy.mockRestore();
  });

  it("shows missing and attached protocol eligibility from canonical appointment-request documents", async () => {
    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: false });
    const missing = renderPanel();
    expect(await screen.findByText("Request missing — not yet eligible for protocoling")).toBeTruthy();
    missing.unmount();

    mockListAppointmentDocuments.mockResolvedValue([documentFixture(1, "request.pdf", "application/pdf")]);
    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: true });
    renderPanel();
    expect(await screen.findByText("Request attached")).toBeTruthy();
  });

  it("hides only the satisfied eligibility banner in the appointment workspace", async () => {
    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: true });
    const satisfied = renderPanel({ layout: "workspace", hideSatisfiedProtocolEligibilityStatus: true });
    await waitFor(() => expect(mockFetchRequestDocumentProtocolPolicy).toHaveBeenCalled());
    expect(screen.queryByTestId("request-document-protocol-status")).toBeNull();
    satisfied.unmount();

    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({ requireRequestDocumentForProtocolQueue: true, protocolQueueAppliesToAppointment: true, hasQualifyingRequestDocument: false });
    renderPanel({ layout: "workspace", hideSatisfiedProtocolEligibilityStatus: true });
    expect((await screen.findByTestId("request-document-protocol-status")).textContent).toContain("Request missing");
  });

  it("does not show protocol eligibility status when the policy is disabled", async () => {
    renderPanel();
    await waitFor(() => expect(mockFetchRequestDocumentProtocolPolicy).toHaveBeenCalled());
    expect(screen.queryByTestId("request-document-protocol-status")).toBeNull();
  });

  it("does not show protocol eligibility status when the appointment does not use protocoling", async () => {
    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({
      requireRequestDocumentForProtocolQueue: true,
      protocolQueueAppliesToAppointment: false,
      hasQualifyingRequestDocument: false,
    });
    const missing = renderPanel();
    await waitFor(() => expect(mockFetchRequestDocumentProtocolPolicy).toHaveBeenCalled());
    expect(screen.queryByTestId("request-document-protocol-status")).toBeNull();
    missing.unmount();

    mockFetchRequestDocumentProtocolPolicy.mockResolvedValue({
      requireRequestDocumentForProtocolQueue: true,
      protocolQueueAppliesToAppointment: false,
      hasQualifyingRequestDocument: true,
    });
    renderPanel();
    await waitFor(() => expect(mockFetchRequestDocumentProtocolPolicy).toHaveBeenCalled());
    expect(screen.queryByTestId("request-document-protocol-status")).toBeNull();
  });
});
