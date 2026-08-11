import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestDocument } from "@/lib/api-hooks";

const apiMocks = vi.hoisted(() => ({
  deleteDocument: vi.fn(),
  integration: vi.fn(),
  list: vi.fn(),
  scan: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/api-hooks", () => ({
  deleteComparisonDocument: apiMocks.deleteDocument,
  fetchIntegrationStatus: apiMocks.integration,
  listComparisonDocuments: apiMocks.list,
  uploadComparisonDocument: apiMocks.upload,
}));
vi.mock("@/lib/naps2-webscan", () => ({ scanAppointmentRequest: apiMocks.scan }));
vi.mock("@/lib/toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/services/scanning/workstation-naps2-settings", () => ({
  resolveEffectiveNaps2Endpoint: (endpoint: string) => ({ endpoint }),
}));
vi.mock("@/components/documents/document-preview-workspace", () => ({
  DocumentPreviewWorkspace: ({ document }: { document: RequestDocument }) => <div>Previewing {document.originalFilename}</div>,
}));

import { ComparisonDocumentsPanel } from "./comparison-documents-panel";

const attachedDocument: RequestDocument = {
  id: 501,
  patientId: 10,
  appointmentId: null,
  v2BookingId: null,
  documentType: "comparison_request",
  originalFilename: "comparison-paper.pdf",
  storedPath: "",
  mimeType: "application/pdf",
  fileSize: 2048,
  storageLocationType: "local_fallback",
  source: "manual_upload",
  lastMoveAttemptAt: null,
  lastMoveError: null,
  createdAt: "2026-08-11T08:00:00Z",
};

function renderPanel(props: { canAttach?: boolean; canDelete?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComparisonDocumentsPanel comparisonRequestId={77} canAttach={props.canAttach ?? true} canDelete={props.canDelete ?? false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMocks.integration.mockResolvedValue({ scanner: { naps2WebScanEnabled: true, naps2WebScanEndpoint: "http://localhost:5000", scanDpi: "200", scanColorMode: "grayscale", scannerSource: "feeder" } });
  apiMocks.upload.mockResolvedValue(attachedDocument);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ComparisonDocumentsPanel", () => {
  it("uploads through canonical document APIs, refreshes the count/list, and previews the attachment", async () => {
    apiMocks.list.mockResolvedValueOnce([]).mockResolvedValue([attachedDocument]);
    renderPanel();
    expect(await screen.findByText("None attached")).toBeTruthy();

    const file = new File([new Uint8Array([37, 80, 68, 70])], "comparison-paper.pdf", { type: "application/pdf" });
    if (!(file as File & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer) {
      Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([37, 80, 68, 70]).buffer });
    }
    fireEvent.change(screen.getByLabelText("Choose comparison paper"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    await waitFor(() => expect(apiMocks.upload).toHaveBeenCalledWith(expect.objectContaining({
      comparisonRequestId: 77,
      originalFilename: "comparison-paper.pdf",
      mimeType: "application/pdf",
      source: "manual_upload",
    })));
    expect(await screen.findByText("1 attached")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /comparison-paper\.pdf/ }));
    expect(await screen.findByText("Previewing comparison-paper.pdf")).toBeTruthy();
  });

  it("uses the existing NAPS2 scan bridge and keeps removal supervisor-gated", async () => {
    const scannedFile = new File([new Uint8Array([37, 80, 68, 70])], "comparison-77-papers.pdf", { type: "application/pdf" });
    if (!(scannedFile as File & { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer) {
      Object.defineProperty(scannedFile, "arrayBuffer", { value: async () => new Uint8Array([37, 80, 68, 70]).buffer });
    }
    apiMocks.scan.mockResolvedValue({ file: scannedFile, source: "naps2_webscan" });
    apiMocks.list.mockResolvedValue([attachedDocument]);
    const view = renderPanel({ canDelete: false });
    fireEvent.click(await screen.findByRole("button", { name: "Scan" }));
    await waitFor(() => expect(apiMocks.scan).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: "http://localhost:5000",
      fileName: "comparison-77-papers.pdf",
    })));
    await waitFor(() => expect(apiMocks.upload).toHaveBeenCalledWith(expect.objectContaining({ source: "naps2_webscan" })));
    expect(screen.queryByRole("button", { name: "Remove comparison-paper.pdf" })).toBeNull();

    view.unmount();
    apiMocks.list.mockResolvedValue([attachedDocument]);
    renderPanel({ canDelete: true });
    expect(await screen.findByRole("button", { name: "Remove comparison-paper.pdf" })).toBeTruthy();
  });
});
