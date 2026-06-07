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
import { chooseLocalized } from "@/lib/i18n";
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

const emptyForm: ExamTypeForm = {
  modalityId: "",
  code: "",
  name_ar: "",
  name_en: "",
  specific_instruction_ar: "",
  specific_instruction_en: "",
  durationMinutes: "",
};

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

function preparationStatus(row: ExamTypeRow) {
  const hasArabic = hasText(row.specific_instruction_ar);
  const hasEnglish = hasText(row.specific_instruction_en);
  if (hasArabic && hasEnglish) return "Complete";
  if (!hasArabic && !hasEnglish) return "Missing both";
  if (!hasArabic) return "Missing Arabic";
  return "Missing English";
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
    onError: (err: any) => { setMutationError(err?.message || "Delete failed"); },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: (id: number) => hardDeleteExamType(id),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Hard delete failed"); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ExamTypeForm; isActive?: boolean }) => updateExamType(id, toPayload(data)),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setEditingId(null);
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); },
  });

  const activateMutation = useMutation({
    mutationFn: (row: ExamTypeRow) => updateExamType(row.id, toPayload(formFromRow(row), true)),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Activate failed"); },
  });

  const createMutation = useMutation({
    mutationFn: (data: ExamTypeForm) => createExamType(toPayload(data, true)),
    onSuccess: () => {
      invalidateExamTypeQueries();
      setShowCreate(false);
      setCreateForm(emptyForm);
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Create failed"); },
  });

  const modalities = ((data?.modalities ?? []) as ModalityRow[]);
  const examTypes = ((data?.examTypes ?? []) as ExamTypeRow[]);

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

function modalityLabel(row: ExamTypeRow, modalityById: Map<string, ModalityRow>, language: string) {
  const modality = modalityById.get(String(row.modality_id));
  if (!modality) return "Not assigned";
  const baseLabel = chooseLocalized(language as any, modality.name_ar, modality.name_en) || modality.code || `Modality ${modality.id}`;
  return modality.is_active === false ? `${baseLabel} (Inactive)` : baseLabel;
}

function ExamTypeFormCard({
  editMode = false,
  form,
  modalityOptions,
  onCancel,
  onChange,
  onSubmit,
  pending,
  submitLabel,
}: {
  editMode?: boolean;
  form: ExamTypeForm;
  modalityOptions: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onChange: (form: ExamTypeForm) => void;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  const prefix = editMode ? "Edit " : "";
  const canSubmit = hasText(form.name_en) && hasText(form.name_ar) && hasText(form.code) && hasText(form.modalityId);

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
          <textarea value={form.specific_instruction_ar} onChange={(event) => onChange({ ...form, specific_instruction_ar: event.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-rtl" />
        </label>
        <label className="text-xs font-medium">
          Preparation English
          <textarea value={form.specific_instruction_en} onChange={(event) => onChange({ ...form, specific_instruction_en: event.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-sm input-ltr" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onSubmit} disabled={pending || !canSubmit} className="text-sm">{submitLabel}</Button>
        <Button variant="secondary" onClick={onCancel} className="text-sm">Cancel</Button>
      </div>
    </Card>
  );
}
