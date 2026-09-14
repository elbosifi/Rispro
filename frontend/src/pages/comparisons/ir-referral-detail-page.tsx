import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Input, Textarea } from "@/components/shared";
import { fetchDoctorMe } from "@/lib/api/doctor-portal-reporting";
import { confirmIrReferralMaterials, createIrReferralScheduleRequest, deleteIrReferralDocument, fetchIrReferral, listIrReferralDocuments, recordIrReferralDecision, uploadIrReferralDocument } from "@/lib/api/ir-referrals";
import { buildRadiantPacsTagUrl } from "@/pages/doctor/doctor-reporting-board-page.helpers";
import { getDoctorDisplayName } from "@/lib/user-display-name";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { useV2ExamTypes, useV2Lookups } from "@/v2/appointments/api";

const PREPARE_ROLES = new Set<string>(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
const MANAGER_ROLES = new Set<string>(["supervisor", "super_admin"]);
const DECISION_LABELS: Record<string, string> = {
  eligible_for_intervention: "Eligible for intervention",
  needs_information: "Needs additional information",
  not_suitable: "Not suitable for intervention",
};

function humanizeDecision(decision: string | null): string {
  return decision ? DECISION_LABELS[decision] ?? "Recorded decision" : "No decision recorded";
}

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
      pushToast({ type: "success", title: "Document attached", message: "The document is linked to this IR consultation." });
    },
    onError: (error) => pushToast({ type: "error", title: "Attachment failed", message: error instanceof Error ? error.message : "Unable to attach document." }),
  });
  const remove = useMutation({
    mutationFn: (documentId: number) => deleteIrReferralDocument(referralId, documentId),
    onSuccess: refresh,
    onError: (error) => pushToast({ type: "error", title: "Removal failed", message: error instanceof Error ? error.message : "Unable to remove document." }),
  });
  const confirm = useMutation({
    mutationFn: () => confirmIrReferralMaterials(referralId, { documentsConfirmed, imagesConfirmed, note: note.trim() || null }),
    onSuccess: () => {
      refresh();
      pushToast({ type: "success", title: "Sent for IR review", message: "The assigned doctor can now review this consultation." });
    },
    onError: (error) => pushToast({ type: "error", title: "Confirmation failed", message: error instanceof Error ? error.message : "Unable to send for review." }),
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
      pushToast({ type: "success", title: "IR decision recorded", message: "The consultation decision has been saved." });
    },
    onError: (error) => pushToast({ type: "error", title: "Decision failed", message: error instanceof Error ? error.message : "Unable to record decision." }),
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
      pushToast({ type: "success", title: "Appointment requested", message: "Reception can now book this through Appointment V2." });
    },
    onError: (error) => pushToast({ type: "error", title: "Request failed", message: error instanceof Error ? error.message : "Unable to request an appointment." }),
  });

  if (referral.isLoading) return <main className="p-6 text-sm text-muted-foreground">Loading IR consultation...</main>;
  if (!referral.data) return <main className="p-6 text-sm text-red-600">IR consultation not found.</main>;

  const row = referral.data;
  const patientName = row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
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
  }, language) || "Unknown reviewer";

  const startReviewEditing = () => {
    setAssessmentText(row.assessmentText ?? "");
    setDecision(row.decision ?? "eligible_for_intervention");
    setDecisionNote(row.decisionNote ?? "");
    setReviewEditing(true);
  };

  return <main className="space-y-4 p-4 lg:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link to="/comparisons" className="text-sm font-semibold text-accent">Review Requests</Link><h1 className="mt-1 text-2xl font-semibold">IR Consultation</h1><p className="text-sm text-muted-foreground">Status: {row.status.replaceAll("_", " ")}</p></div>
      <div className="flex gap-2">
        {row.patientDicomId ? <a href={buildRadiantPacsTagUrl("00100020", row.patientDicomId)} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm font-semibold">Open patient studies <ExternalLink size={15} /></a> : <span className="inline-flex items-center rounded border px-3 py-2 text-sm text-muted-foreground">Patient PACS identifier unavailable</span>}
        {canPrepareMaterials ? <Link to={`/pacs/remap?irReferralId=${row.id}&returnPath=${encodeURIComponent(`/comparisons/ir/${row.id}`)}`} className="inline-flex items-center rounded border px-3 py-2 text-sm font-semibold">PACS Remap</Link> : null}
      </div>
    </div>

    <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
      <div><p className="text-xs text-muted-foreground">Patient</p><p className="font-semibold">{patientName}</p><p className="text-sm text-muted-foreground">{row.patientMrn || "MRN unavailable"}</p></div>
      <div><p className="text-xs text-muted-foreground">Requested procedure</p><p className="font-semibold">{row.requestedProcedure}</p><p className="text-sm text-muted-foreground">{row.clinicalIndication || "No clinical indication recorded"}</p></div>
      <div><p className="text-xs text-muted-foreground">Assigned IR doctor</p><p>{getDoctorDisplayName({ displayName: row.assignedDoctorName, fullName: row.assignedDoctorNameAr, englishName: row.assignedDoctorNameEn }, language) || "Unassigned"}</p></div>
      <div><p className="text-xs text-muted-foreground">Created</p><p>{new Date(row.createdAt).toLocaleString()}</p></div>
    </section>

    {recordedReview ? <section className="rounded-lg border p-4" aria-labelledby="ir-assessment-heading">
      <h2 id="ir-assessment-heading" className="font-semibold">IR Assessment</h2>
      <dl className="mt-3 grid gap-2 text-sm">
        <div><dt className="font-semibold">Assessment</dt><dd className="whitespace-pre-wrap">{row.assessmentText || "No assessment text recorded"}</dd></div>
        <div><dt className="font-semibold">Decision</dt><dd>{humanizeDecision(row.decision)}</dd></div>
        {row.decisionNote ? <div><dt className="font-semibold">Decision note</dt><dd className="whitespace-pre-wrap">{row.decisionNote}</dd></div> : null}
        <div><dt className="font-semibold">Reviewed by</dt><dd>{reviewerName}</dd></div>
        <div><dt className="font-semibold">Reviewed</dt><dd>{new Date(row.reviewedAt!).toLocaleString()}</dd></div>
      </dl>
    </section> : null}

    {row.status === "needs_information" ? <section className="rounded-lg border border-amber-300 bg-amber-50 p-4"><h2 className="font-semibold text-amber-950">Additional information requested</h2><p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{row.decisionNote}</p>{row.assessmentText ? <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">Assessment: {row.assessmentText}</p> : null}</section> : null}

    <section className="rounded-lg border p-4">
      <h2 className="font-semibold">Documents</h2>
      <p className="text-sm text-muted-foreground">Referral paper, external reports, and supporting documents use canonical RISpro storage.</p>
      {canPrepareMaterials ? <div className="mt-3 flex flex-wrap gap-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm"><Upload size={15} />{file ? file.name : "Choose document"}<input ref={fileInput} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{file ? <Button type="button" disabled={upload.isPending} onClick={() => upload.mutate()}>Attach document</Button> : null}</div> : null}
      <ul className="mt-3 grid gap-2">
        {(documents.data ?? []).map((document) => <li key={document.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm"><a className="min-w-0 flex-1 underline" href={`/api/documents/${document.id}/view`} target="_blank" rel="noreferrer">{document.originalFilename || document.original_filename || `Document ${document.id}`}</a>{canDeleteDocuments ? <button type="button" aria-label={`Remove document ${document.id}`} disabled={remove.isPending} className="rounded p-1.5 text-red-600 hover:bg-red-50" onClick={() => { if (window.confirm("Remove this document from canonical storage?")) remove.mutate(document.id); }}><Trash2 size={15} /></button> : null}</li>)}
        {documents.data?.length === 0 ? <li className="text-sm text-muted-foreground">No documents attached.</li> : null}
      </ul>
    </section>

    {canPrepareMaterials ? <section className="rounded-lg border p-4"><h2 className="font-semibold">Final preparation confirmation</h2><div className="mt-3 grid gap-2 text-sm"><label className="flex gap-2"><input type="checkbox" checked={documentsConfirmed} onChange={(event) => setDocumentsConfirmed(event.target.checked)} />I confirm the required referral/supporting documents are attached and correct.</label><label className="flex gap-2"><input type="checkbox" checked={imagesConfirmed} onChange={(event) => setImagesConfirmed(event.target.checked)} />I confirm the relevant patient imaging is available in PACS.</label><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional preparation note" /></div><div className="mt-3"><Button type="button" disabled={!documentsConfirmed || !imagesConfirmed || confirm.isPending} onClick={() => confirm.mutate()}>Confirm &amp; Send for IR Review</Button></div></section> : null}

    {ready && canReviewClinically && recordedReview && !reviewEditing ? <div className="flex"><Button type="button" onClick={startReviewEditing}>{row.decision === "needs_information" ? "Review new information" : "Edit assessment"}</Button></div> : null}

    {showReviewForm ? <section className="rounded-lg border p-4"><h2 className="font-semibold">Clinical IR decision</h2><Textarea aria-label="Assessment" className="mt-3" value={assessmentText} onChange={(event) => setAssessmentText(event.target.value)} placeholder="Assessment" /><label className="mt-3 block text-sm font-semibold">Decision<select aria-label="Decision" className="mt-1 w-full rounded border p-2" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="eligible_for_intervention">Eligible for intervention</option><option value="needs_information">Needs additional information</option><option value="not_suitable">Not suitable for intervention</option></select></label><Textarea aria-label="Decision note" className="mt-3" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Decision note (required when requesting information or marking not suitable)" /><div className="mt-3"><Button type="button" disabled={submitDecision.isPending || ((decision === "needs_information" || decision === "not_suitable") && !decisionNote.trim())} onClick={() => submitDecision.mutate()}>Record decision</Button></div></section> : null}

    {eligible ? <section className="rounded-lg border p-4"><h2 className="font-semibold">Request Appointment</h2><p className="text-sm text-muted-foreground">This creates a reception request only; capacity is evaluated by the normal Appointment V2 booking flow.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><select aria-label="Modality" className="rounded border p-2" value={modalityId} onChange={(event) => { setModalityId(event.target.value); setExamTypeId(""); }}><option value="">Select modality</option>{(lookups.data?.modalities ?? []).map((modality) => <option key={modality.id} value={modality.id}>{modality.nameEn || modality.nameAr}</option>)}</select><select aria-label="Examination" className="rounded border p-2" value={examTypeId} disabled={!modalityId} onChange={(event) => setExamTypeId(event.target.value)}><option value="">Select examination</option>{(examTypes.data ?? []).map((exam) => <option key={exam.id} value={exam.id}>{exam.nameEn || exam.nameAr}</option>)}</select><Input type="date" aria-label="Preferred date" value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} /><select aria-label="Urgency" className="rounded border p-2" value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}><option value="same_day">Same day</option><option value="within_24_hours">Within 24 hours</option><option value="within_72_hours">Within 72 hours</option><option value="routine">Routine</option></select></div><Textarea aria-label="Reception instruction" className="mt-3" value={receptionInstruction} onChange={(event) => setReceptionInstruction(event.target.value)} placeholder="Reception instructions (optional)" /><Textarea aria-label="Technologist instruction" className="mt-3" value={technologistInstruction} onChange={(event) => setTechnologistInstruction(event.target.value)} placeholder="Technologist instructions" /><div className="mt-3"><Button type="button" disabled={!modalityId || !examTypeId || !technologistInstruction.trim() || requestAppointment.isPending} onClick={() => requestAppointment.mutate()}>Request appointment</Button></div></section> : null}
  </main>;
}
