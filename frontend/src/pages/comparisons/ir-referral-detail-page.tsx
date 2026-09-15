import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, Button, Input, Textarea } from "@/components/shared";
import { fetchDoctorMe } from "@/lib/api/doctor-portal-reporting";
import { confirmIrReferralMaterials, createIrReferralScheduleRequest, deleteIrReferralDocument, fetchIrReferral, listIrReferralDocuments, recordIrReferralDecision, uploadIrReferralDocument } from "@/lib/api/ir-referrals";
import { irDecisionLabel, irReferralStatusLabel, irReferralStatusVariant } from "@/lib/ir-referral-display";
import { formatDateTimeLy } from "@/lib/date-format";
import { buildRadiantPacsTagUrl } from "@/pages/doctor/doctor-reporting-board-page.helpers";
import { getDoctorDisplayName } from "@/lib/user-display-name";
import { pushToast } from "@/lib/toast";
import { t } from "@/lib/i18n";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { useV2ExamTypes, useV2Lookups } from "@/v2/appointments/api";

const PREPARE_ROLES = new Set<string>(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
const MANAGER_ROLES = new Set<string>(["supervisor", "super_admin"]);
async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export default function IrReferralDetailPage() {
  const { id } = useParams();
  const referralId = Number(id);
  const { language } = useLanguage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentsConfirmed, setDocumentsConfirmed] = useState(false);
  const [imagesConfirmed, setImagesConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [reviewEditing, setReviewEditing] = useState(false);
  const [assessmentText, setAssessmentText] = useState("");
  const [decision, setDecision] = useState("eligible_for_intervention");
  const [decisionNote, setDecisionNote] = useState("");
  const [modalityId, setModalityId] = useState("");
  const [examTypeId, setExamTypeId] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [urgency, setUrgency] = useState<"same_day" | "within_24_hours" | "within_72_hours" | "routine">("routine");
  const [receptionInstruction, setReceptionInstruction] = useState("");
  const [technologistInstruction, setTechnologistInstruction] = useState("");

  const referral = useQuery({
    queryKey: ["ir-referral", referralId],
    queryFn: () => fetchIrReferral(referralId),
    enabled: Number.isInteger(referralId) && referralId > 0,
  });
  const doctorMe = useQuery({
    queryKey: ["doctor-me", "ir-referral", user?.id],
    queryFn: fetchDoctorMe,
    enabled: Boolean(user && ["doctor", "supervisor", "super_admin"].includes(user.role)),
    retry: false,
  });
  const documents = useQuery({
    queryKey: ["ir-referral-documents", referralId],
    queryFn: () => listIrReferralDocuments(referralId),
    enabled: Boolean(referral.data),
  });
  const lookups = useV2Lookups();
  const examTypes = useV2ExamTypes(modalityId ? Number(modalityId) : null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["ir-referral", referralId] });
    void queryClient.invalidateQueries({ queryKey: ["ir-referral-documents", referralId] });
    void queryClient.invalidateQueries({ queryKey: ["my-ir-referrals"] });
  };

  const upload = useMutation({
    mutationFn: async () => uploadIrReferralDocument(referralId, {
      originalFilename: file!.name,
      mimeType: file!.type || "application/octet-stream",
      fileContentBase64: await toBase64(file!),
    }),
    onSuccess: () => {
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      refresh();
      pushToast({ type: "success", title: t(language, "irReferral.documentAttachedTitle"), message: t(language, "irReferral.documentAttachedMessage") });
    },
    onError: (error) => pushToast({ type: "error", title: t(language, "irReferral.documentAttachFailedTitle"), message: error instanceof Error ? error.message : t(language, "irReferral.documentAttachFailedMessage") }),
  });
  const remove = useMutation({
    mutationFn: (documentId: number) => deleteIrReferralDocument(referralId, documentId),
    onSuccess: refresh,
    onError: (error) => pushToast({ type: "error", title: t(language, "irReferral.documentRemoveFailedTitle"), message: error instanceof Error ? error.message : t(language, "irReferral.documentRemoveFailedMessage") }),
  });
  const confirm = useMutation({
    mutationFn: () => confirmIrReferralMaterials(referralId, { documentsConfirmed, imagesConfirmed, note: note.trim() || null }),
    onSuccess: () => {
      refresh();
      pushToast({ type: "success", title: t(language, "irReferral.reviewSentTitle"), message: t(language, "irReferral.reviewSentMessage") });
    },
    onError: (error) => pushToast({ type: "error", title: t(language, "irReferral.confirmationFailedTitle"), message: error instanceof Error ? error.message : t(language, "irReferral.confirmationFailedMessage") }),
  });
  const submitDecision = useMutation({
    mutationFn: () => recordIrReferralDecision(referralId, {
      assessmentText: assessmentText.trim() || null,
      decision,
      decisionNote: decisionNote.trim() || null,
    }),
    onSuccess: () => {
      setReviewEditing(false);
      refresh();
      pushToast({ type: "success", title: t(language, "irReferral.decisionRecordedTitle"), message: t(language, "irReferral.decisionRecordedMessage") });
    },
    onError: (error) => pushToast({ type: "error", title: t(language, "irReferral.decisionFailedTitle"), message: error instanceof Error ? error.message : t(language, "irReferral.decisionFailedMessage") }),
  });
  const requestAppointment = useMutation({
    mutationFn: () => createIrReferralScheduleRequest(referralId, {
      modalityId: Number(modalityId),
      examTypeId: Number(examTypeId),
      preferredDate: preferredDate || null,
      urgency,
      receptionInstruction: receptionInstruction.trim() || null,
      technologistInstruction: technologistInstruction.trim(),
    }),
    onSuccess: () => {
      refresh();
      pushToast({ type: "success", title: t(language, "irReferral.appointmentRequestedTitle"), message: t(language, "irReferral.appointmentRequestedMessage") });
    },
    onError: (error) => pushToast({ type: "error", title: t(language, "irReferral.appointmentRequestFailedTitle"), message: error instanceof Error ? error.message : t(language, "irReferral.appointmentRequestFailedMessage") }),
  });

  if (referral.isLoading) return <main className="p-6 text-sm text-muted-foreground">{t(language, "irReferral.loading")}</main>;
  if (!referral.data) return <main className="p-6 text-sm text-red-600">{t(language, "irReferral.notFound")}</main>;

  const row = referral.data;
  const patientName = row.patientEnglishName || row.patientArabicName || row.patientMrn || t(language, "reviewRequests.patientFallback", { id: row.patientId });
  const manager = MANAGER_ROLES.has(user?.role ?? "");
  const canPrepareByRole = PREPARE_ROLES.has(user?.role ?? "");
  const materialStatusOpen = row.status === "preparing" || row.status === "needs_information";
  const canPrepareMaterials = canPrepareByRole && materialStatusOpen;
  const canDeleteDocuments = manager && materialStatusOpen;
  const activeDoctorProfileId = doctorMe.data?.hasActiveDoctorProfile ? doctorMe.data.profile?.id ?? null : null;
  const canReviewClinically = activeDoctorProfileId != null && (activeDoctorProfileId === row.assignedDoctorId || manager);
  const ready = row.status === "ready_for_review";
  const recordedReview = Boolean(row.reviewedAt && row.decision);
  const showReviewForm = ready && canReviewClinically && (!recordedReview || reviewEditing);
  const eligible = ready && row.decision === "eligible_for_intervention" && canReviewClinically;
  const reviewerName = getDoctorDisplayName({
    displayName: row.reviewedByDoctorName,
    fullName: row.reviewedByDoctorNameAr,
    englishName: row.reviewedByDoctorNameEn,
  }, language) || t(language, "irReferral.unknownReviewer");

  const startReviewEditing = () => {
    setAssessmentText(row.assessmentText ?? "");
    setDecision(row.decision ?? "eligible_for_intervention");
    setDecisionNote(row.decisionNote ?? "");
    setReviewEditing(true);
  };

  return <main className="mx-auto max-w-[1200px] space-y-5 p-4 lg:p-6" dir={language === "ar" ? "rtl" : "ltr"}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link to="/comparisons" className="text-sm font-semibold text-accent">{t(language, "irReferral.backToReviewRequests")}</Link><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{t(language, "irReferral.detailTitle")}</h1><Badge variant={irReferralStatusVariant(row.status)}>{irReferralStatusLabel(language, row.status)}</Badge></div></div>
      <div className="flex flex-wrap gap-2">
        {row.patientDicomId ? <a href={buildRadiantPacsTagUrl("00100020", row.patientDicomId)} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t(language, "irReferral.openPatientStudies")} <ExternalLink size={15} /></a> : <span className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm text-muted-foreground">{t(language, "irReferral.pacsIdentifierUnavailable")}</span>}
        {canPrepareMaterials ? <Link to={`/pacs/remap?irReferralId=${row.id}&returnPath=${encodeURIComponent(`/comparisons/ir/${row.id}`)}`} className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t(language, "irReferral.pacsRemap")}</Link> : null}
      </div>
    </div>

    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="ir-summary-heading">
      <h2 id="ir-summary-heading" className="sr-only">{t(language, "irReferral.detailTitle")}</h2>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.patient")}</dt><dd className="mt-1 font-semibold">{patientName}</dd><dd className="text-sm text-muted-foreground">{row.patientMrn || t(language, "reviewRequests.mrnUnavailable")}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.requestedProcedureField")}</dt><dd className="mt-1 font-semibold">{row.requestedProcedure}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.assignedDoctor")}</dt><dd className="mt-1">{getDoctorDisplayName({ displayName: row.assignedDoctorName, fullName: row.assignedDoctorNameAr, englishName: row.assignedDoctorNameEn }, language) || t(language, "irReferral.unassigned")}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.clinicalIndicationField")}</dt><dd className="mt-1 leading-6">{row.clinicalIndication || t(language, "irReferral.noClinicalIndication")}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.created")}</dt><dd className="mt-1">{formatDateTimeLy(row.createdAt)}</dd></div>
      </dl>
    </section>

    {row.status === "needs_information" ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold text-amber-950">{t(language, "irReferral.additionalInformationRequested")}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-900">{row.decisionNote}</p>{row.assessmentText ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-900"><span className="font-semibold">{t(language, "irReferral.assessment")}:</span> {row.assessmentText}</p> : null}</section> : null}

    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-lg font-semibold">{t(language, "irReferral.documents")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t(language, "irReferral.documentHelp")}</p>
      <dl className="mt-4 grid gap-3 border-y border-border/70 py-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "reviewRequests.documentsLabel")}</dt><dd className="mt-1 font-medium">{t(language, "reviewRequests.documents", { count: documents.data?.length ?? 0 })}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "reviewRequests.imagingLabel")}</dt><dd className="mt-1 font-medium">{t(language, "reviewRequests.imaging", { status: row.imagesConfirmed ? t(language, "reviewRequests.confirmed") : t(language, "reviewRequests.pending") })}</dd></div>
      </dl>
      {canPrepareMaterials ? <div className="mt-4 flex flex-wrap gap-2"><label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm"><Upload size={15} />{file ? file.name : t(language, "irReferral.chooseDocument")}<input ref={fileInput} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{file ? <Button type="button" disabled={upload.isPending} onClick={() => upload.mutate()}>{t(language, "irReferral.attachDocument")}</Button> : null}</div> : null}
      <ul className="mt-3 grid gap-2">
        {(documents.data ?? []).map((document) => <li key={document.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"><a className="min-w-0 flex-1 underline" href={`/api/documents/${document.id}/view`} target="_blank" rel="noreferrer">{document.originalFilename || document.original_filename || t(language, "irReferral.documentFallback", { id: document.id })}</a>{canDeleteDocuments ? <button type="button" aria-label={t(language, "irReferral.removeDocument", { id: document.id })} disabled={remove.isPending} className="rounded p-1.5 text-red-600 hover:bg-red-50" onClick={() => { if (window.confirm(t(language, "irReferral.removeDocumentConfirm"))) remove.mutate(document.id); }}><Trash2 size={15} /></button> : null}</li>)}
        {documents.data?.length === 0 ? <li className="text-sm text-muted-foreground">{t(language, "irReferral.noDocuments")}</li> : null}
      </ul>
    </section>

    {canPrepareMaterials ? <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h2 className="text-lg font-semibold">{t(language, "irReferral.finalPreparationConfirmation")}</h2><div className="mt-4 grid gap-3 text-sm"><label className="flex items-start gap-2"><input type="checkbox" checked={documentsConfirmed} onChange={(event) => setDocumentsConfirmed(event.target.checked)} /><span>{t(language, "irReferral.confirmDocuments")}</span></label><label className="flex items-start gap-2"><input type="checkbox" checked={imagesConfirmed} onChange={(event) => setImagesConfirmed(event.target.checked)} /><span>{t(language, "irReferral.confirmImages")}</span></label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t(language, "irReferral.optionalPreparationNote")} /></div><div className="mt-4"><Button type="button" disabled={!documentsConfirmed || !imagesConfirmed || confirm.isPending} onClick={() => confirm.mutate()}>{t(language, "irReferral.confirmAndSendForReview")}</Button></div></section> : null}

    {recordedReview ? <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="ir-assessment-heading">
      <h2 id="ir-assessment-heading" className="text-lg font-semibold">{t(language, "irReferral.assessmentTitle")}</h2>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.assessment")}</dt><dd className="mt-1 whitespace-pre-wrap leading-6">{row.assessmentText || t(language, "irReferral.noAssessment")}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.decision")}</dt><dd className="mt-1"><Badge variant={row.decision === "eligible_for_intervention" ? "success" : row.decision === "needs_information" ? "warning" : "error"}>{irDecisionLabel(language, row.decision)}</Badge></dd></div>
        {row.decisionNote ? <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.decisionNote")}</dt><dd className="mt-1 whitespace-pre-wrap leading-6">{row.decisionNote}</dd></div> : null}
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.reviewedBy")}</dt><dd className="mt-1">{reviewerName}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(language, "irReferral.reviewed")}</dt><dd className="mt-1">{formatDateTimeLy(row.reviewedAt!)}</dd></div>
      </dl>
    </section> : null}

    {ready && canReviewClinically && recordedReview && !reviewEditing ? <div className="flex"><Button type="button" onClick={startReviewEditing}>{row.decision === "needs_information" ? t(language, "irReferral.reviewNewInformation") : t(language, "irReferral.editAssessment")}</Button></div> : null}

    {showReviewForm ? <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h2 className="text-lg font-semibold">{t(language, "irReferral.clinicalDecision")}</h2><Textarea aria-label={t(language, "irReferral.assessment")} className="mt-4" value={assessmentText} onChange={(event) => setAssessmentText(event.target.value)} placeholder={t(language, "irReferral.assessment")} /><label className="mt-4 block text-sm font-semibold">{t(language, "irReferral.decision")}<select aria-label={t(language, "irReferral.decision")} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="eligible_for_intervention">{irDecisionLabel(language, "eligible_for_intervention")}</option><option value="needs_information">{irDecisionLabel(language, "needs_information")}</option><option value="not_suitable">{irDecisionLabel(language, "not_suitable")}</option></select></label><Textarea aria-label={t(language, "irReferral.decisionNote")} className="mt-4" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder={t(language, "irReferral.decisionNotePlaceholder")} /><div className="mt-4"><Button type="button" disabled={submitDecision.isPending || ((decision === "needs_information" || decision === "not_suitable") && !decisionNote.trim())} onClick={() => submitDecision.mutate()}>{t(language, "irReferral.recordDecision")}</Button></div></section> : null}

    {eligible ? <section className="rounded-xl border border-border bg-card p-4 shadow-sm"><h2 className="text-lg font-semibold">{t(language, "irReferral.requestAppointment")}</h2><p className="mt-1 text-sm text-muted-foreground">{t(language, "irReferral.requestAppointmentHelp")}</p><div className="mt-4"><h3 className="text-sm font-semibold">{t(language, "irReferral.requestedExamination")}</h3><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><span className="text-xs font-semibold text-muted-foreground">{t(language, "irReferral.modality")}</span><select aria-label={t(language, "irReferral.modality")} className="h-10 rounded-md border border-border bg-background px-3" value={modalityId} onChange={(event) => { setModalityId(event.target.value); setExamTypeId(""); }}><option value="">{t(language, "irReferral.selectModality")}</option>{(lookups.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn || modality.nameAr}</option>)}</select></label><label className="grid gap-1 text-sm"><span className="text-xs font-semibold text-muted-foreground">{t(language, "irReferral.examination")}</span><select aria-label={t(language, "irReferral.examination")} className="h-10 rounded-md border border-border bg-background px-3" value={examTypeId} disabled={!modalityId} onChange={(event) => setExamTypeId(event.target.value)}><option value="">{t(language, "irReferral.selectExamination")}</option>{(examTypes.data ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.nameEn || exam.nameAr}</option>)}</select></label></div></div><div className="mt-4"><h3 className="text-sm font-semibold">{t(language, "irReferral.timing")}</h3><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><span className="text-xs font-semibold text-muted-foreground">{t(language, "irReferral.preferredDate")}</span><Input type="date" aria-label={t(language, "irReferral.preferredDate")} value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} /></label><label className="grid gap-1 text-sm"><span className="text-xs font-semibold text-muted-foreground">{t(language, "irReferral.urgency")}</span><select aria-label={t(language, "irReferral.urgency")} className="h-10 rounded-md border border-border bg-background px-3" value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}><option value="same_day">{t(language, "irReferral.sameDay")}</option><option value="within_24_hours">{t(language, "irReferral.within24Hours")}</option><option value="within_72_hours">{t(language, "irReferral.within72Hours")}</option><option value="routine">{t(language, "irReferral.routine")}</option></select></label></div></div><div className="mt-4"><h3 className="text-sm font-semibold">{t(language, "irReferral.instructions")}</h3><div className="mt-2 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm"><span className="text-xs font-semibold text-muted-foreground">{t(language, "irReferral.receptionInstruction")} <span className="font-normal">({t(language, "irReferral.optional")})</span></span><Textarea aria-label={t(language, "irReferral.receptionInstruction")} value={receptionInstruction} onChange={(event) => setReceptionInstruction(event.target.value)} /></label><label className="grid gap-1 text-sm"><span className="text-xs font-semibold text-muted-foreground">{t(language, "irReferral.technologistInstruction")}</span><Textarea aria-label={t(language, "irReferral.technologistInstruction")} value={technologistInstruction} onChange={(event) => setTechnologistInstruction(event.target.value)} /></label></div></div><div className="mt-4"><Button type="button" disabled={!modalityId || !examTypeId || !technologistInstruction.trim() || requestAppointment.isPending} onClick={() => requestAppointment.mutate()}>{t(language, "irReferral.requestAppointment")}</Button></div></section> : null}
  </main>;
}
