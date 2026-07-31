import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateAppointment } from "@/lib/api-hooks";
import type { AppointmentLookups } from "@/types/api";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { chooseLocalized, t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { pushToast } from "@/lib/toast";
import { useV2ExamTypes } from "@/v2/appointments/api";

interface AppointmentEditorProps {
  appointment: AppointmentWithDetails;
  lookups: AppointmentLookups | undefined;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onUpdated?: (appointment: AppointmentWithDetails) => void;
  onDeleted?: () => void;
  defaultOpen?: boolean;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

function resolveRoutinePriorityId(lookups: AppointmentLookups | undefined): number | null {
  const priorities = lookups?.priorities ?? [];
  const routine = priorities.find((priority) => {
    const code = String((priority as { code?: string }).code ?? "").toLowerCase();
    const nameEn = String(priority.nameEn ?? "").toLowerCase();
    const nameAr = String(priority.nameAr ?? "").toLowerCase();
    return code === "routine" || nameEn.includes("routine") || nameAr.includes("روت");
  });
  return routine?.id ?? priorities[0]?.id ?? null;
}

function getPriorityTone(codeOrName: string): "urgent" | "stat" | null {
  const normalized = codeOrName.toLowerCase();
  if (normalized.includes("stat")) return "stat";
  if (normalized.includes("urgent")) return "urgent";
  return null;
}

export function AppointmentEditor(props: AppointmentEditorProps) {
  const { appointment, lookups, defaultOpen = false } = props;
  const routinePriorityId = resolveRoutinePriorityId(lookups);
  const routinePriorityIdString = routinePriorityId != null ? String(routinePriorityId) : "";
  const editorKey = [
    appointment.id,
    appointment.examTypeId ?? "",
    appointment.reportingPriorityId ?? routinePriorityIdString,
    appointment.notes ?? "",
    appointment.requiresReport ? "report" : "no-report",
    defaultOpen ? "open" : "closed",
  ].join("|");

  return (
    <AppointmentEditorForm
      key={editorKey}
      {...props}
      defaultOpen={defaultOpen}
      routinePriorityIdString={routinePriorityIdString}
    />
  );
}

function AppointmentEditorForm({
  appointment,
  lookups,
  editing,
  onEdit,
  onCancel,
  onUpdated,
  defaultOpen,
  routinePriorityIdString,
}: AppointmentEditorProps & { defaultOpen: boolean; routinePriorityIdString: string }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const parsedModalityId = Number(appointment.modalityId);
  const modalityId = Number.isFinite(parsedModalityId) ? parsedModalityId : null;
  const modalityExamTypes = useV2ExamTypes(modalityId);
  const [examTypeId, setExamTypeId] = useState(String(appointment.examTypeId ?? ""));
  const [internalEditing, setInternalEditing] = useState(defaultOpen);
  const [notes, setNotes] = useState(String(appointment.notes ?? ""));
  const [requiresReport, setRequiresReport] = useState(Boolean(appointment.requiresReport));
  const initialPriorityId = String(appointment.reportingPriorityId ?? routinePriorityIdString);
  const [priorityId, setPriorityId] = useState(initialPriorityId);

  const isEdited = Boolean(
    appointment.updatedAt &&
      appointment.createdAt &&
      String(appointment.updatedAt) !== String(appointment.createdAt)
  );

  const fallbackExamTypes = useMemo(() => {
    return (lookups?.examTypes ?? []).filter((examType) => {
      if (!examType.isActive) return false;
      if (!appointment.modalityId) return true;
      return !examType.modalityId || String(examType.modalityId) === String(appointment.modalityId);
    });
  }, [lookups, appointment.modalityId]);

  const examTypeOptions = useMemo(() => {
    const modalityExamTypeData = modalityExamTypes.data ?? [];
    if (modalityExamTypeData.length > 0) {
      return modalityExamTypeData
        .filter((examType) => examType.isActive)
        .map((examType) => ({
          id: examType.id,
          label: examType.name,
        }));
    }

    return fallbackExamTypes.map((examType) => ({
      id: examType.id,
      label: chooseLocalized(language, examType.nameAr, examType.nameEn),
    }));
  }, [fallbackExamTypes, language, modalityExamTypes.data]);

  const selectedPriority = (lookups?.priorities ?? []).find((priority) => String(priority.id) === priorityId);
  const selectedPriorityCodeOrName = String((selectedPriority as { code?: string } | undefined)?.code ?? selectedPriority?.nameEn ?? "");
  const selectedPriorityTone = getPriorityTone(selectedPriorityCodeOrName);
  const priorityToneClass =
    selectedPriorityTone === "urgent"
      ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
      : selectedPriorityTone === "stat"
      ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
      : "border-stone-300 bg-white text-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-white";

  const mutation = useMutation({
    mutationFn: () =>
      updateAppointment(appointment.id, {
        examTypeId: examTypeId ? Number(examTypeId) : null,
        reportingPriorityId: priorityId ? Number(priorityId) : null,
        requiresReport,
        notes: notes.trim() ? notes.trim() : null
      }),
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: (updated) => {
      pushToast({
        type: "success",
        title: t(language, "appointmentEditor.toastUpdated"),
        message: t(language, "appointmentEditor.toastUpdatedMsg")
      });
      queryClient.setQueryData(["appointment-manage-modal", updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      setInternalEditing(false);
      onUpdated?.(updated);
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: t(language, "appointmentEditor.toastUpdateFailed"),
        message: getErrorMessage(err, t(language, "appointmentEditor.toastUpdateFailedMsg"))
      });
    }
  });

  const isEditing = editing ?? internalEditing;

  if (!isEditing) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setInternalEditing(true);
            onEdit?.();
          }}
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
        >
          {t(language, "common.edit")}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/30 p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-white">{t(language, "appointmentEditor.title")}</h4>
          {isEdited && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              {t(language, "appointmentEditor.edited")}
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
          {t(language, "appointmentEditor.hint")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor="appointment-editor-exam-type" className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
            {t(language, "appointmentEditor.examType")}
          </label>
          <select
            id="appointment-editor-exam-type"
            value={examTypeId}
            onChange={(e) => setExamTypeId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm focus:ring-2 focus:ring-teal-500 outline-none"
          >
            <option value="">{t(language, "appointmentEditor.noExamType")}</option>
            {examTypeOptions.map((examType) => (
              <option key={examType.id} value={examType.id}>
                {examType.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="appointment-editor-priority" className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
            {t(language, "appointmentEditor.priority")}
          </label>
          <select
            id="appointment-editor-priority"
            value={priorityId}
            onChange={(e) => setPriorityId(e.target.value)}
            className={`w-full px-3 py-2 rounded-lg border text-sm focus:ring-2 focus:ring-teal-500 outline-none ${priorityToneClass}`}
          >
            {(lookups?.priorities ?? []).map((priority) => (
              <option key={priority.id} value={priority.id}>
                {chooseLocalized(language, priority.nameAr, priority.nameEn)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-white">
          <input
            type="checkbox"
            checked={requiresReport}
            onChange={(e) => setRequiresReport(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-stone-300 text-teal-600 focus:ring-teal-500"
          />
          <span>
            <span className="block font-medium">{t(language, "appointmentEditor.requiresReport")}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400">
              {t(language, "appointmentEditor.requiresReportHint")}
            </span>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="appointment-editor-notes" className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
          {t(language, "appointmentEditor.notes")}
        </label>
        <textarea
          id="appointment-editor-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm focus:ring-2 focus:ring-teal-500 outline-none"
          placeholder={t(language, "appointmentEditor.notesPlaceholder")}
        />
      </div>

      <div className="flex justify-end">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setInternalEditing(false);
              onCancel?.();
            }}
            className="px-4 py-2 rounded-lg bg-stone-200 hover:bg-stone-300 dark:bg-stone-700 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-200 text-sm font-medium transition-colors"
          >
            {t(language, "common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium transition-colors"
          >
            {mutation.isPending ? t(language, "appointmentEditor.saving") : t(language, "appointmentEditor.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
