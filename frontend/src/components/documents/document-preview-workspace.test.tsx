import { useEffect, useRef, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestDocument } from "@/lib/api-hooks";
import { LanguageProvider } from "@/providers/language-provider-component";
import { DocumentPreviewWorkspace } from "./document-preview-workspace";

const pageDimensions: Record<number, { width: number; height: number }> = {
  1: { width: 600, height: 800 },
  2: { width: 800, height: 600 },
  3: { width: 500, height: 1000 },
};

function MockDocument({ children, file, onLoadSuccess, onLoadError }: { children: ReactNode; file: { url: string }; onLoadSuccess?: (pdf: { numPages: number; getPage: (pageNumber: number) => Promise<{ getViewport: () => { width: number; height: number } }> }) => void; onLoadError?: (error: Error) => void }) {
  const isMalformed = file.url.includes("/999/");
  const onLoadSuccessRef = useRef(onLoadSuccess);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onLoadSuccessRef.current = onLoadSuccess;
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError, onLoadSuccess]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isMalformed) onLoadErrorRef.current?.(new Error("Failed to load PDF from https://internal.example/documents/999/view"));
      else onLoadSuccessRef.current?.({
        numPages: file.url.includes("/43/") ? 2 : 3,
        getPage: async (pageNumber) => ({
          getViewport: () => pageDimensions[pageNumber] ?? pageDimensions[1],
        }),
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [file.url, isMalformed]);
  if (file.url.includes("/998/")) {
    throw new Error("PDF preview component failed");
  }
  return <>{children}</>;
}

function MockPage({ pageNumber, width, scale, loading, rotate }: { pageNumber: number; width?: number; scale?: number; loading?: ReactNode; rotate?: number }) {
  return (
    <div
      data-testid={`mock-pdf-page-${pageNumber}`}
      data-page-number={pageNumber}
      data-width={width ?? ""}
      data-scale={scale ?? ""}
      data-rotation={rotate ?? 0}
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

function renderWorkspace(document: RequestDocument, options: { expanded?: boolean; onExpandedChange?: (expanded: boolean) => void } = {}) {
  return render(
    <LanguageProvider>
      <div className="h-[600px]">
        <DocumentPreviewWorkspace document={document} expanded={options.expanded} onExpandedChange={options.onExpandedChange} />
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
  it("renders every PDF page in one continuous preview", async () => {
    renderWorkspace(pdfDocument());

    expect(await screen.findByTestId("mock-pdf-page-1")).toBeTruthy();
    expect(screen.getByTestId("mock-pdf-page-2")).toBeTruthy();
    expect(screen.getByTestId("mock-pdf-page-3")).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Document utilities" })).toBeTruthy();
  });

  it("contains mixed page sizes in fit-page mode", async () => {
    renderWorkspace(pdfDocument());

    await waitFor(() => {
      const portraitScale = Number(screen.getByTestId("mock-pdf-page-1").getAttribute("data-scale"));
      const landscapeScale = Number(screen.getByTestId("mock-pdf-page-2").getAttribute("data-scale"));
      const tallPageScale = Number(screen.getByTestId("mock-pdf-page-3").getAttribute("data-scale"));
      expect(600 * portraitScale).toBeLessThanOrEqual(240);
      expect(800 * portraitScale).toBeLessThanOrEqual(240);
      expect(800 * landscapeScale).toBeLessThanOrEqual(240);
      expect(600 * landscapeScale).toBeLessThanOrEqual(240);
      expect(500 * tallPageScale).toBeLessThanOrEqual(240);
      expect(1000 * tallPageScale).toBeLessThanOrEqual(240);
      expect(tallPageScale).not.toBe(portraitScale);
    });
  });

  it("supports fit-width, zoom, and rotation controls", async () => {
    const user = userEvent.setup();
    renderWorkspace(pdfDocument());
    const page = await screen.findByTestId("mock-pdf-page-1");
    await waitFor(() => expect(Number(page.getAttribute("data-scale"))).toBeLessThan(1));
    const initialScale = Number(page.getAttribute("data-scale"));

    await user.click(screen.getByRole("button", { name: "Fit width" }));
    expect(Number(page.getAttribute("data-width"))).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Fit page" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(Number(page.getAttribute("data-scale"))).toBeGreaterThan(initialScale);
    await user.click(screen.getByRole("button", { name: "Rotate clockwise" }));
    expect(page.getAttribute("data-rotation")).toBe("90");
  });

  it("updates the continuous page set when the selected PDF changes", async () => {
    const { rerender } = renderWorkspace(pdfDocument());
    await screen.findByTestId("mock-pdf-page-3");

    rerender(
      <LanguageProvider>
        <div className="h-[600px]"><DocumentPreviewWorkspace document={pdfDocument(43)} /></div>
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId("mock-pdf-page-3")).toBeNull();
      expect(screen.getByTestId("mock-pdf-page-1")).toBeTruthy();
      expect(screen.getByTestId("mock-pdf-page-2")).toBeTruthy();
    });
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

    expect(await screen.findByTestId("mock-pdf-page-1")).toBeTruthy();
    expect(error).toHaveBeenCalled();
  });

  it("preserves the continuous PDF preview when expanded review changes", async () => {
    const onExpandedChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWorkspace(pdfDocument(), { onExpandedChange });
    await screen.findByTestId("mock-pdf-page-3");

    rerender(
      <LanguageProvider>
        <div className="h-[600px]">
          <DocumentPreviewWorkspace document={pdfDocument()} expanded onExpandedChange={onExpandedChange} />
        </div>
      </LanguageProvider>
    );

    expect(screen.getByTestId("mock-pdf-page-2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exit expanded review" }));
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("can exit expanded review after a component-level PDF failure", async () => {
    const onExpandedChange = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWorkspace(pdfDocument(998), { expanded: true, onExpandedChange });

    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Exit expanded review" }));
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    expect(error).toHaveBeenCalled();
  });
});
