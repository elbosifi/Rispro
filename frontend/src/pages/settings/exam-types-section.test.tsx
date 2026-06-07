import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExamTypesSection from "./exam-types-section";
import { LanguageProvider } from "@/providers/language-provider";
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
});
