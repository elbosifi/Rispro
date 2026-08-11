import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CatalogImportExportPanel from "./catalog-import-export-panel";
import {
  applyCatalogWorkbookImport,
  exportCatalogWorkbook,
  previewCatalogWorkbookImport,
} from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", () => ({
  applyCatalogWorkbookImport: vi.fn(),
  exportCatalogWorkbook: vi.fn(),
  previewCatalogWorkbookImport: vi.fn(),
}));

describe("CatalogImportExportPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the shared export action", async () => {
    vi.mocked(exportCatalogWorkbook).mockResolvedValue(undefined);
    render(<CatalogImportExportPanel onImportSuccess={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Export Excel" }));

    expect(exportCatalogWorkbook).toHaveBeenCalledTimes(1);
  });

  it("preserves workbook preview rows and selection controls", async () => {
    vi.mocked(previewCatalogWorkbookImport).mockResolvedValue({
      preview: {
        workbook: {
          sheetNames: ["Modalities", "ExamTypes"],
          requiredSheets: ["Modalities", "ExamTypes"],
        },
        canApply: true,
        summary: {
          modalitiesTotal: 1,
          examTypesTotal: 0,
          selectedModalities: 1,
          selectedExamTypes: 0,
          errors: 0,
          warnings: 0,
        },
        modalities: [{
          id: "modality-1",
          action: "create",
          selected: true,
          rowNumber: 2,
          code: "CT",
          nameEn: "CT",
          nameAr: "أشعة مقطعية",
          dailyCapacity: 20,
          errors: [],
        }],
        examTypes: [],
        progressNotes: ["Preview completed."],
        errors: [],
      },
    });
    const { container } = render(<CatalogImportExportPanel onImportSuccess={vi.fn()} />);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();

    await userEvent.upload(fileInput!, new File(["workbook"], "catalog.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }));

    await waitFor(() => expect(previewCatalogWorkbookImport).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByDisplayValue("CT")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Apply Selected Rows" })).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "LI" && element.textContent === "1. Preview completed.",
      ),
    ).toBeTruthy();
    expect(applyCatalogWorkbookImport).not.toHaveBeenCalled();
  });
});
