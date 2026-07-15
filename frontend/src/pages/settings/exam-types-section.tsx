import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createExamType,
  deleteExamType,
  fetchExamTypes,
  hardDeleteExamType,
  updateExamType,
} from "@/lib/api-hooks";
import { Button } from "@/components/shared/Button";
import { Card } from "@/components/shared/Card";
import { chooseLocalized, type Language } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import CatalogImportExportPanel from "./catalog-import-export-panel";

type ExamTypeRow = {
  id: number;
  modality_id: number | null;
  code?: string | null;
  name_ar?: string | null;
  name_en?: string | null;
  specific_instruction_ar?: string | null;
  specific_instruction_en?: string | null;
  duration_minutes?: number | null;
  is_active?: boolean;
};

type ModalityRow = {
  id: number;
  name_ar?: string | null;
  name_en?: string | null;
  code?: string | null;
  is_active?: boolean;
};

type ExamTypeForm = {
  modalityId: string;
  code: string;
  name_ar: string;
  name_en: string;
  specific_instruction_ar: string;
  specific_instruction_en: string;
  durationMinutes: string;
};

type StatusFilter = "active" | "inactive" | "all";
type PreparationFilter = "all" | "missing_arabic" | "missing_english" | "missing_both";
type CopyMode = "arabic" | "english" | "both";

const emptyForm: ExamTypeForm = {
  modalityId: "",
  code: "",
  name_ar: "",
  name_en: "",
  specific_instruction_ar: "",
  specific_instruction_en: "",
  durationMinutes: "",
};

const EMPTY_MODALITY_ROWS: ModalityRow[] = [];
const EMPTY_EXAM_TYPE_ROWS: ExamTypeRow[] = [];

function invalidateModalityDerivedAppointmentCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["lookups"] });
  queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
  queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
  queryClient.invalidateQueries({ queryKey: ["v2-bookings"] });
  queryClient.invalidateQueries({ queryKey: ["print-appointments"] });
  queryClient.invalidateQueries({ queryKey: ["print-appointment"] });
  queryClient.invalidateQueries({ queryKey: ["registrations"] });
  queryClient.invalidateQueries({ queryKey: ["calendar"] });
  queryClient.invalidateQueries({ queryKey: ["queue"] });
}

function QueryError({ message }: { message: string }) {
  return <p className="text-sm text-red-600 dark:text-red-400">{message}</p>;
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm description-center">Recent supervisor re-authentication is required for this settings section.</p>
      <Button onClick={onReAuthRequired} className="text-sm">Re-authenticate</Button>
    </div>
  );
}

function toPayload(form: ExamTypeForm, activeFlag?: boolean) {
  return {
    modalityId: form.modalityId ? parseInt(form.modalityId, 10) : undefined,
    code: form.code.trim(),
    nameAr: form.name_ar.trim(),
    nameEn: form.name_en.trim(),
    specificInstructionAr: form.specific_instruction_ar,
    specificInstructionEn: form.specific_instruction_en,
    durationMinutes: form.durationMinutes === "" ? null : Number(form.durationMinutes),
    ...(activeFlag === undefined ? {} : { isActive: activeFlag }),
  };
}

function hasText(value: string | null | undefined) {
  return String(value ?? "").trim().length > 0;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function preparationStatus(row: ExamTypeRow) {
  const hasArabic = hasText(row.specific_instruction_ar);
  const hasEnglish = hasText(row.specific_instruction_en);
  if (hasArabic && hasEnglish) return "Complete";
  if (!hasArabic && !hasEnglish) return "Missing both";
  if (!hasArabic) return "Missing Arabic";
  return "Missing English";
}

function instructionValue(row: ExamTypeRow, mode: "arabic" | "english") {
  return mode === "arabic" ? String(row.specific_instruction_ar ?? "") : String(row.specific_instruction_en ?? "");
}

function matchesPreparationFilter(row: ExamTypeRow, filter: PreparationFilter) {
  const hasArabic = hasText(row.specific_instruction_ar);
  const hasEnglish = hasText(row.specific_instruction_en);
  if (filter === "all") return true;
  if (filter === "missing_arabic") return !hasArabic;
  if (filter === "missing_english") return !hasEnglish;
  return !hasArabic && !hasEnglish;
}

export default function ExamTypesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [modalityFilter, setModalityFilter] = useState("all");
  const [preparationFilter, setPreparationFilter] = useState<PreparationFilter>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ExamTypeForm>(emptyForm);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ExamTypeForm>(emptyForm);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["exam-types", statusFilter === "active" ? "active" : "with-inactive"],
    queryFn: () => fetchExamTypes(statusFilter !== "active"),
  });

  const invalidateExamTypeQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["exam-types"] });
    queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
    queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
    invalidateModalityDerivedAppointmentCaches(queryClient);
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteExamType(id),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setMutationError(null);
    },
    onError: (err: unknown) => { setMutationError(getErrorMessage(err, "Delete failed")); },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: number) => hardDeleteExamType(id),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setMutationError(null);
    },
    onError: (err: unknown) => { setMutationError(getErrorMessage(err, "Hard delete failed")); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ExamTypeForm; isActive?: boolean }) => updateExamType(id, toPayload(data)),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setEditingId(null);
      setMutationError(null);
    },
    onError: (err: unknown) => { setMutationError(getErrorMessage(err, "Update failed")); },
  });

  const activateMutation = useMutation({
    mutationFn: (row: ExamTypeRow) => updateExamType(row.id, toPayload(formFromRow(row), true)),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setMutationError(null);
    },
    onError: (err: unknown) => { setMutationError(getErrorMessage(err, "Activate failed")); },
  });

  const createMutation = useMutation({
    mutationFn: (data: ExamTypeForm) => createExamType(toPayload(data, true)),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setShowCreate(false);
      setCreateForm(emptyForm);
      setMutationError(null);
    },
    onError: (err: unknown) => { setMutationError(getErrorMessage(err, "Create failed")); },
  });

  const modalities = (data?.modalities ?? EMPTY_MODALITY_ROWS) as ModalityRow[];
  const examTypes = (data?.examTypes ?? EMPTY_EXAM_TYPE_ROWS) as ExamTypeRow[];

  const modalityOptions = modalities.map((modality) => {
    const baseLabel = chooseLocalized(language, modality.name_ar, modality.name_en) || modality.code || `Modality ${modality.id}`;
    return {
      value: String(modality.id),
      label: modality.is_active === false ? `${baseLabel} (Inactive)` : baseLabel,
    };
  });
  const modalityById = new Map(modalities.map((modality) => [String(modality.id), modality]));

  const filteredExamTypes = useMemo(() => {
    const cleanSearch = search.trim().toLowerCase();
    return examTypes.filter((row) => {
      if (statusFilter === "active" && row.is_active === false) return false;
      if (statusFilter === "inactive" && row.is_active !== false) return false;
      if (modalityFilter !== "all" && String(row.modality_id ?? "") !== modalityFilter) return false;
      if (!matchesPreparationFilter(row, preparationFilter)) return false;
      if (!cleanSearch) return true;
      return [row.code, row.name_en, row.name_ar].some((value) => String(value ?? "").toLowerCase().includes(cleanSearch));
    });
  }, [examTypes, modalityFilter, preparationFilter, search, statusFilter]);

  const startEdit = (row: ExamTypeRow) => {
    setEditingId(row.id);
    setEditForm(formFromRow(row));
    setMutationError(null);
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["exam-types"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  return (
    <div className="space-y-4">
      <CatalogImportExportPanel
        onImportSuccess={(summary) => {
          queryClient.invalidateQueries({ queryKey: ["exam-types"] });
          queryClient.invalidateQueries({ queryKey: ["modalities"] });
          queryClient.invalidateQueries({ queryKey: ["modalities", "all"] });
          queryClient.invalidateQueries({ queryKey: ["lookups"] });
          queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
          queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
          invalidateModalityDerivedAppointmentCaches(queryClient);
          setImportSummary(
            `Imported workbook: ${summary.modalitiesCreated} modalities created, ${summary.modalitiesUpdated} updated, ${summary.examTypesCreated} exam types created, ${summary.examTypesUpdated} updated, ${summary.skipped} skipped.`
          );
          setMutationError(null);
        }}
      />
      {importSummary && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-sm">
          {importSummary}
        </div>
      )}
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 flex-1">
            <label className="text-xs font-medium">
              Search
              <input aria-label="Search exam types" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" placeholder="Code, English, Arabic" />
            </label>
            <label className="text-xs font-medium">
              Modality
              <select aria-label="Modality filter" value={modalityFilter} onChange={(event) => setModalityFilter(event.target.value)} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm">
                <option value="all">All modalities</option>
                {modalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium">
              Status
              <select aria-label="Status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
            </label>
            <label className="text-xs font-medium">
              Preparation
              <select aria-label="Preparation filter" value={preparationFilter} onChange={(event) => setPreparationFilter(event.target.value as PreparationFilter)} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm">
                <option value="all">All</option>
                <option value="missing_arabic">Missing Arabic</option>
                <option value="missing_english">Missing English</option>
                <option value="missing_both">Missing both</option>
              </select>
            </label>
          </div>
          <Button variant="secondary" onClick={() => { setShowCreate((current) => !current); setMutationError(null); }} className="text-xs">
            {showCreate ? "Cancel" : "Add exam type"}
          </Button>
        </div>
        <p className="text-sm description-center">{filteredExamTypes.length} of {examTypes.length} exam types visible</p>
      </Card>

      {showCreate && (
        <ExamTypeFormCard
          form={createForm}
          examTypes={examTypes}
          modalityById={modalityById}
          modalityOptions={modalityOptions}
          onChange={setCreateForm}
          onCancel={() => setShowCreate(false)}
          onSubmit={() => createMutation.mutate(createForm)}
          pending={createMutation.isPending}
          submitLabel="Create"
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 dark:bg-stone-800/60">
            <tr className="text-left border-b border-stone-200 dark:border-stone-700">
              <th className="p-3">Code</th>
              <th className="p-3">English name</th>
              <th className="p-3">Arabic name</th>
              <th className="p-3">Modality</th>
              <th className="p-3">Minutes</th>
              <th className="p-3">Preparation</th>
              <th className="p-3">Status</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredExamTypes.map((row) => (
              <tr key={row.id} className="border-b border-stone-100 dark:border-stone-800 align-top">
                {editingId === row.id ? (
                  <td colSpan={8} className="p-3">
                    <ExamTypeFormCard
                      form={editForm}
                      examTypes={examTypes}
                      modalityById={modalityById}
                      modalityOptions={modalityOptions}
                      onChange={setEditForm}
                      onCancel={() => { setEditingId(null); setMutationError(null); }}
                      onSubmit={() => updateMutation.mutate({ id: row.id, data: editForm })}
                      pending={updateMutation.isPending}
                      submitLabel="Save"
                      editMode
                    />
                  </td>
                ) : (
                  <>
                    <td className="p-3 font-mono">{row.code || "-"}</td>
                    <td className="p-3">{row.name_en || "-"}</td>
                    <td className="p-3 input-rtl">{row.name_ar || "-"}</td>
                    <td className="p-3">{modalityLabel(row, modalityById, language)}</td>
                    <td className="p-3">{row.duration_minutes ?? "-"}</td>
                    <td className="p-3">{preparationStatus(row)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.is_active !== false ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                        {row.is_active !== false ? t("settings.active") : t("settings.inactive")}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => startEdit(row)} className="text-xs">Edit</Button>
                        {row.is_active !== false ? (
                          <Button variant="secondary" onClick={() => { if (window.confirm("Deactivate this exam type? It will disappear from active lists.")) deleteMutation.mutate(row.id); }} className="text-xs">Deactivate</Button>
                        ) : (
                          <>
                            <Button variant="secondary" onClick={() => activateMutation.mutate(row)} className="text-xs">Activate</Button>
                            <Button variant="secondary" onClick={() => { if (window.confirm("Hard delete this inactive exam type? This cannot be undone and will fail if it is still referenced.")) hardDeleteMutation.mutate(row.id); }} className="text-xs">Hard Delete</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {filteredExamTypes.length === 0 && (
              <tr><td colSpan={8} className="p-4 text-sm description-center">No exam types match the selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formFromRow(row: ExamTypeRow): ExamTypeForm {
  return {
    modalityId: row.modality_id == null ? "" : String(row.modality_id),
    code: row.code ?? "",
    name_ar: row.name_ar ?? "",
    name_en: row.name_en ?? "",
    specific_instruction_ar: row.specific_instruction_ar ?? "",
    specific_instruction_en: row.specific_instruction_en ?? "",
    durationMinutes: row.duration_minutes == null ? "" : String(row.duration_minutes),
  };
}

function modalityLabel(row: ExamTypeRow, modalityById: Map<string, ModalityRow>, language: Language) {
  const modality = modalityById.get(String(row.modality_id));
  if (!modality) return "Not assigned";
  const baseLabel = chooseLocalized(language, modality.name_ar, modality.name_en) || modality.code || `Modality ${modality.id}`;
  return modality.is_active === false ? `${baseLabel} (Inactive)` : baseLabel;
}

function ExamTypeFormCard({
  editMode = false,
  form,
  examTypes,
  modalityOptions,
  modalityById,
  onCancel,
  onChange,
  onSubmit,
  pending,
  submitLabel,
}: {
  editMode?: boolean;
  form: ExamTypeForm;
  examTypes: ExamTypeRow[];
  modalityOptions: Array<{ value: string; label: string }>;
  modalityById: Map<string, ModalityRow>;
  onCancel: () => void;
  onChange: (form: ExamTypeForm) => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const prefix = editMode ? "Edit " : "";
  const canSubmit = hasText(form.name_en) && hasText(form.name_ar) && hasText(form.code) && hasText(form.modalityId);
  const [copyOpen, setCopyOpen] = useState(false);

  const copyInstructions = (source: ExamTypeRow, mode: CopyMode, append: boolean) => {
    const nextForm = { ...form };
    const applyLanguage = (language: "arabic" | "english") => {
      const field = language === "arabic" ? "specific_instruction_ar" : "specific_instruction_en";
      const sourceValue = instructionValue(source, language);
      if (!sourceValue) return true;
      if (!append && hasText(nextForm[field]) && !window.confirm(`Replace existing ${language} instruction text?`)) return false;
      nextForm[field] = append && hasText(nextForm[field]) ? `${nextForm[field]}\n${sourceValue}` : sourceValue;
      return true;
    };

    if ((mode === "arabic" || mode === "both") && !applyLanguage("arabic")) return;
    if ((mode === "english" || mode === "both") && !applyLanguage("english")) return;
    onChange(nextForm);
    setCopyOpen(false);
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-medium">
          Code
          <input aria-label={editMode ? "Edit code" : "Code"} value={form.code} onChange={(event) => onChange({ ...form, code: event.target.value })} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" />
        </label>
        <label className="text-xs font-medium">
          English name
          <input aria-label={`${prefix}English name`.trim()} value={form.name_en} onChange={(event) => onChange({ ...form, name_en: event.target.value })} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" />
        </label>
        <label className="text-xs font-medium">
          Arabic name
          <input aria-label={`${prefix}Arabic name`.trim()} value={form.name_ar} onChange={(event) => onChange({ ...form, name_ar: event.target.value })} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-rtl" />
        </label>
        <label className="text-xs font-medium">
          Exam modality
          <select aria-label={editMode ? "Edit modality" : "Exam modality"} value={form.modalityId} onChange={(event) => onChange({ ...form, modalityId: event.target.value })} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm">
            <option value="">Select modality</option>
            {modalityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium">
          Duration minutes
          <input aria-label={editMode ? "Edit duration minutes" : "Duration minutes"} type="number" min={0} value={form.durationMinutes} onChange={(event) => onChange({ ...form, durationMinutes: event.target.value })} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-medium">
          Preparation Arabic
          <textarea aria-label="Preparation Arabic" value={form.specific_instruction_ar} onChange={(event) => onChange({ ...form, specific_instruction_ar: event.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-rtl" />
        </label>
        <label className="text-xs font-medium">
          Preparation English
          <textarea aria-label="Preparation English" value={form.specific_instruction_en} onChange={(event) => onChange({ ...form, specific_instruction_en: event.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setCopyOpen(true)} className="text-sm">Copy instructions from existing exam</Button>
        <Button onClick={onSubmit} disabled={pending || !canSubmit} className="text-sm">{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel} className="text-sm">Cancel</Button>
      </div>
      {copyOpen && (
        <InstructionCopyDialog
          currentModalityId={form.modalityId}
          examTypes={examTypes}
          modalityById={modalityById}
          onClose={() => setCopyOpen(false)}
          onCopy={copyInstructions}
        />
      )}
    </Card>
  );
}

function InstructionCopyDialog({
  currentModalityId,
  examTypes,
  modalityById,
  onClose,
  onCopy,
}: {
  currentModalityId: string;
  examTypes: ExamTypeRow[];
  modalityById: Map<string, ModalityRow>;
  onClose: () => void;
  onCopy: (source: ExamTypeRow, mode: CopyMode, append: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"same" | "all">(currentModalityId ? "same" : "all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [append, setAppend] = useState(false);
  const selected = examTypes.find((row) => row.id === selectedId) ?? null;
  const cleanSearch = search.trim().toLowerCase();
  const visibleRows = examTypes
    .filter((row) => {
      if (scope === "same" && currentModalityId && String(row.modality_id ?? "") !== currentModalityId) return false;
      if (!cleanSearch) return true;
      const modality = modalityLabel(row, modalityById, "en").toLowerCase();
      return [row.code, row.name_en, row.name_ar, modality].some((value) => String(value ?? "").toLowerCase().includes(cleanSearch));
    })
    .sort((left, right) => {
      const leftSame = currentModalityId && String(left.modality_id ?? "") === currentModalityId;
      const rightSame = currentModalityId && String(right.modality_id ?? "") === currentModalityId;
      if (leftSame !== rightSame) return leftSame ? -1 : 1;
      if ((left.is_active !== false) !== (right.is_active !== false)) return left.is_active !== false ? -1 : 1;
      if ((hasText(left.specific_instruction_ar) || hasText(left.specific_instruction_en)) !== (hasText(right.specific_instruction_ar) || hasText(right.specific_instruction_en))) {
        return hasText(left.specific_instruction_ar) || hasText(left.specific_instruction_en) ? -1 : 1;
      }
      return String(left.name_en ?? left.code ?? "").localeCompare(String(right.name_en ?? right.code ?? ""));
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-label="Copy instructions from existing exam" className="w-full max-w-5xl rounded-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 p-4 space-y-4 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-semibold text-stone-900 dark:text-white">Copy instructions from existing exam</h4>
          <Button variant="secondary" onClick={onClose} className="text-xs">Close</Button>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="text-xs font-medium md:col-span-2">
            Search
            <input aria-label="Search source exams" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" placeholder="Code, name, modality" />
          </label>
          <label className="text-xs font-medium">
            Source modality scope
            <select aria-label="Source modality scope" value={scope} onChange={(event) => setScope(event.target.value as "same" | "all")} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm">
              <option value="same" disabled={!currentModalityId}>Same modality</option>
              <option value="all">All modalities</option>
            </select>
          </label>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="max-h-80 overflow-auto rounded border border-stone-200 dark:border-stone-700">
            <table className="min-w-full text-xs">
              <thead className="bg-stone-50 dark:bg-stone-800">
                <tr className="text-left">
                  <th className="p-2">Code</th>
                  <th className="p-2">English</th>
                  <th className="p-2">Arabic</th>
                  <th className="p-2">Modality</th>
                  <th className="p-2">Preparation</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="p-2 font-mono">{row.code || "-"}</td>
                    <td className="p-2">{row.name_en || "-"}</td>
                    <td className="p-2 input-rtl">{row.name_ar || "-"}</td>
                    <td className="p-2">{modalityLabel(row, modalityById, "en")}</td>
                    <td className="p-2">{preparationStatus(row)}</td>
                    <td className="p-2"><Button variant="secondary" onClick={() => setSelectedId(row.id)} className="text-xs">Select</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-stone-200 dark:border-stone-700 p-3 space-y-3 text-sm">
            {selected ? (
              <>
                <div>
                  <p className="font-semibold">{selected.code || "-"} - {selected.name_en || selected.name_ar || "Unnamed exam"}</p>
                  <p className="description-center text-xs">{modalityLabel(selected, modalityById, "en")}</p>
                </div>
                <div>
                  <p className="text-xs font-medium">Arabic instruction</p>
                  <p className="mt-1 min-h-10 rounded bg-stone-50 dark:bg-stone-800 p-2 input-rtl whitespace-pre-wrap">{selected.specific_instruction_ar || "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium">English instruction</p>
                  <p className="mt-1 min-h-10 rounded bg-stone-50 dark:bg-stone-800 p-2 input-ltr whitespace-pre-wrap">{selected.specific_instruction_en || "-"}</p>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={append} onChange={(event) => setAppend(event.target.checked)} />
                  Append instead of replace
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => onCopy(selected, "arabic", append)} className="text-xs">Copy Arabic only</Button>
                  <Button variant="secondary" onClick={() => onCopy(selected, "english", append)} className="text-xs">Copy English only</Button>
                  <Button onClick={() => onCopy(selected, "both", append)} className="text-xs">Copy both</Button>
                </div>
              </>
            ) : (
              <p className="description-center">Select an exam to preview its preparation instructions.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
