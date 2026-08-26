import { useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Copy, Edit3 } from "lucide-react";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { formatDateLy, formatDateTimeLy } from "@/lib/date-format";
import { pushToast } from "@/lib/toast";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, PatientDirectorySummary } from "@/types/api";
import { Badge, Button, DisclosureSection } from "@/components/shared";
import { PatientSummaryContent } from "@/components/patients/patient-summary-content";
import { usePatientDirectorySummary } from "@/components/patients/patient-summary-formatters";
import { AppointmentEditor } from "./appointment-editor";

export type AppointmentDetailsMode = "view" | "edit";

interface AppointmentInformationViewProps {
  appointment: AppointmentWithDetails;
  lookups: AppointmentLookups | undefined;
  reportStatus?: { canViewReport?: boolean; state?: string | null } | null;
  onBack: () => void;
  onOpenPatientProfile: () => void;
  onOpenReschedule?: () => void;
  onOpenStatus: () => void;
  onAppointmentUpdated: (appointment: AppointmentWithDetails) => void;
}

type DefinitionRow = { label: string; value: React.ReactNode; dir?: "ltr" | "rtl"; emphasis?: "normal" | "strong" };

const dash = "—";

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return dash;
  return String(value);
}

function text(language: "ar" | "en", ar: string, en: string) {
  return chooseLocalized(language, ar, en);
}

function statusVariant(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (["no-show", "cancelled", "voided"].includes(status)) return "error";
  if (["arrived", "waiting", "discontinued"].includes(status)) return "warning";
  if (status === "scheduled" || status === "in-progress") return "info";
  return "neutral";
}

function StatusBadge({ language, status }: { language: "ar" | "en"; status: string }) {
  return <Badge variant={statusVariant(status)} size="sm" aria-label={text(language, "حالة الموعد", "Appointment status")}>{statusLabel(language, status)}</Badge>;
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
  return <button type="button" onClick={() => void copy()} className="ms-1 inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={`${text(language, "نسخ", "Copy")} ${label}`} title={`${text(language, "نسخ", "Copy")} ${label}`}>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button>;
}

function CopyableValue({ value, label }: { value: string | number | null | undefined; label: string }) {
  const raw = value === null || value === undefined ? "" : String(value);
  return <span className="inline-flex max-w-full items-center [unicode-bidi:isolate]" dir="ltr"><span className="break-all">{valueOrDash(value)}</span><CopyValueButton value={raw} label={label} /></span>;
}

function DefinitionGrid({ rows }: { rows: DefinitionRow[] }) {
  return <dl className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{rows.map((row) => <div key={row.label} className="min-w-0"><dt className="text-xs font-medium leading-5 text-muted-foreground">{row.label}</dt><dd dir={row.dir} className={`mt-1 min-w-0 break-words leading-6 ${row.emphasis === "strong" ? "text-[15px] font-semibold text-foreground" : "text-sm font-medium text-foreground"}`}>{row.value}</dd></div>)}</dl>;
}

function DetailGroup({ title, rows, prominent = false }: { title: string; rows: DefinitionRow[]; prominent?: boolean }) {
  const id = `appointment-group-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return <section className={prominent ? "rounded-lg bg-muted/20 p-3.5" : "pt-1"} aria-labelledby={id}><h3 id={id} className="mb-3 text-sm font-semibold text-foreground">{title}</h3><DefinitionGrid rows={rows} /></section>;
}

function LongTextDisclosure({ title, textValue }: { title: string; textValue: string | null | undefined }) {
  const { language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const content = String(textValue ?? "").trim();
  if (!content) return null;
  return <section className="rounded-lg bg-muted/20 p-3.5"><h3 className="text-sm font-semibold text-foreground">{title}</h3><p className={`mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground ${expanded ? "" : "line-clamp-3"}`}>{content}</p><button type="button" className="mt-2 min-h-9 text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? text(language, "عرض أقل", "Show less") : text(language, "عرض التعليمات كاملة", "Show full instructions")}</button></section>;
}

function reportAvailabilityLabel(language: "ar" | "en", state: string | null | undefined, canViewReport?: boolean) {
  if (canViewReport) return text(language, "متاح", "Available");
  const labels: Record<string, [string, string]> = { final: ["نهائي", "Final"], draft: ["مسودة", "Draft"], pending: ["قيد الانتظار", "Pending"], unavailable: ["غير متاح", "Unavailable"] };
  const label = labels[String(state ?? "").toLowerCase()];
  return label ? text(language, label[0], label[1]) : dash;
}

function protocolStateLabel(language: "ar" | "en", state: string | null | undefined) {
  const normalized = String(state ?? "").toLowerCase();
  if (["assigned", "active", "completed"].includes(normalized)) return text(language, "معين", "Assigned");
  if (["unassigned", "not_assigned", "pending"].includes(normalized)) return text(language, "غير معين", "Not assigned");
  return dash;
}

function elapsedSince(value: string | null | undefined) {
  if (!value) return dash;
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return dash;
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function AppointmentDetailsReadOnly({ appointment, reportStatus, onEdit, onOpenReschedule, onOpenStatus, readOnly = false }: { appointment: AppointmentWithDetails; reportStatus?: { canViewReport?: boolean; state?: string | null } | null; onEdit?: () => void; onOpenReschedule?: () => void; onOpenStatus?: () => void; readOnly?: boolean }) {
  const { language, t } = useLanguage();
  const protocol = appointment.protocolAssignmentSummary;
  const examinationRows: DefinitionRow[] = [
    { label: text(language, "الوسيلة", "Modality"), value: `${valueOrDash(chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn))} · ${valueOrDash(appointment.modalityCode)}`, emphasis: "strong" },
    { label: text(language, "نوع الفحص", "Examination type"), value: valueOrDash(chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)), emphasis: "strong" },
    { label: text(language, "رقم الوصول", "Accession number"), value: <CopyableValue value={appointment.accessionNumber} label={text(language, "رقم الوصول", "accession number")} />, dir: "ltr", emphasis: "strong" },
    { label: text(language, "التقرير", "Report requirement"), value: appointment.isAdditionalImaging ? text(language, "يُدرج التقرير مع الفحص الأصلي", "Reported with original examination") : appointment.requiresReport ? text(language, "مطلوب", "Required") : text(language, "غير مطلوب", "Not required") },
    { label: text(language, "الأولوية", "Reporting priority"), value: chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn) || text(language, "الأولوية غير محددة", "Priority not assigned") },
  ];
  const scheduleRows: DefinitionRow[] = [
    { label: text(language, "تاريخ الموعد", "Appointment date"), value: formatDateLy(appointment.appointmentDate), dir: "ltr", emphasis: "strong" },
    { label: text(language, "وقت الحجز", "Booking time"), value: appointment.bookingTime || text(language, "الوقت غير محدد", "Time not assigned"), dir: "ltr", emphasis: "strong" },
    { label: text(language, "التسلسل اليومي / الترتيب", "Daily sequence / slot"), value: valueOrDash(appointment.dailySequence || appointment.modalitySlotNumber) },
    { label: text(language, "الحضور المباشر", "Walk-in"), value: appointment.isWalkIn ? text(language, "حضور مباشر", "Walk-in") : text(language, "مجدول", "Scheduled") },
    { label: text(language, "الحالة الحالية", "Current status"), value: <StatusBadge language={language} status={appointment.status} /> },
  ];
  const workflowRows: DefinitionRow[] = [
    { label: text(language, "وقت الوصول", "Arrival time"), value: formatDateTimeLy(appointment.arrivedAt), dir: "ltr" },
    { label: text(language, "مدة الانتظار", "Waiting duration"), value: elapsedSince(appointment.waitingStartedAt ?? appointment.arrivedAt), dir: "ltr" },
    { label: text(language, "وقت الإكمال", "Completion time"), value: formatDateTimeLy(appointment.completedAt ?? appointment.autoCompletedAt), dir: "ltr" },
  ];
  const capacityRows: DefinitionRow[] = [
    { label: text(language, "الحجز الزائد", "Overbooking"), value: appointment.isOverbooked ? text(language, "نعم", "Yes") : text(language, "لا", "No") },
    { label: text(language, "سبب الحجز الزائد", "Overbooking reason"), value: valueOrDash(appointment.overbookingReason) },
    { label: text(language, "اعتماد السعة", "Capacity approval"), value: valueOrDash(appointment.approvedByName) },
    { label: text(language, "استخدام الحصة الخاصة", "Special quota usage"), value: valueOrDash(appointment.specialReasonCode ? chooseLocalized(language, appointment.specialReasonLabelAr, appointment.specialReasonLabelEn) || appointment.specialReasonCode : null) },
    { label: text(language, "ملاحظة الحصة الخاصة", "Special quota note"), value: valueOrDash(appointment.specialReasonNote) },
  ];
  const auditRows: DefinitionRow[] = [
    { label: text(language, "أنشئ بواسطة", "Created by"), value: valueOrDash(appointment.createdByName ?? appointment.createdByUsername ?? appointment.createdByUserId) },
    { label: text(language, "تاريخ الإنشاء", "Created date/time"), value: formatDateTimeLy(appointment.createdAt), dir: "ltr" },
    { label: text(language, "آخر تحديث", "Last updated"), value: formatDateTimeLy(appointment.updatedAt), dir: "ltr" },
    { label: text(language, "المعرف الداخلي", "Internal appointment ID"), value: valueOrDash(appointment.id), dir: "ltr" },
    { label: text(language, "سبب عدم الحضور", "No-show reason"), value: valueOrDash(appointment.noShowReason) },
    { label: text(language, "سبب الإيقاف أو الإلغاء", "Discontinued / cancellation reason"), value: valueOrDash(appointment.cancelReason) },
  ];
  if (appointment.status === "voided" || appointment.voidedAt || appointment.voidedByUserId || appointment.voidedByName || appointment.voidedByUsername || appointment.voidReason) {
    auditRows.push(
      { label: text(language, "أُلغي بواسطة", "Voided by"), value: valueOrDash(appointment.voidedByName ?? appointment.voidedByUsername ?? appointment.voidedByUserId) },
      { label: text(language, "تاريخ ووقت الإلغاء", "Voided date/time"), value: formatDateTimeLy(appointment.voidedAt), dir: "ltr" },
      { label: text(language, "سبب الإلغاء", "Void reason"), value: valueOrDash(appointment.voidReason) },
    );
  }
  const technicalRows: DefinitionRow[] = [
    { label: text(language, "الدراسة", "Study"), value: appointment.studyInstanceUid ? text(language, "مرتبطة", "Linked") : text(language, "غير مرتبطة", "Unlinked") },
    { label: "Study Instance UID", value: <CopyableValue value={appointment.studyInstanceUid} label="Study Instance UID" />, dir: "ltr" },
    { label: text(language, "ملاحظة PACS", "PACS note"), value: valueOrDash(appointment.sonicDicomStudyNote) },
    { label: text(language, "حالة التقرير", "Report availability"), value: reportAvailabilityLabel(language, reportStatus?.state, reportStatus?.canViewReport) },
    { label: text(language, "حالة البروتوكول", "Protocol state"), value: protocolStateLabel(language, protocol?.status ?? (protocol ? "assigned" : "unassigned")) },
    { label: text(language, "اسم البروتوكول والإصدار", "Protocol name and version"), value: protocol ? `${valueOrDash(protocol.protocolName)} ${protocol.versionNumber ? `v${protocol.versionNumber}` : ""}`.trim() : dash },
    ...(protocol?.freeTextProtocol?.trim() ? [{ label: text(language, "البروتوكول النصي", "Free-text protocol"), value: protocol.freeTextProtocol.trim() }] : []),
    { label: text(language, "الجهاز المخصص", "Assigned scanner"), value: valueOrDash(protocol?.scannerName) },
    { label: text(language, "عين بواسطة", "Assigned by"), value: valueOrDash(protocol?.assignedBy) },
    { label: text(language, "تاريخ التعيين", "Assigned date/time"), value: formatDateTimeLy(protocol?.assignedAt), dir: "ltr" },
    { label: text(language, "ملاحظات البروتوكول", "Protocol notes"), value: valueOrDash(protocol?.protocolNotes) },
    { label: text(language, "ملاحظات التباين", "Contrast notes"), value: valueOrDash(protocol?.contrastNotes) },
  ];
  const hasCapacity = [appointment.isOverbooked, appointment.overbookingReason, appointment.approvedByName, appointment.specialReasonCode, appointment.specialReasonNote].some(Boolean);

  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="appointment-details-heading" className="text-base font-semibold">{t("registrations.appointmentDetails")}</h2>{!readOnly && onEdit ? <Button type="button" size="sm" onClick={onEdit}><Edit3 size={15} className="me-1.5" aria-hidden="true" />{t("common.edit")}</Button> : null}</div>
    <div className="space-y-6">
      <DetailGroup title={text(language, "الفحص", "Examination")} rows={examinationRows} prominent />
      <DetailGroup title={text(language, "الجدولة وسير العمل", "Schedule and workflow")} rows={scheduleRows} />
      <DisclosureSection title={text(language, "الأوقات الإضافية لسير العمل", "Additional workflow timestamps")}><DefinitionGrid rows={workflowRows} /></DisclosureSection>
      <section className="space-y-4" aria-labelledby="appointment-clinical-heading"><h3 id="appointment-clinical-heading" className="text-sm font-semibold">{text(language, "المعلومات السريرية", "Clinical information")}</h3><DefinitionGrid rows={[{ label: text(language, "الطبيب الطالب", "Ordering / requesting doctor"), value: dash }]} /><LongTextDisclosure title={text(language, "ملاحظات الموعد", "Appointment notes")} textValue={appointment.notes} /><LongTextDisclosure title={text(language, "تعليمات الجهاز", "Modality instructions")} textValue={chooseLocalized(language, appointment.modalityGeneralInstructionAr, appointment.modalityGeneralInstructionEn)} /><LongTextDisclosure title={text(language, "تعليمات الفحص", "Examination instructions")} textValue={chooseLocalized(language, appointment.examSpecificInstructionAr, appointment.examSpecificInstructionEn)} /></section>
      {hasCapacity ? <DisclosureSection title={text(language, "السعة واستثناءات الحجز", "Capacity and booking exceptions")}><DefinitionGrid rows={capacityRows} /></DisclosureSection> : null}
      <DisclosureSection title={text(language, "التفاصيل الإدارية والتدقيق", "Administrative and audit details")}><DefinitionGrid rows={auditRows} /></DisclosureSection>
      <DisclosureSection title={text(language, "تفاصيل PACS التقنية", "Technical PACS details")}><DefinitionGrid rows={technicalRows} /></DisclosureSection>
    </div>
    {!readOnly ? <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">{onOpenReschedule ? <Button type="button" variant="outline" size="sm" onClick={onOpenReschedule}><CalendarClock size={15} className="me-1.5" aria-hidden="true" />{t("registrations.reschedule")}</Button> : null}{onOpenStatus ? <Button type="button" variant="outline" size="sm" onClick={onOpenStatus}>{text(language, "تغيير الحالة", "Change status")}</Button> : null}</div> : null}
  </>;
}

function AppointmentDetailsSection({ appointment, lookups, reportStatus, onOpenReschedule, onOpenStatus, onAppointmentUpdated }: { appointment: AppointmentWithDetails; lookups: AppointmentLookups | undefined; reportStatus?: { canViewReport?: boolean; state?: string | null } | null; onOpenReschedule?: () => void; onOpenStatus: () => void; onAppointmentUpdated: (appointment: AppointmentWithDetails) => void }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<AppointmentDetailsMode>("view");
  return <section aria-labelledby="appointment-details-heading" className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5">{mode === "edit" ? <><div className="mb-4 flex items-center justify-between gap-3"><h2 id="appointment-details-heading" className="text-base font-semibold">{t("registrations.appointmentDetails")}</h2></div><AppointmentEditor key={appointment.id} appointment={appointment} lookups={lookups} editing onCancel={() => setMode("view")} onUpdated={(updated) => { onAppointmentUpdated(updated); setMode("view"); }} /></> : <AppointmentDetailsReadOnly appointment={appointment} reportStatus={reportStatus} onEdit={() => setMode("edit")} onOpenReschedule={onOpenReschedule} onOpenStatus={onOpenStatus} />}</section>;
}

function PatientDetailsSection({ appointment }: { appointment: AppointmentWithDetails }) {
  const { t, language } = useLanguage();
  const patientQuery = usePatientDirectorySummary(appointment.patientId);
  return <section aria-labelledby="appointment-patient-details-heading" className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5"><div className="mb-4"><h2 id="appointment-patient-details-heading" className="text-base font-semibold">{t("registrations.patientDetails")}</h2></div>{patientQuery.isLoading ? <p className="mb-3 text-sm text-muted-foreground" role="status">{t("common.loading")}</p> : null}{patientQuery.isError ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{t("registrations.patientDetailsLoadFailed")}</p> : null}{patientQuery.data ? <PatientSummaryContent summary={patientQuery.data as PatientDirectorySummary} variant="embedded" /> : <p className="text-sm text-muted-foreground">{text(language, "لا تتوفر بيانات المريض.", "Patient details are unavailable.")}</p>}</section>;
}

export function AppointmentInformationView(props: AppointmentInformationViewProps) {
  const { t, language } = useLanguage();
  const isRtl = language === "ar";
  return <div data-testid="appointment-information-view" className="min-h-full min-w-0"><div className="mb-4 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" className="min-h-10 gap-1.5 px-2 text-sm" onClick={props.onBack} aria-label={t("common.back")}>{isRtl ? <ChevronRight data-testid="appointment-information-back-icon" data-direction="right" size={18} aria-hidden="true" /> : <ChevronLeft data-testid="appointment-information-back-icon" data-direction="left" size={18} aria-hidden="true" />}<span>{t("common.back")}</span></Button><h1 className="text-lg font-semibold">{t("registrations.information")}</h1></div><div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(370px,410px)_minmax(0,1fr)]"><PatientDetailsSection appointment={props.appointment} /><AppointmentDetailsSection appointment={props.appointment} lookups={props.lookups} reportStatus={props.reportStatus} onOpenReschedule={props.onOpenReschedule} onOpenStatus={props.onOpenStatus} onAppointmentUpdated={props.onAppointmentUpdated} /></div></div>;
}
