import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Check, Copy, Edit3, UserRound } from "lucide-react";
import { fetchPatientDirectorySummary } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, PatientDirectorySummary } from "@/types/api";
import { formatDateLy, formatDateTimeLy } from "@/lib/date-format";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { Badge, Button } from "@/components/shared";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { pushToast } from "@/lib/toast";
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
  onVoid?: () => void;
  onAppointmentUpdated: (appointment: AppointmentWithDetails) => void;
}

type DefinitionRow = { label: string; value: React.ReactNode; dir?: "ltr" | "rtl"; emphasis?: "normal" | "strong" };

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
}

function bilingual(language: Language, ar: string, en: string): string {
  return chooseLocalized(language, ar, en);
}

function formatSex(language: Language, value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["m", "male"].includes(normalized)) return bilingual(language, "ذكر", "Male");
  if (["f", "female"].includes(normalized)) return bilingual(language, "أنثى", "Female");
  if (["other", "o"].includes(normalized)) return bilingual(language, "آخر", "Other");
  if (["unknown", "u", "undisclosed"].includes(normalized)) return bilingual(language, "غير معروف", "Unknown");
  return "—";
}

function categoryLabel(language: Language, category: string | null | undefined): string {
  if (category === "oncology") return bilingual(language, "أورام", "Oncology");
  if (category === "non_oncology") return bilingual(language, "غير أورام", "Non-oncology");
  return "—";
}

function elapsedSince(value: string | null | undefined): string {
  if (!value) return "—";
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function statusVariant(status: string): "success" | "warning" | "error" | "info" | "neutral" {
  if (status === "completed") return "success";
  if (["no-show", "cancelled"].includes(status)) return "error";
  if (status === "discontinued") return "warning";
  if (["arrived", "waiting"].includes(status)) return "warning";
  if (status === "scheduled") return "info";
  return "neutral";
}

function localizedStatus(language: Language, status: string): string {
  const knownStatuses = new Set(["scheduled", "arrived", "waiting", "in-progress", "completed", "no-show", "discontinued", "cancelled", "voided"]);
  return knownStatuses.has(status) ? statusLabel(language, status) : bilingual(language, "حالة غير معروفة", "Unknown status");
}

function reportAvailabilityLabel(language: Language, status: string | null | undefined, canViewReport?: boolean): string {
  if (canViewReport) return bilingual(language, "متاح", "Available");
  const labels: Record<string, [string, string]> = {
    final: ["نهائي", "Final"],
    draft: ["مسودة", "Draft"],
    pending: ["قيد الانتظار", "Pending"],
    unavailable: ["غير متاح", "Unavailable"],
  };
  const label = labels[String(status ?? "").trim().toLowerCase()];
  return label ? bilingual(language, label[0], label[1]) : "—";
}

function protocolStateLabel(language: Language, status: string | null | undefined): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (["assigned", "active", "completed"].includes(normalized)) return bilingual(language, "معين", "Assigned");
  if (["unassigned", "not_assigned", "pending"].includes(normalized)) return bilingual(language, "غير معين", "Not assigned");
  return "—";
}

function StatusBadge({ language, status }: { language: Language; status: string }) {
  return <Badge variant={statusVariant(status)} size="sm" aria-label={bilingual(language, "حالة الموعد", "Appointment status")}>{localizedStatus(language, status)}</Badge>;
}

function DefinitionGrid({ rows }: { rows: DefinitionRow[] }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="text-[11px] font-medium leading-4 text-muted-foreground">{row.label}</dt>
          <dd dir={row.dir} className={`mt-0.5 min-w-0 break-words leading-5 ${row.emphasis === "strong" ? "text-sm font-semibold text-foreground" : "text-[13px] font-medium text-foreground"}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyValueButton({ value, label }: { value: string | null | undefined; label: string }) {
  const { language } = useLanguage();
  const [copied, setCopied] = useState(false);
  const text = String(value ?? "").trim();
  if (!text) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      pushToast({ type: "success", title: bilingual(language, "تم النسخ", "Copied"), message: label });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast({ type: "error", title: bilingual(language, "فشل النسخ", "Copy failed"), message: label });
    }
  };

  return <button type="button" onClick={() => void copy()} className="ms-1 inline-flex min-h-7 min-w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={`${bilingual(language, "نسخ", "Copy")} ${label}`} title={`${bilingual(language, "نسخ", "Copy")} ${label}`}><span className="sr-only">{label}</span>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button>;
}

function CopyableValue({ value, label }: { value: string | null | undefined; label: string }) {
  return <span className="inline-flex max-w-full items-center" dir="ltr"><span className="break-all">{valueOrDash(value)}</span><CopyValueButton value={value} label={label} /></span>;
}

function DetailGroup({ title, rows, prominent = false }: { title: string; rows: DefinitionRow[]; prominent?: boolean }) {
  return <section className={prominent ? "rounded-lg bg-muted/20 p-3" : "pt-1"} aria-labelledby={`appointment-group-${title.replace(/\s+/g, "-").toLowerCase()}`}><h3 id={`appointment-group-${title.replace(/\s+/g, "-").toLowerCase()}`} className="mb-2 text-xs font-semibold text-foreground">{title}</h3><DefinitionGrid rows={rows} /></section>;
}

function LongTextDisclosure({ title, text }: { title: string; text: string | null | undefined }) {
  const { language } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const content = String(text ?? "").trim();
  if (!content) return null;
  return <section className="rounded-lg border border-border/70 bg-muted/20 p-3"><h3 className="text-xs font-semibold text-foreground">{title}</h3><p className={`mt-1 whitespace-pre-wrap text-[13px] leading-5 text-foreground ${expanded ? "" : "line-clamp-3"}`}>{content}</p><button type="button" className="mt-2 text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? bilingual(language, "عرض أقل", "Show less") : bilingual(language, "عرض التعليمات كاملة", "Show full instructions")}</button></section>;
}

function patientRows(appointment: AppointmentWithDetails, summary: PatientDirectorySummary | undefined, language: Language) {
  const demographics = summary?.demographics;
  const identifiers = summary?.identifiers;
  const contact = summary?.contact;
  const primaryIdentifier = identifiers?.items?.find((item) => item.isPrimary);
  const category = summary?.category ?? appointment.caseCategory;
  const estimated = Boolean(summary?.warnings.incompleteData || demographics?.demographicsEstimated || appointment.demographicsEstimated);
  const primary = [
    { label: "MRN", value: <CopyableValue value={demographics?.mrn ?? appointment.mrn} label="MRN" />, dir: "ltr" as const, emphasis: "strong" as const },
    { label: bilingual(language, "المعرف الأساسي", "Primary identifier"), value: <CopyableValue value={primaryIdentifier?.value ?? identifiers?.identifierValue ?? appointment.patientPrimaryIdentifierValue} label={bilingual(language, "المعرف الأساسي", "Primary identifier")} />, dir: "ltr" as const },
    { label: bilingual(language, "النوع", "Identifier type"), value: valueOrDash(identifiers?.identifierType ?? appointment.patientPrimaryIdentifierLabelEn ?? appointment.patientPrimaryIdentifierType) },
    { label: bilingual(language, "العمر والجنس", "Age / sex"), value: `${demographics?.ageYears ?? appointment.ageYears} ${bilingual(language, "سنة", "years")} · ${formatSex(language, demographics?.sex ?? appointment.sex)}` },
    { label: bilingual(language, "الهاتف الأساسي", "Primary phone"), value: <CopyableValue value={contact?.phone1 ?? appointment.phone1} label={bilingual(language, "الهاتف الأساسي", "primary phone")} />, dir: "ltr" as const },
    { label: bilingual(language, "الفئة", "Category"), value: <PatientCategoryBadge category={category} showWhenUnset={false} size="sm" /> },
  ];
  const additional = [
    { label: bilingual(language, "الرقم الوطني", "National ID"), value: <CopyableValue value={identifiers?.nationalId ?? appointment.nationalId} label={bilingual(language, "الرقم الوطني", "national ID")} />, dir: "ltr" as const },
    { label: bilingual(language, "تاريخ الميلاد", "Date of birth"), value: formatDateLy(demographics?.dateOfBirth), dir: "ltr" as const },
    { label: bilingual(language, "الهاتف الثانوي", "Secondary phone"), value: valueOrDash(contact?.phone2), dir: "ltr" as const },
    { label: bilingual(language, "العنوان", "Address"), value: valueOrDash(contact?.address ?? appointment.address) },
    { label: bilingual(language, "معرف المريض الداخلي", "Internal patient ID"), value: valueOrDash(demographics?.id ?? appointment.patientId), dir: "ltr" as const },
    { label: bilingual(language, "بيانات مقدرة أو غير مكتملة", "Estimated or incomplete demographics"), value: estimated ? bilingual(language, "نعم", "Yes") : bilingual(language, "لا", "No") },
  ];
  return { names: [demographics?.arabicFullName ?? appointment.arabicFullName, demographics?.englishFullName ?? appointment.englishFullName], primary, additional };
}

function PatientDetailsSection({ appointment, onOpenPatientProfile }: { appointment: AppointmentWithDetails; onOpenPatientProfile: () => void }) {
  const { language, t } = useLanguage();
  const patientQuery = useQuery({
    queryKey: ["patient-directory-summary", appointment.patientId],
    queryFn: () => fetchPatientDirectorySummary(appointment.patientId),
    enabled: appointment.patientId > 0,
    staleTime: 30_000,
    retry: 1,
  });
  const details = patientRows(appointment, patientQuery.data, language);

  return <section aria-labelledby="appointment-patient-details-heading" className="min-w-0 rounded-xl border border-border bg-background p-3 sm:p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="appointment-patient-details-heading" className="text-sm font-semibold">{t("registrations.patientDetails")}</h2><Button type="button" variant="outline" size="sm" onClick={onOpenPatientProfile}><UserRound size={14} className="me-1.5" aria-hidden="true" />{t("registrations.openPatientProfile")}</Button></div>{patientQuery.isLoading ? <p className="mb-3 text-xs text-muted-foreground" role="status">{t("common.loading")}</p> : null}{patientQuery.isError ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">{t("registrations.patientDetailsLoadFailed")}</p> : null}<div className="border-b border-border/70 pb-3"><p className="text-lg font-semibold leading-7 text-foreground">{valueOrDash(details.names[0])}</p><p className="text-sm font-medium leading-6 text-muted-foreground">{valueOrDash(details.names[1])}</p></div><div className="mt-3"><DefinitionGrid rows={details.primary} /></div><details className="mt-4 border-t border-border/70 pt-3"><summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{bilingual(language, "بيانات ديموغرافية إضافية", "More demographics")}</summary><div className="mt-3"><DefinitionGrid rows={details.additional} /></div></details></section>;
}

function SummaryStrip({ appointment }: { appointment: AppointmentWithDetails }) {
  const { language } = useLanguage();
  const modality = valueOrDash(chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn));
  const exam = valueOrDash(chooseLocalized(language, appointment.examNameAr, appointment.examNameEn));
  const priority = chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn).trim();
  const appointmentTime = (appointment as AppointmentWithDetails & { appointmentTime?: string | null }).appointmentTime;
  const time = String(appointment.bookingTime ?? appointmentTime ?? "").trim() || bilingual(language, "الوقت غير محدد", "Time not assigned");
  return <section aria-label={bilingual(language, "ملخص الموعد", "Appointment summary")} className="rounded-xl border border-accent/20 bg-accent/5 p-3 sm:p-4"><div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"><div className="min-w-0"><p className="text-base font-semibold text-foreground sm:text-lg"><span>{modality}</span><span className="mx-1 text-muted-foreground">·</span><span>{exam}</span></p><p className="mt-1 text-sm font-medium text-foreground" dir="ltr">{formatDateLy(appointment.appointmentDate)} <span className="text-muted-foreground">·</span> {time}</p></div><div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end"><StatusBadge language={language} status={appointment.status} /><Badge variant="warning" size="sm">{priority || bilingual(language, "الأولوية غير محددة", "Priority not assigned")}</Badge><Badge variant={appointment.requiresReport ? "accent" : "neutral"} size="sm">{appointment.requiresReport ? bilingual(language, "التقرير مطلوب", "Report required") : bilingual(language, "التقرير غير مطلوب", "Report not required")}</Badge><span className="ms-auto inline-flex max-w-full items-center text-[13px] font-semibold text-foreground sm:ms-1" dir="ltr"><span className="break-all">{valueOrDash(appointment.accessionNumber)}</span><CopyValueButton value={appointment.accessionNumber} label={bilingual(language, "رقم الوصول", "accession number")} /></span></div></div></section>;
}

function AppointmentDetailsReadOnly({ appointment, reportStatus, onEdit, onOpenReschedule, onOpenStatus }: { appointment: AppointmentWithDetails; reportStatus?: { canViewReport?: boolean; state?: string | null } | null; onEdit: () => void; onOpenReschedule?: () => void; onOpenStatus: () => void }) {
  const { language, t } = useLanguage();
  const protocol = appointment.protocolAssignmentSummary;
  const reportState = reportAvailabilityLabel(language, reportStatus?.state, reportStatus?.canViewReport);
  const examinationRows: DefinitionRow[] = [
    { label: bilingual(language, "الوسيلة", "Modality"), value: `${valueOrDash(chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn))} · ${valueOrDash(appointment.modalityCode)}`, emphasis: "strong" },
    { label: bilingual(language, "نوع الفحص", "Examination type"), value: valueOrDash(chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)), emphasis: "strong" },
    { label: bilingual(language, "رقم الوصول", "Accession number"), value: <CopyableValue value={appointment.accessionNumber} label={bilingual(language, "رقم الوصول", "accession number")} />, dir: "ltr", emphasis: "strong" },
    { label: bilingual(language, "معرف الموعد", "Appointment ID / reference"), value: valueOrDash(appointment.id), dir: "ltr" },
    { label: bilingual(language, "التقرير", "Report requirement"), value: appointment.requiresReport ? bilingual(language, "مطلوب", "Required") : bilingual(language, "غير مطلوب", "Not required") },
    { label: bilingual(language, "الأولوية", "Reporting priority"), value: chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn) || bilingual(language, "الأولوية غير محددة", "Priority not assigned") },
  ];
  const scheduleRows: DefinitionRow[] = [
    { label: bilingual(language, "تاريخ الموعد", "Appointment date"), value: formatDateLy(appointment.appointmentDate), dir: "ltr", emphasis: "strong" },
    { label: bilingual(language, "وقت الحجز", "Booking time"), value: valueOrDash(appointment.bookingTime), dir: "ltr" },
    { label: bilingual(language, "التسلسل اليومي / الفتحة", "Daily sequence / slot"), value: valueOrDash(appointment.dailySequence || appointment.modalitySlotNumber) },
    { label: bilingual(language, "الحضور المباشر", "Walk-in"), value: appointment.isWalkIn ? bilingual(language, "حضور مباشر", "Walk-in") : bilingual(language, "مجدول", "Scheduled") },
    { label: bilingual(language, "الحالة الحالية", "Current status"), value: <StatusBadge language={language} status={appointment.status} /> },
    { label: bilingual(language, "الفئة", "Category"), value: categoryLabel(language, appointment.caseCategory) },
    { label: bilingual(language, "وقت الوصول", "Arrival time"), value: formatDateTimeLy(appointment.arrivedAt), dir: "ltr" },
    { label: bilingual(language, "مدة الانتظار", "Waiting duration"), value: elapsedSince(appointment.waitingStartedAt ?? appointment.arrivedAt), dir: "ltr" },
    { label: bilingual(language, "وقت الإكمال", "Completion time"), value: formatDateTimeLy(appointment.completedAt ?? appointment.autoCompletedAt), dir: "ltr" },
  ];
  const capacityRows: DefinitionRow[] = [
    { label: bilingual(language, "الحجز الزائد", "Overbooking"), value: appointment.isOverbooked ? bilingual(language, "نعم", "Yes") : bilingual(language, "لا", "No") },
    { label: bilingual(language, "سبب الحجز الزائد", "Overbooking reason"), value: valueOrDash(appointment.overbookingReason) },
    { label: bilingual(language, "اعتماد السعة", "Capacity approval"), value: valueOrDash(appointment.approvedByName) },
    { label: bilingual(language, "استخدام الحصة الخاصة", "Special quota usage"), value: valueOrDash(appointment.specialReasonCode ? chooseLocalized(language, appointment.specialReasonLabelAr, appointment.specialReasonLabelEn) || appointment.specialReasonCode : null) },
    { label: bilingual(language, "ملاحظة الحصة الخاصة", "Special quota note"), value: valueOrDash(appointment.specialReasonNote) },
  ];
  const auditRows: DefinitionRow[] = [
    { label: bilingual(language, "أنشئ بواسطة", "Created by"), value: valueOrDash(appointment.createdByName ?? appointment.createdByUsername ?? appointment.createdByUserId) },
    { label: bilingual(language, "تاريخ الإنشاء", "Created date/time"), value: formatDateTimeLy(appointment.createdAt), dir: "ltr" },
    { label: bilingual(language, "آخر تحديث", "Last updated"), value: formatDateTimeLy(appointment.updatedAt), dir: "ltr" },
    { label: bilingual(language, "المعرف الداخلي", "Internal appointment ID"), value: valueOrDash(appointment.id), dir: "ltr" },
    { label: bilingual(language, "سبب عدم الحضور", "No-show reason"), value: valueOrDash(appointment.noShowReason) },
    { label: bilingual(language, "سبب الإيقاف أو الإلغاء", "Discontinued / cancellation reason"), value: valueOrDash(appointment.cancelReason) },
  ];
  const technicalRows: DefinitionRow[] = [
    { label: bilingual(language, "الدراسة", "Study"), value: appointment.studyInstanceUid ? bilingual(language, "مرتبطة", "Linked") : bilingual(language, "غير مرتبطة", "Unlinked") },
    { label: "Study Instance UID", value: <CopyableValue value={appointment.studyInstanceUid} label="Study Instance UID" />, dir: "ltr" },
    { label: bilingual(language, "ملاحظة PACS", "PACS note"), value: valueOrDash(appointment.sonicDicomStudyNote) },
    { label: bilingual(language, "حالة التقرير", "Report availability"), value: reportState },
    { label: bilingual(language, "حالة البروتوكول", "Protocol state"), value: protocolStateLabel(language, protocol?.status ?? (protocol ? "assigned" : "unassigned")) },
    { label: bilingual(language, "اسم البروتوكول والإصدار", "Protocol name and version"), value: protocol ? `${valueOrDash(protocol.protocolName)} ${protocol.versionNumber ? `v${protocol.versionNumber}` : ""}`.trim() : "—" },
    { label: bilingual(language, "الجهاز المخصص", "Assigned scanner"), value: valueOrDash(protocol?.scannerName) },
    { label: bilingual(language, "عين بواسطة", "Assigned by"), value: valueOrDash(protocol?.assignedBy) },
    { label: bilingual(language, "تاريخ التعيين", "Assigned date/time"), value: formatDateTimeLy(protocol?.assignedAt), dir: "ltr" },
    { label: bilingual(language, "ملاحظات البروتوكول", "Protocol notes"), value: valueOrDash(protocol?.protocolNotes) },
    { label: bilingual(language, "ملاحظات التباين", "Contrast notes"), value: valueOrDash(protocol?.contrastNotes) },
  ];

  return <><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="appointment-details-heading" className="text-sm font-semibold">{t("registrations.appointmentDetails")}</h2><Button type="button" size="sm" onClick={onEdit}><Edit3 size={14} className="me-1.5" aria-hidden="true" />{t("common.edit")}</Button></div><div className="space-y-5"><DetailGroup title={bilingual(language, "الفحص", "Examination")} rows={examinationRows} prominent /><DetailGroup title={bilingual(language, "الجدولة وسير العمل", "Schedule and workflow")} rows={scheduleRows} /><section className="space-y-3" aria-labelledby="appointment-clinical-heading"><h3 id="appointment-clinical-heading" className="text-xs font-semibold">{bilingual(language, "المعلومات السريرية", "Clinical information")}</h3><DefinitionGrid rows={[{ label: bilingual(language, "الطبيب الطالب", "Ordering / requesting doctor"), value: "—" }]} /><LongTextDisclosure title={bilingual(language, "ملاحظات الموعد", "Appointment notes")} text={appointment.notes} /><LongTextDisclosure title={bilingual(language, "تعليمات الجهاز", "Modality instructions")} text={chooseLocalized(language, appointment.modalityGeneralInstructionAr, appointment.modalityGeneralInstructionEn)} /><LongTextDisclosure title={bilingual(language, "تعليمات الفحص", "Examination instructions")} text={chooseLocalized(language, appointment.examSpecificInstructionAr, appointment.examSpecificInstructionEn)} /></section>{[appointment.isOverbooked, appointment.overbookingReason, appointment.approvedByName, appointment.specialReasonCode, appointment.specialReasonNote].some(Boolean) ? <details className="border-t border-border/70 pt-3"><summary className="cursor-pointer text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{bilingual(language, "السعة واستثناءات الحجز", "Capacity and booking exceptions")}</summary><div className="mt-3"><DefinitionGrid rows={capacityRows} /></div></details> : null}<details className="border-t border-border/70 pt-3"><summary className="cursor-pointer text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{bilingual(language, "التفاصيل الإدارية والتدقيق", "Administrative and audit details")}</summary><div className="mt-3"><DefinitionGrid rows={auditRows} /></div></details><details className="border-t border-border/70 pt-3"><summary className="cursor-pointer text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{bilingual(language, "تفاصيل PACS التقنية", "Technical PACS details")}</summary><div className="mt-3"><DefinitionGrid rows={technicalRows} /></div></details></div><div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">{onOpenReschedule ? <Button type="button" variant="outline" size="sm" onClick={onOpenReschedule}><CalendarClock size={14} className="me-1.5" aria-hidden="true" />{t("registrations.reschedule")}</Button> : null}<Button type="button" variant="outline" size="sm" onClick={onOpenStatus}>{bilingual(language, "تغيير الحالة", "Change status")}</Button></div></>;
}

function AppointmentDetailsSection({ appointment, lookups, reportStatus, onOpenReschedule, onOpenStatus, onAppointmentUpdated }: { appointment: AppointmentWithDetails; lookups: AppointmentLookups | undefined; reportStatus?: { canViewReport?: boolean; state?: string | null } | null; onOpenReschedule?: () => void; onOpenStatus: () => void; onAppointmentUpdated: (appointment: AppointmentWithDetails) => void }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<AppointmentDetailsMode>("view");
  return <section aria-labelledby="appointment-details-heading" className="min-w-0 rounded-xl border border-border bg-background p-3 sm:p-4">{mode === "edit" ? <><div className="mb-3 flex items-center justify-between gap-2"><h2 id="appointment-details-heading" className="text-sm font-semibold">{t("registrations.appointmentDetails")}</h2></div><AppointmentEditor key={appointment.id} appointment={appointment} lookups={lookups} editing onCancel={() => setMode("view")} onUpdated={(updated) => { onAppointmentUpdated(updated); setMode("view"); }} /></> : <AppointmentDetailsReadOnly appointment={appointment} reportStatus={reportStatus} onEdit={() => setMode("edit")} onOpenReschedule={onOpenReschedule} onOpenStatus={onOpenStatus} />}</section>;
}

export function AppointmentInformationView(props: AppointmentInformationViewProps) {
  const { t, language } = useLanguage();
  return <div data-testid="appointment-information-view" className="min-h-full min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2"><Button type="button" variant="ghost" size="sm" onClick={props.onBack} aria-label={t("common.back")}><ArrowLeft size={16} aria-hidden="true" /></Button><h1 className="text-base font-semibold">{t("registrations.information")}</h1></div><SummaryStrip appointment={props.appointment} /><div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.7fr)]"><PatientDetailsSection appointment={props.appointment} onOpenPatientProfile={props.onOpenPatientProfile} /><div className="min-w-0"><AppointmentDetailsSection appointment={props.appointment} lookups={props.lookups} reportStatus={props.reportStatus} onOpenReschedule={props.onOpenReschedule} onOpenStatus={props.onOpenStatus} onAppointmentUpdated={props.onAppointmentUpdated} />{props.onVoid ? <section className="mt-3 rounded-xl border border-red-200/70 bg-red-50/40 p-3"><h2 className="text-xs font-semibold text-red-800">{bilingual(language, "إجراءات إدارية", "Administrative actions")}</h2><Button type="button" variant="destructive" size="sm" className="mt-2" onClick={props.onVoid}>{bilingual(language, "إبطال الموعد", "Void appointment")}</Button></section> : null}</div></div></div>;
}
