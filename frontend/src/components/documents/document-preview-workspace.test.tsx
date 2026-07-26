import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestDocument } from "@/lib/api-hooks";
import { LanguageProvider } from "@/providers/language-provider-component";
import { DocumentPreviewWorkspace } from "./document-preview-workspace";

function MockDocument({ children, file, onLoadSuccess, onLoadError }: { children: ReactNode; file: { url: string }; onLoadSuccess?: (pdf: { numPages: number }) => void; onLoadError?: (error: Error) => void }) {
  const isMalformed = file.url.includes("/999/");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isMalformed) onLoadError?.(new Error("Failed to load PDF from https://internal.example/documents/999/view"));
      else onLoadSuccess?.({ numPages: file.url.includes("/43/") ? 2 : 3 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [file.url, isMalformed]);
  if (file.url.includes("/998/")) {
    throw new Error("PDF preview component failed");
  }
  return <>{children}</>;
}

function MockPage({ pageNumber, width, loading }: { pageNumber: number; width: number; loading?: ReactNode }) {
  const isLargePage = width > 200;
  return (
    <div
      data-testid={isLargePage ? "mock-pdf-large-page" : `mock-pdf-page-${pageNumber}`}
      data-page-number={pageNumber}
      data-width={width}
    >
      {loading || `Rendered page ${pageNumber}`}
    </div>
  );
}

vi.mock("react-pdf", () => ({
  Document: MockDocument,
  Page: MockPage,
  pdfjs: { GlobalWorkerOptions: {} },
}));

const pdfDocument = (id = 42): RequestDocument => ({
  id,
  patientId: 9,
  appointmentId: 42,
  v2BookingId: null,
  documentType: "appointment_request",
  originalFilename: `${id}.pdf`,
  storedPath: "",
  mimeType: "application/pdf",
  fileSize: 12,
  storageLocationType: "local_fallback",
  source: "manual_upload",
  lastMoveAttemptAt: null,
  lastMoveError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

function renderWorkspace(document: RequestDocument) {
  return render(
    <LanguageProvider>
      <div className="h-[600px]">
        <DocumentPreviewWorkspace document={document} />
      </div>
    </LanguageProvider>
  );
}

beforeEach(() => localStorage.setItem("rispro-language", "en"));
afterEach(() => {
  cleanup();
  localStorage.removeItem("rispro-language");
  vi.clearAllMocks();
});

describe("DocumentPreviewWorkspace", () => {
  it("opens PDFs in overview mode with the page count and one button per page", async () => {
    renderWorkspace(pdfDocument());

    expect(await screen.findByText("3 pages")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open page 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open page 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open page 3" })).toBeTruthy();
    expect(screen.queryByTestId("mock-pdf-large-page")).toBeNull();
  });

  it("opens a selected overview page in single-page mode", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfDocument());
    await screen.findByText("3 pages");

    await user.click(screen.getByRole("button", { name: "Open page 2" }));

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to all pages" })).toBeTruthy();
    expect(screen.getByTestId("mock-pdf-large-page").getAttribute("data-page-number")).toBe("2");
  });

  it("supports previous and next controls at their single-page boundaries", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfDocument());
    await screen.findByText("3 pages");
    await user.click(screen.getByRole("button", { name: "Open page 1" }));

    const previous = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    expect((previous as HTMLButtonElement).disabled).toBe(true);
    expect((next as HTMLButtonElement).disabled).toBe(false);

    await user.click(next);
    await user.click(next);
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();
    expect((next as HTMLButtonElement).disabled).toBe(true);

    await user.click(previous);
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  });

  it("returns to overview while preserving the selected page", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfDocument());
    await screen.findByText("3 pages");
    await user.click(screen.getByRole("button", { name: "Open page 2" }));
    await user.click(screen.getByRole("button", { name: "Back to all pages" }));

    expect(screen.getByText("3 pages")).toBeTruthy();
    expect(screen.queryByTestId("mock-pdf-large-page")).toBeNull();
    expect(screen.getByRole("button", { name: "Open page 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Open page 1" }).getAttribute("aria-current")).toBeNull();
  });

  it("resets to overview mode and page one when the selected PDF changes", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWorkspace(pdfDocument());
    await screen.findByText("3 pages");
    await user.click(screen.getByRole("button", { name: "Open page 3" }));
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();

    rerender(
      <LanguageProvider>
        <div className="h-[600px]"><DocumentPreviewWorkspace document={pdfDocument(43)} /></div>
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByText("2 pages")).toBeTruthy());
    expect(screen.queryByTestId("mock-pdf-large-page")).toBeNull();
    expect(screen.getByRole("button", { name: "Open page 1" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders an image preview with one selected thumbnail", () => {
    const document = { ...pdfDocument(), originalFilename: "scan.png", mimeType: "image/png" };
    renderWorkspace(document);

    expect(screen.getByRole("img", { name: "scan.png" }).getAttribute("src")).toBe("/api/documents/42/view");
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows an unsupported-file fallback with the open action", () => {
    const document = { ...pdfDocument(), originalFilename: "scan.pdf", mimeType: "application/octet-stream" };
    renderWorkspace(document);

    expect(screen.getByRole("alert").textContent).toContain("not supported");
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe("/api/documents/42/view");
  });

  it("contains malformed-PDF failures and keeps the open action available", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    renderWorkspace(pdfDocument(999));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be previewed"));
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe("/api/documents/999/view");
    expect(warn).toHaveBeenCalledWith("[RISpro] React-PDF preview failed:", expect.stringContaining("[url]"));
  });

  it("resets a component-level PDF failure when another document is selected", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = renderWorkspace(pdfDocument(998));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe("/api/documents/998/view");

    rerender(
      <LanguageProvider>
        <div className="h-[600px]"><DocumentPreviewWorkspace document={pdfDocument()} /></div>
      </LanguageProvider>
    );

    expect(await screen.findByText("3 pages")).toBeTruthy();
    expect(error).toHaveBeenCalled();
  });
});
