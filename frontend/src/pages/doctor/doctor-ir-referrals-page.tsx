import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/shared";
import { fetchMyIrReferralWorklist } from "@/lib/api/ir-referrals";

export function DoctorIrReferralsPage() {
  const query = useQuery({ queryKey: ["doctor", "ir-referrals", "worklist"], queryFn: fetchMyIrReferralWorklist, refetchInterval: 30_000 });
  if (query.isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading IR consultations...</p>;
  if (query.error) return <p className="p-4 text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Unable to load IR consultations."}</p>;
  const status = (value: string) => ({ preparing: "Preparing", ready_for_review: "Ready for review", needs_information: "Needs additional information", appointment_requested: "Appointment requested" }[value] ?? value.replaceAll("_", " "));
  return <section className="space-y-4 p-4 lg:p-6"><header><h1 className="text-2xl font-semibold">IR Consultations</h1><p className="text-sm text-muted-foreground">Consultation work is separate from Reporting Board report status and metrics.</p></header><div className="grid gap-3">{(query.data??[]).map(item => <article key={item.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><Badge variant="info">IR Consultation</Badge><h2 className="mt-2 font-semibold">{item.patientEnglishName || item.patientArabicName || item.patientMrn || `Patient ${item.patientId}`}</h2><p className="text-sm text-muted-foreground">{item.patientMrn || "MRN unavailable"} · {item.requestedProcedure}</p></div><Badge variant={item.status === "ready_for_review" ? "success" : item.status === "preparing" ? "warning" : "info"}>{status(item.status)}</Badge></div><p className="mt-2 text-sm">{item.clinicalIndication || "No clinical indication recorded."}</p><p className="mt-2 text-xs text-muted-foreground">Documents: {item.documentsConfirmed ? "confirmed" : "not confirmed"} · Imaging: {item.imagesConfirmed ? "confirmed" : "not confirmed"}</p><Link to={`/comparisons/ir/${item.id}`} className="mt-3 inline-block text-sm font-semibold text-accent">Open consultation</Link></article>)}{query.data?.length===0?<p className="rounded border p-4 text-sm text-muted-foreground">No assigned IR consultations.</p>:null}</div></section>;
}
