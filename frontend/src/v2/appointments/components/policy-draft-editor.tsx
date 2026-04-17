import { useEffect, useMemo, useState } from "react";
import { useV2ExamTypeCatalog, useV2Lookups } from "../api";
import type {
  PolicyCategoryDailyLimitDto,
  PolicyExamMixQuotaRuleDto,
  PolicyExamTypeRuleDto,
  PolicyExamTypeSpecialQuotaDto,
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

export function PolicyDraftEditor({
  snapshot,
  onSave,
  isSaving,
}: {
  snapshot: PolicySnapshotDto | null;
  onSave: (nextSnapshot: PolicySnapshotDto, changeNote: string | null) => Promise<void>;
  isSaving: boolean;
}) {
  const lookups = useV2Lookups();
  const examTypeCatalog = useV2ExamTypeCatalog();
  const [draft, setDraft] = useState<PolicySnapshotDto>(emptySnapshot());
  const [changeNote, setChangeNote] = useState("");
  const [advancedJsonValue, setAdvancedJsonValue] = useState("");
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null);

  useEffect(() => {
    const next = snapshot ?? emptySnapshot();
    setDraft(next);
    setAdvancedJsonValue(JSON.stringify(next, null, 2));
    setAdvancedJsonError(null);
  }, [snapshot]);

  useEffect(() => {
    setAdvancedJsonValue(JSON.stringify(draft, null, 2));
  }, [draft]);

  const modalityOptions = useMemo(() => {
    return (lookups.data?.modalities ?? []).map((m) => ({
      value: m.id,
      label: m.name || m.code || `Modality ${m.id}`,
    }));
  }, [lookups.data?.modalities]);

  const examTypeOptionsByModality = useMemo(() => {
    const map = new Map<number, Array<{ value: number; label: string }>>();
    for (const examType of examTypeCatalog.data ?? []) {
      if (examType.modalityId == null) continue;
      const list = map.get(examType.modalityId) ?? [];
      list.push({
        value: examType.id,
        label: examType.name || examType.code || `Exam type ${examType.id}`,
      });
      map.set(examType.modalityId, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return map;
  }, [examTypeCatalog.data]);

  const allExamTypeOptions = useMemo(() => {
    const values = examTypeCatalog.data ?? [];
    return values
      .map((examType) => ({
        value: examType.id,
        label: examType.name || examType.code || `Exam type ${examType.id}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [examTypeCatalog.data]);

  const lookupStatusMessage = useMemo(() => {
    if (lookups.isLoading || examTypeCatalog.isLoading) {
      return { tone: "muted" as const, text: "Loading modality and exam type lookups..." };
    }
    if (lookups.isError || examTypeCatalog.isError) {
      return { tone: "error" as const, text: "Failed to load modality or exam type lookups." };
    }
    if (modalityOptions.length === 0) {
      return { tone: "muted" as const, text: "No modalities available for policy editing." };
    }
    return null;
  }, [examTypeCatalog.isError, examTypeCatalog.isLoading, lookups.isError, lookups.isLoading, modalityOptions.length]);

  const hasDraftSnapshot = snapshot != null;

  async function handleSave() {
    if (!hasDraftSnapshot) return;
    await onSave(draft, changeNote.trim() || null);
  }

  function applyRawJson() {
    try {
      const parsed = JSON.parse(advancedJsonValue) as PolicySnapshotDto;
      // specialReasonCodes are global config — raw JSON cannot modify them.
      // Preserve the current global value so users cannot fake-edit via JSON.
      parsed.specialReasonCodes = [...draft.specialReasonCodes];
      setDraft(parsed);
      setAdvancedJsonError(null);
    } catch (error) {
      setAdvancedJsonError(error instanceof Error ? error.message : "Invalid JSON");
    }
  }

  const inputBase =
    "w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100";

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid var(--border-color, #e2e8f0)",
        backgroundColor: "var(--bg-surface, #f8fafc)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Scheduling Policy Draft</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted, #64748b)", marginBottom: 12 }}>
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
                    setDraft((prev) => ({
                      ...prev,
                      categoryDailyLimits: prev.categoryDailyLimits.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, dailyLimit: Number(event.target.value) } : item
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
                    {
                      id: createNextId(prev.modalityBlockedRules),
                      modalityId: modalityOptions[0]?.value ?? 0,
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
                    } satisfies PolicyModalityBlockedRuleDto,
                  ],
                }))
              }
            >
              Add blocked rule
            </button>
          </div>
        </details>

        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600, marginBottom: 8 }}>Exam date rules</summary>
          <div style={{ display: "grid", gap: 8 }}>
            {draft.examTypeRules.map((row, index) => {
              const examTypeOptionsForRow = examTypeOptionsByModality.get(row.modalityId) ?? [];
              const selectedModalityLabel = modalityOptions.find((m) => m.value === row.modalityId)?.label ?? "selected modality";
              return (
                <div key={`${row.id}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <select
                    className={inputBase}
                    value={row.modalityId}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, modalityId: Number(event.target.value), examTypeIds: [] }
                            : item
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
                            ? {
                                ...item,
                                effectMode: event.target.value as PolicyExamTypeRuleDto["effectMode"],
                              }
                            : item
                        ),
                      }))
                    }
                  >
                    <option value="restriction_overridable">Restricted unless supervisor approves</option>
                    <option value="hard_restriction">Hard restriction</option>
                  </select>
                  <div className="rounded border border-stone-300 p-2 text-xs dark:border-stone-600">
                    <p className="mb-1 text-[11px] text-stone-500 dark:text-stone-400">Exam types</p>
                    {row.modalityId === 0 ? (
                      <p className="text-[11px] text-stone-500 dark:text-stone-400">Select a modality first.</p>
                    ) : examTypeOptionsForRow.length === 0 ? (
                      <div className="text-[11px] text-stone-400 dark:text-stone-500 leading-relaxed">
                        <p>No exam types configured for {selectedModalityLabel}.</p>
                        <p className="mt-1 text-[10px] text-stone-400">Add exam types in Settings before using this modality.</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {examTypeOptionsForRow.map((examTypeOption) => (
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
                                        ? [...item.examTypeIds, examTypeOption.value]
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
                    )}
                  </div>

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
                        <option value={0}>Sunday</option>
                        <option value={1}>Monday</option>
                        <option value={2}>Tuesday</option>
                        <option value={3}>Wednesday</option>
                        <option value={4}>Thursday</option>
                        <option value={5}>Friday</option>
                        <option value={6}>Saturday</option>
                      </select>
                      <input
                        className={inputBase}
                        type="date"
                        value={row.recurrenceAnchorDate ?? ""}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            examTypeRules: prev.examTypeRules.map((item, itemIndex) =>
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
                      modalityId: modalityOptions[0]?.value ?? 0,
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
              const examTypeOptionsForRow = examTypeOptionsByModality.get(row.modalityId) ?? [];
              const selectedModalityLabel = modalityOptions.find((m) => m.value === row.modalityId)?.label ?? "selected modality";
              return (
                <div key={`${row.id}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  <select
                    className={inputBase}
                    value={row.modalityId}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        examMixQuotaRules: (prev.examMixQuotaRules ?? []).map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, modalityId: Number(event.target.value), examTypeIds: [] }
                            : item
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
                  <div className="rounded border border-stone-300 p-2 text-xs dark:border-stone-600">
                    <p className="mb-1 text-[11px] text-stone-500 dark:text-stone-400">Exam types in group</p>
                    {row.modalityId === 0 ? (
                      <p className="text-[11px] text-stone-500 dark:text-stone-400">Select a modality first.</p>
                    ) : examTypeOptionsForRow.length === 0 ? (
                      <div className="text-[11px] text-stone-400 dark:text-stone-500 leading-relaxed">
                        <p>No exam types configured for {selectedModalityLabel}.</p>
                        <p className="mt-1 text-[10px] text-stone-400">Add exam types in Settings before using this modality.</p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {examTypeOptionsForRow.map((examTypeOption) => (
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
                                        ? [...item.examTypeIds, examTypeOption.value]
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
                    )}
                  </div>
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
                        <option value={0}>Sunday</option>
                        <option value={1}>Monday</option>
                        <option value={2}>Tuesday</option>
                        <option value={3}>Wednesday</option>
                        <option value={4}>Thursday</option>
                        <option value={5}>Friday</option>
                        <option value={6}>Saturday</option>
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
                      modalityId: modalityOptions[0]?.value ?? 0,
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
            {draft.examTypeSpecialQuotas.map((row, index) => (
              <div key={`${row.id}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <select
                  className={inputBase}
                  value={row.examTypeId}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      examTypeSpecialQuotas: prev.examTypeSpecialQuotas.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, examTypeId: Number(event.target.value) } : item
                      ),
                    }))
                  }
                >
                  <option value={0}>Select exam type...</option>
                  {allExamTypeOptions.map((examType) => (
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
            ))}
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
          <div
            style={{
              padding: 8,
              border: "1px solid var(--border-color, #e2e8f0)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--text-muted, #64748b)",
            }}
          >
            Special reason codes are global configuration and are not managed per-policy version.
            They are shown here for reference only.
            Changes to special reason codes must be made through the legacy settings page,
            not through the V2 draft editor.
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
            Patient identifier types are not part of the current V2 policy snapshot contract.
            Manage identifier types in Settings until the V2 admin DTO includes this section.
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
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || !hasDraftSnapshot}
          style={{
            padding: "8px 14px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "var(--color-primary, #3b82f6)",
            color: "#fff",
            cursor: isSaving || !hasDraftSnapshot ? "not-allowed" : "pointer",
            opacity: isSaving || !hasDraftSnapshot ? 0.6 : 1,
            width: "fit-content",
          }}
        >
          {isSaving ? "Saving..." : "Save Draft Snapshot"}
        </button>
      </div>
    </div>
  );
}
