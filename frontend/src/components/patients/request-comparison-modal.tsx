import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/shared";
import { createComparisonRequest, fetchComparisonReportingDoctors, fetchPreviousCompletedStudies } from "@/lib/api-hooks";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import type { PreviousCompletedStudy } from "@/types/api";

function studyLabel(study: PreviousCompletedStudy) {
  return [
    study.date,
    study.modalityCode || study.modalityName,
    study.examName,
    study.accessionNumber,
  ].filter(Boolean).join(" | ");
}

export function RequestComparisonModal({
  patientId,
  onClose,
}: {
  patientId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [plannedReportingDoctorId, setPlannedReportingDoctorId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const { data: studies = [], isLoading, error } = useQuery({
    queryKey: ["comparison-previous-studies", patientId],
    queryFn: () => fetchPreviousCompletedStudies(patientId),
  });
  const selectedStudy = studies.find((study) => study.bookingId === selectedBookingId) ?? null;
  const canPlanDoctor = user?.role === "supervisor" || user?.role === "super_admin";
  const doctorsQuery = useQuery({
    queryKey: ["comparison-reporting-doctors", selectedStudy?.modalityId],
    queryFn: () => fetchComparisonReportingDoctors(selectedStudy!.modalityId),
    enabled: canPlanDoctor && Boolean(selectedStudy),
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!selectedBookingId) throw new Error("Select a previous completed RISpro study.");
      const cleanReason = reason.trim();
      if (!cleanReason) throw new Error("Reason is required.");
      return createComparisonRequest({ patientId, linkedPreviousBookingId: selectedBookingId, reason: cleanReason, plannedReportingDoctorId });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comparison-requests"] });
      pushToast({ type: "success", title: "Comparison requested", message: "Request is pending materials confirmation." });
      onClose();
    },
    onError: (err) => {
      pushToast({ type: "error", title: "Comparison request failed", message: err instanceof Error ? err.message : "Unable to create comparison request." });
    },
  });
  const canSubmit = Boolean(selectedBookingId && reason.trim()) && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-comparison-title"
      onClick={(event) => event.stopPropagation()}
    >
      <section className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 id="request-comparison-title" className="text-lg font-semibold">Request comparison</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close request comparison">
            <X size={18} />
          </Button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading previous completed studies...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Unable to load previous studies."}</p>
          ) : studies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed previous RISpro studies were found for this patient.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Study</th>
                    <th className="px-3 py-2">Report</th>
                    <th className="px-3 py-2">PACS</th>
                  </tr>
                </thead>
                <tbody>
                  {studies.map((study) => (
                    <tr key={study.bookingId} className="border-t border-border">
                      <td className="px-3 py-2">
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name="comparison-study"
                            checked={selectedBookingId === study.bookingId}
                            onChange={() => setSelectedBookingId(study.bookingId)}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-medium">{studyLabel(study)}</span>
                            <span className="block text-xs text-muted-foreground">Booking #{study.bookingId}</span>
                          </span>
                        </label>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{study.reportStatus}</td>
                      <td className="px-3 py-2 text-xs">{study.studyInstanceUid || "Study UID not recorded"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Reason for comparison request</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 rounded-lg border border-border bg-background px-3 py-2"
              placeholder="Clinical or operational reason"
            />
          </label>
          {canPlanDoctor && selectedStudy ? (
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Assign reporting doctor</span>
              <select aria-label="Assign reporting doctor" value={plannedReportingDoctorId ?? ""} onChange={(event) => setPlannedReportingDoctorId(event.target.value ? Number(event.target.value) : null)} className="h-10 rounded-lg border border-border bg-background px-3">
                <option value="">Unassigned - send to reporting pool</option>
                {(doctorsQuery.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            Create comparison request
          </Button>
        </div>
      </section>
    </div>
  );
}
