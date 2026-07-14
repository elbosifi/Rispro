import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExamTypesSection from "./exam-types-section";
import { LanguageProvider } from "@/providers/language-provider-component";
import {
  createExamType,
  deleteExamType,
  fetchExamTypes,
  hardDeleteExamType,
  updateExamType,
} from "@/lib/api-hooks";

vi.mock("@/lib/api-hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-hooks")>();
  return {
    ...actual,
    createExamType: vi.fn(),
    deleteExamType: vi.fn(),
    fetchExamTypes: vi.fn(),
    hardDeleteExamType: vi.fn(),
    updateExamType: vi.fn(),
  };
});

const catalog = {
  modalities: [
    { id: 1, code: "CT", name_ar: "مقطعية", name_en: "CT", is_active: true },
    { id: 2, code: "MR", name_ar: "رنين", name_en: "MRI", is_active: false },
  ],
  examTypes: [
    {
      id: 10,
      modality_id: 1,
      code: "CT-BRAIN",
      name_ar: "دماغ",
      name_en: "Brain CT",
      duration_minutes: 20,
      specific_instruction_ar: "صيام",
      specific_instruction_en: "Fasting",
      is_active: true,
    },
    {
      id: 11,
      modality_id: 2,
      code: "MR-SPINE",
      name_ar: "",
      name_en: "Spine MRI",
      duration_minutes: 45,
      specific_instruction_ar: "",
      specific_instruction_en: "Remove metal",
      is_active: true,
    },
    {
      id: 12,
      modality_id: 1,
      code: "CT-OLD",
      name_ar: "",
      name_en: "",
      duration_minutes: null,
      specific_instruction_ar: "",
      specific_instruction_en: "",
      is_active: false,
    },
  ],
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <ExamTypesSection onReAuthRequired={vi.fn()} />
      </QueryClientProvider>
    </LanguageProvider>
  );
}

function rowFor(text: string) {
  return screen.getByText(text).closest("tr") as HTMLTableRowElement;
}

function dialog() {
  return screen.getByRole("dialog", { name: "Copy instructions from existing exam" });
}

function dialogRowFor(text: string) {
  return within(dialog()).getByText(text).closest("tr") as HTMLTableRowElement;
}

function fieldValue(label: string) {
  return (screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

describe("ExamTypesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchExamTypes).mockResolvedValue(catalog);
    vi.mocked(createExamType).mockResolvedValue({ examType: {} });
    vi.mocked(updateExamType).mockResolvedValue({ examType: {} });
    vi.mocked(deleteExamType).mockResolvedValue({ examType: {} });
    vi.mocked(hardDeleteExamType).mockResolvedValue({ examType: {} });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("filters exam types by code, English name, and Arabic name", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    const search = screen.getByLabelText("Search exam types");

    await userEvent.type(search, "spine");
    expect(screen.getByText("MR-SPINE")).toBeTruthy();
    expect(screen.queryByText("CT-BRAIN")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "دماغ");
    expect(screen.getByText("CT-BRAIN")).toBeTruthy();
    expect(screen.queryByText("MR-SPINE")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "CT-BRAIN");
    expect(screen.getByText("Brain CT")).toBeTruthy();
    expect(screen.queryByText("MR-SPINE")).toBeNull();
  });

  it("filters by modality, status, and preparation status", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.selectOptions(screen.getByLabelText("Modality filter"), "2");
    expect(screen.getByText("MR-SPINE")).toBeTruthy();
    expect(screen.getAllByText("رنين (Inactive)").length).toBeGreaterThan(0);
    expect(screen.queryByText("CT-BRAIN")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Modality filter"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Preparation filter"), "missing_arabic");
    expect(screen.getByText("MR-SPINE")).toBeTruthy();
    expect(screen.queryByText("CT-BRAIN")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "inactive");
    await userEvent.selectOptions(screen.getByLabelText("Preparation filter"), "missing_both");
    expect(await screen.findByText("CT-OLD")).toBeTruthy();
    expect(screen.queryByText("MR-SPINE")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "all");
    await userEvent.selectOptions(screen.getByLabelText("Preparation filter"), "all");
    expect(screen.getByText("CT-BRAIN")).toBeTruthy();
    expect(screen.getByText("CT-OLD")).toBeTruthy();
  });

  it("creates exam types with code and duration minutes", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(screen.getByRole("button", { name: "Add exam type" }));
    await userEvent.type(screen.getByLabelText("Code"), "XR-CHEST");
    await userEvent.type(screen.getByLabelText("English name"), "Chest X-ray");
    await userEvent.type(screen.getByLabelText("Arabic name"), "صدر");
    await userEvent.selectOptions(screen.getByLabelText("Exam modality"), "1");
    await userEvent.type(screen.getByLabelText("Duration minutes"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createExamType).toHaveBeenCalledWith(expect.objectContaining({
      code: "XR-CHEST",
      durationMinutes: 15,
      modalityId: 1,
      nameEn: "Chest X-ray",
      nameAr: "صدر",
    })));
  });

  it("edits code and duration without an active checkbox or implicit active-state payload", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(within(rowFor("CT-BRAIN")).getByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText("Active")).toBeNull();

    const code = screen.getByLabelText("Edit code");
    await userEvent.clear(code);
    await userEvent.type(code, "CT-HEAD");
    const duration = screen.getByLabelText("Edit duration minutes");
    await userEvent.clear(duration);
    await userEvent.type(duration, "25");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateExamType).toHaveBeenCalledWith(10, expect.objectContaining({
      code: "CT-HEAD",
      durationMinutes: 25,
    })));
    expect(vi.mocked(updateExamType).mock.calls[0]?.[1]).not.toHaveProperty("isActive");
    expect(vi.mocked(updateExamType).mock.calls[0]?.[1]).not.toHaveProperty("is_active");
  });

  it("keeps deactivate, activate, and hard delete as explicit actions", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(within(rowFor("CT-BRAIN")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(deleteExamType).toHaveBeenCalledWith(10));

    await userEvent.selectOptions(screen.getByLabelText("Status filter"), "inactive");
    const inactiveRow = rowFor("CT-OLD");
    expect(within(inactiveRow).getByRole("button", { name: "Activate" })).toBeTruthy();
    expect(within(inactiveRow).getByRole("button", { name: "Hard Delete" })).toBeTruthy();

    await userEvent.click(within(inactiveRow).getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(updateExamType).toHaveBeenCalledWith(12, expect.objectContaining({ isActive: true })));
    await userEvent.click(within(inactiveRow).getByRole("button", { name: "Hard Delete" }));
    await waitFor(() => expect(hardDeleteExamType).toHaveBeenCalledWith(12));
  });

  it("create form can copy Arabic and English instructions without changing other fields", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(screen.getByRole("button", { name: "Add exam type" }));
    await userEvent.type(screen.getByLabelText("Code"), "XR-CHEST");
    await userEvent.type(screen.getByLabelText("English name"), "Chest X-ray");
    await userEvent.type(screen.getByLabelText("Arabic name"), "صدر");
    await userEvent.selectOptions(screen.getByLabelText("Exam modality"), "1");
    await userEvent.type(screen.getByLabelText("Duration minutes"), "15");

    await userEvent.click(screen.getByRole("button", { name: "Copy instructions from existing exam" }));
    expect(within(dialog()).getByText("CT-BRAIN")).toBeTruthy();
    await userEvent.click(within(dialogRowFor("CT-BRAIN")).getByRole("button", { name: "Select" }));
    expect(within(dialog()).getByText("Fasting")).toBeTruthy();
    expect(within(dialog()).getByText("صيام")).toBeTruthy();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Copy both" }));

    expect(fieldValue("Code")).toBe("XR-CHEST");
    expect(fieldValue("English name")).toBe("Chest X-ray");
    expect(fieldValue("Arabic name")).toBe("صدر");
    expect(fieldValue("Exam modality")).toBe("1");
    expect(fieldValue("Duration minutes")).toBe("15");
    expect(fieldValue("Preparation Arabic")).toBe("صيام");
    expect(fieldValue("Preparation English")).toBe("Fasting");
  });

  it("edit form can copy individual instruction languages without changing catalog fields", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(within(rowFor("CT-BRAIN")).getByRole("button", { name: "Edit" }));
    const codeBefore = (screen.getByLabelText("Edit code") as HTMLInputElement).value;
    const durationBefore = (screen.getByLabelText("Edit duration minutes") as HTMLInputElement).value;

    await userEvent.click(screen.getByRole("button", { name: "Copy instructions from existing exam" }));
    await userEvent.selectOptions(within(dialog()).getByLabelText("Source modality scope"), "all");
    await userEvent.click(within(dialogRowFor("MR-SPINE")).getByRole("button", { name: "Select" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Copy English only" }));

    expect(fieldValue("Edit code")).toBe(codeBefore);
    expect(fieldValue("Edit English name")).toBe("Brain CT");
    expect(fieldValue("Edit Arabic name")).toBe("دماغ");
    expect(fieldValue("Edit modality")).toBe("1");
    expect(fieldValue("Edit duration minutes")).toBe(durationBefore);
    expect(fieldValue("Preparation Arabic")).toBe("صيام");
    expect(fieldValue("Preparation English")).toBe("Remove metal");
  });

  it("does not overwrite existing instruction text without confirmation", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(within(rowFor("CT-BRAIN")).getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy instructions from existing exam" }));
    await userEvent.selectOptions(within(dialog()).getByLabelText("Source modality scope"), "all");
    await userEvent.click(within(dialogRowFor("MR-SPINE")).getByRole("button", { name: "Select" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Copy English only" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(fieldValue("Preparation English")).toBe("Fasting");
  });

  it("prioritizes same-modality source exams while still allowing all modalities", async () => {
    renderSection();

    await screen.findByText("CT-BRAIN");
    await userEvent.click(screen.getByRole("button", { name: "Add exam type" }));
    await userEvent.selectOptions(screen.getByLabelText("Exam modality"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Copy instructions from existing exam" }));

    const sameModalityRows = within(dialog()).getAllByRole("row");
    expect(within(sameModalityRows[1]!).getByText("CT-BRAIN")).toBeTruthy();
    expect(within(sameModalityRows[2]!).getByText("CT-OLD")).toBeTruthy();

    await userEvent.selectOptions(within(dialog()).getByLabelText("Source modality scope"), "all");
    expect(within(dialog()).getByText("MR-SPINE")).toBeTruthy();
    await userEvent.type(within(dialog()).getByLabelText("Search source exams"), "MRI");
    expect(within(dialog()).getByText("MR-SPINE")).toBeTruthy();
    expect(within(dialog()).queryByText("CT-BRAIN")).toBeNull();
  });
});
