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
    documentType: "referral_request",
    suggestedFileName: "V2-42-referral_request.pdf",
    scanFileFormat: "pdf",
    sessionCode: "SCAN-TEST",
    guidance: "Ready to scan",
  },
}));
const mockScanPages = vi.fn<(customOptions?: unknown) => Promise<Blob[]>>(
  async () => [new Blob(["page-1"], { type: "application/pdf" })]
);

vi.mock("@/lib/api-hooks", () => ({
  listAppointmentDocuments: (appointmentId: number, appointmentRefType?: string) =>
    mockListAppointmentDocuments(appointmentId, appointmentRefType),
  uploadAppointmentDocument: (payload: unknown) => mockUploadAppointmentDocument(payload),
  deleteAppointmentDocument: (documentId: number) => mockDeleteAppointmentDocument(documentId),
  prepareScanSession: (payload: unknown) => mockPrepareScanSession(payload),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: vi.fn(),
}));

vi.mock("./use-scanapp-for-web", () => ({
  useScanAppForWeb: () => ({
    isSupported: true,
    scanPages: (customOptions?: unknown) => mockScanPages(customOptions),
  }),
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
    mockScanPages.mockReset();

    mockListAppointmentDocuments.mockResolvedValue([]);
    mockPrepareScanSession.mockResolvedValue({
      preparation: {
        documentType: "referral_request",
        suggestedFileName: "V2-42-referral_request.pdf",
        scanFileFormat: "pdf",
        sessionCode: "SCAN-TEST",
        guidance: "Ready to scan",
      },
    });
    mockScanPages.mockResolvedValue([new Blob(["page-1"], { type: "application/pdf" })]);
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
  });

  it("prepares scan and uploads scanned pages through existing document upload API", async () => {
    mockScanPages.mockResolvedValue([
      new Blob(["page-1"], { type: "application/pdf" }),
      new Blob(["page-2"], { type: "application/pdf" }),
    ]);

    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Scan & Attach" }));

    await waitFor(() => {
      expect(mockPrepareScanSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockUploadAppointmentDocument).toHaveBeenCalledTimes(2);
    });

    expect(mockPrepareScanSession).toHaveBeenCalledWith({
      appointmentId: 42,
      patientId: 9,
      documentType: "referral_request",
      appointmentRefType: "v2_booking",
    });
    expect(mockUploadAppointmentDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 9,
        appointmentId: 42,
        appointmentRefType: "v2_booking",
        documentType: "referral_request",
        mimeType: "application/pdf",
      })
    );
  });

  it("Prepare Scan triggers a real scanner request when local scan is enabled", async () => {
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: "Prepare Scan" }));

    await waitFor(() => {
      expect(mockPrepareScanSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockScanPages).toHaveBeenCalledTimes(1);
    });
  });

  it("Prepare Scan triggers scanner request even when local-scan button is hidden", async () => {
    renderPanelWithoutLocalScan();

    await userEvent.click(screen.getByRole("button", { name: "Prepare Scan" }));

    await waitFor(() => {
      expect(mockPrepareScanSession).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockScanPages).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps failed scanned uploads retryable through the same upload API", async () => {
    mockScanPages.mockResolvedValue([new Blob(["retry-me"], { type: "application/pdf" })]);
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

    await userEvent.click(screen.getByRole("button", { name: "Scan & Attach" }));

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
