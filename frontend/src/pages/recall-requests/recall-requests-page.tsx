import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchComplementaryRecalls, markComplementaryRecallsSeen } from "@/lib/api-hooks";

export default function RecallRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const recalls = useQuery({ queryKey: ["complementary-recalls"], queryFn: fetchComplementaryRecalls });
  const seen = useMutation({ mutationFn: markComplementaryRecallsSeen, onSuccess: () => { void Promise.all([queryClient.invalidateQueries({ queryKey: ["complementary-recalls"] }), queryClient.invalidateQueries({ queryKey: ["complementary-recalls", "unseen-count"] })]); } });
  const markSeen = seen.mutate;
  useEffect(() => {
    const ids = recalls.data?.filter((recall) => recall.receptionSeenAt == null && (recall.status === "pending_scheduling" || recall.status === "scheduled")).map((recall) => recall.id) ?? [];
    if (ids.length && !seen.isPending) markSeen(ids);
  }, [markSeen, recalls.data, seen.isPending]);
  return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4"><div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><h1 className="text-xl font-semibold">Recall Requests</h1><p className="mt-1 text-sm text-muted-foreground">Complementary examinations awaiting reception scheduling.</p></div><div className="overflow-hidden rounded-2xl border border-border bg-card">{recalls.isLoading ? <div className="p-5 text-sm text-muted-foreground">Loading…</div> : recalls.data?.map((recall) => <div key={recall.id} className="flex flex-wrap items-center gap-3 border-b border-border p-4 last:border-b-0"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{recall.patientDisplayName || `Patient #${recall.originalAppointmentId}`}</p><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{recall.status.replace("_", " ")}</span></div><p className="text-sm text-muted-foreground">{recall.patientIdentifier || recall.patientMrn || "Identifier unavailable"} · {recall.modalityCode || recall.modalityName || "Modality"} · {recall.originalExam || "Exam"}</p><p className="mt-1 text-sm font-medium">{recall.originalAccession || `V2-${String(recall.originalAppointmentId).padStart(6, "0")}`} · requested by {recall.requesterDisplayName || "Clinical staff"}</p><p className="mt-1 text-sm text-foreground">{recall.receptionInstruction || "No reception instruction"}</p><details className="mt-1 text-sm text-muted-foreground"><summary>Technologist instruction</summary><p className="mt-1 whitespace-pre-wrap">{recall.technologistInstruction}</p></details>{recall.recallAppointmentId ? <p className="mt-1 text-xs text-muted-foreground">Return appointment: {recall.recallAppointmentAccession || recall.recallAppointmentId} {recall.recallAppointmentDate ? `· ${recall.recallAppointmentDate}` : ""}</p> : null}<p className="mt-1 text-xs text-muted-foreground">Requested {new Date(recall.requestedAt).toLocaleString()}</p></div>{recall.status === "pending_scheduling" ? <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={() => navigate(`/appointments?recallRequestId=${recall.id}`)}>Book Recall</button> : null}</div>)}</div></div>;
}
