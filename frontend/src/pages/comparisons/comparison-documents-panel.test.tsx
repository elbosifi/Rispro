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
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en" }) }));

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
  it("retains failed PDF segments and retries upload without rescanning", async () => {
    apiMocks.list.mockResolvedValue([]);
    const first = new File(["%PDF-first"], "first.pdf", { type: "application/pdf" });
    const second = new File(["%PDF-second"], "second.pdf", { type: "application/pdf" });
    apiMocks.scan.mockResolvedValue({ file: first, files: [first, second], pageCount: 3, source: "naps2_webscan" });
    apiMocks.upload.mockResolvedValueOnce(attachedDocument).mockRejectedValueOnce(new Error("Upload disconnected"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Scan/i }));
    const retry = await screen.findByRole("button", { name: "Retry scanned uploads" });
    fireEvent.click(retry);
    await waitFor(() => expect(apiMocks.upload).toHaveBeenCalledTimes(3));
    expect(apiMocks.scan).toHaveBeenCalledTimes(1);
    expect(apiMocks.upload.mock.calls.map(([payload]) => payload.originalFilename)).toEqual(["first.pdf", "second.pdf", "second.pdf"]);
    expect(apiMocks.upload.mock.calls[2][0]).toMatchObject({ comparisonRequestId: 77, source: "naps2_webscan" });
  });

  it("keeps pending scanned uploads bound to their original comparison request across navigation", async () => {
    apiMocks.list.mockResolvedValue([]);
    const file = new File(["%PDF-paper"], "original-request.pdf", { type: "application/pdf" });
    apiMocks.scan.mockResolvedValue({ file, pageCount: 1, source: "naps2_webscan" });
    apiMocks.upload.mockRejectedValueOnce(new Error("Upload disconnected"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const view = (id: number) => <QueryClientProvider client={client}><ComparisonDocumentsPanel comparisonRequestId={id} canAttach canDelete={false} /></QueryClientProvider>;
    const rendered = render(view(77));
    fireEvent.click(await screen.findByRole("button", { name: /Scan/i }));
    await screen.findByRole("button", { name: "Retry scanned uploads" });
    rendered.rerender(view(88));
    expect(screen.queryByRole("button", { name: "Retry scanned uploads" })).toBeNull();
    rendered.rerender(view(77));
    fireEvent.click(await screen.findByRole("button", { name: "Retry scanned uploads" }));
    await waitFor(() => expect(apiMocks.upload).toHaveBeenCalledTimes(2));
    expect(apiMocks.upload.mock.calls[1][0]).toMatchObject({ comparisonRequestId: 77, originalFilename: "original-request.pdf" });
    expect(apiMocks.scan).toHaveBeenCalledTimes(1);
  });

});
