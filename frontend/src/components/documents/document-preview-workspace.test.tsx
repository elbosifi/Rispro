import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestDocument } from "@/lib/api-hooks";
import { LanguageProvider } from "@/providers/language-provider-component";
import { DocumentPreviewWorkspace } from "./document-preview-workspace";

function MockDocument({ children, file, onLoadSuccess, onLoadError }: { children: ReactNode; file: { url: string }; onLoadSuccess?: (pdf: { numPages: number }) => void; onLoadError?: () => void }) {
  const isMalformed = file.url.includes("/999/");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isMalformed) onLoadError?.();
      else onLoadSuccess?.({ numPages: file.url.includes("/43/") ? 2 : 3 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [file.url, isMalformed]);
  return <>{children}</>;
}

function MockPage({ pageNumber, loading }: { pageNumber: number; loading?: ReactNode }) {
  return <div data-testid={`mock-pdf-page-${pageNumber}`}>{loading || `Rendered page ${pageNumber}`}</div>;
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
  it("renders the PDF page count and one control per page", async () => {
    renderWorkspace(pdfDocument());

    expect(await screen.findByText("Page 1 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 3" })).toBeTruthy();
  });

  it("changes the selected page from a thumbnail and identifies it accessibly", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfDocument());
    await screen.findByText("Page 1 of 3");

    await user.click(screen.getByRole("button", { name: "Page 2" }));

    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 2" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBeNull();
  });

  it("supports previous and next controls at their boundaries", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfDocument());
    await screen.findByText("Page 1 of 3");

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

  it("resets to page one when the selected document changes", async () => {
    const { rerender } = renderWorkspace(pdfDocument());
    await screen.findByText("Page 1 of 3");
    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(screen.getByText("Page 3 of 3")).toBeTruthy();

    rerender(
      <LanguageProvider>
        <div className="h-[600px]"><DocumentPreviewWorkspace document={pdfDocument(43)} /></div>
      </LanguageProvider>
    );

    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
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
    renderWorkspace(pdfDocument(999));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be previewed"));
    expect(screen.getByRole("link", { name: "Open in new tab" }).getAttribute("href")).toBe("/api/documents/999/view");
  });
});
