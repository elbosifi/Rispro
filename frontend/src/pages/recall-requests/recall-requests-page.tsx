import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchComplementaryRecalls, markComplementaryRecallSeen } from "@/lib/api-hooks";

export default function RecallRequestsPage() {
  const navigate = useNavigate(); const queryClient = useQueryClient();
  const recalls = useQuery({ queryKey: ["complementary-recalls"], queryFn: fetchComplementaryRecalls });
  const seen = useMutation({ mutationFn: markComplementaryRecallSeen, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["complementary-recalls"] }) });
  return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4"><div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><h1 className="text-xl font-semibold">Recall Requests</h1><p className="mt-1 text-sm text-muted-foreground">Complementary examinations awaiting reception scheduling.</p></div><div className="overflow-hidden rounded-2xl border border-border bg-card">{recalls.isLoading ? <div className="p-5 text-sm text-muted-foreground">Loading…</div> : recalls.data?.map((recall) => <div key={recall.id} className="flex flex-wrap items-center gap-3 border-b border-border p-4 last:border-b-0"><div className="min-w-0 flex-1"><p className="font-medium">Recall #{recall.id}</p><p className="text-sm text-muted-foreground">{recall.receptionInstruction || "No reception instruction"}</p><p className="text-xs text-muted-foreground">{recall.status.replace("_", " ")}</p></div>{recall.status === "pending_scheduling" ? <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={() => { void seen.mutateAsync(recall.id); navigate(`/appointments?recallRequestId=${recall.id}`); }}>Book Recall</button> : null}</div>)}</div></div>;
}
