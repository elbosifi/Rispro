import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Button, Card } from "@/components/shared";
import { chooseLocalized } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { useV2ExamTypeCatalog, useV2Lookups, useV2PolicyUsers } from "../api";
import type {
  PolicyCategoryDailyLimitDto,
  PolicyExamMixQuotaRuleDto,
  PolicyExamTypeRuleDto,
  PolicyExamTypeSpecialQuotaDto,
  PolicyDisplayLookupsDto,
  PolicyModalityBlockedRuleDto,
  PolicySnapshotDto,
} from "../types";

function emptySnapshot(): PolicySnapshotDto {
  return {
    categoryDailyLimits: [],
    modalityBlockedRules: [],
    examTypeRules: [],
    examTypeSpecialQuotas: [],
    examMixQuotaRules: [],
    specialReasonCodes: [],
  };
}

function createNextId(values: Array<{ id: number }>): number {
  const maxId = values.reduce((max, row) => (row.id > max ? row.id : max), 0);
  return maxId + 1;
}

function createBlockedRule(modalityId: number, id: number): PolicyModalityBlockedRuleDto {
  return {
    id,
    modalityId,
    ruleType: "specific_date",
    specificDate: null,
    startDate: null,
    endDate: null,
    recurStartMonth: null,
    recurStartDay: null,
    recurEndMonth: null,
    recurEndDay: null,
    isOverridable: false,
    isActive: true,
    title: null,
    notes: null,
  };
}

function cloneBlockedRule(rule: PolicyModalityBlockedRuleDto, modalityId: number, id: number): PolicyModalityBlockedRuleDto {
  return {
    ...rule,
    id,
    modalityId,
  };
}

interface ModalityOption {
  value: number;
  label: string;
  dailyCapacity: number | null;
}

interface ExamTypeOption {
  value: number;
  label: string;
}

type SnapshotScopedValue<T> = {
  baseSnapshot: PolicySnapshotDto | null;
  value: T;
};

type ScheduleRule =
  | Pick<PolicyExamTypeRuleDto, "ruleType" | "specificDate" | "startDate" | "endDate" | "weekday" | "alternateWeeks" | "recurrenceAnchorDate">
  | Pick<PolicyExamMixQuotaRuleDto, "ruleType" | "specificDate" | "startDate" | "endDate" | "weekday" | "alternateWeeks" | "recurrenceAnchorDate">;

const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatRuleTypeLabel(ruleType: ScheduleRule["ruleType"]): string {
  if (ruleType === "date_range") return "Date range";
  if (ruleType === "weekly_recurrence") return "Weekly recurrence";
  return "Specific date";
}

function formatEffectModeLabel(effectMode: PolicyExamTypeRuleDto["effectMode"]): string {
  return effectMode === "hard_restriction" ? "Hard restriction" : "Supervisor-overridable restriction";
}

function formatScheduleSummary(rule: ScheduleRule): string {
  if (rule.ruleType === "date_range") {
    if (rule.startDate && rule.endDate) return `${rule.startDate} to ${rule.endDate}`;
    if (rule.startDate) return `From ${rule.startDate}`;
    if (rule.endDate) return `Until ${rule.endDate}`;
    return "Date range not set";
  }
  if (rule.ruleType === "weekly_recurrence") {
    const weekday = rule.weekday == null ? "weekday not set" : weekdayLabels[rule.weekday] ?? "weekday not set";
    const cadence = rule.alternateWeeks ? "alternate weeks" : "every week";
    const anchor = rule.recurrenceAnchorDate ? ` from ${rule.recurrenceAnchorDate}` : "";
    return `${weekday}, ${cadence}${anchor}`;
  }
  return rule.specificDate ?? "Specific date not set";
}

function clampDailyLimit(value: number, dailyCapacity: number | null): number {
  const next = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (dailyCapacity == null || !Number.isFinite(dailyCapacity)) return next;
  return Math.min(next, Math.max(0, dailyCapacity));
}

function validateCategoryDailyLimits(
  limits: PolicySnapshotDto["categoryDailyLimits"],
  modalityOptions: ModalityOption[]
): string | null {
  const activeLimits = limits.filter((row) => row.isActive);
  if (activeLimits.length === 0) return null;

  const dailyCapacityByModality = new Map<number, number | null>(
    modalityOptions.map((option) => [option.value, option.dailyCapacity])
  );
  const seen = new Set<string>();
  const grouped = new Map<number, typeof activeLimits>();

  for (const row of activeLimits) {
    const modalityId = Number(row.modalityId);
    if (!Number.isFinite(modalityId) || modalityId <= 0) {
      return "Each active category limit must select a modality.";
    }
    const key = `${modalityId}:${row.caseCategory}`;
    if (seen.has(key)) {
      return "Duplicate active category limits detected for the same modality/category.";
    }
    seen.add(key);
    const existing = grouped.get(modalityId) ?? [];
    existing.push(row);
    grouped.set(modalityId, existing);
  }

  for (const [modalityId, rows] of grouped) {
    const modalityCapacity = dailyCapacityByModality.get(modalityId) ?? null;
    if (modalityCapacity == null || !Number.isFinite(modalityCapacity)) {
      return `Modality ${modalityId} is missing a valid daily capacity.`;
    }
    const oncology = rows.find((row) => row.caseCategory === "oncology");
    const nonOncology = rows.find((row) => row.caseCategory === "non_oncology");

    const configuredRows = [oncology, nonOncology].filter((row) => row != null);
    for (const configured of configuredRows) {
      if (Number(configured.dailyLimit) > modalityCapacity) {
        return `Configured ${configured.caseCategory} limit exceeds modality ${modalityId} daily capacity (${modalityCapacity}).`;
      }
    }
  }

  return null;
}

export function PolicyDraftEditor({
  snapshot,
  displayLookups,
  externalValidationErrors = [],
  onSave,
  isSaving,
}: {
  snapshot: PolicySnapshotDto | null;
  displayLookups?: PolicyDisplayLookupsDto;
  externalValidationErrors?: string[];
  onSave: (nextSnapshot: PolicySnapshotDto, changeNote: string | null) => Promise<void>;
  isSaving: boolean;
}) {
  const lookups = useV2Lookups();
  const examTypeCatalog = useV2ExamTypeCatalog();
  const policyUsers = useV2PolicyUsers();
  const { language } = useLanguage();
  const [draftOverride, setDraftOverride] = useState<SnapshotScopedValue<PolicySnapshotDto> | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [advancedJsonOverride, setAdvancedJsonOverride] = useState<SnapshotScopedValue<string> | null>(null);
  const [advancedJsonErrorState, setAdvancedJsonErrorState] = useState<SnapshotScopedValue<string | null> | null>(null);
  const [saveValidationErrorState, setSaveValidationErrorState] = useState<SnapshotScopedValue<string | null> | null>(null);
  const [availableExamFilters, setAvailableExamFilters] = useState<Record<string, string>>({});

  const serverDraft = snapshot ?? emptySnapshot();
  const draft =
    draftOverride?.baseSnapshot === snapshot
      ? draftOverride.value
      : serverDraft;
  const advancedJsonValue =
    advancedJsonOverride?.baseSnapshot === snapshot
      ? advancedJsonOverride.value
      : JSON.stringify(draft, null, 2);
  const advancedJsonError =
    advancedJsonErrorState?.baseSnapshot === snapshot
      ? advancedJsonErrorState.value
      : null;
  const saveValidationError =
    saveValidationErrorState?.baseSnapshot === snapshot
      ? saveValidationErrorState.value
      : null;
  const setDraft: Dispatch<SetStateAction<PolicySnapshotDto>> = (nextDraft) => {
    setDraftOverride((currentOverride) => {
      const currentDraft =
        currentOverride?.baseSnapshot === snapshot
          ? currentOverride.value
          : serverDraft;
      return {
        baseSnapshot: snapshot,
        value: typeof nextDraft === "function" ? nextDraft(currentDraft) : nextDraft,
      };
    });
    setAdvancedJsonOverride(null);
    setSaveValidationErrorState({ baseSnapshot: snapshot, value: null });
  };
  const setAdvancedJsonValue = (value: string) => {
    setAdvancedJsonOverride({ baseSnapshot: snapshot, value });
  };
  const setAdvancedJsonError = (value: string | null) => {
    setAdvancedJsonErrorState({ baseSnapshot: snapshot, value });
  };
  const setSaveValidationError = (value: string | null) => {
    setSaveValidationErrorState({ baseSnapshot: snapshot, value });
  };

  const modalityOptions = useMemo(() => {
    return (lookups.data?.modalities ?? [])
      .map((m) => {
        const modalityId = Number(m.id);
        const dailyCapacity = m.dailyCapacity == null ? null : Number(m.dailyCapacity);
        return Number.isFinite(modalityId)
          ? {
              value: modalityId,
              label: chooseLocalized(language, m.nameAr, m.nameEn) || m.name || m.code || `Modality ${modalityId}`,
              dailyCapacity: Number.isFinite(dailyCapacity) ? dailyCapacity : null,
            }
          : null;
      })
      .filter((option): option is ModalityOption => option != null);
  }, [language, lookups.data?.modalities]);

  const activeModalityIds = useMemo(() => {
    return (lookups.data?.modalities ?? [])
      .filter((modality) => modality.isActive)
      .map((modality) => Number(modality.id))
      .filter((modalityId) => Number.isFinite(modalityId) && modalityId > 0);
  }, [lookups.data?.modalities]);

  const examTypeOptionsByModality = useMemo(() => {
    const map = new Map<number, ExamTypeOption[]>();
    for (const examType of examTypeCatalog.data ?? []) {
      const modalityId = examType.modalityId == null ? null : Number(examType.modalityId);
      const examTypeId = Number(examType.id);
      if (modalityId == null || !Number.isFinite(modalityId) || !Number.isFinite(examTypeId)) continue;
      const list = map.get(modalityId) ?? [];
      list.push({
        value: examTypeId,
        label: chooseLocalized(language, examType.nameAr, examType.nameEn) || examType.name || examType.code || `Exam type ${examTypeId}`,
      });
      map.set(modalityId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return map;
  }, [examTypeCatalog.data, language]);

  const allExamTypeOptions = useMemo(() => {
    const values = examTypeCatalog.data ?? [];
    return values
      .map((examType) => {
        const examTypeId = Number(examType.id);
        return Number.isFinite(examTypeId)
          ? {
              value: examTypeId,
              label: chooseLocalized(language, examType.nameAr, examType.nameEn) || examType.name || examType.code || `Exam type ${examTypeId}`,
            }
          : null;
      })
      .filter((option): option is ExamTypeOption => option != null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [examTypeCatalog.data, language]);

  const examTypeById = useMemo(() => {
    const map = new Map<number, NonNullable<typeof examTypeCatalog.data>[number]>();
    for (const examType of examTypeCatalog.data ?? []) {
      map.set(Number(examType.id), examType);
    }
    for (const examType of displayLookups?.examTypes ?? []) {
      map.set(Number(examType.id), examType);
    }
    return map;
  }, [displayLookups?.examTypes, examTypeCatalog]);

  const policyUserOptions = useMemo(() => {
    return (policyUsers.data ?? [])
      .map((user) => ({
        value: Number(user.id),
        label: `${user.fullName || user.username} (${user.username})`,
      }))
      .filter((user) => Number.isInteger(user.value) && user.value > 0)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [policyUsers.data]);

  const lookupStatusMessage = useMemo(() => {
    if (lookups.isLoading || examTypeCatalog.isLoading || policyUsers.isLoading) {
      return { tone: "muted" as const, text: "Loading modality and exam type lookups..." };
    }
    if (lookups.isError || examTypeCatalog.isError || policyUsers.isError) {
      return { tone: "error" as const, text: "Failed to load modality or exam type lookups." };
    }
    if (modalityOptions.length === 0) {
      return { tone: "muted" as const, text: "No modalities available for policy editing." };
    }
    return null;
  }, [examTypeCatalog.isError, examTypeCatalog.isLoading, lookups.isError, lookups.isLoading, modalityOptions.length, policyUsers.isError, policyUsers.isLoading]);

  const hasDraftSnapshot = snapshot != null;
  const canSave = !lookups.isLoading && !examTypeCatalog.isLoading && !policyUsers.isLoading;

  async function handleSave() {
    if (!hasDraftSnapshot) return;
    if (externalValidationErrors.length > 0) {
      setSaveValidationError(externalValidationErrors[0] ?? "Resolve validation errors before saving.");
      return;
    }
    const categoryLimitsError = validateCategoryDailyLimits(draft.categoryDailyLimits, modalityOptions);
    if (categoryLimitsError) {
      setSaveValidationError(categoryLimitsError);
      return;
    }
    const emptyActiveExamRule = draft.examTypeRules.find((row) => row.isActive && row.examTypeIds.length === 0);
    if (emptyActiveExamRule) {
      setSaveValidationError("Active exam restriction rules must include at least one selected exam type.");
      return;
    }
    const emptyActiveExamMixGroup = (draft.examMixQuotaRules ?? []).find((row) => row.isActive && row.examTypeIds.length === 0);
    if (emptyActiveExamMixGroup) {
      setSaveValidationError("Active exam mix quota groups must include at least one selected exam type.");
      return;
    }
    await onSave(draft, changeNote.trim() || null);
  }

  function applyRawJson() {
    if (!window.confirm("Apply raw JSON changes to the draft form? This can overwrite structured edits.")) {
      return;
    }
    try {
      const parsed = JSON.parse(advancedJsonValue) as PolicySnapshotDto;
      setDraft(parsed);
      setAdvancedJsonError(null);
    } catch (error) {
      setAdvancedJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  }

  // Standardized input style - matches input-premium
  const inputBase = "input-premium text-xs";

  function formatExamTypeLabel(examTypeId: number): string {
    const examType = examTypeById.get(Number(examTypeId));
    if (!examType) return `Unknown exam type ID ${examTypeId}`;
    const label = chooseLocalized(language, examType.nameAr, examType.nameEn) || examType.name || examType.code || `Exam type ${examTypeId}`;
    const withCode = examType.code ? `${label} (${examType.code})` : label;
    return examType.isActive === false ? `${withCode} (inactive)` : withCode;
  }

  function updateExamRuleModality(index: number, modalityId: number): void {
    const current = draft.examTypeRules[index];
    if (current?.examTypeIds.length && !window.confirm("Changing modality will clear selected exams for this rule. Continue?")) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      examTypeRules: prev.examTypeRules.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, modalityId, examTypeIds: [] };
      }),
    }));
  }

  function updateExamMixModality(index: number, modalityId: number): void {
    const current = draft.examMixQuotaRules?.[index];
    if (current?.examTypeIds.length && !window.confirm("Changing modality will clear selected exams for this group. Continue?")) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return { ...item, modalityId, examTypeIds: [] };
      }),
    }));
  }

  function getFilteredExamOptions(filterKey: string, options: ExamTypeOption[]): ExamTypeOption[] {
    const filter = (availableExamFilters[filterKey] ?? "").trim().toLowerCase();
    if (!filter) return options;
    return options.filter((option) => option.label.toLowerCase().includes(filter));
  }

  function updateAvailableExamFilter(filterKey: string, value: string): void {
    setAvailableExamFilters((prev) => ({ ...prev, [filterKey]: value }));
  }

  function clearExamRuleSelections(index: number): void {
    const current = draft.examTypeRules[index];
    if (current?.examTypeIds.length && !window.confirm("Clear all selected exams from this exam restriction rule?")) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      examTypeRules: prev.examTypeRules.map((item, itemIndex) => (itemIndex === index ? { ...item, examTypeIds: [] } : item)),
    }));
  }

  function clearExamMixSelections(index: number): void {
    const current = draft.examMixQuotaRules?.[index];
    if (current?.examTypeIds.length && !window.confirm("Clear all selected exams from this exam mix group?")) {
      return;
    }
    setDraft((prev) => ({
      ...prev,
      examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
        itemIndex === index ? { ...item, examTypeIds: [] } : item
      ),
    }));
  }

  return (
    <Card>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Scheduling Policy Draft</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
        Edit policy rules using structured sections, then save snapshot changes to the active draft.
      </p>

      {!hasDraftSnapshot && (
        <div style={{ marginBottom: 12, color: "var(--text-muted, #64748b)", fontSize: 13 }}>
          Create a draft first to start editing policy rules.
        </div>
      )}

      {lookupStatusMessage && (
        <div
          style={{
            marginBottom: 12,
            fontSize: 12,
            color:
              lookupStatusMessage.tone === "error"
                ? "var(--color-error, #ef4444)"
                : "var(--text-muted, #64748b)",
          }}
        >
          {lookupStatusMessage.text}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Daily category limits</summary>
          <div style={{ display: "grid", gap: 8 }}>
            {draft.categoryDailyLimits.map((row, index) => (
              <div key={`${row.id}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-5">
                <select
                  className={inputBase}
                  value={row.modalityId}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      categoryDailyLimits: prev.categoryDailyLimits.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, modalityId: Number(event.target.value) } : item
                      ),
                    }))
                  }
                >
                  <option value={0}>Select modality...</option>
                  {modalityOptions.map((modality) => (
                    <option key={modality.value} value={modality.value}>
                      {modality.label}
                    </option>
                  ))}
                </select>
                <select
                  className={inputBase}
                  value={row.caseCategory}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      categoryDailyLimits: prev.categoryDailyLimits.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, caseCategory: event.target.value as "oncology" | "non_oncology" }
                          : item
                      ),
                    }))
                  }
                >
                  <option value="non_oncology">Non-oncology</option>
                  <option value="oncology">Oncology</option>
                </select>
                <input
                  className={inputBase}
                  type="number"
                  min={0}
                  value={row.dailyLimit}
                  onChange={(event) =>
                    setDraft((prev) => {
                      const rawValue = Number(event.target.value);
                      const nextLimits = prev.categoryDailyLimits.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dailyLimit: Number.isFinite(rawValue) ? rawValue : 0 } : item
                      );
                      const changedRow = nextLimits[index];
                      if (!changedRow) return { ...prev, categoryDailyLimits: nextLimits };
                      const modalityId = Number(changedRow.modalityId);
                      const modalityCapacity =
                        modalityOptions.find((option) => option.value === modalityId)?.dailyCapacity ?? null;
                      nextLimits[index] = {
                        ...changedRow,
                        dailyLimit: clampDailyLimit(Number(changedRow.dailyLimit), modalityCapacity),
                      };

                      return {
                        ...prev,
                        categoryDailyLimits: nextLimits,
                      };
                    })
                  }
                />
                <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        categoryDailyLimits: prev.categoryDailyLimits.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, isActive: event.target.checked } : item
                        ),
                      }))
                    }
                  />
                  Active
                </label>
                <button
                  type="button"
                  className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      categoryDailyLimits: prev.categoryDailyLimits.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  categoryDailyLimits: [
                    ...prev.categoryDailyLimits,
                    {
                      id: createNextId(prev.categoryDailyLimits),
                      modalityId: modalityOptions[0]?.value ?? 0,
                      caseCategory: "non_oncology",
                      dailyLimit: 0,
                      isActive: true,
                    } satisfies PolicyCategoryDailyLimitDto,
                  ],
                }))
              }
            >
              Add limit
            </button>
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Blocked dates</summary>
          <div style={{ display: "grid", gap: 8 }}>
            {draft.modalityBlockedRules.map((row, index) => (
              <div key={`${row.id}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <select
                  className={inputBase}
                  value={row.modalityId}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, modalityId: Number(event.target.value) } : item
                      ),
                    }))
                  }
                >
                  <option value={0}>Select modality...</option>
                  {modalityOptions.map((modality) => (
                    <option key={modality.value} value={modality.value}>
                      {modality.label}
                    </option>
                  ))}
                </select>
                <select
                  className={inputBase}
                  value={row.ruleType}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, ruleType: event.target.value as PolicyModalityBlockedRuleDto["ruleType"] }
                          : item
                      ),
                    }))
                  }
                >
                  <option value="specific_date">Specific date</option>
                  <option value="date_range">Date range</option>
                  <option value="yearly_recurrence">Yearly recurrence</option>
                </select>
                {row.ruleType === "specific_date" && (
                  <input
                    className={inputBase}
                    type="date"
                    value={row.specificDate ?? ""}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, specificDate: event.target.value || null } : item
                        ),
                      }))
                    }
                  />
                )}
                {row.ruleType === "date_range" && (
                  <>
                    <input
                      className={inputBase}
                      type="date"
                      value={row.startDate ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, startDate: event.target.value || null } : item
                          ),
                        }))
                      }
                    />
                    <input
                      className={inputBase}
                      type="date"
                      value={row.endDate ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, endDate: event.target.value || null } : item
                          ),
                        }))
                      }
                    />
                  </>
                )}
                {row.ruleType === "yearly_recurrence" && (
                  <>
                    <input
                      className={inputBase}
                      type="number"
                      min={1}
                      max={12}
                      placeholder="Start month"
                      value={row.recurStartMonth ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, recurStartMonth: event.target.value ? Number(event.target.value) : null }
                              : item
                          ),
                        }))
                      }
                    />
                    <input
                      className={inputBase}
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Start day"
                      value={row.recurStartDay ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, recurStartDay: event.target.value ? Number(event.target.value) : null }
                              : item
                          ),
                        }))
                      }
                    />
                    <input
                      className={inputBase}
                      type="number"
                      min={1}
                      max={12}
                      placeholder="End month"
                      value={row.recurEndMonth ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, recurEndMonth: event.target.value ? Number(event.target.value) : null }
                              : item
                          ),
                        }))
                      }
                    />
                    <input
                      className={inputBase}
                      type="number"
                      min={1}
                      max={31}
                      placeholder="End day"
                      value={row.recurEndDay ?? ""}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, recurEndDay: event.target.value ? Number(event.target.value) : null }
                              : item
                          ),
                        }))
                      }
                    />
                  </>
                )}
                <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={row.isOverridable}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, isOverridable: event.target.checked } : item
                        ),
                      }))
                    }
                  />
                  Supervisor can override
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, isActive: event.target.checked } : item
                        ),
                      }))
                    }
                  />
                  Active
                </label>
                <input
                  className={inputBase}
                  placeholder="Title (optional)"
                  value={row.title ?? ""}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, title: event.target.value || null } : item
                      ),
                    }))
                  }
                />
                <input
                  className={inputBase}
                  placeholder="Notes (optional)"
                  value={row.notes ?? ""}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      modalityBlockedRules: prev.modalityBlockedRules.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, notes: event.target.value || null } : item
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      modalityBlockedRules: prev.modalityBlockedRules.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  modalityBlockedRules: [
                    ...prev.modalityBlockedRules,
                    createBlockedRule(modalityOptions[0]?.value ?? 0, createNextId(prev.modalityBlockedRules)),
                  ],
                }))
              }
            >
              Add blocked rule
            </button>
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => {
                  if (activeModalityIds.length === 0 || prev.modalityBlockedRules.length === 0) {
                    return prev;
                  }
                  const template = prev.modalityBlockedRules.find((row) => Number(row.modalityId) > 0) ?? prev.modalityBlockedRules[0];
                  const existingModalityIds = new Set(
                    prev.modalityBlockedRules.map((row) => Number(row.modalityId)).filter((modalityId) => Number.isFinite(modalityId) && modalityId > 0)
                  );
                  const nextId = createNextId(prev.modalityBlockedRules);
                  const rows = activeModalityIds
                    .filter((modalityId) => !existingModalityIds.has(modalityId))
                    .map((modalityId, index) => cloneBlockedRule(template, modalityId, nextId + index));
                  return {
                    ...prev,
                    modalityBlockedRules: [...prev.modalityBlockedRules, ...rows],
                  };
                })
              }
            >
              Add blocked rule for all modalities
            </button>
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Exam restriction rules</summary>
          <div style={{ display: "grid", gap: 8 }}>
            {draft.examTypeRules.map((row, index) => {
              const rowModalityId = Number(row.modalityId);
              const examTypeOptionsForRow = examTypeOptionsByModality.get(rowModalityId) ?? [];
              const selectedModalityLabel = modalityOptions.find((m) => m.value === rowModalityId)?.label ?? "selected modality";
              const filterKey = `exam-rule-${row.id}-${index}`;
              const filteredExamTypeOptions = getFilteredExamOptions(filterKey, examTypeOptionsForRow);
              return (
                <div key={`${row.id}-${index}`} className="rounded border border-stone-300 p-3 text-xs dark:border-stone-600">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="m-0 text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {row.title || `Exam restriction rule #${index + 1}`}
                      </h3>
                      <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                        {selectedModalityLabel} - {formatRuleTypeLabel(row.ruleType)} - {formatEffectModeLabel(row.effectMode)} -{" "}
                        {formatScheduleSummary(row)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded border border-stone-300 px-2 py-1 text-[10px] font-semibold dark:border-stone-600">
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                      <span className="rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600">
                        {row.examTypeIds.length} selected
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Primary controls</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <select
                          className={inputBase}
                          value={row.modalityId}
                          onChange={(event) => updateExamRuleModality(index, Number(event.target.value))}
                        >
                          <option value={0}>Select modality...</option>
                          {modalityOptions.map((modality) => (
                            <option key={modality.value} value={modality.value}>
                              {modality.label}
                            </option>
                          ))}
                        </select>
                        <select
                          className={inputBase}
                          value={row.ruleType}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, ruleType: event.target.value as PolicyExamTypeRuleDto["ruleType"] }
                                  : item
                              ),
                            }))
                          }
                        >
                          <option value="specific_date">Specific date</option>
                          <option value="date_range">Date range</option>
                          <option value="weekly_recurrence">Weekly recurrence</option>
                        </select>
                        <select
                          className={inputBase}
                          value={row.effectMode}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, effectMode: event.target.value as PolicyExamTypeRuleDto["effectMode"] }
                                  : item
                              ),
                            }))
                          }
                        >
                          <option value="restriction_overridable">Supervisor-overridable restriction</option>
                          <option value="hard_restriction">Hard restriction</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Schedule controls</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        {row.ruleType === "specific_date" && (
                          <input
                            className={inputBase}
                            type="date"
                            value={row.specificDate ?? ""}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, specificDate: event.target.value || null } : item
                                ),
                              }))
                            }
                          />
                        )}
                        {row.ruleType === "date_range" && (
                          <>
                            <input
                              className={inputBase}
                              type="date"
                              value={row.startDate ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, startDate: event.target.value || null } : item
                                  ),
                                }))
                              }
                            />
                            <input
                              className={inputBase}
                              type="date"
                              value={row.endDate ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, endDate: event.target.value || null } : item
                                  ),
                                }))
                              }
                            />
                          </>
                        )}
                        {row.ruleType === "weekly_recurrence" && (
                          <>
                            <select
                              className={inputBase}
                              value={row.weekday ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, weekday: event.target.value ? Number(event.target.value) : null }
                                      : item
                                  ),
                                }))
                              }
                            >
                              <option value="">Select weekday...</option>
                              {weekdayLabels.map((weekday, weekdayIndex) => (
                                <option key={weekday} value={weekdayIndex}>
                                  {weekday}
                                </option>
                              ))}
                            </select>
                            <input
                              className={inputBase}
                              type="date"
                              value={row.recurrenceAnchorDate ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, recurrenceAnchorDate: event.target.value || null } : item
                                  ),
                                }))
                              }
                            />
                            <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                              <input
                                type="checkbox"
                                checked={row.alternateWeeks}
                                onChange={(event) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, alternateWeeks: event.target.checked } : item
                                    ),
                                  }))
                                }
                              />
                              Alternate weeks
                            </label>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded border border-stone-300 p-2 dark:border-stone-600">
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                        Selected exams ({row.examTypeIds.length})
                      </p>
                      {row.examTypeIds.length === 0 ? (
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">No selected exams.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.examTypeIds.map((examTypeId) => (
                            <span
                              key={examTypeId}
                              className="inline-flex items-center gap-1 rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600"
                            >
                              {formatExamTypeLabel(examTypeId)}
                              <button
                                type="button"
                                className="font-semibold text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                                aria-label={`Remove ${formatExamTypeLabel(examTypeId)}`}
                                onClick={() =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, examTypeIds: item.examTypeIds.filter((id) => id !== examTypeId) }
                                        : item
                                    ),
                                  }))
                                }
                              >
                                x
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded border border-stone-300 p-2 dark:border-stone-600">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Available exams to add</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        examTypeIds: [...new Set([...item.examTypeIds, ...examTypeOptionsForRow.map((option) => option.value)])],
                                      }
                                    : item
                                ),
                              }))
                            }
                            disabled={examTypeOptionsForRow.length === 0}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            className="rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600"
                            onClick={() => clearExamRuleSelections(index)}
                          >
                            Clear all
                          </button>
                        </div>
                      </div>
                      {rowModalityId === 0 ? (
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">Select a modality first.</p>
                      ) : examTypeOptionsForRow.length === 0 ? (
                        <p className="text-[11px] text-stone-400 dark:text-stone-500">
                          No active exam types available to add for {selectedModalityLabel}.
                        </p>
                      ) : (
                        <>
                          {examTypeOptionsForRow.length > 8 && (
                            <input
                              className={`${inputBase} mb-2`}
                              placeholder="Search available exams"
                              value={availableExamFilters[filterKey] ?? ""}
                              onChange={(event) => updateAvailableExamFilter(filterKey, event.target.value)}
                            />
                          )}
                          <p className="mb-2 text-[10px] text-stone-500 dark:text-stone-400">
                            Checked exams are the ones this rule blocks or restricts.
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {filteredExamTypeOptions.map((examTypeOption) => (
                              <label key={examTypeOption.value} className="inline-flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={row.examTypeIds.includes(examTypeOption.value)}
                                  onChange={(event) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      examTypeRules: prev.examTypeRules.map((item, itemIndex) => {
                                        if (itemIndex !== index) return item;
                                        return {
                                          ...item,
                                          examTypeIds: event.target.checked
                                            ? [...new Set([...item.examTypeIds, examTypeOption.value])]
                                            : item.examTypeIds.filter((id) => id !== examTypeOption.value),
                                        };
                                      }),
                                    }))
                                  }
                                />
                                {examTypeOption.label}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Notes/actions</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                        <input
                          className={inputBase}
                          placeholder="Title (optional)"
                          value={row.title ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, title: event.target.value || null } : item
                              ),
                            }))
                          }
                        />
                        <input
                          className={inputBase}
                          placeholder="Notes (optional)"
                          value={row.notes ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, notes: event.target.value || null } : item
                              ),
                            }))
                          }
                        />
                        <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                          <input
                            type="checkbox"
                            checked={row.isActive}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, isActive: event.target.checked } : item
                                ),
                              }))
                            }
                          />
                          Active
                        </label>
                        <button
                          type="button"
                          className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              examTypeRules: prev.examTypeRules.filter((_, itemIndex) => itemIndex !== index),
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  examTypeRules: [
                    ...prev.examTypeRules,
                    {
                      id: createNextId(prev.examTypeRules),
                      modalityId: 0,
                      ruleType: "specific_date",
                      effectMode: "restriction_overridable",
                      specificDate: null,
                      startDate: null,
                      endDate: null,
                      weekday: null,
                      alternateWeeks: false,
                      recurrenceAnchorDate: null,
                      examTypeIds: [],
                      title: null,
                      notes: null,
                      isActive: true,
                    } satisfies PolicyExamTypeRuleDto,
                  ],
                }))
              }
            >
              Add exam rule
            </button>
          </div>
        </details>

        <details open>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Exam mix quota groups</summary>
          <div style={{ display: "grid", gap: 8 }}>
            {(draft.examMixQuotaRules ?? []).map((row, index) => {
              const rowModalityId = Number(row.modalityId);
              const examTypeOptionsForRow = examTypeOptionsByModality.get(rowModalityId) ?? [];
              const selectedModalityLabel = modalityOptions.find((m) => m.value === rowModalityId)?.label ?? "selected modality";
              const filterKey = `exam-mix-${row.id}-${index}`;
              const filteredExamTypeOptions = getFilteredExamOptions(filterKey, examTypeOptionsForRow);
              return (
                <div key={`${row.id}-${index}`} className="rounded border border-stone-300 p-3 text-xs dark:border-stone-600">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="m-0 text-sm font-semibold text-stone-900 dark:text-stone-100">
                        {row.title || `Exam mix group #${index + 1}`}
                      </h3>
                      <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                        {selectedModalityLabel} - {formatRuleTypeLabel(row.ruleType)} - Daily limit {row.dailyLimit} -{" "}
                        {formatScheduleSummary(row)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className="rounded border border-stone-300 px-2 py-1 text-[10px] font-semibold dark:border-stone-600">
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                      <span className="rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600">
                        {row.examTypeIds.length} selected
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Primary controls</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                        <select
                          className={inputBase}
                          value={row.modalityId}
                          onChange={(event) => updateExamMixModality(index, Number(event.target.value))}
                        >
                          <option value={0}>Select modality...</option>
                          {modalityOptions.map((modality) => (
                            <option key={modality.value} value={modality.value}>
                              {modality.label}
                            </option>
                          ))}
                        </select>
                        <input
                          className={inputBase}
                          placeholder="Group title"
                          value={row.title ?? ""}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                itemIndex === index ? { ...item, title: event.target.value || null } : item
                              ),
                            }))
                          }
                        />
                        <select
                          className={inputBase}
                          value={row.ruleType}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, ruleType: event.target.value as PolicyExamMixQuotaRuleDto["ruleType"] }
                                  : item
                              ),
                            }))
                          }
                        >
                          <option value="specific_date">Specific date</option>
                          <option value="date_range">Date range</option>
                          <option value="weekly_recurrence">Weekly recurrence</option>
                        </select>
                        <input
                          className={inputBase}
                          type="number"
                          min={1}
                          value={row.dailyLimit}
                          onChange={(event) =>
                            setDraft((prev) => ({
                              ...prev,
                              examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                itemIndex === index ? { ...item, dailyLimit: Number(event.target.value) } : item
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Schedule controls</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        {row.ruleType === "specific_date" && (
                          <input
                            className={inputBase}
                            type="date"
                            value={row.specificDate ?? ""}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, specificDate: event.target.value || null } : item
                                ),
                              }))
                            }
                          />
                        )}
                        {row.ruleType === "date_range" && (
                          <>
                            <input
                              className={inputBase}
                              type="date"
                              value={row.startDate ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, startDate: event.target.value || null } : item
                                  ),
                                }))
                              }
                            />
                            <input
                              className={inputBase}
                              type="date"
                              value={row.endDate ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, endDate: event.target.value || null } : item
                                  ),
                                }))
                              }
                            />
                          </>
                        )}
                        {row.ruleType === "weekly_recurrence" && (
                          <>
                            <select
                              className={inputBase}
                              value={row.weekday ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, weekday: event.target.value ? Number(event.target.value) : null }
                                      : item
                                  ),
                                }))
                              }
                            >
                              <option value="">Select weekday...</option>
                              {weekdayLabels.map((weekday, weekdayIndex) => (
                                <option key={weekday} value={weekdayIndex}>
                                  {weekday}
                                </option>
                              ))}
                            </select>
                            <input
                              className={inputBase}
                              type="date"
                              value={row.recurrenceAnchorDate ?? ""}
                              onChange={(event) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, recurrenceAnchorDate: event.target.value || null }
                                      : item
                                  ),
                                }))
                              }
                            />
                            <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                              <input
                                type="checkbox"
                                checked={row.alternateWeeks}
                                onChange={(event) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                      itemIndex === index ? { ...item, alternateWeeks: event.target.checked } : item
                                    ),
                                  }))
                                }
                              />
                              Alternate weeks
                            </label>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="rounded border border-stone-300 p-2 dark:border-stone-600">
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                        Selected exams ({row.examTypeIds.length})
                      </p>
                      {row.examTypeIds.length === 0 ? (
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">No selected exams.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.examTypeIds.map((examTypeId) => (
                            <span
                              key={examTypeId}
                              className="inline-flex items-center gap-1 rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600"
                            >
                              {formatExamTypeLabel(examTypeId)}
                              <button
                                type="button"
                                className="font-semibold text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
                                aria-label={`Remove ${formatExamTypeLabel(examTypeId)}`}
                                onClick={() =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, examTypeIds: item.examTypeIds.filter((id) => id !== examTypeId) }
                                        : item
                                    ),
                                  }))
                                }
                              >
                                x
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded border border-stone-300 p-2 dark:border-stone-600">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Available exams to add</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        examTypeIds: [...new Set([...item.examTypeIds, ...examTypeOptionsForRow.map((option) => option.value)])],
                                      }
                                    : item
                                ),
                              }))
                            }
                            disabled={examTypeOptionsForRow.length === 0}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            className="rounded border border-stone-300 px-2 py-1 text-[10px] dark:border-stone-600"
                            onClick={() => clearExamMixSelections(index)}
                          >
                            Clear all
                          </button>
                        </div>
                      </div>
                      {rowModalityId === 0 ? (
                        <p className="text-[11px] text-stone-500 dark:text-stone-400">Select a modality first.</p>
                      ) : examTypeOptionsForRow.length === 0 ? (
                        <p className="text-[11px] text-stone-400 dark:text-stone-500">
                          No active exam types available to add for {selectedModalityLabel}.
                        </p>
                      ) : (
                        <>
                          {examTypeOptionsForRow.length > 8 && (
                            <input
                              className={`${inputBase} mb-2`}
                              placeholder="Search available exams"
                              value={availableExamFilters[filterKey] ?? ""}
                              onChange={(event) => updateAvailableExamFilter(filterKey, event.target.value)}
                            />
                          )}
                          <div className="flex flex-wrap gap-1">
                            {filteredExamTypeOptions.map((examTypeOption) => (
                              <label key={examTypeOption.value} className="inline-flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={row.examTypeIds.includes(examTypeOption.value)}
                                  onChange={(event) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) => {
                                        if (itemIndex !== index) return item;
                                        return {
                                          ...item,
                                          examTypeIds: event.target.checked
                                            ? [...new Set([...item.examTypeIds, examTypeOption.value])]
                                            : item.examTypeIds.filter((id) => id !== examTypeOption.value),
                                        };
                                      }),
                                    }))
                                  }
                                />
                                {examTypeOption.label}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-[11px] font-semibold text-stone-600 dark:text-stone-300">Notes/actions</p>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                          <input
                            type="checkbox"
                            checked={row.isActive}
                            onChange={(event) =>
                              setDraft((prev) => ({
                                ...prev,
                                examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, isActive: event.target.checked } : item
                                ),
                              }))
                            }
                          />
                          Active
                        </label>
                        <button
                          type="button"
                          className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              examMixQuotaRules: (prev.examMixQuotaRules ?? []).filter((_, itemIndex) => itemIndex !== index),
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  examMixQuotaRules: [
                    ...(prev.examMixQuotaRules ?? []),
                    {
                      id: createNextId(prev.examMixQuotaRules ?? []),
                      modalityId: 0,
                      title: null,
                      ruleType: "specific_date",
                      specificDate: null,
                      startDate: null,
                      endDate: null,
                      weekday: null,
                      alternateWeeks: false,
                      recurrenceAnchorDate: null,
                      dailyLimit: 1,
                      examTypeIds: [],
                      isActive: true,
                    } satisfies PolicyExamMixQuotaRuleDto,
                  ],
                }))
              }
            >
              Add exam mix group
            </button>
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Special quotas</summary>
          <div style={{ display: "grid", gap: 8 }}>
            {draft.examTypeSpecialQuotas.map((row, index) => {
              const rowExamType = examTypeById.get(Number(row.examTypeId));
              const rowModalityId = rowExamType?.modalityId == null ? 0 : Number(rowExamType.modalityId);
              const filteredExamTypeOptions = rowModalityId > 0 ? examTypeOptionsByModality.get(rowModalityId) ?? [] : [];
              return (
              <div key={`${row.id}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-6">
                <select
                  className={inputBase}
                  value={rowModalityId}
                  onChange={(event) => {
                    const modalityId = Number(event.target.value);
                    const firstExamTypeId = examTypeOptionsByModality.get(modalityId)?.[0]?.value ?? 0;
                    setDraft((prev) => ({
                      ...prev,
                      examTypeSpecialQuotas: prev.examTypeSpecialQuotas.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, examTypeId: firstExamTypeId } : item
                      ),
                    }));
                  }}
                >
                  <option value={0}>Select modality...</option>
                  {modalityOptions.map((modality) => (
                    <option key={modality.value} value={modality.value}>
                      {modality.label}
                    </option>
                  ))}
                </select>
                <select
                  className={inputBase}
                  multiple
                  value={row.examTypeId ? [String(row.examTypeId)] : []}
                  onChange={(event) => {
                    const selectedExamTypeIds = Array.from(event.currentTarget.selectedOptions)
                      .map((option) => Number(option.value))
                      .filter((examTypeId) => Number.isInteger(examTypeId) && examTypeId > 0);
                    setDraft((prev) => {
                      const replacement =
                        selectedExamTypeIds.length === 0
                          ? [{ ...row, examTypeId: 0 }]
                          : selectedExamTypeIds.map((examTypeId, selectedIndex) => ({
                              ...row,
                              id: selectedIndex === 0 ? row.id : createNextId(prev.examTypeSpecialQuotas) + selectedIndex,
                              examTypeId,
                              allowedUserIds: row.allowedUserIds ?? [],
                            }));
                      return {
                        ...prev,
                        examTypeSpecialQuotas: [
                          ...prev.examTypeSpecialQuotas.slice(0, index),
                          ...replacement,
                          ...prev.examTypeSpecialQuotas.slice(index + 1),
                        ],
                      };
                    });
                  }}
                >
                  {filteredExamTypeOptions.map((examType) => (
                    <option key={examType.value} value={examType.value}>
                      {examType.label}
                    </option>
                  ))}
                </select>
                <input
                  className={inputBase}
                  type="number"
                  min={0}
                  value={row.dailyExtraSlots}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      examTypeSpecialQuotas: prev.examTypeSpecialQuotas.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dailyExtraSlots: Number(event.target.value) } : item
                      ),
                    }))
                  }
                />
                <select
                  className={inputBase}
                  multiple
                  value={(row.allowedUserIds ?? []).map(String)}
                  onChange={(event) => {
                    const allowedUserIds = Array.from(event.currentTarget.selectedOptions)
                      .map((option) => Number(option.value))
                      .filter((userId) => Number.isInteger(userId) && userId > 0);
                    setDraft((prev) => ({
                      ...prev,
                      examTypeSpecialQuotas: prev.examTypeSpecialQuotas.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, allowedUserIds } : item
                      ),
                    }));
                  }}
                >
                  {policyUserOptions.map((user) => (
                    <option key={user.value} value={user.value}>
                      {user.label}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        examTypeSpecialQuotas: prev.examTypeSpecialQuotas.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, isActive: event.target.checked } : item
                        ),
                      }))
                    }
                  />
                  Active
                </label>
                <button
                  type="button"
                  className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      examTypeSpecialQuotas: prev.examTypeSpecialQuotas.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            );
            })}
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  examTypeSpecialQuotas: [
                    ...prev.examTypeSpecialQuotas,
                    {
                      id: createNextId(prev.examTypeSpecialQuotas),
                      examTypeId: allExamTypeOptions[0]?.value ?? 0,
                      dailyExtraSlots: 0,
                      allowedUserIds: [],
                      isActive: true,
                    } satisfies PolicyExamTypeSpecialQuotaDto,
                  ],
                }))
              }
            >
              Add special quota
            </button>
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Special reason codes</summary>
          <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 8 }}>
            Editable global list used when staff choose special quota extra slots.
          </p>
          <div className="grid gap-2">
            {draft.specialReasonCodes.map((row, index) => (
              <div key={`${row.code || "new"}-${index}`} className="grid gap-2 rounded border border-stone-200 p-2 dark:border-stone-700 md:grid-cols-[1fr_1.5fr_1.5fr_auto_auto]">
                <input
                  className={inputBase}
                  placeholder="code"
                  value={row.code}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      specialReasonCodes: prev.specialReasonCodes.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, code: event.target.value } : item
                      ),
                    }))
                  }
                />
                <input
                  className={inputBase}
                  placeholder="English label"
                  value={row.labelEn}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      specialReasonCodes: prev.specialReasonCodes.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, labelEn: event.target.value } : item
                      ),
                    }))
                  }
                />
                <input
                  className={inputBase}
                  dir="rtl"
                  placeholder="Arabic label"
                  value={row.labelAr}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      specialReasonCodes: prev.specialReasonCodes.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, labelAr: event.target.value } : item
                      ),
                    }))
                  }
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        specialReasonCodes: prev.specialReasonCodes.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, isActive: event.target.checked } : item
                        ),
                      }))
                    }
                  />
                  Active
                </label>
                <button
                  type="button"
                  className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      specialReasonCodes: prev.specialReasonCodes.filter((_, itemIndex) => itemIndex !== index),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="w-fit rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  specialReasonCodes: [
                    ...prev.specialReasonCodes,
                    { code: "", labelAr: "", labelEn: "", isActive: true },
                  ],
                }))
              }
            >
              Add special reason
            </button>
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Patient identifier types</summary>
          <div
            style={{
              padding: 8,
              border: "1px solid var(--border-color, #e2e8f0)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Patient identifier types are not part of the current policy snapshot contract.
            Manage identifier types in Settings until the scheduling administration DTO includes this section.
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Advanced / Raw JSON</summary>
          <p style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginBottom: 8 }}>
            Debug panel only. Raw JSON is hidden by default.
          </p>
          <textarea
            value={advancedJsonValue}
            onChange={(event) => setAdvancedJsonValue(event.target.value)}
            rows={14}
            style={{
              width: "100%",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              border: "1px solid var(--border-color, #e2e8f0)",
              borderRadius: 6,
              padding: 10,
              marginBottom: 8,
              background: "#fff",
            }}
          />
          {advancedJsonError && (
            <div style={{ color: "var(--color-error, #ef4444)", fontSize: 12, marginBottom: 8 }}>
              Invalid snapshot JSON: {advancedJsonError}
            </div>
          )}
          <button
            type="button"
            onClick={applyRawJson}
            className="rounded border border-stone-300 px-2 py-1 text-xs dark:border-stone-600"
          >
            Apply JSON to form
          </button>
        </details>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {saveValidationError && (
          <div
            style={{
              color: "var(--accent)",
              fontSize: 12,
              marginBottom: 8,
              border: "1px solid rgba(255, 71, 87, 0.3)",
              borderRadius: "var(--radius-md)",
              padding: "8px 12px",
              background: "rgba(255, 71, 87, 0.1)",
            }}
          >
            {saveValidationError}
          </div>
        )}
        <input
          type="text"
          placeholder="Change note (optional)"
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid var(--border-color, #e2e8f0)",
            borderRadius: 6,
          }}
        />
                <Button
                  onClick={handleSave}
                  disabled={isSaving || !canSave}
                  style={{
                    backgroundColor: canSave ? "var(--blue)" : "var(--border)",
                    color: canSave ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {isSaving ? "Saving..." : "Save Draft"}
                 </Button>
      </div>
    </Card>
  );
}
