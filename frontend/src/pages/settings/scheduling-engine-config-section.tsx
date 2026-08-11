import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchExamTypes,
  fetchModalitiesSettings,
  fetchSchedulingEngineConfig,
  saveSchedulingEngineConfig,
} from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";
import type { SchedulingEngineConfig } from "@/types/api";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

const RULE_TYPE_LABELS: Record<string, string> = {
  specific_date: "تاريخ محدد",
  date_range: "نطاق تاريخ",
  yearly_recurrence: "تكرار سنوي",
  weekly_recurrence: "تكرار أسبوعي"
};

const EFFECT_MODE_LABELS: Record<string, string> = {
  restriction_overridable: "مقيد ما لم يوافق المشرف",
  hard_restriction: "تقييد صارم"
};

const WEEKDAY_LABELS: Record<string, string> = {
  "0": "الأحد",
  "1": "الاثنين",
  "2": "الثلاثاء",
  "3": "الأربعاء",
  "4": "الخميس",
  "5": "الجمعة",
  "6": "السبت"
};

const SECTION_HELPERS: Record<string, string> = {
  categoryLimits: "اضبط الحد اليومي لحالات الأورام وغير الأورام.",
  blockedRules: "احجب التواريخ الكاملة أو نطاقات التواريخ لجهاز معين.",
  examRules: "الفحوصات المحددة هي التي تحجبها هذه القاعدة أو تقيدها.",
  specialQuotas: "أضف عدداً قليلاً من الخانات الإضافية لأنواع فحص محددة.",
  specialReasons: "الأسباب التي يمكن للموظفين اختيارها عند استخدام حصة خاصة.",
  identifierTypes: "أنواع هوية إضافية للمريض متاحة أثناء التسجيل."
};

const SECTION_TITLES: Record<string, string> = {
  categoryLimits: "الحدود اليومية للفئات",
  blockedRules: "التواريخ المحجوبة",
  examRules: "قواعد تقييد الفحص",
  specialQuotas: "الحصص الخاصة",
  specialReasons: "رموز الأسباب الخاصة",
  identifierTypes: "أنواع هوية المريض"
};

const ACTION_LABELS = {
  add: {
    categoryLimits: "إضافة حد",
    blockedRules: "إضافة قاعدة",
    examRules: "إضافة قاعدة",
    specialQuotas: "إضافة حصة",
    specialReasons: "إضافة سبب",
    identifierTypes: "إضافة نوع"
  },
  remove: "إزالة",
  active: "مفعل",
  overridable: "يمكن للمشرف التجاوز",
  alternateWeeks: "أسابيع متناوبة فقط",
  save: "حفظ إعدادات الجدولة",
  reset: "إعادة القيم من الخادم",
  saving: "جاري الحفظ…"
} as const;

export default function SchedulingEngineConfigSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // Lookup data for dropdowns
  const { data: modalityLookup } = useQuery<{ modalities: Record<string, unknown>[] }>({
    queryKey: ["modalities-settings"],
    queryFn: () => fetchModalitiesSettings(true),
    staleTime: 1000 * 60 * 10
  });
  const { data: examTypeLookup } = useQuery<{ examTypes: Record<string, unknown>[] }>({
    queryKey: ["exam-types-settings"],
    queryFn: () => fetchExamTypes(true),
    staleTime: 1000 * 60 * 10
  });

  type CategoryLimitRow = {
    id?: number;
    modalityId: string;
    caseCategory: "oncology" | "non_oncology";
    dailyLimit: string;
    isActive: boolean;
  };
  type BlockedRuleRow = {
    id?: number;
    modalityId: string;
    ruleType: "specific_date" | "date_range" | "yearly_recurrence";
    specificDate: string;
    startDate: string;
    endDate: string;
    recurStartMonth: string;
    recurStartDay: string;
    recurEndMonth: string;
    recurEndDay: string;
    isOverridable: boolean;
    isActive: boolean;
    title: string;
    notes: string;
  };
  type ExamRuleRow = {
    id?: number;
    modalityId: string;
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    effectMode: "hard_restriction" | "restriction_overridable";
    specificDate: string;
    startDate: string;
    endDate: string;
    weekday: string;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string;
    examTypeIds: number[];
    isActive: boolean;
    title: string;
    notes: string;
  };
  type SpecialQuotaRow = {
    id?: number;
    examTypeId: string;
    dailyExtraSlots: string;
    isActive: boolean;
  };
  type SpecialReasonRow = {
    code: string;
    labelEn: string;
    labelAr: string;
    isActive: boolean;
  };
  type IdentifierTypeRow = {
    id?: number;
    code: string;
    labelEn: string;
    labelAr: string;
    isActive: boolean;
  };
  type SchedulingDraft = {
    categoryLimits: CategoryLimitRow[];
    blockedRules: BlockedRuleRow[];
    examRules: ExamRuleRow[];
    specialQuotas: SpecialQuotaRow[];
    specialReasons: SpecialReasonRow[];
    identifierTypes: IdentifierTypeRow[];
  };
  type SchedulingDraftOverride = {
    baseUpdatedAt: number;
    value: SchedulingDraft;
  };

  const emptyDraft = (): SchedulingDraft => ({
    categoryLimits: [],
    blockedRules: [],
    examRules: [],
    specialQuotas: [],
    specialReasons: [],
    identifierTypes: []
  });
  const [draftOverride, setDraftOverride] = useState<SchedulingDraftOverride | null>(null);
  const { data, dataUpdatedAt, isLoading, error } = useQuery({
    queryKey: ["scheduling-engine-config"],
    queryFn: fetchSchedulingEngineConfig
  });

  const asArray = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const asText = (value: unknown): string => String(value ?? "").trim();
  const asDate = (value: unknown): string => String(value ?? "").slice(0, 10);
  const asBool = (value: unknown, fallback = true): boolean => {
    if (typeof value === "boolean") return value;
    const raw = String(value ?? "").toLowerCase();
    if (["1", "true", "yes", "enabled", "on"].includes(raw)) return true;
    if (["0", "false", "no", "disabled", "off"].includes(raw)) return false;
    return fallback;
  };
  const asNum = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  };

  type ModalityLookupRow = Record<string, unknown> & {
    nameEn?: string;
    name_en?: string;
  };
  type ExamTypeLookupRow = ModalityLookupRow & {
    modalityId?: unknown;
    modality_id?: unknown;
  };

  // Build modality options for dropdowns
  const modalityOptions = useMemo(() => {
    const rows: ModalityLookupRow[] = Array.isArray(modalityLookup?.modalities) ? modalityLookup.modalities : [];
    return rows
      .filter((modality) => modality.isActive !== false)
      .map((modality) => ({ value: String(modality.id), label: modality.nameEn || modality.name_en || `Modality ${modality.id}` }));
  }, [modalityLookup]);

  // Build exam type options for dropdowns
  const examTypeOptions = useMemo(() => {
    const rows: ExamTypeLookupRow[] = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((examType) => examType.isActive !== false)
      .map((examType) => ({ value: String(examType.id), label: examType.nameEn || examType.name_en || `Exam ${examType.id}` }));
  }, [examTypeLookup]);

  // Build exam type options with modality for filtering
  const examTypeOptionsWithModality = useMemo(() => {
    const rows: ExamTypeLookupRow[] = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((examType) => examType.isActive !== false)
      .map((examType) => ({
        value: String(examType.id),
        label: examType.nameEn || examType.name_en || `Exam ${examType.id}`,
        modalityId: examType.modalityId ?? examType.modality_id
      }));
  }, [examTypeLookup]);

  const normalizeConfig = (raw: SchedulingEngineConfig): SchedulingDraft => {
    const categoryLimits = asArray(raw.categoryLimits).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      caseCategory: (asText(row.caseCategory ?? row.case_category) === "oncology" ? "oncology" : "non_oncology") as
        | "oncology"
        | "non_oncology",
      dailyLimit: asText(row.dailyLimit ?? row.daily_limit ?? 0),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const blockedRules = asArray(raw.blockedRules).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      ruleType: (asText(row.ruleType ?? row.rule_type) as BlockedRuleRow["ruleType"]) || "specific_date",
      specificDate: asDate(row.specificDate ?? row.specific_date),
      startDate: asDate(row.startDate ?? row.start_date),
      endDate: asDate(row.endDate ?? row.end_date),
      recurStartMonth: asText(row.recurStartMonth ?? row.recur_start_month),
      recurStartDay: asText(row.recurStartDay ?? row.recur_start_day),
      recurEndMonth: asText(row.recurEndMonth ?? row.recur_end_month),
      recurEndDay: asText(row.recurEndDay ?? row.recur_end_day),
      isOverridable: asBool(row.isOverridable ?? row.is_overridable, false),
      isActive: asBool(row.isActive ?? row.is_active, true),
      title: asText(row.title),
      notes: asText(row.notes)
    }));
    const examRules = asArray(raw.examRules).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      ruleType: (asText(row.ruleType ?? row.rule_type) as ExamRuleRow["ruleType"]) || "specific_date",
      effectMode:
        (asText(row.effectMode ?? row.effect_mode) as ExamRuleRow["effectMode"]) || "restriction_overridable",
      specificDate: asDate(row.specificDate ?? row.specific_date),
      startDate: asDate(row.startDate ?? row.start_date),
      endDate: asDate(row.endDate ?? row.end_date),
      weekday: asText(row.weekday),
      alternateWeeks: asBool(row.alternateWeeks ?? row.alternate_weeks, false),
      recurrenceAnchorDate: asDate(row.recurrenceAnchorDate ?? row.recurrence_anchor_date),
      examTypeIds: (
        Array.isArray(row.examTypeIds)
          ? (row.examTypeIds as unknown[])
          : Array.isArray(row.exam_type_ids)
            ? (row.exam_type_ids as unknown[])
            : []
      ).map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
      isActive: asBool(row.isActive ?? row.is_active, true),
      title: asText(row.title),
      notes: asText(row.notes)
    }));
    const specialQuotas = asArray(raw.specialQuotas).map((row) => ({
      id: asNum(row.id) ?? undefined,
      examTypeId: asText(row.examTypeId ?? row.exam_type_id),
      dailyExtraSlots: asText(row.dailyExtraSlots ?? row.daily_extra_slots ?? 0),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const specialReasons = asArray(raw.specialReasons).map((row) => ({
      code: asText(row.code),
      labelEn: asText(row.labelEn ?? row.label_en),
      labelAr: asText(row.labelAr ?? row.label_ar),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const identifierTypes = asArray(raw.identifierTypes).map((row) => ({
      id: asNum(row.id) ?? undefined,
      code: asText(row.code),
      labelEn: asText(row.labelEn ?? row.label_en),
      labelAr: asText(row.labelAr ?? row.label_ar),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    return {
      categoryLimits,
      blockedRules,
      examRules,
      specialQuotas,
      specialReasons,
      identifierTypes
    };
  };

  const serverDraft = data ? normalizeConfig(data) : emptyDraft();
  const draft =
    draftOverride?.baseUpdatedAt === dataUpdatedAt
      ? draftOverride.value
      : serverDraft;

  const serializeDraft = (value: SchedulingDraft): SchedulingEngineConfig => ({
    categoryLimits: value.categoryLimits
      .filter((row) => row.modalityId.trim() && row.dailyLimit.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        caseCategory: row.caseCategory,
        dailyLimit: Number(row.dailyLimit),
        isActive: row.isActive
      })),
    blockedRules: value.blockedRules
      .filter((row) => row.modalityId.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        ruleType: row.ruleType,
        specificDate: row.specificDate || null,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        recurStartMonth: row.recurStartMonth ? Number(row.recurStartMonth) : null,
        recurStartDay: row.recurStartDay ? Number(row.recurStartDay) : null,
        recurEndMonth: row.recurEndMonth ? Number(row.recurEndMonth) : null,
        recurEndDay: row.recurEndDay ? Number(row.recurEndDay) : null,
        isOverridable: row.isOverridable,
        isActive: row.isActive,
        title: row.title,
        notes: row.notes
      })),
    examRules: value.examRules
      .filter((row) => row.modalityId.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        ruleType: row.ruleType,
        effectMode: row.effectMode,
        specificDate: row.specificDate || null,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        weekday: row.weekday ? Number(row.weekday) : null,
        alternateWeeks: row.alternateWeeks,
        recurrenceAnchorDate: row.recurrenceAnchorDate || null,
        examTypeIds: row.examTypeIds,
        isActive: row.isActive,
        title: row.title,
        notes: row.notes
      })),
    specialQuotas: value.specialQuotas
      .filter((row) => row.examTypeId.trim() && row.dailyExtraSlots.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        examTypeId: Number(row.examTypeId),
        dailyExtraSlots: Number(row.dailyExtraSlots),
        isActive: row.isActive
      })),
    specialReasons: value.specialReasons
      .filter((row) => row.code.trim())
      .map((row) => ({
        code: row.code.trim(),
        labelEn: row.labelEn.trim(),
        labelAr: row.labelAr.trim(),
        isActive: row.isActive
      })),
    identifierTypes: value.identifierTypes
      .filter((row) => row.code.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        code: row.code.trim(),
        labelEn: row.labelEn.trim(),
        labelAr: row.labelAr.trim(),
        isActive: row.isActive
      }))
  });

  const [saveNotice, setSaveNotice] = useState<"saved" | null>(null);
  const [quotaModalityFilter, setQuotaModalityFilter] = useState<string>("");
  const [quotaNotice, setQuotaNotice] = useState<string>("");
  const setDraft: Dispatch<SetStateAction<SchedulingDraft>> = (nextDraft) => {
    setDraftOverride((currentOverride) => {
      const currentDraft =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverDraft;
      const nextValue =
        typeof nextDraft === "function"
          ? nextDraft(currentDraft)
          : nextDraft;

      return {
        baseUpdatedAt: dataUpdatedAt,
        value: nextValue
      };
    });
    setSaveNotice(null);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: SchedulingEngineConfig) => saveSchedulingEngineConfig(payload),
    onSuccess: (returnedConfig) => {
      // Immediately replace local draft with the authoritative server response
      setDraftOverride({
        baseUpdatedAt: dataUpdatedAt,
        value: normalizeConfig(returnedConfig)
      });
      setValidationErrors([]);
      setSaveNotice("saved");
      queryClient.invalidateQueries({ queryKey: ["scheduling-engine-config"] });
    }
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const validateDraft = (value: SchedulingDraft): string[] => {
    const errors: string[] = [];

    value.categoryLimits.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Daily category limits row ${index + 1}: modality is required.`);
      if (!row.dailyLimit.trim()) errors.push(`Daily category limits row ${index + 1}: daily limit is required.`);
    });

    value.blockedRules.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Blocked dates row ${index + 1}: modality is required.`);
      if (row.ruleType === "specific_date" && !row.specificDate) {
        errors.push(`Blocked dates row ${index + 1}: specific date is required.`);
      }
      if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
        errors.push(`Blocked dates row ${index + 1}: start and end dates are required.`);
      }
      if (row.ruleType === "yearly_recurrence") {
        if (!row.recurStartMonth || !row.recurStartDay) {
          errors.push(`Blocked dates row ${index + 1}: recurrence start month/day is required.`);
        }
      }
    });

    value.examRules.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Exam date rules row ${index + 1}: modality is required.`);
      if (!row.effectMode) errors.push(`Exam date rules row ${index + 1}: effect mode is required.`);
      if ((row.examTypeIds || []).length === 0) errors.push(`Exam date rules row ${index + 1}: select at least one exam type.`);
      if (row.ruleType === "specific_date" && !row.specificDate) {
        errors.push(`Exam date rules row ${index + 1}: specific date is required.`);
      }
      if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
        errors.push(`Exam date rules row ${index + 1}: start and end dates are required.`);
      }
      if (row.ruleType === "weekly_recurrence" && !row.weekday) {
        errors.push(`Exam date rules row ${index + 1}: weekday is required.`);
      }
    });

    value.specialQuotas.forEach((row, index) => {
      if (!row.examTypeId.trim()) errors.push(`Special quotas row ${index + 1}: exam type is required.`);
      if (!row.dailyExtraSlots.trim()) errors.push(`Special quotas row ${index + 1}: extra slots is required.`);
    });

    value.specialReasons.forEach((row, index) => {
      if (!row.code.trim()) errors.push(`Special reason codes row ${index + 1}: code is required.`);
      if (!row.labelEn.trim()) errors.push(`Special reason codes row ${index + 1}: English label is required.`);
      if (!row.labelAr.trim()) errors.push(`Special reason codes row ${index + 1}: Arabic label is required.`);
    });

    value.identifierTypes.forEach((row, index) => {
      if (!row.code.trim()) errors.push(`Patient identifier types row ${index + 1}: code is required.`);
      if (!row.labelEn.trim()) errors.push(`Patient identifier types row ${index + 1}: English label is required.`);
      if (!row.labelAr.trim()) errors.push(`Patient identifier types row ${index + 1}: Arabic label is required.`);
    });

    return errors;
  };

  if (error) {
    const msg = (error as Error).message;
    if ((error as { status?: number })?.status === 403 || msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["scheduling-engine-config"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) {
    return <p className="description-center">{t("settings.loading")}</p>;
  }

  // ---- Small reusable field components ----
  const ModalitySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="input-field text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("settings.selectModality")}</option>
      {modalityOptions.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );

  const ExamTypeMultiSelect = ({ values, onChange, modalityId }: { values: number[]; onChange: (ids: number[]) => void; modalityId?: string }) => {
    const toggle = (id: number) => {
      onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
    };
    const allExamTypes = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    const filteredOptions = modalityId
      ? examTypeOptions.filter((opt: { value: string }) => {
          const et = allExamTypes.find((examType) => String(examType.id) === opt.value);
          return et && String(et.modalityId || et.modality_id) === modalityId;
        })
      : [];
    return (
      <div className="space-y-1">
        {!modalityId && (
          <p className="text-[10px] text-stone-500">Select a modality first</p>
        )}
        {!!modalityId && filteredOptions.length === 0 && (
          <p className="text-[10px] text-stone-500">No exam types configured for selected modality</p>
        )}
        {!!modalityId && filteredOptions.length > 0 && (
          <>
            <p className="text-[10px] text-stone-500">Restricted exams</p>
            <p className="text-[10px] text-stone-500">Checked exams are the ones this rule blocks or restricts.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-[10px]" onClick={() => onChange(filteredOptions.map((opt: { value: string }) => Number(opt.value)))}>
                Select all
              </button>
              <button type="button" className="btn-secondary text-[10px]" onClick={() => onChange([])}>
                Clear all
              </button>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
          {filteredOptions.map((opt: { value: string; label: string }) => {
            const id = Number(opt.value);
            const checked = values.includes(id);
            return (
              <label key={opt.value} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${checked ? "bg-teal-50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300" : "bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="sr-only" />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  const WeekdaySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="input-field text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select weekday…</option>
      {Object.entries(WEEKDAY_LABELS).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  );

  // ---- Section renderer ----
  const renderSection = (
    key: keyof SchedulingDraft,
    title: string,
    helper: string,
    addRow: () => void,
    renderRow: (row: Record<string, unknown>, index: number) => React.ReactNode
  ) => (
    <section className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium text-sm">{title}</h4>
        <button type="button" className="btn-secondary text-xs" onClick={addRow}>
          {ACTION_LABELS.add[key]}
        </button>
      </div>
      <details className="space-y-2" open>
        <summary className="cursor-pointer list-none text-[11px] text-stone-500 dark:text-stone-400">
          {helper}
        </summary>
        {draft[key].map((row, index) => renderRow(row as Record<string, unknown>, index))}
        {draft[key].length === 0 && (
          <p className="text-[11px] text-stone-400 dark:text-stone-500 italic">No rows configured yet.</p>
        )}
      </details>
    </section>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm description-center">
        Set the booking rules staff use every day. Each section controls one part of appointment access.
      </p>

      {/* A. Category Daily Limits */}
      {renderSection("categoryLimits", SECTION_TITLES.categoryLimits, SECTION_HELPERS.categoryLimits,
        () => setDraft((prev) => ({
          ...prev,
          categoryLimits: [...prev.categoryLimits, { modalityId: "", caseCategory: "non_oncology", dailyLimit: "0", isActive: true }]
        })),
        (row, idx) => (
          <div key={`cl-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.caseCategory as string} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, caseCategory: e.target.value as "oncology" | "non_oncology" } : r) }))}>
              <option value="non_oncology">غير أورام</option>
              <option value="oncology">أورام</option>
            </select>
            <input className="input-field text-xs" type="number" min="0" placeholder="الحد اليومي" value={row.dailyLimit as string} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, dailyLimit: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* B. Modality Blocked Rules */}
      {renderSection("blockedRules", SECTION_TITLES.blockedRules, SECTION_HELPERS.blockedRules,
        () => setDraft((prev) => ({
          ...prev,
          blockedRules: [...prev.blockedRules, { modalityId: "", ruleType: "specific_date", specificDate: "", startDate: "", endDate: "", recurStartMonth: "", recurStartDay: "", recurEndMonth: "", recurEndDay: "", isOverridable: false, isActive: true, title: "", notes: "" }]
        })),
        (row, idx) => (
          <div key={`br-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.ruleType as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, ruleType: e.target.value as BlockedRuleRow["ruleType"] } : r) }))}>
              {Object.entries(RULE_TYPE_LABELS).filter(([k]) => k !== "weekly_recurrence").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {row.ruleType === "specific_date" && (
              <input className="input-field text-xs" type="date" placeholder="تاريخ محدد" value={row.specificDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, specificDate: e.target.value } : r) }))} />
            )}
            {row.ruleType === "date_range" && (
              <>
                <input className="input-field text-xs" type="date" placeholder="تاريخ البداية" value={row.startDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, startDate: e.target.value } : r) }))} />
                <input className="input-field text-xs" type="date" placeholder="تاريخ النهاية" value={row.endDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, endDate: e.target.value } : r) }))} />
              </>
            )}
            {row.ruleType === "yearly_recurrence" && (
              <>
                <div className="flex gap-2">
                  <input className="input-field text-xs w-12" type="number" min="1" max="12" placeholder="MM" value={row.recurStartMonth as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurStartMonth: e.target.value } : r) }))} />
                  <input className="input-field text-xs w-12" type="number" min="1" max="31" placeholder="DD" value={row.recurStartDay as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurStartDay: e.target.value } : r) }))} />
                  <span className="text-[10px] text-stone-400 self-center">بداية التكرار</span>
                </div>
                <div className="flex gap-2">
                  <input className="input-field text-xs w-12" type="number" min="1" max="12" placeholder="MM" value={row.recurEndMonth as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurEndMonth: e.target.value } : r) }))} />
                  <input className="input-field text-xs w-12" type="number" min="1" max="31" placeholder="DD" value={row.recurEndDay as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurEndDay: e.target.value } : r) }))} />
                  <span className="text-[10px] text-stone-400 self-center">نهاية التكرار</span>
                </div>
              </>
            )}
            <input className="input-field text-xs" placeholder="العنوان (اختياري)" value={row.title as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, title: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="ملاحظات (اختياري)" value={row.notes as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isOverridable as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, isOverridable: e.target.checked } : r) }))} /> {ACTION_LABELS.overridable}</label>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* C. Exam Schedule Restriction Rules */}
      {renderSection("examRules", SECTION_TITLES.examRules, SECTION_HELPERS.examRules,
        () => setDraft((prev) => ({
          ...prev,
          examRules: [...prev.examRules, { modalityId: "", ruleType: "specific_date", effectMode: "restriction_overridable", specificDate: "", startDate: "", endDate: "", weekday: "", alternateWeeks: false, recurrenceAnchorDate: "", examTypeIds: [], isActive: true, title: "", notes: "" }]
        })),
        (row, idx) => (
          <div key={`er-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, modalityId: v, examTypeIds: [] } : r) }))} />
            <select className="input-field text-xs" value={row.ruleType as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, ruleType: e.target.value as ExamRuleRow["ruleType"] } : r) }))}>
              <option value="specific_date">{RULE_TYPE_LABELS.specific_date}</option>
              <option value="date_range">{RULE_TYPE_LABELS.date_range}</option>
              <option value="weekly_recurrence">{RULE_TYPE_LABELS.weekly_recurrence}</option>
            </select>
            <select className="input-field text-xs" value={row.effectMode as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, effectMode: e.target.value as ExamRuleRow["effectMode"] } : r) }))}>
              <option value="restriction_overridable">{EFFECT_MODE_LABELS.restriction_overridable}</option>
              <option value="hard_restriction">{EFFECT_MODE_LABELS.hard_restriction}</option>
            </select>
            <div className="md:col-span-1">
              <ExamTypeMultiSelect
                values={(row.examTypeIds as number[]) || []}
                onChange={(ids) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, examTypeIds: ids } : r) }))}
                modalityId={row.modalityId as string}
              />
            </div>
            {row.ruleType === "specific_date" && (
              <input className="input-field text-xs" type="date" placeholder="تاريخ محدد" value={row.specificDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, specificDate: e.target.value } : r) }))} />
            )}
            {row.ruleType === "date_range" && (
              <>
                <input className="input-field text-xs" type="date" placeholder="تاريخ البداية" value={row.startDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, startDate: e.target.value } : r) }))} />
                <input className="input-field text-xs" type="date" placeholder="تاريخ النهاية" value={row.endDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, endDate: e.target.value } : r) }))} />
              </>
            )}
            {row.ruleType === "weekly_recurrence" && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] text-stone-500">اليوم</p>
                  <WeekdaySelect value={row.weekday as string} onChange={(v) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, weekday: v } : r) }))} />
                </div>
                <input className="input-field text-xs" type="date" placeholder="تاريخ مرساة التكرار" value={row.recurrenceAnchorDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, recurrenceAnchorDate: e.target.value } : r) }))} />
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.alternateWeeks as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, alternateWeeks: e.target.checked } : r) }))} /> {ACTION_LABELS.alternateWeeks}</label>
              </>
            )}
            <input className="input-field text-xs" placeholder="العنوان (اختياري)" value={row.title as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, title: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="ملاحظات (اختياري)" value={row.notes as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, examRules: prev.examRules.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* D. Special Quotas */}
      <section className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-medium text-sm">{SECTION_TITLES.specialQuotas}</h4>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialQuotas: [...prev.specialQuotas, { examTypeId: "", dailyExtraSlots: "0", isActive: true }] }))}>
              {ACTION_LABELS.add.specialQuotas}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => {
              const existingIds = new Set(draft.specialQuotas.map(q => q.examTypeId).filter(id => id.trim()));
              const allActiveExamTypes = examTypeOptionsWithModality.filter(et => !existingIds.has(et.value));
              if (allActiveExamTypes.length === 0) {
                setQuotaNotice("All exam types already added");
                return;
              }
              setDraft(prev => ({
                ...prev,
                specialQuotas: [
                  ...prev.specialQuotas,
                  ...allActiveExamTypes.map(et => ({ examTypeId: et.value, dailyExtraSlots: "0", isActive: true }))
                ]
              }));
              setQuotaNotice("");
            }}>
              Add all exams
            </button>
            <button type="button" className="btn-secondary text-xs" disabled={!quotaModalityFilter} onClick={() => {
              if (!quotaModalityFilter) {
                setQuotaNotice("Select a modality first");
                return;
              }
              const existingIds = new Set(draft.specialQuotas.map(q => q.examTypeId).filter(id => id.trim()));
              const allActiveExamTypes = examTypeOptionsWithModality.filter(et => !existingIds.has(et.value) && String(et.modalityId) === quotaModalityFilter);
              if (allActiveExamTypes.length === 0) {
                setQuotaNotice("No exam types found for selected modality");
                return;
              }
              setDraft(prev => ({
                ...prev,
                specialQuotas: [
                  ...prev.specialQuotas,
                  ...allActiveExamTypes.map(et => ({ examTypeId: et.value, dailyExtraSlots: "0", isActive: true }))
                ]
              }));
              setQuotaNotice("");
            }}>
              Add all for modality
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => {
              if (!confirm("Remove all special quota rows?")) return;
              setDraft(prev => ({ ...prev, specialQuotas: [] }));
              setQuotaNotice("");
            }}>
              Delete all
            </button>
            <button type="button" className="btn-secondary text-xs" disabled={!quotaModalityFilter} onClick={() => {
              if (!quotaModalityFilter) {
                setQuotaNotice("Select a modality first");
                return;
              }
              if (!confirm(`Remove all special quota rows for the selected modality?`)) return;
              const examTypeIds = new Set(
                examTypeOptionsWithModality
                  .filter(et => String(et.modalityId) === quotaModalityFilter)
                  .map(et => et.value)
              );
              setDraft(prev => ({
                ...prev,
                specialQuotas: prev.specialQuotas.filter(q => !examTypeIds.has(q.examTypeId))
              }));
              setQuotaNotice("");
            }}>
              Delete for modality
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-600 dark:text-stone-400">Filter by modality:</span>
          <select className="input-field text-xs" value={quotaModalityFilter} onChange={(e) => setQuotaModalityFilter(e.target.value)}>
            <option value="">All modalities</option>
            {modalityOptions.map((opt: { value: string; label: string }) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {quotaNotice && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{quotaNotice}</p>
        )}
        <details className="space-y-2" open>
          <summary className="cursor-pointer list-none text-[11px] text-stone-500 dark:text-stone-400">
            {SECTION_HELPERS.specialQuotas}
          </summary>
          <div className="space-y-2">
            {draft.specialQuotas.map((row, idx) => (
              <div key={`sq-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                <select className="input-field text-xs" value={row.examTypeId as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, examTypeId: e.target.value } : r) }))}>
                  <option value="">Select exam type…</option>
                  {examTypeOptions.map((opt: { value: string; label: string }) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input className="input-field text-xs" type="number" min="0" placeholder="Extra slots per day" value={row.dailyExtraSlots as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, dailyExtraSlots: e.target.value } : r) }))} />
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
                <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
              </div>
            ))}
            {draft.specialQuotas.length === 0 && (
              <p className="text-[11px] text-stone-400 dark:text-stone-500 italic">No rows configured yet.</p>
            )}
          </div>
        </details>
      </section>

      {/* E. Special Reason Codes */}
      {renderSection("specialReasons", SECTION_TITLES.specialReasons, SECTION_HELPERS.specialReasons,
        () => setDraft((prev) => ({ ...prev, specialReasons: [...prev.specialReasons, { code: "", labelEn: "", labelAr: "", isActive: true }] })),
        (row, idx) => (
          <div key={`sr-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <input className="input-field text-xs" placeholder="الرمز" value={row.code as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, code: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="English label" value={row.labelEn as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, labelEn: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Arabic label" value={row.labelAr as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, labelAr: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* F. Patient Identifier Types */}
      {renderSection("identifierTypes", SECTION_TITLES.identifierTypes, SECTION_HELPERS.identifierTypes,
        () => setDraft((prev) => ({ ...prev, identifierTypes: [...prev.identifierTypes, { code: "", labelEn: "", labelAr: "", isActive: true }] })),
        (row, idx) => (
          <div key={`it-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <input className="input-field text-xs" placeholder="الرمز" value={row.code as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, code: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="English label" value={row.labelEn as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, labelEn: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Arabic label" value={row.labelAr as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, labelAr: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* Save / Reset */}
      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => {
            if (data) setDraft(normalizeConfig(data));
          }}
        >
          {ACTION_LABELS.reset}
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors text-sm"
          onClick={() => {
            const errors = validateDraft(draft);
            setValidationErrors(errors);
            if (errors.length > 0) return;
            saveMutation.mutate(serializeDraft(draft));
          }}
        >
          {saveMutation.isPending ? ACTION_LABELS.saving : ACTION_LABELS.save}
        </button>
      </div>

      {validationErrors.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
          {validationErrors.slice(0, 8).map((error, index) => (
            <p key={`validation-${index}`}>{error}</p>
          ))}
          {validationErrors.length > 8 && <p>...and {validationErrors.length - 8} more.</p>}
        </div>
      )}

      {saveMutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {(saveMutation.error as Error)?.message || "Save failed"}
        </div>
      )}
      {saveNotice === "saved" && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm">
          Configuration saved successfully.
        </div>
      )}
    </div>
  );
}
