import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Input, Textarea } from "@/components/shared";
import {
  createModality,
  deactivateModality,
  deleteModality,
  fetchModalitiesSettings,
  updateModality,
  type ModalitySettingsRow,
} from "@/lib/api-hooks";
import { chooseLocalized } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import CatalogImportExportPanel from "./catalog-import-export-panel";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";
import { mutationErrorMessage } from "./settings-section-utils";

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

type ModalityFormState = {
  code: string;
  name_ar: string;
  name_en: string;
  daily_capacity: number;
  is_active: boolean;
  general_instruction_ar: string;
  general_instruction_en: string;
  safety_warning_ar: string;
  safety_warning_en: string;
  safety_warning_enabled: boolean;
  safety_workflow_type: "standard_acknowledgement" | "mri_primary_implant_screening";
};

type ModalityMutationSource = Pick<
  ModalitySettingsRow,
  | "code"
  | "name_ar"
  | "name_en"
  | "daily_capacity"
  | "is_active"
  | "general_instruction_ar"
  | "general_instruction_en"
  | "safety_warning_ar"
  | "safety_warning_en"
  | "safety_warning_enabled"
  | "safety_workflow_type"
>;

const EMPTY_MODALITY_FORM: ModalityFormState = {
  code: "",
  name_ar: "",
  name_en: "",
  daily_capacity: 0,
  is_active: true,
  general_instruction_ar: "",
  general_instruction_en: "",
  safety_warning_ar: "",
  safety_warning_en: "",
  safety_warning_enabled: true,
  safety_workflow_type: "standard_acknowledgement"
};

export default function ModalitiesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const { data, isLoading, error } = useQuery<{ modalities: ModalitySettingsRow[] }>({
    queryKey: ["modalities", showInactive ? "with-inactive" : "active"],
    queryFn: () => fetchModalitiesSettings(showInactive)
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ModalityFormState>({ ...EMPTY_MODALITY_FORM });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ModalityFormState>({ ...EMPTY_MODALITY_FORM });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateModality(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Deactivate failed")); }
  });
  const hardDeleteMutation = useMutation({
    mutationFn: (id: number) => deleteModality(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Hard delete failed")); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ModalityMutationSource }) => updateModality(id, {
      code: data.code,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      dailyCapacity: data.daily_capacity,
      isActive: data.is_active ? "enabled" : "disabled",
      generalInstructionAr: data.general_instruction_ar,
      generalInstructionEn: data.general_instruction_en,
      safetyWarningAr: data.safety_warning_ar,
      safetyWarningEn: data.safety_warning_en,
      safetyWarningEnabled: data.safety_warning_enabled,
      safetyWorkflowType: data.safety_workflow_type
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setEditingId(null);
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Update failed")); }
  });
  const createMutation = useMutation({
    mutationFn: (data: ModalityFormState) => createModality({
      code: data.code,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      dailyCapacity: data.daily_capacity,
      isActive: data.is_active ? "enabled" : "disabled",
      generalInstructionAr: data.general_instruction_ar,
      generalInstructionEn: data.general_instruction_en,
      safetyWarningAr: data.safety_warning_ar,
      safetyWarningEn: data.safety_warning_en,
      safetyWarningEnabled: data.safety_warning_enabled,
      safetyWorkflowType: data.safety_workflow_type
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setShowCreate(false);
      setCreateForm({ ...EMPTY_MODALITY_FORM });
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Create failed")); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["modalities"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="text-muted-foreground">{t("settings.loading")}</p>;

  const modalities = Array.isArray(data?.modalities) ? data.modalities : [];
  const createSafetyWarningInvalid = createForm.safety_warning_enabled && !createForm.safety_warning_ar.trim() && !createForm.safety_warning_en.trim();
  const editSafetyWarningInvalid = editForm.safety_warning_enabled && !editForm.safety_warning_ar.trim() && !editForm.safety_warning_en.trim();

  const startEdit = (modality: ModalitySettingsRow) => {
    setEditingId(modality.id);
    setEditForm({
      code: modality.code,
      name_ar: modality.name_ar,
      name_en: modality.name_en,
      daily_capacity: modality.daily_capacity ?? 0,
      is_active: modality.is_active,
      general_instruction_ar: modality.general_instruction_ar || "",
      general_instruction_en: modality.general_instruction_en || "",
      safety_warning_ar: modality.safety_warning_ar || "",
      safety_warning_en: modality.safety_warning_en || "",
      safety_warning_enabled: modality.safety_warning_enabled !== false,
      safety_workflow_type: modality.safety_workflow_type ?? "standard_acknowledgement"
    });
  };

  return (
    <div className="space-y-4">
      <CatalogImportExportPanel
        onImportSuccess={(summary) => {
          queryClient.invalidateQueries({ queryKey: ["modalities"] });
          queryClient.invalidateQueries({ queryKey: ["modalities", "all"] });
          queryClient.invalidateQueries({ queryKey: ["exam-types"] });
          queryClient.invalidateQueries({ queryKey: ["lookups"] });
          queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
          queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
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
          <Button type="button" onClick={() => setMutationError(null)} variant="ghost" size="sm" className="ms-2">إغلاق</Button>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {showInactive
            ? "Showing all modalities, including inactive ones."
            : "Showing active modalities only. Deactivated modalities stay hidden from this list."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowInactive((prev) => !prev)}
            className="text-xs"
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Button>
          <Button variant="secondary" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="text-xs">{showCreate ? "إلغاء" : "إضافة وسيلة تصوير"}</Button>
        </div>
      </div>
      <span className="text-sm text-muted-foreground">{modalities.length} modalities</span>

      {showCreate && (
        <div className="p-4 bg-muted/20 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-xs font-medium"><span>الرمز</span><Input dir="ltr" value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} placeholder="الرمز" className="w-full" /></label>
            <label className="grid min-w-0 gap-1 text-xs font-medium"><span>الاسم الإنجليزي</span><Input dir="ltr" value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} placeholder="الاسم الإنجليزي" className="w-full" /></label>
            <label className="grid min-w-0 gap-1 text-xs font-medium"><span>الاسم العربي</span><Input dir="rtl" value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} placeholder="الاسم العربي" className="w-full" /></label>
            <label className="grid min-w-0 gap-1 text-xs font-medium"><span>السعة اليومية</span><Input dir="ltr" type="number" value={createForm.daily_capacity} onChange={(e) => setCreateForm({ ...createForm, daily_capacity: parseInt(e.target.value) || 0 })} placeholder="السعة اليومية" className="w-full" /></label>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1 text-xs font-medium"><span>ملاحظات الجهاز (عربي)</span><Textarea dir="rtl" value={createForm.general_instruction_ar} onChange={(e) => setCreateForm({ ...createForm, general_instruction_ar: e.target.value })} placeholder="ملاحظات الجهاز (عربي)" rows={2} className="min-h-20 w-full" /></label>
            <label className="grid min-w-0 gap-1 text-xs font-medium"><span>ملاحظات الجهاز (إنجليزي)</span><Textarea dir="ltr" value={createForm.general_instruction_en} onChange={(e) => setCreateForm({ ...createForm, general_instruction_en: e.target.value })} placeholder="ملاحظات الجهاز (إنجليزي)" rows={2} className="min-h-20 w-full" /></label>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={createForm.safety_warning_enabled} onChange={(e) => setCreateForm({ ...createForm, safety_warning_enabled: e.target.checked })} className="rounded" /> تحذير السلامة مفعل</label>
          </div>
          {createForm.safety_warning_enabled && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="grid min-w-0 gap-1 text-xs font-medium"><span>تحذير السلامة (عربي)</span><Textarea dir="rtl" value={createForm.safety_warning_ar} onChange={(e) => setCreateForm({ ...createForm, safety_warning_ar: e.target.value })} placeholder="تحذير السلامة (عربي)" rows={2} className="min-h-20 w-full" /></label>
              <label className="grid min-w-0 gap-1 text-xs font-medium"><span>تحذير السلامة (إنجليزي)</span><Textarea dir="ltr" value={createForm.safety_warning_en} onChange={(e) => setCreateForm({ ...createForm, safety_warning_en: e.target.value })} placeholder="تحذير السلامة (إنجليزي)" rows={2} className="min-h-20 w-full" /></label>
            </div>
          )}
          {createSafetyWarningInvalid ? <p className="text-xs text-red-700" role="alert">Safety warning text is required when modality safety warning is enabled.</p> : null}
          <label className="block text-xs">Safety workflow<select aria-label="Safety workflow" disabled={!createForm.safety_warning_enabled} value={createForm.safety_workflow_type} onChange={(e) => setCreateForm({ ...createForm, safety_workflow_type: e.target.value as ModalityFormState["safety_workflow_type"] })} className="mt-1 w-full input-premium !py-1"><option value="standard_acknowledgement">Standard warning acknowledgement</option><option value="mri_primary_implant_screening">MRI primary implant screening</option></select><span className="mt-1 block text-muted-foreground">Choose the safety workflow that users must complete before examination and appointment-date selection. Select MRI primary implant screening only for MRI modalities.</span></label>
          <Button type="button" onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.code || !createForm.name_en || createSafetyWarningInvalid} variant="primary" size="sm">إنشاء</Button>
        </div>
      )}

      {modalities.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-4 text-sm text-muted-foreground">
          لم يتم تكوين أي أجهزة بعد.
        </div>
      ) : (
      <ul className="divide-y divide-border">
        {modalities.map((modality) => (
          <li key={modality.id} className="py-3">
            {editingId === modality.id ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-1 text-xs font-medium"><span>الرمز</span><Input dir="ltr" value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className="w-full" /></label>
                  <label className="grid min-w-0 gap-1 text-xs font-medium"><span>الاسم الإنجليزي</span><Input dir="ltr" value={editForm.name_en} onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })} className="w-full" /></label>
                  <label className="grid min-w-0 gap-1 text-xs font-medium"><span>الاسم العربي</span><Input dir="rtl" value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} className="w-full" /></label>
                  <label className="grid min-w-0 gap-1 text-xs font-medium"><span>السعة اليومية</span><Input dir="ltr" type="number" value={editForm.daily_capacity} onChange={(e) => setEditForm({ ...editForm, daily_capacity: parseInt(e.target.value) || 0 })} className="w-full" /></label>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="grid min-w-0 gap-1 text-xs font-medium"><span>ملاحظات الجهاز (عربي)</span><Textarea dir="rtl" value={editForm.general_instruction_ar} onChange={(e) => setEditForm({ ...editForm, general_instruction_ar: e.target.value })} placeholder="ملاحظات الجهاز (عربي)" rows={2} className="min-h-20 w-full" /></label>
                  <label className="grid min-w-0 gap-1 text-xs font-medium"><span>ملاحظات الجهاز (إنجليزي)</span><Textarea dir="ltr" value={editForm.general_instruction_en} onChange={(e) => setEditForm({ ...editForm, general_instruction_en: e.target.value })} placeholder="ملاحظات الجهاز (إنجليزي)" rows={2} className="min-h-20 w-full" /></label>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={editForm.safety_warning_enabled} onChange={(e) => setEditForm({ ...editForm, safety_warning_enabled: e.target.checked })} className="rounded" /> تحذير السلامة مفعل</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" /> مفعل</label>
                </div>
                {editForm.safety_warning_enabled && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="grid min-w-0 gap-1 text-xs font-medium"><span>تحذير السلامة (عربي)</span><Textarea dir="rtl" value={editForm.safety_warning_ar} onChange={(e) => setEditForm({ ...editForm, safety_warning_ar: e.target.value })} placeholder="تحذير السلامة (عربي)" rows={2} className="min-h-20 w-full" /></label>
                    <label className="grid min-w-0 gap-1 text-xs font-medium"><span>تحذير السلامة (إنجليزي)</span><Textarea dir="ltr" value={editForm.safety_warning_en} onChange={(e) => setEditForm({ ...editForm, safety_warning_en: e.target.value })} placeholder="تحذير السلامة (إنجليزي)" rows={2} className="min-h-20 w-full" /></label>
                  </div>
                )}
                {editSafetyWarningInvalid ? <p className="text-xs text-red-700" role="alert">Safety warning text is required when modality safety warning is enabled.</p> : null}
                <label className="block text-xs">Safety workflow<select aria-label="Safety workflow" disabled={!editForm.safety_warning_enabled} value={editForm.safety_workflow_type} onChange={(e) => setEditForm({ ...editForm, safety_workflow_type: e.target.value as ModalityFormState["safety_workflow_type"] })} className="mt-1 w-full input-premium !py-1"><option value="standard_acknowledgement">Standard warning acknowledgement</option><option value="mri_primary_implant_screening">MRI primary implant screening</option></select><span className="mt-1 block text-muted-foreground">Choose the safety workflow that users must complete before examination and appointment-date selection. Select MRI primary implant screening only for MRI modalities.</span></label>
                <div className="flex gap-2">
                  <Button type="button" onClick={() => updateMutation.mutate({ id: modality.id, data: editForm })} disabled={updateMutation.isPending || editSafetyWarningInvalid} variant="primary" size="sm">Save</Button>
                  <Button type="button" onClick={() => setEditingId(null)} variant="secondary" size="sm">إلغاء</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-start">
                  <p className="font-medium text-foreground">{chooseLocalized(language, modality.name_ar, modality.name_en) || modality.code || `Modality ${modality.id}`}</p>
                  <p className="text-sm text-muted-foreground">{t("settings.capacity")}: {modality.daily_capacity ?? "-"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={modality.is_active ? "success" : "neutral"} size="sm">
                    {modality.is_active ? t("settings.active") : t("settings.inactive")}
                  </Badge>
                  <Button type="button" onClick={() => startEdit(modality)} variant="secondary" size="sm">Edit</Button>
                  {modality.is_active ? (
                    <Button
                    type="button"                      onClick={() => {
                        if (window.confirm("Deactivate this modality? It will disappear from active lists.")) {
                          deactivateMutation.mutate(modality.id);
                        }
                      }}
                      variant="secondary" size="sm"
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                    type="button"                      onClick={() => {
                        if (window.confirm("Reactivate this modality?")) {
                          updateMutation.mutate({ id: modality.id, data: { ...modality, is_active: true } });
                        }
                      }}
                      variant="secondary" size="sm"
                    >
                      Activate
                    </Button>
                  )}
                  <Button
                    type="button"                    onClick={() => {
                      if (window.confirm("Permanently delete this modality? This cannot be undone.")) {
                        hardDeleteMutation.mutate(modality.id);
                      }
                    }}
                    variant="destructive" size="sm"
                  >
                    Hard Delete
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}
