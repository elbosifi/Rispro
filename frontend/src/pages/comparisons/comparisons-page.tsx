import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { IR_REFERRAL_STATUSES, irReferralStatusLabel, irReferralStatusVariant } from "@/lib/ir-referral-display";
import { getDoctorDisplayName, getUserDisplayName } from "@/lib/user-display-name";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import type { ComparisonRequest } from "@/types/api";
import type { Patient } from "@/types/api";
import { searchPatients } from "@/lib/api/patients";
import { RequestComparisonModal } from "@/components/patients/request-comparison-modal";
import { RequestIrReferralModal } from "@/components/patients/request-ir-referral-modal";
import { fetchIrReferrals } from "@/lib/api/ir-referrals";
import type { IrReferral } from "@/lib/api/ir-referrals";
import { ComparisonDocumentsPanel } from "./comparison-documents-panel";
import {
  buildComparisonsSearch,
  parseComparisonsNavigation,
  readComparisonsSearch,
  writeComparisonsSearch,
  type ComparisonsNavigationState,
  type ComparisonStatus,
} from "@/lib/navigation/comparisons-navigation";

const CONFIRM_ROLES = new Set(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
const CANCEL_ROLES = new Set(["supervisor", "super_admin"]);

const STATUS_OPTIONS = ["active", "pending", "ready", "assigned", "finalized", "cancelled", "all"] as const;
const IR_STATUS_OPTIONS = ["all", ...IR_REFERRAL_STATUSES] as const;

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

function irPatientName(row: IrReferral, language: Language) {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || t(language, "reviewRequests.patientFallback", { id: row.patientId });
}

function IrReferralRow({ referral }: { referral: IrReferral }) {
  const { language } = useLanguage();
  const doctorName = getDoctorDisplayName({ displayName: referral.assignedDoctorName, fullName: referral.assignedDoctorNameAr, englishName: referral.assignedDoctorNameEn }, language) || t(language, "reviewRequests.unassigned");
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">{t(language, "reviewRequests.irConsultation")}</Badge>
            <Badge variant={irReferralStatusVariant(referral.status)} size="sm">{irReferralStatusLabel(language, referral.status)}</Badge>
          </div>
          <h3 className="mt-3 text-base font-semibold">{irPatientName(referral, language)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{referral.patientMrn || t(language, "reviewRequests.mrnUnavailable")}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.requestedProcedureField")}</dt><dd className="mt-1 font-medium">{referral.requestedProcedure}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "reviewRequests.assignedLabel")}</dt><dd className="mt-1 font-medium">{doctorName}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "reviewRequests.documentsLabel")}</dt><dd className="mt-1 font-medium">{t(language, "reviewRequests.documents", { count: referral.documentCount })}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "reviewRequests.imagingLabel")}</dt><dd className="mt-1 font-medium">{t(language, "reviewRequests.imaging", { status: referral.imagesConfirmed ? t(language, "reviewRequests.confirmed") : t(language, "reviewRequests.pending") })}</dd></div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">{t(language, "reviewRequests.created", { date: formatDateTimeLy(referral.createdAt) })}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Link to={`/comparisons/ir/${referral.id}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted">{t(language, "reviewRequests.openDetails")}<ExternalLink size={14} /></Link>
          {referral.status === "appointment_requested" && referral.scheduleRequestId ? <Link to={`/appointments?irReferralScheduleRequestId=${referral.scheduleRequestId}`} className="inline-flex h-10 items-center rounded-md bg-accent px-3 text-sm font-semibold text-accent-foreground">{t(language, "reviewRequests.bookIrAppointment")}</Link> : null}
        </div>
      </div>
    </article>
  );
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
      if (updated.status === "assigned") pushToast({ type: "success", title: t(language, "comparisons.released"), message: t(language, "comparisons.assignedRelease", { name: updated.assignedDoctorId ? getDoctorDisplayName({ fullName: updated.assignedDoctorNameAr, englishName: updated.assignedDoctorNameEn, displayName: updated.assignedDoctorName }, language) || t(language, "comparisons.assignReportingDoctor") : t(language, "comparisons.assignReportingDoctor") }) });
      else if (row.plannedReportingDoctorId && updated.assignedDoctorId == null) pushToast({ type: "info", title: t(language, "comparisons.released"), message: t(language, "comparisons.ineligiblePlanRelease") });
      else pushToast({ type: "success", title: t(language, "comparisons.released"), message: t(language, "comparisons.poolRelease") });
    },
    onError: (error) => pushToast({
      type: "error",
      title: t(language, "comparisons.confirmationFailed"),
      message: error instanceof Error ? error.message : t(language, "comparisons.confirmationFailedMessage"),
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
      void queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] });
      void queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "stats"] });
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

type EditComparisonDialogProps = { row: ComparisonRequest; manager: boolean; open: boolean; onClose: () => void };

function EditComparisonDialog(props: EditComparisonDialogProps) {
  const { row, open } = props;
  return <EditComparisonDialogContent key={`${open}-${row.id}-${row.reason}-${row.linkedPreviousBookingId}-${row.plannedReportingDoctorId ?? "none"}`} {...props} />;
}

function EditComparisonDialogContent({ row, manager, open, onClose }: EditComparisonDialogProps) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState(row.reason);
  const [bookingId, setBookingId] = useState(row.linkedPreviousBookingId);
  const [doctorId, setDoctorId] = useState<number | null>(row.plannedReportingDoctorId ?? null);
  const studies = useQuery({ queryKey: ["comparison-previous-studies", row.patientId], queryFn: () => fetchPreviousCompletedStudies(row.patientId), enabled: open && manager });
  const selectedStudy = (studies.data ?? []).find((study) => study.bookingId === bookingId);
  const doctors = useQuery({ queryKey: ["comparison-reporting-doctors", selectedStudy?.modalityId], queryFn: () => fetchComparisonReportingDoctors(selectedStudy!.modalityId), enabled: open && manager && Boolean(selectedStudy) });
  const priorLocked = row.documentCount > 0 || Boolean(row.remapJobId) || row.materialsConfirmed;
  const mutation = useMutation({
    mutationFn: () => updateComparisonRequest(row.id, { reason: reason.trim(), ...(manager ? { linkedPreviousBookingId: bookingId, plannedReportingDoctorId: doctorId } : {}) }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["comparison-requests"] }), queryClient.invalidateQueries({ queryKey: ["comparison-request", row.id] }), queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "cases"] })]); onClose(); },
  });
  const { language } = useLanguage();
  return <Dialog open={open} onClose={onClose}><DialogContent><DialogHeader><DialogTitle>{t(language, "comparisons.editRequest")}</DialogTitle><DialogDescription>{t(language, "comparisons.editHelp")}</DialogDescription></DialogHeader><label className="grid gap-1 text-sm">{t(language, "comparisons.reason")}<textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 rounded border p-2" /></label>{manager && <><label className="grid gap-1 text-sm">{t(language, "comparisons.previousCompletedStudy")}<select disabled={priorLocked} value={bookingId} onChange={(event) => { setBookingId(Number(event.target.value)); setDoctorId(null); }} className="h-10 rounded border px-2">{(studies.data ?? []).map((study) => <option key={study.bookingId} value={study.bookingId}>{study.date} · {study.modalityCode} · {study.accessionNumber}</option>)}</select>{priorLocked && <span className="text-xs text-muted-foreground">{t(language, "comparisons.previousStudyLocked")}</span>}</label><label className="grid gap-1 text-sm">{t(language, "comparisons.assignReportingDoctor")}<select disabled={doctors.isLoading} value={doctorId ?? ""} onChange={(event) => setDoctorId(event.target.value ? Number(event.target.value) : null)} className="h-10 rounded border px-2"><option value="">{t(language, "comparisons.unassignedReportingPool")}</option>{(doctors.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{getDoctorDisplayName(doctor, language)}</option>)}</select></label></>}</DialogContent><DialogFooter><Button type="button" variant="secondary" onClick={onClose}>{t(language, "common.cancel")}</Button><Button type="button" disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>{t(language, "comparisons.saveChanges")}</Button></DialogFooter></Dialog>;
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
          <div>{t(language, "comparisons.by", { name: getUserDisplayName({ fullName: row.createdByNameAr ?? row.createdByName, englishName: row.createdByNameEn, username: row.createdByUsername }, language) || (row.createdBy ? `#${row.createdBy}` : "-") })}</div>
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

      {row.assignedDoctorId ? <p className="text-xs text-muted-foreground">{t(language, "comparisons.assignedDoctor", { name: getDoctorDisplayName({ fullName: row.assignedDoctorNameAr, englishName: row.assignedDoctorNameEn, displayName: row.assignedDoctorName }, language) || row.assignedDoctorName || t(language, "comparisons.assignReportingDoctor") })}</p> : null}
      {row.status === "pending_upload_confirmation" ? <p className="text-xs text-muted-foreground">{row.plannedReportingDoctorId ? t(language, "comparisons.plannedTarget", { name: getDoctorDisplayName({ fullName: row.plannedReportingDoctorNameAr, englishName: row.plannedReportingDoctorNameEn, displayName: row.plannedReportingDoctorName }, language) || row.plannedReportingDoctorName || t(language, "comparisons.assignReportingDoctor") }) : t(language, "comparisons.poolDestination")}</p> : null}
      {row.preparationReturnReason ? <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900"><strong>{t(language, "comparisons.returnedPreparation")}</strong>{getUserDisplayName({ fullName: row.preparationReturnedByNameAr ?? row.preparationReturnedByName, englishName: row.preparationReturnedByNameEn, username: row.preparationReturnedByUsername }, language) ? ` ${t(language, "comparisons.by", { name: getUserDisplayName({ fullName: row.preparationReturnedByNameAr ?? row.preparationReturnedByName, englishName: row.preparationReturnedByNameEn, username: row.preparationReturnedByUsername }, language) })}` : ""}{row.preparationReturnedAt ? ` · ${formatDateTimeLy(row.preparationReturnedAt)}` : ""}: {row.preparationReturnReason}</p> : null}
      {row.finalizedAt ? <p className="text-xs text-emerald-700">{t(language, "comparisons.finalizedBy", { date: formatDateTimeLy(row.finalizedAt), name: getDoctorDisplayName({ fullName: row.finalizedByNameAr ?? row.finalizedByName, englishName: row.finalizedByNameEn, displayName: row.finalizedByName, username: null }, language) || t(language, "comparisons.staff") })}</p> : null}
      {row.status !== "pending_upload_confirmation" && row.materialsConfirmationNote ? <p className="text-xs text-muted-foreground"><strong>{t(language, "comparisons.preparationNote")}:</strong> {row.materialsConfirmationNote}</p> : null}
      {row.status === "cancelled" ? <p className="rounded-md bg-red-50 p-2 text-xs text-red-800"><strong>{t(language, "comparisons.cancelled")}:</strong> {row.cancellationReason || t(language, "comparisons.noReason")}{row.cancelledAt ? ` · ${formatDateTimeLy(row.cancelledAt)}` : ""}</p> : null}
      {canConfirm ? <ConfirmationPanel row={row} /> : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5">
        {row.materialsConfirmed ? (
          <div className="flex flex-wrap gap-2 text-xs text-emerald-700"><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{t(language, "comparisons.imagesConfirmed")}</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{t(language, "comparisons.documentsConfirmed")}</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{t(language, "comparisons.priorConfirmed")}</span>{row.materialsConfirmedAt ? <span>{t(language, "comparisons.by", { name: getUserDisplayName({ fullName: row.materialsConfirmedByNameAr ?? row.materialsConfirmedByName, englishName: row.materialsConfirmedByNameEn, username: row.materialsConfirmedByUsername }, language) || t(language, "comparisons.staff") })} · {formatDateTimeLy(row.materialsConfirmedAt)}</span> : null}</div>
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
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultComparisonStatus: ComparisonStatus = user?.role === "receptionist" ? "pending" : "active";
  const navigation = useMemo(() => parseComparisonsNavigation(searchParams, defaultComparisonStatus), [defaultComparisonStatus, searchParams]);
  const { requestKind, comparisonStatus, irStatus } = navigation;
  const [searchDraft, setSearchDraft] = useState(readComparisonsSearch);
  const [search, setSearch] = useState(readComparisonsSearch);
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [createComparisonOpen, setCreateComparisonOpen] = useState(false);
  const [createIrOpen, setCreateIrOpen] = useState(false);
  useEffect(() => {
    const normalized = buildComparisonsSearch(searchParams, {}, defaultComparisonStatus);
    if (normalized.toString() !== searchParams.toString()) {
      setSearchParams(normalized, { replace: true });
    }
  }, [defaultComparisonStatus, searchParams, setSearchParams]);

  const updateNavigation = (patch: Partial<ComparisonsNavigationState>, replace = true) => {
    setSearchParams(buildComparisonsSearch(searchParams, patch, defaultComparisonStatus), { replace });
  };
  const patientsQuery = useQuery({ queryKey: ["comparison-patient-search", patientQuery.trim()], queryFn: () => searchPatients(patientQuery.trim()), enabled: patientSearchOpen && patientQuery.trim().length >= 2 });
  const canConfirm = Boolean(user && CONFIRM_ROLES.has(user.role));
  const canCancel = Boolean(user && CANCEL_ROLES.has(user.role));
  const manager = Boolean(user && ["supervisor", "super_admin"].includes(user.role));
  const selectedId = id ? Number(id) : null;
  const listQuery = useQuery({ queryKey: ["comparison-requests", requestKind, comparisonStatus, search], queryFn: () => fetchComparisonRequests({ status: requestKind === "all" ? "all" : comparisonStatus, q: search || null }), enabled: !selectedId && requestKind !== "ir" });
  const irReferralsQuery = useQuery({ queryKey: ["ir-referrals", requestKind, irStatus, search], queryFn: () => fetchIrReferrals({ status: requestKind === "all" ? "all" : irStatus, q: search || null }), enabled: !selectedId && requestKind !== "comparisons" });
  const detailQuery = useQuery({ queryKey: ["comparison-request", selectedId], queryFn: () => fetchComparisonRequest(selectedId!), enabled: Boolean(selectedId), refetchInterval: (query) => {
    const remapStatus = (query.state.data as ComparisonRequest | undefined)?.remapJobStatus;
    return remapStatus && ["uploaded", "processing", "remapped", "sending", "awaiting_confirmation"].includes(remapStatus) ? 2_000 : false;
  } });
  const rows = selectedId ? (detailQuery.data ? [detailQuery.data] : []) : listQuery.data ?? [];
  const comparisonLoading = selectedId ? detailQuery.isLoading : listQuery.isLoading;
  const comparisonError = selectedId ? detailQuery.error : listQuery.error;
  const showComparisons = Boolean(selectedId) || requestKind !== "ir";
  const showIr = !selectedId && requestKind !== "comparisons";
  const comparisonResult = showComparisons ? (
    <section className="space-y-3" aria-labelledby="comparison-results-heading">
      {!selectedId ? <h2 id="comparison-results-heading" className="text-lg font-semibold">{t(language, "reviewRequests.comparisons")}</h2> : null}
      {comparisonLoading ? <p className="text-sm text-muted-foreground">{t(language, "reviewRequests.loadingComparisons")}</p> : comparisonError ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{comparisonError instanceof Error ? comparisonError.message : t(language, "reviewRequests.comparisonLoadError")}</p> : rows.length === 0 ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t(language, "reviewRequests.noComparisonResults")}</p> : <div className="rounded-xl border border-border/70 bg-muted/40 p-4"><div className="grid gap-4">{rows.map((row) => <ComparisonRow key={row.id} row={row} canConfirm={canConfirm} canCancel={canCancel} manager={manager} canEdit={Boolean(user && (manager || row.createdBy === user.id))} />)}</div></div>}
    </section>
  ) : null;
  const irResult = showIr ? (
    <section className="space-y-3" aria-labelledby="ir-results-heading">
      <h2 id="ir-results-heading" className="text-lg font-semibold">{t(language, "reviewRequests.irConsultations")}</h2>
      {irReferralsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t(language, "reviewRequests.loadingIrConsultations")}</p> : irReferralsQuery.error ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{irReferralsQuery.error instanceof Error ? irReferralsQuery.error.message : t(language, "reviewRequests.irLoadError")}</p> : (irReferralsQuery.data ?? []).length === 0 ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">{t(language, "reviewRequests.noIrResults")}</p> : <div className="grid gap-3">{(irReferralsQuery.data ?? []).map((referral) => <IrReferralRow key={referral.id} referral={referral} />)}</div>}
    </section>
  ) : null;
  const allResultsEmpty = requestKind === "all" && !comparisonLoading && !comparisonError && !irReferralsQuery.isLoading && !irReferralsQuery.error && rows.length === 0 && (irReferralsQuery.data ?? []).length === 0;

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 p-4 lg:p-6" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">RISpro</p><h1 className="mt-1 text-2xl font-semibold">{t(language, "comparisons.title")}</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t(language, "comparisons.subtitle")}</p></div>
        <div className="flex flex-wrap items-center gap-3"><Button type="button" onClick={() => { setPatientSearchOpen(true); setSelectedPatient(null); setPatientQuery(""); }}>{t(language, "reviewRequests.searchPatient")}</Button>{selectedId ? <Link to="/comparisons" className="text-sm font-semibold text-accent">{t(language, "reviewRequests.all")}</Link> : null}</div>
      </div>
      {!selectedId ? (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex h-10 items-end gap-1" role="tablist" aria-label={t(language, "reviewRequests.title")}><Button type="button" size="sm" variant={requestKind === "all" ? "secondary" : "ghost"} onClick={() => updateNavigation({ requestKind: "all" }, false)}>{t(language, "reviewRequests.all")}</Button><Button type="button" size="sm" variant={requestKind === "comparisons" ? "secondary" : "ghost"} onClick={() => updateNavigation({ requestKind: "comparisons" }, false)}>{t(language, "reviewRequests.comparisons")}</Button><Button type="button" size="sm" variant={requestKind === "ir" ? "secondary" : "ghost"} onClick={() => updateNavigation({ requestKind: "ir" }, false)}>{t(language, "reviewRequests.irConsultations")}</Button></div>
            {requestKind === "comparisons" ? <label className="grid min-w-44 gap-1 text-xs font-semibold">{t(language, "reviewRequests.status")}<select aria-label={t(language, "reviewRequests.comparisonStatusAria")} value={comparisonStatus} onChange={(event) => updateNavigation({ comparisonStatus: event.target.value as ComparisonStatus })} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">{STATUS_OPTIONS.map((value) => <option key={value} value={value}>{t(language, `comparisons.filter.${value}` as TranslationKey)}</option>)}</select></label> : null}
            {requestKind === "ir" ? <label className="grid min-w-52 gap-1 text-xs font-semibold">{t(language, "reviewRequests.status")}<select aria-label={t(language, "reviewRequests.irStatusAria")} value={irStatus} onChange={(event) => updateNavigation({ irStatus: event.target.value as (typeof IR_STATUS_OPTIONS)[number] })} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">{IR_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value === "all" ? t(language, "reviewRequests.allStatuses") : irReferralStatusLabel(language, value)}</option>)}</select></label> : null}
            <form className="flex min-w-[min(100%,18rem)] flex-1 items-end gap-2" onSubmit={(event) => { event.preventDefault(); const nextSearch = searchDraft.trim(); writeComparisonsSearch(nextSearch); setSearch(nextSearch); }}>
              <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold">{t(language, "reviewRequests.search")}<input aria-label={t(language, "reviewRequests.search")} value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal" placeholder={t(language, "reviewRequests.searchPlaceholder")} /></label>
              <Button type="submit" variant="secondary"><Search size={15} />{t(language, "reviewRequests.search")}</Button>
            </form>
          </div>
        </div>
      ) : null}
      {allResultsEmpty ? <p className="rounded-xl border border-border p-5 text-sm text-muted-foreground">{t(language, "reviewRequests.noResults")}</p> : <div className="space-y-6">{comparisonResult}{irResult}</div>}
      {patientSearchOpen ? <Dialog open onClose={() => setPatientSearchOpen(false)}><DialogContent><DialogHeader><DialogTitle>{t(language, "reviewRequests.searchPatient")}</DialogTitle><DialogDescription>{t(language, "reviewRequests.searchPatientDescription")}</DialogDescription></DialogHeader><div className="grid gap-3"><input autoFocus aria-label={t(language, "reviewRequests.searchPatient")} value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)} placeholder={t(language, "reviewRequests.searchPatientPlaceholder")} className="h-10 rounded-md border border-border px-3" />{patientQuery.trim().length >= 2 ? patientsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t(language, "reviewRequests.searchingPatients")}</p> : <div className="grid gap-2">{(patientsQuery.data ?? []).map((patient) => <button key={patient.id} type="button" className="rounded-md border border-border p-3 text-start text-sm hover:bg-muted" onClick={() => setSelectedPatient(patient)}><strong>{patient.englishFullName || patient.arabicFullName || patient.mrn}</strong>{patient.mrn ? <span className="ms-2 text-muted-foreground">{patient.mrn}</span> : null}</button>)}</div> : <p className="text-sm text-muted-foreground">{t(language, "reviewRequests.searchPatientMinimum")}</p>}</div>{selectedPatient ? <div className="rounded-md border border-accent/50 bg-accent/5 p-3"><p className="font-medium">{selectedPatient.englishFullName || selectedPatient.arabicFullName || selectedPatient.mrn}</p>{selectedPatient.mrn ? <p className="mt-1 text-sm text-muted-foreground">{selectedPatient.mrn}</p> : null}<div className="mt-3 flex flex-wrap gap-2"><Button type="button" onClick={() => { setPatientSearchOpen(false); setCreateIrOpen(false); setCreateComparisonOpen(true); }}>{t(language, "reviewRequests.createComparison")}</Button><Button type="button" variant="secondary" onClick={() => { setPatientSearchOpen(false); setCreateComparisonOpen(false); setCreateIrOpen(true); }}>{t(language, "reviewRequests.createIrConsultation")}</Button></div></div> : null}</DialogContent></Dialog> : null}
      {createComparisonOpen && selectedPatient ? <RequestComparisonModal patientId={selectedPatient.id} onClose={() => setCreateComparisonOpen(false)} /> : null}
      {createIrOpen && selectedPatient ? <RequestIrReferralModal patient={selectedPatient} onClose={() => setCreateIrOpen(false)} onCreated={(referralId) => { setCreateIrOpen(false); setCreateComparisonOpen(false); setPatientSearchOpen(false); navigate(`/comparisons/ir/${referralId}`); }} /> : null}
    </main>
  );
}
