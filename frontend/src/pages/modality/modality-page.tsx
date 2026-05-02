import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  Printer,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  TimerReset,
} from "lucide-react";
import { DateInput } from "@/components/common/date-input";
import { Select } from "@/components/common/select";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared";
import { fetchAppointmentLookups, fetchModalityWorklist, completeAppointment } from "@/lib/api-hooks";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { chooseLocalized, t } from "@/lib/i18n";
import type { Language } from "@/lib/i18n";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AppointmentLookups, AppointmentStatus } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";

const ACTIVE_STATUSES = new Set<AppointmentStatus>(["waiting", "arrived", "in-progress"]);
const HISTORY_STATUSES = new Set<AppointmentStatus>([
  "scheduled",
  "completed",
  "discontinued",
  "no-show",
  "cancelled",
  "voided",
]);

function isActiveStatus(status: AppointmentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

function isHistoryStatus(status: AppointmentStatus): boolean {
  return HISTORY_STATUSES.has(status);
}

function statusVariant(status: AppointmentStatus): "success" | "warning" | "info" | "error" | "neutral" | "accent" {
  switch (status) {
    case "waiting":
      return "warning";
    case "arrived":
      return "info";
    case "in-progress":
      return "accent";
    case "completed":
      return "success";
    case "discontinued":
    case "cancelled":
    case "voided":
      return "error";
    case "no-show":
      return "warning";
    default:
      return "neutral";
  }
}

function workflowStep(status: AppointmentStatus): 1 | 2 | 3 {
  if (status === "completed") return 3;
  if (status === "in-progress") return 2;
  return 1;
}

function normalizeStatusLabel(language: Language, status: AppointmentStatus): string {
  return t(language, `status.${status}`);
}

function sexLabel(language: Language, sex: string | null | undefined): string {
  const value = String(sex ?? "").trim().toLowerCase();
  if (!value) return t(language, "common.na");
  if (value.startsWith("m")) return language === "ar" ? "ذكر" : "Male";
  if (value.startsWith("f")) return language === "ar" ? "أنثى" : "Female";
  return sex ?? t(language, "common.na");
}

function formatAgeSex(language: Language, appointment: AppointmentWithDetails): string {
  const ageText =
    appointment.ageYears > 0
      ? language === "ar"
        ? `${appointment.ageYears} سنة`
        : `${appointment.ageYears} years`
      : "";
  const sexText = sexLabel(language, appointment.sex);
  if (!ageText && sexText === t(language, "common.na")) return t(language, "common.na");
  if (!ageText) return sexText;
  if (sexText === t(language, "common.na")) return ageText;
  return `${ageText} • ${sexText}`;
}

function formatIdentifierLine(language: Language, appointment: AppointmentWithDetails): string {
  const parts: string[] = [];
  if (appointment.mrn) {
    parts.push(`${t(language, "settings.fieldMRN")}: ${appointment.mrn}`);
  }
  if (appointment.nationalId) {
    parts.push(`${t(language, "settings.fieldNationalId")}: ${appointment.nationalId}`);
  }
  return parts.length > 0 ? parts.join(" • ") : t(language, "common.na");
}

function getRowSortKey(appointment: AppointmentWithDetails): number {
  const slot = Number(appointment.modalitySlotNumber ?? appointment.dailySequence ?? Number.MAX_SAFE_INTEGER);
  return Number.isFinite(slot) ? slot : Number.MAX_SAFE_INTEGER;
}

export default function ModalityPage() {
  const { language: rawLanguage, isArabic } = useLanguage();
  const language = rawLanguage as Language;
  const queryClient = useQueryClient();
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  const [modalityId, setModalityId] = useState("");
  const [date, setDate] = useState(todayIsoDateLy());
  const [scope, setScope] = useState<"day" | "all">("day");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [confirmTargetId, setConfirmTargetId] = useState<number | null>(null);
  const [confirmVerified, setConfirmVerified] = useState(false);

  const { data: lookups } = useQuery<AppointmentLookups>({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading, isFetching } = useQuery({
    queryKey: ["modality-worklist", modalityId, date, scope],
    queryFn: () => fetchModalityWorklist(modalityId, date, scope),
    enabled: !!modalityId,
    staleTime: 1000 * 10,
    refetchInterval: 15_000,
  });

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId]
  );

  useEffect(() => {
    if (selectedAppointmentId == null) return;
    if (!appointments.some((appointment) => appointment.id === selectedAppointmentId)) {
      setSelectedAppointmentId(null);
      setConfirmTargetId(null);
      setConfirmVerified(false);
    }
  }, [appointments, selectedAppointmentId]);

  useEffect(() => {
    if (confirmTargetId == null) return;
    if (!appointments.some((appointment) => appointment.id === confirmTargetId)) {
      setConfirmTargetId(null);
      setConfirmVerified(false);
    }
  }, [appointments, confirmTargetId]);

  const completeMutation = useMutation({
    mutationFn: completeAppointment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
      setConfirmTargetId(null);
      setConfirmVerified(false);
    },
  });

  const activeAppointments = useMemo(
    () =>
      appointments
        .filter((appointment) => appointment.appointmentDate === date && isActiveStatus(appointment.status))
        .slice()
        .sort((a, b) => getRowSortKey(a) - getRowSortKey(b) || a.accessionNumber.localeCompare(b.accessionNumber)),
    [appointments, date]
  );

  const historyAppointments = useMemo(
    () =>
      appointments
        .filter((appointment) => appointment.appointmentDate !== date || isHistoryStatus(appointment.status))
        .slice()
        .sort((a, b) => {
          const dateOrder = b.appointmentDate.localeCompare(a.appointmentDate);
          if (dateOrder !== 0) return dateOrder;
          const statusOrder = Number(isHistoryStatus(b.status)) - Number(isHistoryStatus(a.status));
          if (statusOrder !== 0) return statusOrder;
          return getRowSortKey(a) - getRowSortKey(b) || a.accessionNumber.localeCompare(b.accessionNumber);
        }),
    [appointments, date]
  );

  const waitingCount = activeAppointments.filter((appointment) => appointment.status === "waiting").length;
  const arrivedCount = activeAppointments.filter((appointment) => appointment.status === "arrived").length;
  const inProgressCount = activeAppointments.filter((appointment) => appointment.status === "in-progress").length;
  const completedCount = appointments.filter((appointment) => appointment.status === "completed").length;
  const activeCount = activeAppointments.length;
  const historyCount = historyAppointments.length;

  const selectedEdited =
    Boolean(selectedAppointment?.createdAt && selectedAppointment?.updatedAt) &&
    selectedAppointment?.createdAt !== selectedAppointment?.updatedAt;

  const currentStage = selectedAppointment ? workflowStep(selectedAppointment.status) : 1;
  const currentStageLabel =
    selectedAppointment?.status === "completed"
      ? t(language, "status.completed")
      : selectedAppointment?.status === "in-progress"
        ? t(language, "status.in-progress")
        : selectedAppointment
          ? `${t(language, "status.waiting")} / ${t(language, "status.arrived")}`
          : t(language, "modality.selectPrompt");

  const canComplete = Boolean(selectedAppointment && ACTIVE_STATUSES.has(selectedAppointment.status));
  const completionTarget = confirmTargetId == null ? null : appointments.find((appointment) => appointment.id === confirmTargetId) ?? null;

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["modality-worklist"] });
  };

  const handlePrint = (appointmentId: number) => {
    void printAppointmentSlipById(appointmentId, language);
  };

  const handleRequestCompletion = (appointment: AppointmentWithDetails) => {
    setConfirmTargetId(appointment.id);
    setConfirmVerified(false);
  };

  const handleConfirmCompletion = () => {
    if (!completionTarget || !confirmVerified || completeMutation.isPending) return;
    completeMutation.mutate(completionTarget.id);
  };

  const modalities = lookups?.modalities ?? [];
  const headerTitle = t(language, "modality.title");
  const selectedName = selectedAppointment ? chooseLocalized(language, selectedAppointment.arabicFullName, selectedAppointment.englishFullName) : "";
  const selectedModality = selectedAppointment ? chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn) : "";
  const selectedExam = selectedAppointment ? chooseLocalized(language, selectedAppointment.examNameAr, selectedAppointment.examNameEn) || t(language, "common.na") : "";
  const selectedPriority = selectedAppointment ? chooseLocalized(language, selectedAppointment.priorityNameAr, selectedAppointment.priorityNameEn) || t(language, "common.na") : "";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.10),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_20%),linear-gradient(180deg,rgba(248,250,252,1),rgba(241,245,249,1))]" dir={isArabic ? "rtl" : "ltr"}>
      <div className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
        <header className="rounded-[2rem] border border-slate-200/80 bg-white/90 px-4 py-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur-md sm:px-6">
          <div className={`flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between ${isArabic ? "xl:flex-row-reverse" : ""}`}>
            <div className={`flex items-center gap-4 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--accent),var(--accent-secondary))] text-white shadow-md">
                <span className="text-lg font-bold tracking-[0.24em]">NCCB</span>
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{chooseLocalized(language, "الموعد المختار", "Selected appointment")}</p>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{t(language, "brand.hospitalName")}</h1>
                <p className="text-sm text-muted-foreground sm:text-base">{headerTitle}</p>
              </div>
            </div>

            <div className={`flex flex-wrap items-center gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <Clock3 size={14} />
                  <span>{chooseLocalized(language, "الوقت الحالي", "Current time")}</span>
                </div>
                <p className="mt-1 text-lg font-semibold text-foreground">{new Date().toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
              </div>

              <Button variant="ghost" size="sm" onClick={handleRefresh} className="rounded-2xl px-4">
                <RefreshCw size={16} />
                <span>{t(language, "modality.refresh")}</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="grid flex-1 gap-5 xl:grid-cols-[minmax(360px,0.95fr)_minmax(0,1.35fr)]">
          <section className="flex min-h-0 flex-col gap-5">
            <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
              <div className={`grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] ${isArabic ? "lg:[direction:rtl]" : ""}`}>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{t(language, "modality.selectModality")}</p>
                    <div className="mt-2">
                      <Select
                        label={t(language, "modality.selectModality")}
                        value={modalityId}
                        onChange={(value) => {
                          setModalityId(value);
                          setSelectedAppointmentId(null);
                          setConfirmTargetId(null);
                          setConfirmVerified(false);
                        }}
                        options={[
                          { value: "", label: t(language, "modality.selectModality") },
                          ...modalities
                            .filter((modality) => modality.isActive)
                            .map((modality) => ({
                              value: String(modality.id),
                              label: chooseLocalized(language, modality.nameAr, modality.nameEn) || modality.code || `Modality ${modality.id}`,
                            })),
                        ]}
                        required
                      />
                    </div>
                  </div>

                  <DateInput
                    label={t(language, "modality.date")}
                    value={date}
                    onChange={setDate}
                    disabled={scope === "all"}
                  />

                  <div>
                    <p className="text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5 text-muted-foreground">
                      {t(language, "modality.scope")}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={scope === "day" ? "primary" : "secondary"}
                        size="lg"
                        onClick={() => setScope("day")}
                        className="justify-center"
                      >
                        {t(language, "modality.scopeToday")}
                      </Button>
                      <Button
                        type="button"
                        variant={scope === "all" ? "primary" : "secondary"}
                        size="lg"
                        onClick={() => setScope("all")}
                        className="justify-center"
                      >
                        {t(language, "modality.scopeAll")}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/80 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{chooseLocalized(language, "الغرفة / المحطة", "Room / station")}</p>
                      <h2 className="mt-1 text-xl font-semibold text-foreground">
                        {chooseLocalized(language, "تجهيز لغرف ومحطات مستقبلية", "Future room / station ready")}
                      </h2>
                    </div>
                    <Building2 className="mt-0.5 h-5 w-5 text-[var(--accent)]" />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {chooseLocalized(language, "هذا التخطيط مهيأ لتصفية CT أو US أو تصفية خاصة بالماسح من دون افتراض أن كل موداليتي لها غرفة واحدة.", "This layout is ready for future CT room, US room, or scanner-specific filtering without assuming one room per modality.")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="neutral" size="sm">
                      CT
                    </Badge>
                    <Badge variant="neutral" size="sm">
                      US
                    </Badge>
                    <Badge variant="neutral" size="sm">
                      MRI
                    </Badge>
                    <Badge variant="neutral" size="sm">
                      {chooseLocalized(language, "بحسب الماسح", "Scanner-specific")}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label={t(language, "status.waiting")}
                value={waitingCount}
                tone="amber"
                icon={<Clock3 size={20} />}
              />
              <MetricCard
                label={t(language, "status.arrived")}
                value={arrivedCount}
                tone="sky"
                icon={<BadgeCheck size={20} />}
              />
              <MetricCard
                label={t(language, "status.in-progress")}
                value={inProgressCount}
                tone="indigo"
                icon={<TimerReset size={20} />}
              />
              <MetricCard
                label={t(language, "status.completed")}
                value={completedCount}
                tone="emerald"
                icon={<CheckCircle2 size={20} />}
              />
            </div>

            <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/92 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
              <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{chooseLocalized(language, "قائمة العمل الفعالة", "Active worklist")}</p>
                    <h2 className="mt-1 text-xl font-semibold text-foreground">
                      {chooseLocalized(language, "اليوم أولاً، ثم التاريخ", "Today first, history second")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {chooseLocalized(language, "حالات الانتظار والوصول وقيد التنفيذ تبقى في الأعلى.", "Waiting, arrived, and in-progress cases stay at the top.")}
                    </p>
                  </div>
                <Badge variant="selected" size="sm">
                  {activeCount}
                </Badge>
              </div>

              <div className="mt-5">
                {isLoading ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {t(language, "modality.loading")}
                  </div>
                ) : !modalityId ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {t(language, "modality.selectPrompt")}
                  </div>
                ) : activeAppointments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                    {t(language, "modality.empty")}
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {activeAppointments.map((appointment) => {
                      const selected = appointment.id === selectedAppointmentId;
                      const edited = Boolean(appointment.createdAt && appointment.updatedAt && appointment.createdAt !== appointment.updatedAt);
                      return (
                        <li key={appointment.id}>
                          <button
                            ref={selected ? selectedRef : undefined}
                            type="button"
                            onClick={() => setSelectedAppointmentId(appointment.id)}
                            className={`w-full rounded-2xl border p-4 text-right transition-all duration-150 ${
                              selected
                                ? "border-[color:var(--accent)] bg-[linear-gradient(135deg,rgba(37,99,235,0.10),rgba(14,165,233,0.08))] shadow-[0_12px_30px_rgba(37,99,235,0.12)]"
                                : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            <div className={`flex items-start justify-between gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-base font-semibold text-foreground">
                                    #{appointment.modalitySlotNumber ?? appointment.dailySequence ?? "—"} • {chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}
                                  </p>
                                  <PatientCategoryBadge category={appointment.caseCategory} showWhenUnset={false} size="sm" />
                                  {edited ? (
                                    <Badge variant="warning" size="sm">
                                      {t(language, "appointmentEditor.edited")}
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {appointment.accessionNumber} {"•"} {chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)}{" "}
                                  {appointment.examNameEn || appointment.examNameAr ? `• ${chooseLocalized(language, appointment.examNameAr, appointment.examNameEn)}` : ""}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatAgeSex(language, appointment)} {"•"} {formatIdentifierLine(language, appointment)}
                                </p>
                              </div>

                              <div className="flex flex-col items-end gap-2">
                                <Badge variant={statusVariant(appointment.status)} size="sm">
                                  {normalizeStatusLabel(language, appointment.status)}
                                </Badge>
                                <p className="text-xs text-muted-foreground">
                                  {formatDateLy(appointment.appointmentDate)}
                                </p>
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>

            {historyCount > 0 ? (
              <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/88 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{chooseLocalized(language, "السجل التاريخي", "History")}</p>
                    <h2 className="mt-1 text-xl font-semibold text-foreground">
                      {chooseLocalized(language, "عرض تاريخي ثانوي", "Secondary history view")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {chooseLocalized(language, "تبقى الحالات المكتملة والملغاة وغير الحاضرة بعيدة عن التدفق الحي.", "Completed, cancelled, and no-show cases stay here away from the live scanner flow.")}
                    </p>
                  </div>
                  <Badge variant="neutral" size="sm">
                    {historyCount}
                  </Badge>
                </div>

                <div className="mt-5">
                  {historyAppointments.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-muted-foreground">
                      {t(language, "modality.empty")}
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {historyAppointments.slice(0, 12).map((appointment) => (
                        <li key={appointment.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedAppointmentId(appointment.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-right transition-colors ${
                              appointment.id === selectedAppointmentId
                                ? "border-[color:var(--accent)] bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(14,165,233,0.06))]"
                                : "border-slate-200 bg-white hover:bg-slate-50"
                            }`}
                          >
                            <div className={`flex items-center justify-between gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground">
                                  {chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {appointment.accessionNumber} {"•"} {chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn)} {"•"} {normalizeStatusLabel(language, appointment.status)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <PatientCategoryBadge category={appointment.caseCategory} showWhenUnset={false} size="sm" />
                                <Badge variant={statusVariant(appointment.status)} size="sm">
                                  {normalizeStatusLabel(language, appointment.status)}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            ) : null}
          </section>

          <aside className="flex min-h-0 flex-col gap-5">
            <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/94 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              {selectedAppointment ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{chooseLocalized(language, "الموعد المختار", "Selected appointment")}</p>
                      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
                        {selectedName}
                      </h2>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <PatientCategoryBadge category={selectedAppointment.caseCategory} showWhenUnset={false} size="sm" />
                        {selectedEdited ? (
                          <Badge variant="warning" size="sm">
                            {t(language, "appointmentEditor.edited")}
                          </Badge>
                        ) : null}
                        <Badge variant={statusVariant(selectedAppointment.status)} size="sm">
                          {normalizeStatusLabel(language, selectedAppointment.status)}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => handlePrint(selectedAppointment.id)}>
                        <Printer size={16} />
                        <span>{t(language, "common.print")}</span>
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <DetailField label={t(language, "modality.fieldPatient")} value={selectedName} />
                    <DetailField label={t(language, "settings.fieldMRN")} value={selectedAppointment.mrn ?? null} />
                    <DetailField label={t(language, "settings.fieldNationalId")} value={selectedAppointment.nationalId ?? null} />
                    <DetailField label={t(language, "settings.fieldAge")} value={formatAgeSex(language, selectedAppointment)} />
                    <DetailField label={t(language, "modality.fieldAccession")} value={selectedAppointment.accessionNumber} />
                    <DetailField label={t(language, "modality.fieldModality")} value={selectedModality} />
                    <DetailField label={t(language, "modality.fieldExam")} value={selectedExam} />
                    <DetailField label={t(language, "modality.fieldPriority")} value={selectedPriority} />
                  </div>

                  <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{chooseLocalized(language, "سير العمل", "Workflow")}</p>
                        <h3 className="mt-1 text-lg font-semibold text-foreground">{currentStageLabel}</h3>
                      </div>
                      <Badge variant={statusVariant(selectedAppointment.status)} size="sm">
                        {formatDateLy(selectedAppointment.appointmentDate)}
                      </Badge>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                    <WorkflowStep
                      active={currentStage === 1}
                      done={currentStage > 1}
                      label={chooseLocalized(language, "انتظار / حضور", "Waiting / arrived")}
                      hint={chooseLocalized(language, "جاهز للبدء", "Ready to start")}
                    />
                    <WorkflowStep
                      active={currentStage === 2}
                      done={currentStage > 2}
                      label={chooseLocalized(language, "قيد التنفيذ", "In progress")}
                      hint={chooseLocalized(language, "مكان البدء المستقبلي محجوز هنا.", "Workflow slot reserved for future start actions.")}
                    />
                    <WorkflowStep
                      active={currentStage === 3}
                      done={currentStage === 3}
                      label={chooseLocalized(language, "مكتمل", "Completed")}
                      hint={chooseLocalized(language, "انتهاء الفحص", "Exam finished")}
                    />
                    </div>

                    <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-muted-foreground">
                      {chooseLocalized(language, "سيتم ربط تحكمات البدء / قيد التنفيذ هنا عند توفر دعم الخادم.", "Start / in-progress controls will plug in here when backend support is available.")}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="lg"
                      onClick={() => handlePrint(selectedAppointment.id)}
                      className="justify-center"
                    >
                      <Printer size={18} />
                      <span>{t(language, "common.print")}</span>
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      size="lg"
                      disabled={!canComplete || completeMutation.isPending}
                      onClick={() => handleRequestCompletion(selectedAppointment)}
                      className="justify-center"
                    >
                      {completeMutation.isPending ? (
                        <RefreshCw size={18} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={18} />
                      )}
                      <span>{t(language, "modality.complete")}</span>
                    </Button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
                    <div className={`flex items-start gap-3 ${isArabic ? "flex-row-reverse" : ""}`}>
                      <ShieldAlert className="mt-0.5 h-5 w-5 text-[var(--accent)]" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{chooseLocalized(language, "التعامل مع المشاكل", "Problem handling")}</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{chooseLocalized(language, "بلاغ مشكلة / لا يمكن التنفيذ / العودة إلى الاستقبال سيُوضع هنا لاحقاً.", "Report issue / cannot perform / return to reception will live here later.")}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <Badge variant="neutral" size="sm">
                        {chooseLocalized(language, "مساحة عمل مستقبلية", "Future action slot")}
                      </Badge>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[520px] items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-8 py-12 text-center">
                  <div className="max-w-md space-y-3">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(37,99,235,0.12),rgba(14,165,233,0.14))] text-[var(--accent)]">
                      <ScanLine size={28} />
                    </div>
                    <h2 className="text-2xl font-semibold text-foreground">{t(language, "modality.selectPrompt")}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                    {chooseLocalized(language, "اختر جهازاً ثم اختر موعداً من القائمة اليسرى لمراجعة الهوية الكاملة وخطوات العمل.", "Choose a modality, then select an appointment from the left to review full identity details and workflow steps.")}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white/94 p-5 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{chooseLocalized(language, "ملخص العمل الحالي", "Current worklist snapshot")}</p>
                  <h3 className="mt-1 text-lg font-semibold text-foreground">
                    {chooseLocalized(language, "ملخص العمل الحالي", "Current worklist snapshot")}
                  </h3>
                </div>
                <RefreshCw className={`h-5 w-5 text-[var(--accent)] ${isFetching ? "animate-spin" : ""}`} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SnapshotLine
                  label={chooseLocalized(language, "الإجمالي الفعال", "Active total")}
                  value={activeCount}
                />
                <SnapshotLine
                  label={chooseLocalized(language, "التاريخ", "History")}
                  value={historyCount}
                />
              </div>
            </Card>
          </aside>
        </main>
      </div>

      <Dialog
        open={confirmTargetId != null}
        onClose={() => {
          setConfirmTargetId(null);
          setConfirmVerified(false);
        }}
      >
        <DialogContent maxWidth="760px">
          {completionTarget ? (
            <>
              <DialogHeader>
                <div className="space-y-1">
                  <DialogTitle>{t(language, "modality.confirmCompleteTitle")}</DialogTitle>
                  <DialogDescription>{t(language, "modality.confirmCompleteBody")}</DialogDescription>
                </div>
              </DialogHeader>

              <div className="mt-4 space-y-4">
                <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-lg font-semibold text-foreground">
                      {chooseLocalized(language, completionTarget.arabicFullName, completionTarget.englishFullName)}
                    </h4>
                    <PatientCategoryBadge category={completionTarget.caseCategory} showWhenUnset={false} size="sm" />
                    {completionTarget.createdAt && completionTarget.updatedAt && completionTarget.createdAt !== completionTarget.updatedAt ? (
                      <Badge variant="warning" size="sm">
                        {t(language, "appointmentEditor.edited")}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DetailField label={t(language, "modality.fieldAccession")} value={completionTarget.accessionNumber} />
                    <DetailField label={t(language, "modality.fieldModality")} value={chooseLocalized(language, completionTarget.modalityNameAr, completionTarget.modalityNameEn)} />
                    <DetailField label={t(language, "modality.fieldExam")} value={chooseLocalized(language, completionTarget.examNameAr, completionTarget.examNameEn) || t(language, "common.na")} />
                    <DetailField label={t(language, "modality.fieldPriority")} value={chooseLocalized(language, completionTarget.priorityNameAr, completionTarget.priorityNameEn) || t(language, "common.na")} />
                    <DetailField label={t(language, "modality.fieldPatient")} value={chooseLocalized(language, completionTarget.arabicFullName, completionTarget.englishFullName)} />
                    <DetailField label={t(language, "settings.fieldMRN")} value={completionTarget.mrn ?? null} />
                    <DetailField label={t(language, "settings.fieldNationalId")} value={completionTarget.nationalId ?? null} />
                    <DetailField label={t(language, "settings.fieldAge")} value={formatAgeSex(language, completionTarget)} />
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
                  <Checkbox
                    checked={confirmVerified}
                    onChange={(event) => setConfirmVerified(event.target.checked)}
                  />
                  <span className="text-sm leading-6 text-foreground">
                    {t(language, "modality.confirmCompleteCheckbox")}
                  </span>
                </label>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setConfirmTargetId(null);
                    setConfirmVerified(false);
                  }}
                >
                  {t(language, "common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!confirmVerified || completeMutation.isPending}
                  onClick={handleConfirmCompletion}
                >
                  {completeMutation.isPending ? (
                    <RefreshCw size={18} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={18} />
                  )}
                  <span>{t(language, "modality.confirmCompleteButton")}</span>
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "amber" | "sky" | "indigo" | "emerald";
  icon: React.ReactNode;
}) {
  const toneClasses: Record<"amber" | "sky" | "indigo" | "emerald", string> = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };

  return (
    <div className={`rounded-[1.5rem] border p-4 shadow-sm ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.2em] opacity-80">{label}</p>
        {icon}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium leading-6 text-foreground">{value ?? "—"}</p>
    </div>
  );
}

function WorkflowStep({
  label,
  hint,
  active,
  done,
}: {
  label: string;
  hint: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-3 py-3 text-center ${
        active
          ? "border-[color:var(--accent)] bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(14,165,233,0.06))]"
          : done
            ? "border-emerald-200 bg-emerald-50"
            : "border-slate-200 bg-slate-50"
      }`}
    >
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

function SnapshotLine({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
