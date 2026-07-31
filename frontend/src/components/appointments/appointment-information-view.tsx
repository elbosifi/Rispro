import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Edit3, UserRound } from "lucide-react";
import { fetchPatientDirectorySummary } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, PatientDirectorySummary } from "@/types/api";
import { formatDateLy, formatDateTimeLy } from "@/lib/date-format";
import { chooseLocalized } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { Button } from "@/components/shared";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import { AppointmentEditor } from "./appointment-editor";

export type AppointmentDetailsMode = "view" | "edit";

interface AppointmentInformationViewProps {
  appointment: AppointmentWithDetails;
  lookups: AppointmentLookups | undefined;
  reportStatus?: { canViewReport?: boolean; state?: string | null } | null;
  onBack: () => void;
  onOpenPatientProfile: () => void;
  onOpenReschedule: () => void;
  onOpenStatus: () => void;
  onVoid?: () => void;
  onAppointmentUpdated: (appointment: AppointmentWithDetails) => void;
}

function valueOrDash(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
}

function bilingual(language: Language, ar: string, en: string): string {
  return chooseLocalized(language, ar, en);
}

function elapsedSince(value: string | null | undefined): string {
  if (!value) return "—";
  const started = new Date(value).getTime();
  if (!Number.isFinite(started)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function DefinitionGrid({ rows }: { rows: Array<{ label: string; value: React.ReactNode; dir?: "ltr" | "rtl" }> }) {
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0 border-b border-border/70 pb-2">
          <dt className="text-[10px] font-mono-data uppercase tracking-[0.08em] text-muted-foreground">{row.label}</dt>
          <dd dir={row.dir} className="mt-1 min-w-0 break-words text-sm font-medium text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function patientRows(
  appointment: AppointmentWithDetails,
  summary: PatientDirectorySummary | undefined,
  language: Language,
) {
  const demographics = summary?.demographics;
  const identifiers = summary?.identifiers;
  const contact = summary?.contact;
  const primaryIdentifier = identifiers?.items?.find((item) => item.isPrimary);
  const category = summary?.category ?? appointment.caseCategory;
  const estimated = summary?.warnings.incompleteData || summary?.demographics.demographicsEstimated || appointment.demographicsEstimated;

  return [
    { label: bilingual(language, "الاسم بالعربية", "Arabic full name"), value: valueOrDash(demographics?.arabicFullName ?? appointment.arabicFullName) },
    { label: bilingual(language, "الاسم بالإنجليزية", "English full name"), value: valueOrDash(demographics?.englishFullName ?? appointment.englishFullName) },
    { label: "MRN", value: valueOrDash(demographics?.mrn ?? appointment.mrn), dir: "ltr" as const },
    { label: bilingual(language, "نوع المعرف الأساسي", "Primary identifier type"), value: valueOrDash(identifiers?.identifierType ?? appointment.patientPrimaryIdentifierLabelEn ?? appointment.patientPrimaryIdentifierType) },
    { label: bilingual(language, "قيمة المعرف الأساسي", "Primary identifier value"), value: valueOrDash(primaryIdentifier?.value ?? identifiers?.identifierValue ?? appointment.patientPrimaryIdentifierValue), dir: "ltr" as const },
    { label: bilingual(language, "الرقم الوطني", "National ID"), value: valueOrDash(identifiers?.nationalId ?? appointment.nationalId), dir: "ltr" as const },
    { label: bilingual(language, "تاريخ الميلاد", "Date of birth"), value: valueOrDash(demographics?.dateOfBirth), dir: "ltr" as const },
    { label: bilingual(language, "العمر", "Age"), value: demographics?.ageYears ? `${demographics.ageYears}${estimated ? " · E" : ""}` : valueOrDash(appointment.ageYears) },
    { label: bilingual(language, "الجنس", "Sex"), value: valueOrDash(demographics?.sex ?? appointment.sex) },
    { label: bilingual(language, "الفئة", "Category"), value: category === "oncology" ? bilingual(language, "أورام", "Oncology") : category === "non_oncology" ? bilingual(language, "غير أورام", "Non-oncology") : "—" },
    { label: bilingual(language, "الهاتف الأساسي", "Primary phone"), value: valueOrDash(contact?.phone1 ?? appointment.phone1), dir: "ltr" as const },
    { label: bilingual(language, "الهاتف الثانوي", "Secondary phone"), value: valueOrDash(contact?.phone2), dir: "ltr" as const },
    { label: bilingual(language, "العنوان", "Address"), value: valueOrDash(contact?.address ?? appointment.address) },
    { label: bilingual(language, "معرف المريض الداخلي", "Internal patient ID"), value: valueOrDash(demographics?.id ?? appointment.patientId), dir: "ltr" as const },
    { label: bilingual(language, "البيانات المقدرة أو غير المكتملة", "Estimated or incomplete demographics"), value: estimated ? bilingual(language, "نعم", "Yes") : bilingual(language, "لا", "No") },
  ];
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

  return (
    <section aria-labelledby="appointment-patient-details-heading" className="min-w-0 rounded-xl border border-border bg-background p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="appointment-patient-details-heading" className="text-sm font-semibold">{t("registrations.patientDetails")}</h2>
        <Button type="button" variant="outline" size="sm" onClick={onOpenPatientProfile}>
          <UserRound size={14} className="me-1.5" aria-hidden="true" />{t("registrations.openPatientProfile")}
        </Button>
      </div>
      {patientQuery.isLoading ? <p className="mb-3 text-xs text-muted-foreground" role="status">{t("common.loading")}</p> : null}
      {patientQuery.isError ? <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">{t("registrations.patientDetailsLoadFailed")}</p> : null}
      <DefinitionGrid rows={patientRows(appointment, patientQuery.data, language)} />
    </section>
  );
}

function AppointmentDetailsReadOnly({
  appointment,
  reportStatus,
  onEdit,
  onOpenReschedule,
  onOpenStatus,
}: Pick<AppointmentInformationViewProps, "appointment" | "reportStatus" | "onOpenReschedule" | "onOpenStatus"> & { onEdit: () => void }) {
  const { language, t } = useLanguage();
  const protocol = appointment.protocolAssignmentSummary;
  const rows = [
    { label: bilingual(language, "رقم الوصول", "Accession number"), value: <span dir="ltr" className="font-mono-data">{valueOrDash(appointment.accessionNumber)}</span>, dir: "ltr" as const },
    { label: bilingual(language, "معرف الموعد", "Appointment ID / reference"), value: <span dir="ltr" className="font-mono-data">{appointment.id}</span>, dir: "ltr" as const },
    { label: t("registrations.modality"), value: `${valueOrDash(chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn))} · ${valueOrDash(appointment.modalityCode)}` },
    { label: bilingual(language, "نوع الفحص", "Examination type"), value: valueOrDash(chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)) },
    { label: t("registrations.date"), value: formatDateLy(appointment.appointmentDate), dir: "ltr" as const },
    { label: bilingual(language, "وقت الحجز", "Booking time"), value: valueOrDash(appointment.bookingTime), dir: "ltr" as const },
    { label: bilingual(language, "التسلسل اليومي / رقم الموعد", "Daily sequence / slot"), value: valueOrDash(appointment.dailySequence || appointment.modalitySlotNumber) },
    { label: bilingual(language, "موعد حضور مباشر", "Walk-in"), value: appointment.isWalkIn ? bilingual(language, "نعم", "Yes") : bilingual(language, "لا", "No") },
    { label: bilingual(language, "الحالة الحالية", "Current status"), value: valueOrDash(appointment.status) },
    { label: bilingual(language, "الأولوية", "Reporting priority"), value: valueOrDash(chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn)) },
    { label: bilingual(language, "الفئة", "Category"), value: appointment.caseCategory === "oncology" ? bilingual(language, "أورام", "Oncology") : appointment.caseCategory === "non_oncology" ? bilingual(language, "غير أورام", "Non-oncology") : "—" },
    { label: bilingual(language, "التقرير مطلوب", "Report required"), value: appointment.requiresReport ? bilingual(language, "نعم", "Yes") : bilingual(language, "لا", "No") },
    { label: bilingual(language, "ملاحظات الموعد", "Appointment notes"), value: valueOrDash(appointment.notes) },
    { label: bilingual(language, "تعليمات الجهاز", "Modality instructions"), value: valueOrDash(chooseLocalized(language, appointment.modalityGeneralInstructionAr, appointment.modalityGeneralInstructionEn)) },
    { label: bilingual(language, "تعليمات الفحص", "Examination instructions"), value: valueOrDash(chooseLocalized(language, appointment.examSpecificInstructionAr, appointment.examSpecificInstructionEn)) },
    { label: bilingual(language, "الطبيب الطالب", "Ordering / requesting doctor"), value: "—" },
    { label: bilingual(language, "أنشئ بواسطة", "Created by"), value: valueOrDash(appointment.createdByName ?? appointment.createdByUsername ?? appointment.createdByUserId) },
    { label: bilingual(language, "تاريخ الإنشاء", "Created date/time"), value: formatDateTimeLy(appointment.createdAt), dir: "ltr" as const },
    { label: bilingual(language, "آخر تحديث", "Last updated"), value: formatDateTimeLy(appointment.updatedAt), dir: "ltr" as const },
    { label: bilingual(language, "وقت الوصول", "Arrival time"), value: formatDateTimeLy(appointment.arrivedAt), dir: "ltr" as const },
    { label: bilingual(language, "مدة الانتظار", "Waiting duration"), value: elapsedSince(appointment.waitingStartedAt ?? appointment.arrivedAt), dir: "ltr" as const },
    { label: bilingual(language, "وقت الإكمال", "Completion time"), value: formatDateTimeLy(appointment.completedAt ?? appointment.autoCompletedAt), dir: "ltr" as const },
    { label: bilingual(language, "سبب عدم الحضور", "No-show reason"), value: valueOrDash(appointment.noShowReason) },
    { label: bilingual(language, "سبب الإيقاف", "Discontinued reason"), value: valueOrDash(appointment.cancelReason) },
    { label: bilingual(language, "حالة الحجز الزائد", "Overbooking"), value: appointment.isOverbooked ? bilingual(language, "نعم", "Yes") : bilingual(language, "لا", "No") },
    { label: bilingual(language, "سبب الحجز الزائد", "Overbooking reason"), value: valueOrDash(appointment.overbookingReason) },
    { label: bilingual(language, "موافقة الحجز", "Capacity approval"), value: valueOrDash(appointment.approvedByName) },
    { label: bilingual(language, "استخدام الحجز الخاص", "Special quota usage"), value: valueOrDash(appointment.specialReasonCode ? chooseLocalized(language, appointment.specialReasonLabelAr, appointment.specialReasonLabelEn) || appointment.specialReasonCode : null) },
    { label: bilingual(language, "ملاحظة الحجز الخاص", "Special quota note"), value: valueOrDash(appointment.specialReasonNote) },
  ];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="appointment-details-heading" className="text-sm font-semibold">{t("registrations.appointmentDetails")}</h2>
        <Button type="button" size="sm" onClick={onEdit}><Edit3 size={14} className="me-1.5" aria-hidden="true" />{t("common.edit")}</Button>
      </div>
      <DefinitionGrid rows={rows} />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onOpenReschedule}><CalendarClock size={14} className="me-1.5" aria-hidden="true" />{t("registrations.reschedule")}</Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenStatus}>{bilingual(language, "تغيير الحالة", "Change status")}</Button>
      </div>
      <details className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer text-xs font-semibold">{bilingual(language, "التفاصيل التقنية", "Technical details")}</summary>
        <div className="mt-3 space-y-3">
          <DefinitionGrid rows={[
            { label: bilingual(language, "الدراسة", "Study linked"), value: appointment.studyInstanceUid ? bilingual(language, "مرتبطة", "Linked") : bilingual(language, "غير مرتبطة", "Unlinked") },
            { label: "Study Instance UID", value: valueOrDash(appointment.studyInstanceUid), dir: "ltr" },
            { label: bilingual(language, "ملاحظة PACS", "PACS note"), value: valueOrDash(appointment.sonicDicomStudyNote) },
            { label: bilingual(language, "حالة التقرير", "Report availability"), value: reportStatus?.canViewReport ? bilingual(language, "متاح", "Available") : reportStatus ? valueOrDash(reportStatus.state) : "—" },
          ]} />
          {protocol ? <DefinitionGrid rows={[
            { label: bilingual(language, "حالة البروتوكول", "Protocol state"), value: valueOrDash(protocol.status ?? "assigned") },
            { label: bilingual(language, "اسم البروتوكول والإصدار", "Protocol name and version"), value: `${valueOrDash(protocol.protocolName)} ${protocol.versionNumber ? `v${protocol.versionNumber}` : ""}`.trim() },
            { label: bilingual(language, "الجهاز المعين", "Assigned scanner"), value: valueOrDash(protocol.scannerName) },
            { label: bilingual(language, "عين بواسطة", "Assigned by"), value: valueOrDash(protocol.assignedBy) },
            { label: bilingual(language, "تاريخ التعيين", "Assigned date/time"), value: formatDateTimeLy(protocol.assignedAt), dir: "ltr" },
            { label: bilingual(language, "ملاحظات البروتوكول", "Protocol notes"), value: valueOrDash(protocol.protocolNotes) },
            { label: bilingual(language, "ملاحظات التباين", "Contrast notes"), value: valueOrDash(protocol.contrastNotes) },
          ]} /> : null}
        </div>
      </details>
    </>
  );
}

function AppointmentDetailsSection({
  appointment,
  lookups,
  reportStatus,
  onOpenReschedule,
  onOpenStatus,
  onAppointmentUpdated,
}: Omit<AppointmentInformationViewProps, "onBack" | "onOpenPatientProfile">) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<AppointmentDetailsMode>("view");

  return (
    <section aria-labelledby="appointment-details-heading" className="min-w-0 rounded-xl border border-border bg-background p-3 sm:p-4">
      {mode === "edit" ? (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="appointment-details-heading" className="text-sm font-semibold">{t("registrations.appointmentDetails")}</h2>
          </div>
          <AppointmentEditor
            appointment={appointment}
            lookups={lookups}
            editing
            onCancel={() => setMode("view")}
            onUpdated={(updated) => {
              onAppointmentUpdated(updated);
              setMode("view");
            }}
          />
        </>
      ) : (
        <AppointmentDetailsReadOnly appointment={appointment} reportStatus={reportStatus} onEdit={() => setMode("edit")} onOpenReschedule={onOpenReschedule} onOpenStatus={onOpenStatus} />
      )}
    </section>
  );
}

export function AppointmentInformationView(props: AppointmentInformationViewProps) {
  const { t, language } = useLanguage();
  return (
    <div data-testid="appointment-information-view" className="min-h-full min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={props.onBack} aria-label={t("common.back")}><ArrowLeft size={16} aria-hidden="true" /></Button>
          <h1 className="text-base font-semibold">{t("registrations.information")}</h1>
          <PatientCategoryBadge category={props.appointment.caseCategory} showWhenUnset={false} size="sm" />
        </div>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(260px,0.62fr)_minmax(0,1.38fr)]">
        <PatientDetailsSection appointment={props.appointment} onOpenPatientProfile={props.onOpenPatientProfile} />
        <div className="min-w-0 space-y-3">
          <AppointmentDetailsSection appointment={props.appointment} lookups={props.lookups} reportStatus={props.reportStatus} onOpenReschedule={props.onOpenReschedule} onOpenStatus={props.onOpenStatus} onAppointmentUpdated={props.onAppointmentUpdated} />
          {props.onVoid ? <section className="rounded-xl border border-red-200/70 bg-red-50/40 p-3"><h2 className="text-xs font-semibold text-red-800">{chooseLocalized(language, "إجراءات إدارية", "Administrative actions")}</h2><Button type="button" variant="destructive" size="sm" className="mt-2" onClick={props.onVoid}>{chooseLocalized(language, "إبطال الموعد", "Void appointment")}</Button></section> : null}
        </div>
      </div>
    </div>
  );
}
