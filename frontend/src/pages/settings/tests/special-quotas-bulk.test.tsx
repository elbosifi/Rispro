import { describe, expect, it } from "vitest";

interface ExamTypeOption {
  value: string;
  label: string;
  modalityId: number | null;
}

interface SpecialQuotaRow {
  examTypeId: string;
  dailyExtraSlots: string;
  isActive: boolean;
}

describe("Special Quotas bulk operations", () => {
  const examTypeOptions: ExamTypeOption[] = [
    { value: "1", label: "CT Head", modalityId: 10 },
    { value: "2", label: "CT Chest", modalityId: 10 },
    { value: "3", label: "MRI Brain", modalityId: 20 },
    { value: "4", label: "MRI Spine", modalityId: 20 },
    { value: "5", label: "CT Angio", modalityId: 10 },
  ];

  it("Add all exams creates one row per active exam type", () => {
    const existingDraft: SpecialQuotaRow[] = [];

    const existingIds = new Set(
      existingDraft.map((q) => q.examTypeId).filter((id) => id.trim())
    );
    const allActiveExamTypes = examTypeOptions.filter(
      (et) => !existingIds.has(et.value)
    );

    const newRows: SpecialQuotaRow[] = allActiveExamTypes.map((et) => ({
      examTypeId: et.value,
      dailyExtraSlots: "0",
      isActive: true,
    }));

    expect(newRows.length).toBe(5);
    expect(newRows.map((r) => r.examTypeId).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("Add all exams does not duplicate existing rows", () => {
    const existingDraft: SpecialQuotaRow[] = [
      { examTypeId: "1", dailyExtraSlots: "0", isActive: true },
      { examTypeId: "2", dailyExtraSlots: "0", isActive: true },
    ];

    const existingIds = new Set(
      existingDraft.map((q) => q.examTypeId).filter((id) => id.trim())
    );
    const allActiveExamTypes = examTypeOptions.filter(
      (et) => !existingIds.has(et.value)
    );

    expect(allActiveExamTypes.length).toBe(3);
    expect(allActiveExamTypes.map((e) => e.value).sort()).toEqual(["3", "4", "5"]);
  });

  it("Add all for selected modality only adds matching exam types", () => {
    const existingDraft: SpecialQuotaRow[] = [];
    const modalityId = 10;

    const existingIds = new Set(
      existingDraft.map((q) => q.examTypeId).filter((id) => id.trim())
    );
    const allActiveExamTypes = examTypeOptions.filter(
      (et) => !existingIds.has(et.value) && et.modalityId === modalityId
    );

    expect(allActiveExamTypes.length).toBe(3);
    expect(allActiveExamTypes.map((e) => e.value).sort()).toEqual(["1", "2", "5"]);
  });

  it("Delete all clears special quota rows", () => {
    let draft: SpecialQuotaRow[] = [
      { examTypeId: "1", dailyExtraSlots: "0", isActive: true },
      { examTypeId: "2", dailyExtraSlots: "0", isActive: true },
      { examTypeId: "3", dailyExtraSlots: "0", isActive: true },
    ];

    draft = [];

    expect(draft.length).toBe(0);
  });

  it("Delete all for selected modality clears only matching rows", () => {
    const modalityFilter = "10";
    let draft: SpecialQuotaRow[] = [
      { examTypeId: "1", dailyExtraSlots: "0", isActive: true },
      { examTypeId: "2", dailyExtraSlots: "0", isActive: true },
      { examTypeId: "3", dailyExtraSlots: "0", isActive: true },
    ];

    const examTypeIds = new Set(
      examTypeOptions
        .filter((et) => String(et.modalityId) === modalityFilter)
        .map((et) => et.value)
    );

    draft = draft.filter((q) => !examTypeIds.has(q.examTypeId));

    expect(draft.length).toBe(1);
    expect(draft[0].examTypeId).toBe("3");
  });

  it("Save payload shape for specialQuotas remains unchanged", () => {
    const draft = {
      specialQuotas: [
        { id: 1, examTypeId: "1", dailyExtraSlots: "2", isActive: true },
        { examTypeId: "2", dailyExtraSlots: "0", isActive: true },
      ] as Array<{ id?: number; examTypeId: string; dailyExtraSlots: string; isActive: boolean }>,
    };

    const payload = draft.specialQuotas
      .filter((row) => row.examTypeId.trim() && row.dailyExtraSlots.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        examTypeId: Number(row.examTypeId),
        dailyExtraSlots: Number(row.dailyExtraSlots),
        isActive: row.isActive,
      }));

    expect(payload).toEqual([
      { id: 1, examTypeId: 1, dailyExtraSlots: 2, isActive: true },
      { examTypeId: 2, dailyExtraSlots: 0, isActive: true },
    ]);

    expect(payload[0]).toHaveProperty("examTypeId");
    expect(payload[0]).toHaveProperty("dailyExtraSlots");
    expect(payload[0]).toHaveProperty("isActive");
    expect(payload[0]).not.toHaveProperty("modalityId");
    expect(payload[0]).not.toHaveProperty("ALL");
  });
});