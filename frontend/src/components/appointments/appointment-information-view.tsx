import { useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Copy, Edit3, ExternalLink } from "lucide-react";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { formatDateLy, formatDateTimeLy } from "@/lib/date-format";
import { pushToast } from "@/lib/toast";
import type { ComplementaryRecall } from "@/lib/api/complementary-recalls";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, PatientDirectorySummary } from "@/types/api";
import { Badge, Button, DisclosureSection } from "@/components/shared";
import { PatientSummaryContent } from "@/components/patients/patient-summary-content";
import { usePatientDirectorySummary } from "@/components/patients/patient-summary-formatters";
import { AppointmentEditor } from "./appointment-editor";

export type AppointmentDetailsMode = "view" | "edit";

type ReportStatus = {
  canViewReport?: boolean;
  state?: string | null;
  message?: string | null;
  viewButtonLabel?: string | null;
};

interface AppointmentInformationViewProps {
  appointment: AppointmentWithDetails;
  lookups: AppointmentLookups | undefined;
  reportStatus?: ReportStatus | null;
  recallContext?: ComplementaryRecall | null;
  onBack: () => void;
  onOpenPatientProfile: () => void;
  onOpenReschedule?: () => void;
  onOpenStatus: () => void;
  onOpenReport?: () => void;
  onOpenAppointment?: (appointmentId: number) => void;
  onAppointmentUpdated: (appointment: AppointmentWithDetails) => void;
}

type DefinitionRow = {
  label: string;
  value: React.ReactNode;
  dir?: "ltr" | "rtl";
  emphasis?: boolean;
};

const dash = "—";
const text = (language: "ar" | "en", ar: string, en: string) => chooseLocalized(language, ar, en);
const present = (value: unknown): value is string | number => value !== null && value !== undefined && String(value).trim() !== "";
const valueOrDash = (value: unknown) => present(value) ? String(value) : dash;

function appointmentStatusVariant(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (["no-show", "cancelled", "voided"].includes(status)) return "error";
  if (["arrived", "waiting", "discontinued"].includes(status)) return "warning";
  return status === "scheduled" || status === "in-progress" ? "info" : "neutral";
}

function reportVariant(state: string | null | undefined): "success" | "warning" | "error" | "info" | "neutral" {
  if (state === "final") return "success";
  if (state === "draft" || state === "study_not_found") return "warning";
  if (state === "unavailable") return "error";
  return "neutral";
}

function reportLabel(language: "ar" | "en", state: string | null | undefined) {
  const labels: Record<string, [string, string]> = {
    final: ["نهائي", "Final"],
    draft: ["مسودة", "Draft"],
    no_report: ["لا يوجد تقرير", "No report"],
    study_not_found: ["الدراسة غير موجودة", "Study not found"],
    unavailable: ["غير متاح", "Unavailable"],
    not_required: ["غير مطلوب", "Not required"],
    not_completed: ["لم يكتمل", "Not completed"],
    disabled: ["معطل", "Disabled"],
  };
  const label = labels[String(state ?? "")];
  return label ? text(language, label[0], label[1]) : text(language, "غير مفحوص", "Not checked");
}

function protocolStateLabel(language: "ar" | "en", state: string | null | undefined) {
  const normalized = String(state ?? "").toLowerCase();
  if (["assigned", "active", "completed"].includes(normalized)) return text(language, "معين", "Assigned");
  if (["unassigned", "not_assigned", "pending"].includes(normalized)) return text(language, "غير معين", "Not assigned");
  return state || text(language, "غير محدد", "Not specified");
}

function elapsedSince(value: string | null | undefined) {
  if (!value) return dash;
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return dash;
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function recallStatusLabel(language: "ar" | "en", status: ComplementaryRecall["status"] | null) {
  const labels: Record<NonNullable<ComplementaryRecall["status"]>, [string, string]> = {
    pending_scheduling: ["بانتظار الحجز", "Awaiting booking"],
    scheduled: ["محجوز", "Scheduled"],
    completed: ["مكتمل", "Completed"],
    cancelled: ["ملغى", "Cancelled"],
  };
  return status ? text(language, labels[status][0], labels[status][1]) : dash;
}

function recallStatusVariant(status: ComplementaryRecall["status"] | null): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (status === "scheduled") return "info";
  if (status === "cancelled") return "error";
  return "warning";
}

function recallReasonLabel(language: "ar" | "en", reason: ComplementaryRecall["reasonCode"] | null) {
  const labels: Record<NonNullable<ComplementaryRecall["reasonCode"]>, [string, string]> = {
    missing_sequence_phase: ["تسلسل أو مرحلة مفقودة", "Missing sequence or phase"],
    incomplete_anatomical_coverage: ["تغطية تشريحية غير مكتملة", "Incomplete anatomical coverage"],
    motion_nondiagnostic_quality: ["حركة أو جودة غير تشخيصية", "Motion or nondiagnostic quality"],
    incorrect_protocol: ["بروتوكول غير صحيح", "Incorrect protocol"],
    incorrect_contrast_phase_timing: ["توقيت تباين غير صحيح", "Incorrect contrast phase/timing"],
    additional_diagnostic_characterization: ["توصيف تشخيصي إضافي", "Additional diagnostic characterization"],
    technical_equipment_problem: ["مشكلة تقنية", "Technical equipment problem"],
    patient_related_limitation: ["قيد متعلق بالمريض", "Patient-related limitation"],
    other: ["أخرى", "Other"],
  };
  return reason ? text(language, labels[reason][0], labels[reason][1]) : dash;
}

function CopyValueButton({ value, label }: { value: string | null | undefined; label: string }) {
  const { language } = useLanguage();
  const [copied, setCopied] = useState(false);
  const source = String(value ?? "").trim();
  if (!source) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      pushToast({ type: "success", title: text(language, "تم النسخ", "Copied"), message: label });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast({ type: "error", title: text(language, "فشل النسخ", "Copy failed"), message: label });
    }
  };

  return <button type="button" onClick={() => void copy()} className="ms-1 inline-flex min-h-7 min-w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={`${text(language, "نسخ", "Copy")} ${label}`}>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button>;
}

function CopyableValue({ value, label }: { value: string | number | null | undefined; label: string }) {
  return <span dir="ltr" className="inline-flex max-w-full items-center [unicode-bidi:isolate]"><span className="break-all">{valueOrDash(value)}</span><CopyValueButton value={present(value) ? String(value) : null} label={label} /></span>;
}

function DefinitionGrid({ rows }: { rows: DefinitionRow[] }) {
  return <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{rows.map((row) => <div key={row.label} className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt><dd dir={row.dir} className={`mt-1 min-w-0 break-words text-sm leading-5 text-foreground ${row.emphasis ? "font-semibold" : "font-medium"}`}>{row.value}</dd></div>)}</dl>;
}

function CompactCard({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return <section data-testid={testId} className="min-w-0 rounded-xl border border-border bg-card p-3.5 shadow-sm"><h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>{children}</section>;
}

function WorkflowTimeline({ appointment }: { appointment: AppointmentWithDetails }) {
  const { language } = useLanguage();
  const points = [
    { label: text(language, "تم الحجز", "Booked"), value: appointment.createdAt },
    { label: text(language, "وصل", "Arrived"), value: appointment.arrivedAt },
    { label: text(language, "انتظار", "Waiting"), value: appointment.waitingStartedAt },
    { label: text(language, "اكتمل", "Completed"), value: appointment.completedAt ?? appointment.autoCompletedAt },
  ].filter((point) => present(point.value));
  if (!points.length) return null;
  return <CompactCard title={text(language, "سير العمل", "Workflow")} testId="appointment-workflow-timeline"><ol className="flex flex-wrap gap-x-5 gap-y-3">{points.map((point) => <li key={point.label} className="min-w-28 border-s-2 border-accent/40 ps-3"><p className="text-xs font-semibold text-foreground">{point.label}</p><p dir="ltr" className="mt-0.5 text-xs text-muted-foreground">{formatDateTimeLy(String(point.value))}</p></li>)}</ol></CompactCard>;
}

function RecallCard({ appointment, recallContext, onOpenAppointment }: { appointment: AppointmentWithDetails; recallContext?: ComplementaryRecall | null; onOpenAppointment?: (id: number) => void }) {
  const { language } = useLanguage();
  const context = appointment.complementaryImagingContext;
  if (!context?.relationship) return null;
  const recall = recallContext && (!context.recallRequestId || recallContext.id === context.recallRequestId) ? recallContext : null;
  const original = context.relationship === "original_with_recall";
  const linkedId = original ? context.additionalAppointmentId : context.originalAppointmentId;
  const rows: DefinitionRow[] = original ? [
    { label: text(language, "الحالة", "Status"), value: <Badge variant={recallStatusVariant(recall?.status ?? context.recallStatus)} size="sm">{recallStatusLabel(language, recall?.status ?? context.recallStatus)}</Badge> },
    { label: text(language, "السبب", "Reason"), value: recallReasonLabel(language, recall?.reasonCode ?? context.reasonCode) },
    ...(present(recall?.receptionInstruction) ? [{ label: text(language, "تعليمات الاستقبال", "Reception instruction"), value: recall!.receptionInstruction! }] : []),
    ...(present(recall?.technologistInstruction) ? [{ label: text(language, "تعليمات الفني", "Technologist instruction"), value: recall!.technologistInstruction }] : []),
    ...(present(recall?.requesterDisplayName) ? [{ label: text(language, "طلب بواسطة", "Requested by"), value: recall!.requesterDisplayName! }] : []),
    ...(present(recall?.requestedAt) ? [{ label: text(language, "وقت الطلب", "Requested"), value: formatDateTimeLy(recall!.requestedAt), dir: "ltr" as const }] : []),
    ...(present(recall?.scheduledAt) ? [{ label: text(language, "وقت الجدولة", "Scheduled"), value: formatDateTimeLy(recall!.scheduledAt), dir: "ltr" as const }] : []),
    ...(present(recall?.completedAt) ? [{ label: text(language, "وقت الإكمال", "Completed"), value: formatDateTimeLy(recall!.completedAt), dir: "ltr" as const }] : []),
    ...(present(recall?.recallAppointmentAccession ?? context.additionalAccession) ? [{ label: text(language, "رقم الوصول الإضافي", "Additional accession"), value: <CopyableValue value={recall?.recallAppointmentAccession ?? context.additionalAccession} label={text(language, "رقم الوصول الإضافي", "additional accession")} />, dir: "ltr" as const }] : []),
  ] : [
    { label: text(language, "رقم الوصول الأصلي", "Original accession"), value: <CopyableValue value={recall?.originalAccession ?? context.originalAccession} label={text(language, "رقم الوصول الأصلي", "original accession")} />, dir: "ltr" },
    { label: text(language, "الفحص الأصلي", "Original examination"), value: chooseLocalized(language, recall?.originalExamAr ?? recall?.originalExam ?? appointment.originalExamAr ?? appointment.originalExam, recall?.originalExamEn ?? recall?.originalExam ?? appointment.originalExamEn ?? appointment.originalExam) || dash },
    { label: text(language, "السبب", "Reason"), value: recallReasonLabel(language, recall?.reasonCode ?? context.reasonCode) },
  ];
  return <CompactCard title={original ? text(language, "تصوير إضافي", "Additional imaging") : text(language, "الفحص الأصلي", "Original examination")} testId="appointment-additional-imaging-context"><DefinitionGrid rows={rows} />{typeof linkedId === "number" && linkedId > 0 ? <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => onOpenAppointment?.(linkedId)}>{original ? text(language, "فتح الموعد الإضافي", "Open additional appointment") : text(language, "فتح الموعد الأصلي", "Open original appointment")}</Button> : null}</CompactCard>;
}

function protocolRows(language: "ar" | "en", appointment: AppointmentWithDetails): DefinitionRow[] {
  const protocol = appointment.protocolAssignmentSummary;
  if (!protocol) return [];
  return [
    { label: text(language, "الحالة", "Protocol state"), value: protocolStateLabel(language, protocol.status ?? "assigned") },
    { label: text(language, "اسم البروتوكول", "Protocol name"), value: valueOrDash(protocol.protocolName) },
    { label: text(language, "الإصدار", "Version"), value: valueOrDash(protocol.versionNumber) },
    ...(present(protocol.freeTextProtocol) ? [{ label: text(language, "البروتوكول النصي", "Free-text protocol"), value: protocol.freeTextProtocol! }] : []),
    { label: text(language, "الجهاز", "Scanner"), value: valueOrDash(protocol.scannerName) },
    { label: text(language, "عين بواسطة", "Assigned by"), value: valueOrDash(protocol.assignedBy) },
    { label: text(language, "تاريخ التعيين", "Assigned date/time"), value: formatDateTimeLy(protocol.assignedAt), dir: "ltr" as const },
    { label: text(language, "ملاحظات البروتوكول", "Protocol notes"), value: valueOrDash(protocol.protocolNotes) },
    { label: text(language, "ملاحظات التباين", "Contrast notes"), value: valueOrDash(protocol.contrastNotes) },
  ];
}

function capacityRows(language: "ar" | "en", appointment: AppointmentWithDetails): DefinitionRow[] {
  return [
    ...(appointment.isOverbooked ? [{ label: text(language, "حجز زائد", "Overbooking"), value: text(language, "نعم", "Yes") }] : []),
    ...(present(appointment.overbookingReason) ? [{ label: text(language, "سبب الحجز الزائد", "Overbooking reason"), value: appointment.overbookingReason! }] : []),
    ...(present(appointment.approvedByName) ? [{ label: text(language, "اعتماد السعة", "Capacity approval"), value: appointment.approvedByName! }] : []),
    ...(present(appointment.specialReasonCode) ? [{ label: text(language, "الحصة الخاصة", "Special quota"), value: chooseLocalized(language, appointment.specialReasonLabelAr, appointment.specialReasonLabelEn) || appointment.specialReasonCode! }] : []),
    ...(present(appointment.specialReasonNote) ? [{ label: text(language, "ملاحظة الحصة", "Special quota note"), value: appointment.specialReasonNote! }] : []),
  ];
}

function auditRows(language: "ar" | "en", appointment: AppointmentWithDetails): DefinitionRow[] {
  const rows: DefinitionRow[] = [
    { label: text(language, "أنشئ بواسطة", "Created by"), value: valueOrDash(appointment.createdByName ?? appointment.createdByUsername ?? appointment.createdByUserId) },
    { label: text(language, "أنشئ في", "Created"), value: formatDateTimeLy(appointment.createdAt), dir: "ltr" },
    { label: text(language, "آخر تحديث", "Last updated"), value: formatDateTimeLy(appointment.updatedAt), dir: "ltr" },
    { label: text(language, "المعرف الداخلي", "Internal appointment ID"), value: appointment.id, dir: "ltr" },
    ...(present(appointment.noShowReason) ? [{ label: text(language, "سبب عدم الحضور", "No-show reason"), value: appointment.noShowReason! }] : []),
    ...(present(appointment.cancelReason) ? [{ label: text(language, "سبب الإلغاء", "Cancellation reason"), value: appointment.cancelReason! }] : []),
  ];
  if (appointment.status === "voided" || appointment.voidedAt || appointment.voidedByUserId || appointment.voidedByName || appointment.voidedByUsername || appointment.voidReason) {
    rows.push(
      { label: text(language, "ألغي بواسطة", "Voided by"), value: valueOrDash(appointment.voidedByName ?? appointment.voidedByUsername ?? appointment.voidedByUserId) },
      { label: text(language, "تاريخ ووقت الإلغاء", "Voided date/time"), value: formatDateTimeLy(appointment.voidedAt), dir: "ltr" },
      { label: text(language, "سبب الإلغاء النهائي", "Void reason"), value: valueOrDash(appointment.voidReason) },
    );
  }
  return rows;
}

function ClinicalCard({ appointment }: { appointment: AppointmentWithDetails }) {
  const { language } = useLanguage();
  const modalityInstructions = chooseLocalized(language, appointment.modalityGeneralInstructionAr, appointment.modalityGeneralInstructionEn);
  const examinationInstructions = chooseLocalized(language, appointment.examSpecificInstructionAr, appointment.examSpecificInstructionEn);
  if (![appointment.notes, modalityInstructions, examinationInstructions].some(present)) return null;
  return <CompactCard title={text(language, "معلومات وتعليمات سريرية", "Clinical information and instructions")}><div className="space-y-3 text-sm">{present(appointment.notes) ? <div><p className="text-xs font-medium text-muted-foreground">{text(language, "ملاحظات الموعد", "Appointment notes")}</p><p className="mt-1 whitespace-pre-wrap">{appointment.notes}</p></div> : null}{present(modalityInstructions) ? <div><p className="text-xs font-medium text-muted-foreground">{text(language, "تعليمات الوسيلة", "Modality instructions")}</p><p className="mt-1 whitespace-pre-wrap">{modalityInstructions}</p></div> : null}{present(examinationInstructions) ? <div><p className="text-xs font-medium text-muted-foreground">{text(language, "تعليمات الفحص", "Examination instructions")}</p><p className="mt-1 whitespace-pre-wrap">{examinationInstructions}</p></div> : null}</div></CompactCard>;
}

type DetailsContentProps = {
  appointment: AppointmentWithDetails;
  reportStatus?: ReportStatus | null;
  recallContext?: ComplementaryRecall | null;
  onOpenReport?: () => void;
  onOpenAppointment?: (appointmentId: number) => void;
  readOnly?: boolean;
};

function AppointmentDetailsContent({ appointment, reportStatus, recallContext, onOpenReport, onOpenAppointment, readOnly = false }: DetailsContentProps) {
  const { language } = useLanguage();
  const reportState = reportStatus?.state ?? appointment.reportStatus;
  const waitingSince = ["arrived", "waiting"].includes(appointment.status) ? appointment.waitingStartedAt ?? appointment.arrivedAt : null;
  const capacity = capacityRows(language, appointment);
  const protocol = protocolRows(language, appointment);

  return <div className="space-y-4">
    <div data-testid="appointment-details-primary-grid" className={`grid gap-3 md:grid-cols-2 ${appointment.requiresReport ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
      <CompactCard title={text(language, "الفحص", "Examination")} testId="appointment-examination-card"><DefinitionGrid rows={[
        { label: text(language, "الوسيلة", "Modality"), value: `${chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn) || dash} · ${appointment.modalityCode || dash}`, emphasis: true },
        { label: text(language, "نوع الفحص", "Examination type"), value: chooseLocalized(language, appointment.examNameAr, appointment.examNameEn) || dash, emphasis: true },
        { label: text(language, "رقم الوصول", "Accession number"), value: <CopyableValue value={appointment.accessionNumber} label={text(language, "رقم الوصول", "accession number")} />, dir: "ltr", emphasis: true },
        { label: text(language, "الأولوية", "Reporting priority"), value: chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn) || text(language, "غير محددة", "Not assigned") },
        { label: text(language, "التقرير", "Report requirement"), value: appointment.isAdditionalImaging ? text(language, "مع الفحص الأصلي", "With original examination") : appointment.requiresReport ? text(language, "مطلوب", "Required") : text(language, "غير مطلوب", "Not required") },
      ]} /></CompactCard>
      <CompactCard title={text(language, "الموعد", "Appointment")} testId="appointment-schedule-card"><DefinitionGrid rows={[
        { label: text(language, "التاريخ", "Date"), value: formatDateLy(appointment.appointmentDate), dir: "ltr", emphasis: true },
        { label: text(language, "وقت الحجز", "Booking time"), value: appointment.bookingTime || text(language, "غير محدد", "Not assigned"), dir: "ltr", emphasis: true },
        { label: text(language, "التسلسل / الخانة", "Sequence / slot"), value: valueOrDash(appointment.dailySequence || appointment.modalitySlotNumber) },
        { label: text(language, "نوع الحجز", "Booking type"), value: appointment.isWalkIn ? text(language, "حضور مباشر", "Walk-in") : text(language, "مجدول", "Scheduled") },
        { label: text(language, "الحالة", "Status"), value: <Badge size="sm" variant={appointmentStatusVariant(appointment.status)}>{statusLabel(language, appointment.status)}</Badge> },
        ...(waitingSince ? [{ label: text(language, "مدة الانتظار", "Waiting duration"), value: elapsedSince(waitingSince), dir: "ltr" as const }] : []),
      ]} /></CompactCard>
      {appointment.requiresReport ? <CompactCard title={text(language, "التقرير", "Reporting")} testId="appointment-reporting-card"><DefinitionGrid rows={[
        { label: text(language, "الطبيب المعين", "Assigned doctor"), value: appointment.assignedReportingDoctorName || text(language, "غير معين", "Unassigned"), emphasis: true },
        { label: text(language, "حالة التقرير", "Report status"), value: <Badge data-testid="report-status-badge" size="sm" variant={reportVariant(reportState)}>{reportLabel(language, reportState)}</Badge> },
        ...(appointment.reportStatusCheckedAt ? [{ label: text(language, "آخر فحص", "Status checked"), value: formatDateTimeLy(appointment.reportStatusCheckedAt), dir: "ltr" as const }] : []),
      ]} />{!readOnly && reportStatus?.canViewReport ? <Button type="button" size="sm" className="mt-3" onClick={onOpenReport}><ExternalLink size={14} className="me-1.5" aria-hidden="true" />{reportStatus.viewButtonLabel || text(language, "فتح التقرير", "Open report")}</Button> : null}</CompactCard> : null}
    </div>
    <RecallCard appointment={appointment} recallContext={recallContext} onOpenAppointment={onOpenAppointment} />
    <ClinicalCard appointment={appointment} />
    {protocol.length ? <CompactCard title={text(language, "البروتوكول", "Protocol")}><DefinitionGrid rows={protocol} /></CompactCard> : null}
    <WorkflowTimeline appointment={appointment} />
    {capacity.length ? <DisclosureSection title={text(language, "السعة واستثناءات الحجز", "Capacity and booking exceptions")}><DefinitionGrid rows={capacity} /></DisclosureSection> : null}
    <DisclosureSection title={text(language, "التفاصيل الإدارية والتدقيق", "Administrative and audit details")}><DefinitionGrid rows={auditRows(language, appointment)} /></DisclosureSection>
    <DisclosureSection title={text(language, "تفاصيل PACS التقنية", "Technical PACS details")}><DefinitionGrid rows={[
      { label: text(language, "الدراسة", "Study"), value: appointment.studyInstanceUid ? text(language, "مرتبطة", "Linked") : text(language, "غير مرتبطة", "Unlinked") },
      { label: "Study Instance UID", value: <CopyableValue value={appointment.studyInstanceUid} label="Study Instance UID" />, dir: "ltr" },
      ...(present(appointment.sonicDicomStudyNote) ? [{ label: text(language, "ملاحظة PACS", "PACS note"), value: appointment.sonicDicomStudyNote! }] : []),
      ...(appointment.requiresReport ? [{ label: text(language, "حالة التقرير", "Report availability"), value: reportLabel(language, reportState) }] : []),
    ]} /></DisclosureSection>
  </div>;
}

export function AppointmentDetailsReadOnly({ appointment, reportStatus, onOpenAppointment, readOnly = true }: { appointment: AppointmentWithDetails; reportStatus?: ReportStatus | null; onOpenAppointment?: (id: number) => void; readOnly?: boolean }) {
  return <AppointmentDetailsContent appointment={appointment} reportStatus={reportStatus} onOpenAppointment={onOpenAppointment} readOnly={readOnly} />;
}

function AppointmentDetailsSection({ appointment, lookups, reportStatus, recallContext, onOpenReschedule, onOpenStatus, onOpenReport, onOpenAppointment, onAppointmentUpdated }: Omit<AppointmentInformationViewProps, "onBack" | "onOpenPatientProfile">) {
  const { language, t } = useLanguage();
  const [mode, setMode] = useState<AppointmentDetailsMode>("view");
  if (mode === "edit") return <section className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="appointment-details-heading" className="text-base font-semibold">{t("registrations.appointmentDetails")}</h2></div><AppointmentEditor key={appointment.id} appointment={appointment} lookups={lookups} editing onCancel={() => setMode("view")} onUpdated={(updated) => { onAppointmentUpdated(updated); setMode("view"); }} /></section>;
  return <section aria-labelledby="appointment-details-heading" className="min-w-0 space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="appointment-details-heading" className="text-base font-semibold">{t("registrations.appointmentDetails")}</h2><Button type="button" size="sm" onClick={() => setMode("edit")}><Edit3 size={15} className="me-1.5" aria-hidden="true" />{t("common.edit")}</Button></div><AppointmentDetailsContent appointment={appointment} reportStatus={reportStatus} recallContext={recallContext} onOpenReport={onOpenReport} onOpenAppointment={onOpenAppointment} /><div className="flex flex-wrap gap-2 border-t border-border pt-4">{onOpenReschedule ? <Button type="button" variant="outline" size="sm" onClick={onOpenReschedule}><CalendarClock size={15} className="me-1.5" aria-hidden="true" />{t("registrations.reschedule")}</Button> : null}<Button type="button" variant="outline" size="sm" onClick={onOpenStatus}>{text(language, "تغيير الحالة", "Change status")}</Button></div></section>;
}

function PatientDetailsSection({ appointment }: { appointment: AppointmentWithDetails }) {
  const { t, language } = useLanguage();
  const patientQuery = usePatientDirectorySummary(appointment.patientId);
  return <section aria-labelledby="appointment-patient-details-heading" className="min-w-0 rounded-xl border border-border bg-card p-3.5 shadow-sm"><h2 id="appointment-patient-details-heading" className="mb-3 text-base font-semibold">{t("registrations.patientDetails")}</h2>{patientQuery.isLoading ? <p className="text-sm text-muted-foreground" role="status">{t("common.loading")}</p> : null}{patientQuery.isError ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{t("registrations.patientDetailsLoadFailed")}</p> : null}{patientQuery.data ? <PatientSummaryContent summary={patientQuery.data as PatientDirectorySummary} variant="embedded" /> : !patientQuery.isLoading && !patientQuery.isError ? <p className="text-sm text-muted-foreground">{text(language, "لا تتوفر بيانات المريض.", "Patient details are unavailable.")}</p> : null}</section>;
}

export function AppointmentInformationView(props: AppointmentInformationViewProps) {
  const { t, language } = useLanguage();
  const isRtl = language === "ar";
  return <div data-testid="appointment-information-view" className="min-h-full min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1.5 px-2 text-sm" onClick={props.onBack} aria-label={t("common.back")}>{isRtl ? <ChevronRight data-testid="appointment-information-back-icon" data-direction="right" size={18} aria-hidden="true" /> : <ChevronLeft data-testid="appointment-information-back-icon" data-direction="left" size={18} aria-hidden="true" />}<span>{t("common.back")}</span></Button><h1 className="text-lg font-semibold">{t("registrations.information")}</h1></div><div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]"><AppointmentDetailsSection {...props} /><aside className="min-w-0"><PatientDetailsSection appointment={props.appointment} /></aside></div></div>;
}
