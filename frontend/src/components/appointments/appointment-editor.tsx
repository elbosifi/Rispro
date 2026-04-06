import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteAppointment, updateAppointment } from "@/lib/api-hooks";
import type { Appointment, AppointmentLookups } from "@/types/api";
import { chooseLocalized } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { pushToast } from "@/lib/toast";

interface AppointmentEditorProps {
  appointment: Appointment & Record<string, any>;
  lookups: AppointmentLookups | undefined;
  onUpdated?: (appointment: any) => void;
  onDeleted?: () => void;
}

export function AppointmentEditor({ appointment, lookups, onUpdated, onDeleted }: AppointmentEditorProps) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [examTypeId, setExamTypeId] = useState(String(appointment.examTypeId ?? ""));
  const [priorityId, setPriorityId] = useState(String(appointment.reportingPriorityId ?? ""));
  const [notes, setNotes] = useState(String(appointment.notes ?? ""));

  useEffect(() => {
    setExamTypeId(String(appointment.examTypeId ?? ""));
    setPriorityId(String(appointment.reportingPriorityId ?? ""));
    setNotes(String(appointment.notes ?? ""));
  }, [appointment.id, appointment.examTypeId, appointment.reportingPriorityId, appointment.notes]);

  const isEdited = Boolean(
    appointment.updatedAt &&
      appointment.createdAt &&
      String(appointment.updatedAt) !== String(appointment.createdAt)
  );

  const filteredExamTypes = useMemo(() => {
    return (lookups?.examTypes ?? []).filter((examType) => {
      if (!examType.isActive) return false;
      if (!appointment.modalityId) return true;
      return !examType.modalityId || String(examType.modalityId) === String(appointment.modalityId);
    });
  }, [lookups, appointment.modalityId]);

  const mutation = useMutation({
    mutationFn: () =>
      updateAppointment(appointment.id, {
        examTypeId: examTypeId ? Number(examTypeId) : null,
        reportingPriorityId: priorityId ? Number(priorityId) : null,
        notes: notes.trim() ? notes.trim() : null
      }),
    meta: {
      suppressGlobalToast: true,
      toastSuccessTitle: "Appointment updated",
      toastSuccessMessage: "Exam type or priority was updated."
    },
    onSuccess: (updated) => {
      pushToast({
        type: "success",
        title: "Appointment updated",
        message: "Exam type or priority was updated."
      });
      queryClient.invalidateQueries();
      onUpdated?.(updated);
    },
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: "Update failed",
        message: err?.message || "Could not update the appointment."
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAppointment(appointment.id),
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: () => {
      pushToast({
        type: "success",
        title: "Appointment deleted",
        message: "The appointment was removed."
      });
      queryClient.invalidateQueries();
      onDeleted?.();
    },
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: "Delete failed",
        message: err?.message || "Could not delete the appointment."
      });
    }
  });

  return (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/30 p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-white">Edit appointment</h4>
          {isEdited && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Edited
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
          Exam type, priority, and notes can be changed here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
            Exam type
          </label>
          <select
            value={examTypeId}
            onChange={(e) => setExamTypeId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm focus:ring-2 focus:ring-teal-500 outline-none"
          >
            <option value="">No exam type</option>
            {filteredExamTypes.map((examType) => (
              <option key={examType.id} value={examType.id}>
                {chooseLocalized(language, examType.nameAr, examType.nameEn)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
            Priority
          </label>
          <select
            value={priorityId}
            onChange={(e) => setPriorityId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm focus:ring-2 focus:ring-teal-500 outline-none"
          >
            <option value="">Normal</option>
            {(lookups?.priorities ?? []).map((priority) => (
              <option key={priority.id} value={priority.id}>
                {chooseLocalized(language, priority.nameAr, priority.nameEn)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm focus:ring-2 focus:ring-teal-500 outline-none"
          placeholder="Optional appointment notes"
        />
      </div>

      <div className="flex justify-end">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this appointment? This cannot be undone.")) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium transition-colors"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium transition-colors"
          >
            {mutation.isPending ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
