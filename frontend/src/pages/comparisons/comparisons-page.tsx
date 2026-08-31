import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, ExternalLink, ImageUp, Search, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared";
import {
  cancelComparisonRequest,
  confirmComparisonMaterials,
  fetchComparisonReportingDoctors,
  fetchPreviousCompletedStudies,
  fetchComparisonRequest,
  fetchComparisonRequests,
  updateComparisonRequest,
} from "@/lib/api-hooks";
import { formatDateTimeLy } from "@/lib/date-format";
import { t, type Language, type TranslationKey } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import type { ComparisonRequest } from "@/types/api";
import { ComparisonDocumentsPanel } from "./comparison-documents-panel";

const CONFIRM_ROLES = new Set(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
const CANCEL_ROLES = new Set(["supervisor", "super_admin"]);

const STATUS_OPTIONS = ["active", "pending", "ready", "assigned", "finalized", "cancelled", "all"] as const;

function patientName(row: ComparisonRequest) {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
}

function statusVariant(status: ComparisonRequest["status"]) {
  if (status === "finalized" || status === "ready_for_reporting") return "success";
  if (status === "cancelled") return "error";
  if (status === "pending_upload_confirmation") return "warning";
  return "neutral";
}

function imageReadiness(row: ComparisonRequest, language: Language): { label: string; tone: string } {
  if (row.remapJobStatus === "sent") return { label: t(language, "comparisons.image.sent"), tone: "text-emerald-700" };
  if (row.remapJobStatus === "failed") return { label: t(language, "comparisons.image.failed"), tone: "text-red-700" };
  if (row.remapJobStatus === "sending") return { label: t(language, "comparisons.image.sending"), tone: "text-blue-700" };
  if (row.remapJobStatus === "remapped") return { label: t(language, "comparisons.image.preparing"), tone: "text-blue-700" };
  if (row.remapJobStatus === "processing") return { label: t(language, "comparisons.image.processing"), tone: "text-blue-700" };
  if (row.remapJobStatus === "uploaded") return { label: t(language, row.remapProcessingStage === "staging" ? "comparisons.image.staging" : "comparisons.image.queued"), tone: "text-blue-700" };
  if (row.remapJobStatus === "awaiting_confirmation") return { label: t(language, "comparisons.image.awaiting"), tone: "text-amber-700" };
  if (row.imageAvailabilityConfirmed) return { label: t(language, "comparisons.image.manual"), tone: "text-emerald-700" };
  return { label: t(language, "comparisons.image.unverified"), tone: "text-amber-700" };
}

function ConfirmationPanel({ row }: { row: ComparisonRequest }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [imageAvailabilityConfirmed, setImageAvailabilityConfirmed] = useState(false);
  const [documentsDisposition, setDocumentsDisposition] = useState<"attached_verified" | "not_required" | null>(null);
  const [selectedPriorConfirmed, setSelectedPriorConfirmed] = useState(false);
  const [materialsConfirmationNote, setMaterialsConfirmationNote] = useState("");
  const mutation = useMutation({
    mutationFn: () => confirmComparisonMaterials(row.id, {
      imageAvailabilityConfirmed,
      documentsAvailabilityConfirmed: documentsDisposition === "attached_verified",
      documentsDisposition,
      selectedPriorConfirmed,
      materialsConfirmationNote: materialsConfirmationNote.trim() || null,
    }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["comparison-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["comparison-request", row.id] });
      void queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] });
      void queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] });
      if (updated.status === "assigned") pushToast({ type: "success", title: "Comparison released", message: `Comparison assigned to ${updated.assignedDoctorName ?? "the selected doctor"}.` });
      else if (row.plannedReportingDoctorId && updated.assignedDoctorId == null) pushToast({ type: "warning", title: "Comparison released", message: "Comparison released to the reporting pool because the selected doctor is no longer eligible." });
      else pushToast({ type: "success", title: "Comparison released", message: "Comparison released to the reporting pool." });
    },
    onError: (error) => pushToast({
      type: "error",
      title: "Confirmation failed",
      message: error instanceof Error ? error.message : "Unable to confirm comparison materials.",
    }),
  });
  const canSubmit = imageAvailabilityConfirmed && Boolean(documentsDisposition) && selectedPriorConfirmed && !mutation.isPending;
  if (row.status !== "pending_upload_confirmation") return null;

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3" aria-label={t(language, "comparisons.finalConfirmation")}>
      <h4 className="text-sm font-semibold">{t(language, "comparisons.finalConfirmation")}</h4>
      <p className="mb-2 text-xs text-muted-foreground">{t(language, "comparisons.finalConfirmationHelp")}</p>
      <div className="grid gap-2 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" checked={imageAvailabilityConfirmed} onChange={(event) => setImageAvailabilityConfirmed(event.target.checked)} /><span>{t(language, "comparisons.confirmImages")}</span></label>
        {row.documentCount > 0
          ? <label className="flex items-start gap-2"><input type="radio" name={`documents-${row.id}`} checked={documentsDisposition === "attached_verified"} onChange={() => setDocumentsDisposition("attached_verified")} /><span>{t(language, "comparisons.papersVerified")}</span></label>
          : <label className="flex items-start gap-2"><input type="radio" name={`documents-${row.id}`} checked={documentsDisposition === "not_required"} onChange={() => setDocumentsDisposition("not_required")} /><span>{t(language, "comparisons.noPaperRequired")}</span></label>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={selectedPriorConfirmed} onChange={(event) => setSelectedPriorConfirmed(event.target.checked)} /><span>{t(language, "comparisons.confirmPrior")}</span></label>
        <textarea value={materialsConfirmationNote} onChange={(event) => setMaterialsConfirmationNote(event.target.value)} className="min-h-20 rounded-lg border border-border bg-background px-3 py-2" placeholder={t(language, "comparisons.confirmationNote")} />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}><CheckCircle2 size={16} />{t(language, "comparisons.confirmAndRelease")}</Button>
      </div>
    </section>
  );
}

function CancelComparisonDialog({ row, open, onClose }: { row: ComparisonRequest; open: boolean; onClose: () => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => cancelComparisonRequest(row.id, { reason: reason.trim() }),
    onSuccess: () => {
      setReason("");
      onClose();
      void queryClient.invalidateQueries({ queryKey: ["comparison-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["comparison-request", row.id] });
      void queryClient.invalidateQueries({ queryKey: ["reporting-board-cases"] });
      pushToast({ type: "success", title: "Comparison request cancelled", message: "The cancellation was recorded for audit." });
    },
    onError: (error) => pushToast({ type: "error", title: "Cancellation failed", message: error instanceof Error ? error.message : "Unable to cancel the comparison request." }),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent maxWidth="560px">
        <DialogHeader>
          <DialogTitle>{t(language, "comparisons.cancelTitle")}</DialogTitle>
          <DialogDescription>{t(language, "comparisons.cancelHelp")}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <div><dt className="font-semibold">{t(language, "comparisons.patient")}</dt><dd>{patientName(row)}{row.patientMrn ? ` · ${row.patientMrn}` : ""}</dd></div>
          <div><dt className="font-semibold">{t(language, "comparisons.previousStudy")}</dt><dd>{[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ")}</dd></div>
          <div><dt className="font-semibold">{t(language, "comparisons.requestReason")}</dt><dd>{row.reason}</dd></div>
          <div><dt className="font-semibold">{t(language, "comparisons.currentStatus")}</dt><dd>{row.status.replaceAll("_", " ")}</dd></div>
        </dl>
        <label className="grid gap-1 text-sm font-semibold">{t(language, "comparisons.cancellationReason")}<textarea aria-label={t(language, "comparisons.cancellationReason")} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 font-normal" /></label>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>{t(language, "comparisons.keepRequest")}</Button>
          <Button type="button" variant="destructive" disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{t(language, "comparisons.cancelRequest")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditComparisonDialog({ row, manager, open, onClose }: { row: ComparisonRequest; manager: boolean; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(row.reason);
  const [bookingId, setBookingId] = useState(row.linkedPreviousBookingId);
  const [doctorId, setDoctorId] = useState<number | null>(row.plannedReportingDoctorId ?? null);
  useEffect(() => {
    if (!open) return;
    setReason(row.reason);
    setBookingId(row.linkedPreviousBookingId);
    setDoctorId(row.plannedReportingDoctorId ?? null);
  }, [open, row.id, row.reason, row.linkedPreviousBookingId, row.plannedReportingDoctorId]);
  const studies = useQuery({ queryKey: ["comparison-previous-studies", row.patientId], queryFn: () => fetchPreviousCompletedStudies(row.patientId), enabled: open && manager });
  const selectedStudy = (studies.data ?? []).find((study) => study.bookingId === bookingId);
  const doctors = useQuery({ queryKey: ["comparison-reporting-doctors", selectedStudy?.modalityId], queryFn: () => fetchComparisonReportingDoctors(selectedStudy!.modalityId), enabled: open && manager && Boolean(selectedStudy) });
  const priorLocked = row.documentCount > 0 || Boolean(row.remapJobId) || row.materialsConfirmed;
  const mutation = useMutation({
    mutationFn: () => updateComparisonRequest(row.id, { reason: reason.trim(), ...(manager ? { linkedPreviousBookingId: bookingId, plannedReportingDoctorId: doctorId } : {}) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["comparison-requests"] }), queryClient.invalidateQueries({ queryKey: ["comparison-request", row.id] }), queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] })]); onClose(); },
  });
  const { language } = useLanguage();
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{t(language, "comparisons.editRequest")}</DialogTitle><DialogDescription>{t(language, "comparisons.editHelp")}</DialogDescription></DialogHeader><label className="grid gap-1 text-sm">{t(language, "comparisons.reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 rounded border p-2" /></label>{manager && <><label className="grid gap-1 text-sm">{t(language, "comparisons.previousCompletedStudy")}<select disabled={priorLocked} value={bookingId} onChange={(event) => { setBookingId(Number(event.target.value)); setDoctorId(null); }} className="h-10 rounded border px-2">{(studies.data ?? []).map((study) => <option key={study.bookingId} value={study.bookingId}>{study.date} · {study.modalityCode} · {study.accessionNumber}</option>)}</select>{priorLocked && <span className="text-xs text-muted-foreground">{t(language, "comparisons.previousStudyLocked")}</span>}</label><label className="grid gap-1 text-sm">{t(language, "comparisons.assignReportingDoctor")}<select disabled={doctors.isLoading} value={doctorId ?? ""} onChange={(event) => setDoctorId(event.target.value ? Number(event.target.value) : null)} className="h-10 rounded border px-2"><option value="">{t(language, "comparisons.unassignedReportingPool")}</option>{(doctors.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.displayName}</option>)}</select></label></>}</DialogContent><DialogFooter><Button type="button" variant="secondary" onClick={onClose}>{t(language, "common.cancel")}</Button><Button type="button" disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{t(language, "comparisons.saveChanges")}</Button></DialogFooter></Dialog>;
}

function ComparisonRow({ row, canConfirm, canCancel, canEdit, manager }: { row: ComparisonRequest; canConfirm: boolean; canCancel: boolean; canEdit: boolean; manager: boolean }) {
  const { language } = useLanguage();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const image = imageReadiness(row, language);
  const canPrepare = row.status === "pending_upload_confirmation";
  const canCancelRequest = row.status !== "cancelled" && row.status !== "finalized";
  const remapParams = new URLSearchParams({
    comparisonRequestId: String(row.id),
    patientId: String(row.patientId),
    returnPath: `/comparisons/${row.id}`,
  });

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-md">
      <header className="border-b border-border bg-muted/50 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{patientName(row)}</h3>
            <Badge variant={statusVariant(row.status)} size="sm">{row.status.replaceAll("_", " ")}</Badge>
            <Badge variant="neutral" size="sm">{row.linkedModalityCode || "Modality"}</Badge>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{t(language, "comparisons.previousStudy")}: {[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ") || `#${row.linkedPreviousBookingId}`}</div>
          <p className="mt-2 text-sm"><span className="font-semibold">{t(language, "comparisons.reason")}:</span> {row.reason}</p>
        </div>
        <div className="text-end text-xs text-muted-foreground">
          <div>{t(language, "comparisons.created", { date: formatDateTimeLy(row.createdAt) })}</div>
          <div>{t(language, "comparisons.by", { name: row.createdByName || (row.createdBy ? `#${row.createdBy}` : "-") })}</div>
          <Link to={`/comparisons/${row.id}`} className="mt-2 inline-flex items-center gap-1 font-semibold text-accent"><ExternalLink size={13} />{t(language, "comparisons.openDetails")}</Link>
          {canEdit && canPrepare ? <Button type="button" variant="ghost" size="sm" onClick={() => setEditOpen(true)}>{t(language, "comparisons.editRequest")}</Button> : null}
        </div>
        </div>
      </header>

      <div className="space-y-3 bg-card px-4 py-3">
      <section className="grid gap-3 rounded-lg border border-border/70 bg-muted/30 p-3 md:grid-cols-3" aria-label={t(language, "comparisons.materialReadiness")}>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">{t(language, "comparisons.images")}</h4>
          <p className={`text-xs font-semibold ${image.tone}`}>{image.label}</p>
          {row.remapJobId ? <p className="text-xs text-muted-foreground">{t(language, "comparisons.remapJob", { id: row.remapJobId })}{row.remapProcessingStage ? ` · ${row.remapProcessingStage.replaceAll("_", " ")}` : ""}</p> : null}
          {row.remapJobStatus === "failed" && row.remapErrorMessage ? <p className="text-xs text-red-700">{row.remapErrorMessage}</p> : null}
          {canPrepare ? <Link to={`/comparisons/${row.id}/remap?${remapParams.toString()}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent"><ImageUp size={14} />{t(language, "comparisons.uploadRemap")}</Link> : null}
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">{t(language, "comparisons.documents")}</h4>
          <p className={`text-xs font-semibold ${row.documentCount > 0 ? "text-emerald-700" : "text-amber-700"}`}>{row.documentsDisposition === "attached_verified" ? t(language, "comparisons.papersVerified") : row.documentsDisposition === "not_required" ? t(language, "comparisons.noPaperRequired") : row.materialsConfirmed ? t(language, "comparisons.legacyDocumentConfirmation") : row.documentCount > 0 ? t(language, "comparisons.attachedCount", { count: row.documentCount }) : t(language, "comparisons.noPaperAttached")}</p>
          <p className="text-xs text-muted-foreground">{t(language, "comparisons.canonicalStorage")}</p>
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">{t(language, "comparisons.previousStudy")}</h4>
          <p className="text-xs">{[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ")}</p>
          <p className={`text-xs font-semibold ${row.selectedPriorConfirmed ? "text-emerald-700" : "text-amber-700"}`}>{row.selectedPriorConfirmed ? t(language, "comparisons.selectedConfirmed") : t(language, "comparisons.notConfirmed")}</p>
        </div>
      </section>

      <ComparisonDocumentsPanel comparisonRequestId={row.id} canAttach={canConfirm && canPrepare} canDelete={canCancel && canPrepare} />

      {row.assignedDoctorName ? <p className="text-xs text-muted-foreground">{t(language, "comparisons.assignedDoctor", { name: row.assignedDoctorName })}</p> : null}
      {row.status === "pending_upload_confirmation" ? <p className="text-xs text-muted-foreground">{row.plannedReportingDoctorName ? `Target doctor: ${row.plannedReportingDoctorName} - assignment activates after preparation` : "Reporting destination: Unassigned reporting pool"}</p> : null}
      {row.preparationReturnReason ? <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"><strong>Returned to preparation</strong>{row.preparationReturnedByName ? ` by ${row.preparationReturnedByName}` : ""}{row.preparationReturnedAt ? ` · ${formatDateTimeLy(row.preparationReturnedAt)}` : ""}: {row.preparationReturnReason}</p> : null}
      {row.finalizedAt ? <p className="text-xs text-emerald-700">{t(language, "comparisons.finalizedBy", { date: formatDateTimeLy(row.finalizedAt), name: row.finalizedByName || t(language, "comparisons.staff") })}</p> : null}
      {row.status !== "pending_upload_confirmation" && row.materialsConfirmationNote ? <p className="text-xs text-muted-foreground"><strong>{t(language, "comparisons.preparationNote")}:</strong> {row.materialsConfirmationNote}</p> : null}
      {row.status === "cancelled" ? <p className="rounded-md bg-red-50 p-2 text-xs text-red-800"><strong>{t(language, "comparisons.cancelled")}:</strong> {row.cancellationReason || t(language, "comparisons.noReason")}{row.cancelledAt ? ` · ${formatDateTimeLy(row.cancelledAt)}` : ""}</p> : null}
      {canConfirm ? <ConfirmationPanel row={row} /> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5">
        {row.materialsConfirmed ? (
          <div className="flex flex-wrap gap-2 text-xs text-emerald-700"><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{t(language, "comparisons.imagesConfirmed")}</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{t(language, "comparisons.documentsConfirmed")}</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{t(language, "comparisons.priorConfirmed")}</span>{row.materialsConfirmedAt ? <span>{t(language, "comparisons.by", { name: row.materialsConfirmedByName || t(language, "comparisons.staff") })} · {formatDateTimeLy(row.materialsConfirmedAt)}</span> : null}</div>
        ) : (
          <div className="inline-flex items-center gap-1 text-xs text-amber-700"><XCircle size={13} />{t(language, "comparisons.waitingConfirmation")}</div>
        )}
        {canCancel && canCancelRequest ? <Button type="button" variant="ghost" className="text-red-700" onClick={() => setCancelOpen(true)}>{t(language, "comparisons.cancelRequest")}</Button> : null}
      </footer>
      <CancelComparisonDialog row={row} open={cancelOpen} onClose={() => setCancelOpen(false)} />
      <EditComparisonDialog row={row} manager={manager} open={editOpen} onClose={() => setEditOpen(false)} />
    </article>
  );
}

export default function ComparisonsPage() {
  const { id } = useParams();
  const { language } = useLanguage();
  const { user } = useAuth();
  const [status, setStatus] = useState(() => user?.role === "receptionist" ? "pending" : "active");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const canConfirm = Boolean(user && CONFIRM_ROLES.has(user.role));
  const canCancel = Boolean(user && CANCEL_ROLES.has(user.role));
  const manager = Boolean(user && ["supervisor", "super_admin"].includes(user.role));
  const selectedId = id ? Number(id) : null;
  const listQuery = useQuery({ queryKey: ["comparison-requests", status, search], queryFn: () => fetchComparisonRequests({ status, q: search || null }), enabled: !selectedId });
  const detailQuery = useQuery({ queryKey: ["comparison-request", selectedId], queryFn: () => fetchComparisonRequest(selectedId!), enabled: Boolean(selectedId), refetchInterval: (query) => {
    const remapStatus = (query.state.data as ComparisonRequest | undefined)?.remapJobStatus;
    return remapStatus && ["uploaded", "processing", "remapped", "sending", "awaiting_confirmation"].includes(remapStatus) ? 2_000 : false;
  } });
  const rows = selectedId ? (detailQuery.data ? [detailQuery.data] : []) : listQuery.data ?? [];
  const isLoading = selectedId ? detailQuery.isLoading : listQuery.isLoading;
  const error = selectedId ? detailQuery.error : listQuery.error;

  return (
    <main className="space-y-4 p-4 lg:p-6" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{t(language, "comparisons.title")}</h1><p className="text-sm text-muted-foreground">{t(language, "comparisons.subtitle")}</p></div>
        {selectedId ? <Link to="/comparisons" className="text-sm font-semibold text-accent">{t(language, "comparisons.allRequests")}</Link> : null}
      </div>
      {!selectedId ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-background p-3">
          <label className="grid gap-1 text-xs font-semibold">{t(language, "comparisons.status")}<select aria-label={t(language, "comparisons.statusAria")} value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">{STATUS_OPTIONS.map((value) => <option key={value} value={value}>{t(language, `comparisons.filter.${value}` as TranslationKey)}</option>)}</select></label>
          <form className="flex flex-1 items-end gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
            <label className="grid min-w-60 flex-1 gap-1 text-xs font-semibold">{t(language, "comparisons.search")}<input aria-label={t(language, "comparisons.searchAria")} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal" placeholder={t(language, "comparisons.searchPlaceholder")} /></label>
            <Button type="submit" variant="secondary"><Search size={15} />{t(language, "comparisons.search")}</Button>
          </form>
        </div>
      ) : null}
      {isLoading ? <p className="text-sm text-muted-foreground">{t(language, "comparisons.loading")}</p> : error ? <p className="text-sm text-red-600">{error instanceof Error ? error.message : t(language, "comparisons.loadError")}</p> : rows.length === 0 ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t(language, "comparisons.empty")}</p> : <div className="rounded-xl border border-border/70 bg-muted/60 p-4"><div className="grid gap-5">{rows.map((row) => <ComparisonRow key={row.id} row={row} canConfirm={canConfirm} canCancel={canCancel} manager={manager} canEdit={Boolean(user && (manager || row.createdBy === user.id))} />)}</div></div>}
    </main>
  );
}
