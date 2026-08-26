import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";
import { withdrawComplementaryRecall } from "@/lib/api/complementary-recalls";
import { fetchComplementaryRecalls, markComplementaryRecallsSeen } from "@/lib/api-hooks";
import { chooseLocalized } from "@/lib/i18n";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";

const recallStatuses = ["pending_scheduling", "scheduled", "completed", "cancelled"] as const;
type RecallStatus = (typeof recallStatuses)[number];
type FilterStatus = RecallStatus | "all";
type Recall = Awaited<ReturnType<typeof fetchComplementaryRecalls>>[number];

function statusLabel(language: "ar" | "en", status: RecallStatus) {
  const labels: Record<RecallStatus, [string, string]> = {
    pending_scheduling: ["بحاجة إلى حجز", "Needs booking"], scheduled: ["تم الحجز", "Scheduled"],
    completed: ["مكتمل", "Completed"], cancelled: ["تم سحب الطلب", "Withdrawn"],
  };
  return chooseLocalized(language, ...labels[status]);
}

function statusVariant(status: RecallStatus) {
  return { pending_scheduling: "warning", scheduled: "info", completed: "success", cancelled: "neutral" }[status] as "warning" | "info" | "success" | "neutral";
}

export default function RecallRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { language, isArabic } = useLanguage();
  const [selectedFilter, setSelectedFilter] = useState<FilterStatus>("pending_scheduling");
  const [recallToWithdraw, setRecallToWithdraw] = useState<Recall | null>(null);
  const withdrawalSubmittingRef = useRef(false);
  const recalls = useQuery({ queryKey: ["complementary-recalls"], queryFn: fetchComplementaryRecalls });
  const seen = useMutation({ mutationFn: markComplementaryRecallsSeen, onSuccess: () => { void Promise.all([queryClient.invalidateQueries({ queryKey: ["complementary-recalls"] }), queryClient.invalidateQueries({ queryKey: ["complementary-recalls", "unseen-count"] })]); } });
  const withdraw = useMutation({ mutationFn: withdrawComplementaryRecall, onMutate: () => { withdrawalSubmittingRef.current = true; }, onSuccess: () => { setRecallToWithdraw(null); void Promise.all([queryClient.invalidateQueries({ queryKey: ["complementary-recalls"] }), queryClient.invalidateQueries({ queryKey: ["complementary-recalls", "unseen-count"] })]); }, onSettled: () => { withdrawalSubmittingRef.current = false; } });
  const rows = recalls.data ?? [];
  const canWithdraw = user?.role === "supervisor" || user?.role === "super_admin";
  const counts = useMemo(() => Object.fromEntries(recallStatuses.map((status) => [status, rows.filter((recall) => recall.status === status).length])) as Record<RecallStatus, number>, [rows]);
  const filteredRows = selectedFilter === "all" ? rows : rows.filter((recall) => recall.status === selectedFilter);
  const filters: { status: FilterStatus; label: string; count: number }[] = [
    ...recallStatuses.map((status) => ({ status, label: statusLabel(language, status), count: counts[status] })),
    { status: "all", label: chooseLocalized(language, "الكل", "All"), count: rows.length },
  ];
  const local = (arabic: string, english: string) => chooseLocalized(language, arabic, english);
  const displayAccession = (recall: Recall) => recall.originalAccession || `V2-${String(recall.originalAppointmentId).padStart(6, "0")}`;
  const displayPatient = (recall: Recall) => recall.patientDisplayName || local(`المريض #${recall.originalAppointmentId}`, `Patient #${recall.originalAppointmentId}`);

  useEffect(() => {
    const ids = rows.filter((recall) => recall.receptionSeenAt == null && (recall.status === "pending_scheduling" || recall.status === "scheduled")).map((recall) => recall.id);
    if (ids.length && !seen.isPending) seen.mutate(ids);
  }, [rows, seen]);

  return <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4" dir={isArabic ? "rtl" : "ltr"}>
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><h1 className="text-xl font-semibold">{local("طلبات الاستدعاء", "Recall Requests")}</h1><p className="mt-1 text-sm text-muted-foreground">{local("طلبات التصوير الإضافي التي تنتظر حجز الاستقبال.", "Additional imaging requests awaiting reception scheduling.")}</p></div>
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><p className="text-sm font-medium">{local("تصفية حسب الحالة", "Filter by status")}</p><div className="mt-3 flex flex-wrap gap-2" aria-label={local("تصفية حسب الحالة", "Filter by status")}>{filters.map((filter) => <Button key={filter.status} type="button" size="sm" variant={selectedFilter === filter.status ? "secondary" : "ghost"} aria-pressed={selectedFilter === filter.status} onClick={() => setSelectedFilter(filter.status)}>{filter.label} <span dir="ltr" className="font-mono-data [unicode-bidi:isolate]">({filter.count})</span></Button>)}</div></div>
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {recalls.isLoading ? <div className="p-5 text-sm text-muted-foreground">{local("جارٍ التحميل…", "Loading…")}</div> : recalls.isError ? <div className="p-5 text-sm text-muted-foreground">{local("تعذر تحميل طلبات الاستدعاء.", "Unable to load recall requests.")}</div> : filteredRows.length === 0 ? <div className="p-8 text-center"><p className="font-medium">{local("لا توجد طلبات بهذه الحالة", "No requests with this status")}</p><p className="mt-1 text-sm text-muted-foreground">{local("اختر حالة أخرى لعرض طلبات الاستدعاء.", "Choose another status to view recall requests.")}</p></div> : filteredRows.map((recall) => {
        const status = recall.status as RecallStatus;
        return <article key={recall.id} className="border-b border-border p-4 last:border-b-0 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{displayPatient(recall)}</h2><Badge variant={statusVariant(status)}>{statusLabel(language, status)}</Badge></div><div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm"><p><span className="text-muted-foreground">{local("المعرف", "Identifier")}:</span> <span dir="ltr" className="font-mono-data [unicode-bidi:isolate]">{recall.patientIdentifier || recall.patientMrn || local("غير متاح", "Unavailable")}</span></p><p><span className="text-muted-foreground">{local("الجهاز", "Modality")}:</span> {recall.modalityCode || recall.modalityName || local("غير متاح", "Unavailable")}</p><p><span className="text-muted-foreground">{local("الفحص", "Examination")}:</span> {recall.originalExam || local("غير متاح", "Unavailable")}</p></div><div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">{local("رقم الوصول الأصلي", "Original accession")}:</span> <span dir="ltr" className="ms-1 font-mono-data [unicode-bidi:isolate]">{displayAccession(recall)}</span></div><div className="mt-3 rounded-lg border border-border bg-muted/30 p-3"><p className="text-sm font-semibold">{local("تعليمات الاستقبال", "Reception instruction")}</p><p className="mt-1 whitespace-pre-wrap text-sm">{recall.receptionInstruction || local("لا توجد تعليمات للاستقبال.", "No reception instruction.")}</p></div>{recall.technologistInstruction ? <details className="mt-3 text-sm text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">{local("تعليمات فني الأشعة", "Technologist instruction")}</summary><p className="mt-2 whitespace-pre-wrap">{recall.technologistInstruction}</p></details> : null}<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">{recall.recallAppointmentId ? <p><span className="font-medium text-foreground">{local("موعد العودة", "Return appointment")}:</span> <span dir="ltr" className="font-mono-data [unicode-bidi:isolate]">{recall.recallAppointmentAccession || recall.recallAppointmentId}</span>{recall.recallAppointmentDate ? <span> · {recall.recallAppointmentDate}</span> : null}</p> : null}<p>{local("الطبيب الطالب", "Requesting clinician")}: {recall.requesterDisplayName || local("الفريق السريري", "Clinical staff")}</p></div></div>{status === "pending_scheduling" ? <div className="flex shrink-0 flex-wrap gap-2 border-t border-border pt-4 lg:border-t-0 lg:pt-0"><Button type="button" onClick={() => navigate(`/appointments?recallRequestId=${recall.id}`)}>{local("حجز الاستدعاء", "Book recall")}</Button>{canWithdraw ? <Button type="button" variant="destructive" disabled={withdraw.isPending} onClick={() => setRecallToWithdraw(recall)}>{local("سحب الطلب", "Withdraw request")}</Button> : null}</div> : null}</div></article>;
      })}
    </div>
    <Dialog open={recallToWithdraw != null} onClose={() => { if (!withdraw.isPending) setRecallToWithdraw(null); }}><DialogContent aria-labelledby="withdraw-recall-title" aria-describedby="withdraw-recall-description"><DialogHeader closeLabel={local("إغلاق", "Close")}><DialogTitle id="withdraw-recall-title">{local("سحب طلب الاستدعاء", "Withdraw recall request")}</DialogTitle></DialogHeader>{recallToWithdraw ? <><DialogDescription id="withdraw-recall-description">{local("سيتم سحب طلب التصوير الإضافي من قائمة الحجز النشطة، وسيبقى في السجل.", "The additional-imaging request will be withdrawn from the active scheduling queue but remain in history.")}</DialogDescription><div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm"><p className="font-medium">{displayPatient(recallToWithdraw)}</p><p className="mt-1 text-muted-foreground">{local("رقم الوصول الأصلي", "Original accession")}: <span dir="ltr" className="font-mono-data [unicode-bidi:isolate]">{displayAccession(recallToWithdraw)}</span></p></div></> : null}<DialogFooter><Button type="button" variant="secondary" disabled={withdraw.isPending} onClick={() => setRecallToWithdraw(null)}>{local("إلغاء", "Cancel")}</Button><Button type="button" variant="destructive" disabled={withdraw.isPending} onClick={() => { if (recallToWithdraw && !withdrawalSubmittingRef.current) withdraw.mutate(recallToWithdraw.id); }}>{local("سحب الطلب", "Withdraw request")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
