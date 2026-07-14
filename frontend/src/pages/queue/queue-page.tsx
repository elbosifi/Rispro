import { useState, useRef, useCallback, useEffect, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ExternalLink, RefreshCw, Search, UserRound } from "lucide-react";
import { fetchQueueSnapshot, scanIntoQueue, addWalkIn, cancelAppointment, searchPatients, fetchAppointmentLookups, fetchSettings } from "@/lib/api-hooks";
import type { QueueEntry, QueueSnapshot, Patient } from "@/types/api";
import { todayIsoDateLy } from "@/lib/date-format";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized } from "@/lib/i18n";
import { getPatientRequirementReasonCodes, getPatientRequirementStaffMessage } from "@/lib/patient-requirement-messages";
import { pushToast } from "@/lib/toast";
import { Button, Card, Input, Badge, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, SectionLabel } from "@/components/shared";
import { PatientDrawer } from "@/components/patients/patient-drawer";

type QueueView = "all" | "entered" | "not_entered" | "walk_in";

interface PatientRequirementAlert {
  message: string;
  patientId: number | null;
  appointmentId: number | null;
}

const PATIENT_REQUIREMENT_CODES = new Set([
  "patient_phone_required",
  "patient_primary_identifier_required",
]);

function isPatientRequirementError(error: unknown): boolean {
  return getPatientRequirementReasonCodes(error).some((code) => PATIENT_REQUIREMENT_CODES.has(code));
}

function getPatientRequirementDetails(error: unknown): { patientId: number | null; appointmentId: number | null } {
  const details = (error as { details?: unknown } | null)?.details;
  if (!details || typeof details !== "object") {
    return { patientId: null, appointmentId: null };
  }

  const record = details as Record<string, unknown>;
  return {
    patientId: typeof record.patientId === "number" ? record.patientId : null,
    appointmentId: typeof record.appointmentId === "number" ? record.appointmentId : null,
  };
}

function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" && message ? message : null;
  }
  return null;
}

function formatClockValue(language: string, value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(language === "ar" ? "ar-LY" : "en-GB", {
    timeZone: "Africa/Tripoli",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatElapsedSince(language: string, value: string | null | undefined): string {
  if (!value) return "—";
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return language === "ar" ? `${hours}س ${remainingMinutes}د` : `${hours}h ${remainingMinutes}m`;
}

export default function QueuePage() {
  const { language, t } = useLanguage();
  const [scanValue, setScanValue] = useState("");
  const [walkInSearch, setWalkInSearch] = useState("");
  const [walkInResults, setWalkInResults] = useState<Patient[]>([]);
  const [selectedWalkIn, setSelectedWalkIn] = useState<Patient | null>(null);
  const [selectedModalityId, setSelectedModalityId] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueView, setQueueView] = useState<QueueView>("all");
  const [queueModalityId, setQueueModalityId] = useState("");
  const [showOldNoShows, setShowOldNoShows] = useState(false);
  const [scanWarning, setScanWarning] = useState<string | null>(null);
  const [patientRequirementAlert, setPatientRequirementAlert] = useState<PatientRequirementAlert | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScanEntryRef = useRef<QueueEntry | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Fetch modalities for walk-in form
  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const modalities = lookups?.modalities ?? [];
  const { data: queueArrivalSettings } = useQuery({
    queryKey: ["settings", "queue_and_arrival"],
    queryFn: () => fetchSettings("queue_and_arrival"),
    staleTime: 1000 * 60 * 5
  });
  const walkInSettingRaw = String(queueArrivalSettings?.walk_in_queue ?? "disabled").trim().toLowerCase();
  const isWalkInEnabled = queueArrivalSettings != null && ["enabled", "on", "true", "yes", "1"].includes(walkInSettingRaw);

  // Debounced patient search
  const debouncedPatientSearch = useCallback((query: string) => {
    if (searchTimerRef.current !== null) {
      clearTimeout(searchTimerRef.current);
    }

    searchTimerRef.current = setTimeout(() => {
      searchPatients(query).then(setWalkInResults).catch(console.error);
      searchTimerRef.current = null;
    }, 300);
  }, []);

  const handleWalkInSearch = (query: string) => {
    setWalkInSearch(query);
    if (query.length > 1) {
      debouncedPatientSearch(query);
    } else {
      setWalkInResults([]);
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
    }
  };

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchTimerRef.current !== null) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const { data: queue, dataUpdatedAt, isFetching } = useQuery<QueueSnapshot>({
    queryKey: ["queue"],
    queryFn: fetchQueueSnapshot,
    refetchInterval: 1000 * 10
  });

  const scanMutation = useMutation({
    mutationFn: scanIntoQueue,
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: () => {
      setScanValue("");
      pendingScanEntryRef.current = null;
      setPatientRequirementAlert(null);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      pushToast({
        type: "success",
        title: t("queue.scanSuccess"),
        message: t("queue.scanSuccess")
      });
    },
    onError: (err) => {
      const requirementMessage = getPatientRequirementStaffMessage(err, t);
      if (requirementMessage && isPatientRequirementError(err)) {
        const details = getPatientRequirementDetails(err);
        const entry = pendingScanEntryRef.current;
        setPatientRequirementAlert({
          message: requirementMessage,
          patientId: details.patientId ?? entry?.patientId ?? null,
          appointmentId: details.appointmentId ?? entry?.appointmentId ?? null,
        });
      }

      pushToast({
        type: "error",
        title: t("queue.scanFailed"),
        message: requirementMessage || getErrorMessage(err) || t("queue.scanFailed")
      });
    }
  });

  const walkInMutation = useMutation({
    mutationFn: addWalkIn,
    meta: {
      suppressGlobalToast: true
    },
    onSuccess: () => {
      setSelectedWalkIn(null);
      setWalkInSearch("");
      setWalkInResults([]);
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      pushToast({
        type: "success",
        title: t("queue.walkInSuccess"),
        message: t("queue.walkInSuccess")
      });
    },
    onError: (err) => {
      pushToast({
        type: "error",
        title: t("queue.walkInError"),
        message: getPatientRequirementStaffMessage(err, t) || (err instanceof Error ? err.message : t("queue.walkInError"))
      });
    }
  });

  const cancelMutation = useMutation({
    mutationFn: ({ appointmentId }: { appointmentId: number }) =>
      cancelAppointment(appointmentId, "Cancelled from queue"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      pushToast({
        type: "success",
        title: t("queue.cancelledTitle"),
        message: t("queue.cancelledMessage")
      });
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: t("queue.cancelFailedTitle"),
        message: getErrorMessage(err) || t("queue.cancelFailedMessage")
      });
    }
  });

  const handleScan = (e: FormEvent) => {
    e.preventDefault();
    const cleanScanValue = scanValue.trim();
    if (cleanScanValue) {
      const existingEntry = (queue?.queueEntries ?? []).find(
        (entry) => normalizeText(entry.accessionNumber) === normalizeText(cleanScanValue)
      );
      if (existingEntry && ["arrived", "waiting"].includes(existingEntry.appointmentStatus)) {
        const warning = chooseLocalized(
          language,
          "تم تسجيل حضور هذا الموعد بالفعل.",
          "This accession is already checked in."
        );
        setScanWarning(warning);
        pushToast({
          type: "info",
          title: chooseLocalized(language, "تم تسجيل الحضور بالفعل", "Already checked in"),
          message: warning
        });
        return;
      }
      setScanWarning(null);
      pendingScanEntryRef.current = null;
      scanMutation.mutate(cleanScanValue);
    }
  };

  const handleEnterQueue = (entry: QueueEntry) => {
    pendingScanEntryRef.current = entry;
    scanMutation.mutate(entry.accessionNumber);
  };

  const handleWalkInSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (selectedWalkIn && selectedModalityId) {
      walkInMutation.mutate({
        patientId: selectedWalkIn.id,
        modalityId: selectedModalityId,
        appointmentDate: todayIsoDateLy(),
        isWalkIn: true
      });
    } else if (!selectedModalityId) {
      pushToast({
        type: "error",
        title: t("queue.walkInError"),
        message: t("queue.selectModality")
      });
    }
  };

  const handleNoShow = (appointmentId: number) => {
    navigate(`/queue/no-shows?appointmentId=${appointmentId}`);
  };

  const handleCancel = (appointmentId: number) => {
    if (!window.confirm(t("common.confirmCancelAppointment"))) return;
    cancelMutation.mutate({ appointmentId });
  };
  const normalizeText = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const modalityKey = (nameAr: unknown, nameEn: unknown) => `${normalizeText(nameAr)}|${normalizeText(nameEn)}`;
  const queueSearchTerm = normalizeText(queueSearch);
  const filteredQueueEntries = (queue?.queueEntries ?? []).filter((entry) => {
    if (queueView === "entered" && entry.appointmentStatus === "scheduled") return false;
    if (queueView === "not_entered" && entry.appointmentStatus !== "scheduled") return false;
    if (queueView === "walk_in" && !entry.isWalkIn) return false;
    if (queueModalityId && modalityKey(entry.modalityNameAr, entry.modalityNameEn) !== queueModalityId) return false;
    if (!queueSearchTerm) return true;

    return [
      entry.accessionNumber,
      entry.queueNumber,
      entry.arabicFullName,
      entry.englishFullName,
      entry.phone1,
      entry.nationalId,
      entry.modalityNameAr,
      entry.modalityNameEn,
      entry.examNameAr,
      entry.examNameEn,
      entry.notes,
    ].some((value) => normalizeText(value).includes(queueSearchTerm));
  });
  const enteredQueueEntries = filteredQueueEntries.filter((entry) => entry.appointmentStatus !== "scheduled");
  const notEnteredQueueEntries = filteredQueueEntries.filter((entry) => entry.appointmentStatus === "scheduled");
  const queueEntries = queue?.queueEntries ?? [];
  const enteredCount = queueEntries.filter((entry) => entry.appointmentStatus !== "scheduled").length;
  const notEnteredCount = queueEntries.filter((entry) => entry.appointmentStatus === "scheduled").length;
  const walkInCount = queueEntries.filter((entry) => entry.isWalkIn).length;
  const oldNoShowCandidates: QueueSnapshot["oldNoShowCandidates"] = [];
  const hasActiveFilters = !!queueSearch || queueView !== "all" || !!queueModalityId;
  const lastUpdatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(language === "ar" ? "ar-LY" : "en", { hour: "2-digit", minute: "2-digit" })
    : t("queue.lastUpdatedUnknown");
  const enteredQueueLabel = language === "ar" ? "دخلوا إلى قائمة الإنتظار" : "Entered Queue";
  const notEnteredQueueLabel = language === "ar" ? "المريض لم يصل بعد" : "Not Entered Yet";
  const scheduledLabel = language === "ar" ? "مجدول" : "Scheduled";
  const walkInLabel = language === "ar" ? "دخول مباشر" : "Walk-in";
  const clearQueueFilters = () => {
    setQueueSearch("");
    setQueueView("all");
    setQueueModalityId("");
  };
  const filteredEmptyMessage = chooseLocalized(
    language,
    "لا يوجد مرضى يطابقون عوامل التصفية الحالية.",
    "No patients match the current filters."
  );
  const filteredClearLabel = chooseLocalized(language, "مسح عوامل التصفية", "Clear filters");
  const checkedInEmptyMessage = chooseLocalized(
    language,
    "لا يوجد مرضى مسجلو الحضور بعد. امسح رقم الوصول أو أدخل مريضاً مجدولاً.",
    "No checked-in patients yet. Scan an accession or check in a scheduled patient."
  );
  const notCheckedInEmptyMessage = chooseLocalized(
    language,
    "لا يوجد مرضى مجدولون بانتظار تسجيل الحضور.",
    "No scheduled patients are waiting for check-in."
  );
  const openRegistration = (entry: QueueEntry) => {
    navigate(`/registrations?appointmentId=${entry.appointmentId}&patientId=${entry.patientId}`);
  };
  const openPatientRequirementRegistration = () => {
    if (!patientRequirementAlert?.patientId) return;
    const params = new URLSearchParams();
    if (patientRequirementAlert.appointmentId) {
      params.set("appointmentId", String(patientRequirementAlert.appointmentId));
    }
    params.set("patientId", String(patientRequirementAlert.patientId));
    navigate(`/registrations?${params.toString()}`);
  };
  const relatedAppointmentLabel = (appointment: NonNullable<QueueEntry["relatedAppointments"]>[number]) => {
    const modality = chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn);
    const exam = chooseLocalized(language, appointment.examNameAr, appointment.examNameEn);
    return [modality, exam].filter(Boolean).join(" ") || appointment.accessionNumber || t("queue.relatedAppointmentFallback", { id: appointment.appointmentId });
  };
  const getStatusLabel = (entry: QueueEntry, inQueue: boolean) => {
    if (!inQueue) return scheduledLabel;
    if (entry.appointmentStatus === "arrived") return chooseLocalized(language, "تم النداء", "Called");
    if (entry.appointmentStatus === "waiting") return chooseLocalized(language, "في الانتظار", "Waiting");
    if (entry.appointmentStatus === "in-progress") return chooseLocalized(language, "قيد التنفيذ", "In progress");
    if (entry.appointmentStatus === "completed") return chooseLocalized(language, "مكتمل", "Completed");
    if (entry.appointmentStatus === "no-show") return chooseLocalized(language, "غياب", "No-show");
    if (entry.appointmentStatus === "cancelled") return chooseLocalized(language, "ملغي", "Cancelled");
    return entry.queueStatus;
  };
  const renderQueueEntry = (entry: QueueSnapshot["queueEntries"][number], inQueue: boolean) => {
    const arrivedAt = entry.arrivedAt ?? entry.scannedAt ?? null;
    const relatedAppointmentHint = (entry.relatedAppointments ?? [])
      .filter((appointment) => appointment.appointmentId !== entry.appointmentId)
      .map(relatedAppointmentLabel)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    return (
    <li key={entry.id} className="p-4 flex flex-col gap-3 hover:bg-muted/50 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-start font-medium text-lg underline-offset-2 hover:text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
              onClick={() => setSelectedPatientId(entry.patientId)}
            >
              {chooseLocalized(language, entry.arabicFullName, entry.englishFullName)}
            </button>
            {entry.hasMultipleAppointments && (
              <Badge variant="info" size="sm">
                {t("queue.multipleAppointments", { count: entry.sameDayAppointmentCount ?? entry.relatedAppointments?.length ?? 0 })}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-mono">#{entry.queueNumber} - {entry.accessionNumber}</p>
          {inQueue && arrivedAt ? (
            <p className="text-xs text-muted-foreground">
              {chooseLocalized(language, "دخل: ", "Entered: ")}
              {" "}
              {formatClockValue(language, arrivedAt)}
              <span className="px-1">•</span>
              {chooseLocalized(language, "الانتظار: ", "Waiting: ")}
              {" "}
              {formatElapsedSince(language, arrivedAt)}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {chooseLocalized(language, entry.modalityNameAr, entry.modalityNameEn)}
            {entry.examNameEn || entry.examNameAr ? ` • ${chooseLocalized(language, entry.examNameAr, entry.examNameEn)}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {entry.phone1 || t("queue.noId")} • {entry.nationalId || t("queue.noId")}
          </p>
          {entry.hasMultipleAppointments && relatedAppointmentHint && (
            <p className="text-sm text-muted-foreground">
              {t("queue.alsoToday", { items: relatedAppointmentHint })}
            </p>
          )}
          {entry.notes && <p className="text-sm text-muted-foreground">{entry.notes}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={inQueue ? "warning" : "neutral"}
            size="sm"
          >
            {getStatusLabel(entry, inQueue)}
          </Badge>
          {entry.isWalkIn && <Badge size="sm">{walkInLabel}</Badge>}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openRegistration(entry)}
          >
            <ExternalLink size={14} />
            {t("queue.manageRegistration")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedPatientId(entry.patientId)}
          >
            <UserRound size={14} />
            {t("queue.patientProfile")}
          </Button>
          {!inQueue && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleEnterQueue(entry)}
              disabled={scanMutation.isPending}
            >
              {scanMutation.isPending ? t("common.loading") : t("queue.enterToQueue")}
            </Button>
          )}
          {queue?.reviewActive && !queue?.autoNoShowEnabled && entry.appointmentStatus === "scheduled" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleNoShow(entry.appointmentId)}
            >
              Review no-show
            </Button>
          )}
          {["scheduled", "arrived", "waiting"].includes(entry.appointmentStatus) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleCancel(entry.appointmentId)}
            >
              {t("queue.cancelAppointment")}
            </Button>
          )}
        </div>
      </div>
    </li>
    );
  };
  const renderNoShowCandidate = (candidate: QueueSnapshot["noShowCandidates"][number], oldCandidate = false) => (
    <li key={`${oldCandidate ? "old" : "today"}-${candidate.appointmentId}`} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <button
          type="button"
          className="text-start font-medium underline-offset-2 hover:text-accent hover:underline"
          onClick={() => setSelectedPatientId(candidate.patientId)}
        >
          {chooseLocalized(language, candidate.arabicFullName, candidate.englishFullName)}
        </button>
        <p className="text-sm text-muted-foreground font-mono">
          {candidate.appointmentDate} - {candidate.accessionNumber}
        </p>
        <p className="text-sm text-muted-foreground">
          {chooseLocalized(language, candidate.modalityNameAr, candidate.modalityNameEn)}
          {candidate.phone1 ? ` • ${candidate.phone1}` : ""}
        </p>
      </div>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => navigate(`/queue/no-shows?appointmentId=${candidate.appointmentId}`)}
      >
        {t("queue.markNoShow")}
      </Button>
    </li>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="space-y-3 sm:space-y-4">
        <SectionLabel pulsing>{t("queue.managementLabel")}</SectionLabel>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display" style={{ color: "var(--foreground)" }}>
              <span className="gradient-text">{t("queue.pageTitle")}</span>
            </h1>
            <p className="mt-2 text-muted-foreground">{t("queue.pageSubtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{queue?.queueDate ?? todayIsoDateLy()}</span>
            <span>{t("queue.lastUpdated")}: {lastUpdatedLabel}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["queue"] })}
              disabled={isFetching}
            >
              <RefreshCw size={14} className={isFetching ? "animate-spin" : undefined} />
              {t("queue.refresh")}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <QueueStat label={t("queue.totalAppointments")} value={queue?.summary.total_appointments ?? queueEntries.length} />
        <QueueStat label={enteredQueueLabel} value={enteredCount} tone="amber" />
        <QueueStat label={notEnteredQueueLabel} value={notEnteredCount} />
        <QueueStat label={walkInLabel} value={walkInCount} tone="sky" />
      </div>

      <Card className="p-4" role="region" aria-label="No-show review status">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">No-show review</h2>
            <p className="text-sm text-muted-foreground">
              {!queue?.reviewActive
                ? `Review has not opened yet. It opens at ${queue?.reviewTime ?? "17:00"} Africa/Tripoli time.`
                : queue.autoNoShowEnabled
                  ? "Automatic processing is active; the server worker runs even when this page is closed."
                  : "Manual confirmation is active. Review eligible appointments in the dedicated workspace."}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => navigate("/queue/no-shows")}>Open review workspace</Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5" role="region" aria-label={t("queue.scanAccession")}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{t("queue.scanAccession")}</h3>
            <form onSubmit={handleScan} className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                type="text"
                value={scanValue}
                onChange={(e) => {
                  setScanValue(e.target.value);
                  if (scanWarning) setScanWarning(null);
                }}
                placeholder={t("queue.scanPlaceholder")}
                dir="ltr"
                className="h-11 flex-1"
              />
              <Button type="submit" disabled={scanMutation.isPending || !scanValue.trim()} className="h-11">
                {scanMutation.isPending ? t("common.loading") : t("queue.scan")}
              </Button>
            </form>
            {scanWarning ? (
              <p className="mt-2 text-sm font-medium text-amber-700">{scanWarning}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => window.open("/queue/check-in", "_blank", "noopener,noreferrer")}
          >
            {t("queue.openFullScreenCheckIn")}
          </Button>
        </div>
      </Card>

      {isWalkInEnabled && (
        <Card className="p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
            <div>
              <h3 className="text-lg font-semibold">{t("queue.walkInPatient")}</h3>
              <div className="relative mt-3">
                <Input
                  type="text"
                  value={walkInSearch}
                  onChange={(e) => handleWalkInSearch(e.target.value)}
                  placeholder={t("queue.walkInSearch")}
                  className="w-full"
                />
                {walkInResults.length > 0 && (
                  <ul className="absolute z-10 w-full mt-1 bg-card border border-border rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {walkInResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedWalkIn(p);
                            setWalkInResults([]);
                            setWalkInSearch(chooseLocalized(language, p.arabicFullName, p.englishFullName));
                          }}
                          className="w-full text-start p-3 hover:bg-muted/50 transition-colors"
                        >
                          <p className="font-medium">
                            {chooseLocalized(language, p.arabicFullName, p.englishFullName)}
                          </p>
                          <p className="text-xs text-muted-foreground">{p.nationalId || t("queue.noId")}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selectedWalkIn && (
                <p className="mt-2 text-sm font-medium text-accent">
                  {t("queue.selected", { name: chooseLocalized(language, selectedWalkIn.arabicFullName, selectedWalkIn.englishFullName) })}
                </p>
              )}
            </div>
            <label className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {t("queue.selectModality")}
              </span>
              <select
                value={selectedModalityId}
                onChange={(e) => setSelectedModalityId(e.target.value)}
                className="input-premium h-10 w-full"
              >
                <option value="">{t("queue.chooseModality")}</option>
                {modalities.map((modality) => (
                  <option key={modality.id} value={modality.id}>
                    {chooseLocalized(language, modality.nameAr, modality.nameEn)}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={handleWalkInSubmit} disabled={walkInMutation.isPending || !selectedWalkIn || !selectedModalityId}>
              {walkInMutation.isPending ? t("queue.adding") : t("queue.addToQueue")}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-3">
            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                <Search size={12} />
                {t("queue.searchQueue")}
              </span>
              <Input
                value={queueSearch}
                onChange={(event) => setQueueSearch(event.target.value)}
                placeholder={t("queue.searchQueuePlaceholder")}
                className="h-10"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {t("queue.view")}
              </span>
              <select
                value={queueView}
                onChange={(event) => setQueueView(event.target.value as QueueView)}
                className="input-premium h-10 w-full"
              >
                <option value="all">{t("queue.viewAll")}</option>
                <option value="entered">{enteredQueueLabel}</option>
                <option value="not_entered">{notEnteredQueueLabel}</option>
                <option value="walk_in">{walkInLabel}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                {t("queue.modality")}
              </span>
              <select
                value={queueModalityId}
                onChange={(event) => setQueueModalityId(event.target.value)}
                className="input-premium h-10 w-full"
              >
                <option value="">{t("registrations.all")}</option>
                {modalities.map((modality) => (
                  <option key={modality.id} value={modalityKey(modality.nameAr, modality.nameEn)}>
                    {chooseLocalized(language, modality.nameAr, modality.nameEn)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("queue.lastUpdated")}: {lastUpdatedLabel}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["queue"] })}
              disabled={isFetching}
            >
              <RefreshCw size={14} className={isFetching ? "animate-spin" : undefined} />
              {t("queue.refresh")}
            </Button>
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearQueueFilters}>
                {t("calendar.clearFilters")}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {oldNoShowCandidates.length > 0 && (
        <Card className="p-3 sm:p-4 border-amber-200 bg-amber-50/70" role="region" aria-label={chooseLocalized(language, "تنظيف الغياب القديم", "Old no-show cleanup")}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                {chooseLocalized(language, "تنظيف الغياب القديم", "Old no-show cleanup")}
              </h3>
              <p className="text-sm text-amber-800">
                {chooseLocalized(
                  language,
                  `${oldNoShowCandidates.length} موعد قديم مجدول يحتاج مراجعة`,
                  `${oldNoShowCandidates.length} old scheduled appointment${oldNoShowCandidates.length === 1 ? " needs" : "s need"} review`
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowOldNoShows((current) => !current)}>
                {showOldNoShows ? chooseLocalized(language, "إخفاء", "Hide") : chooseLocalized(language, "مراجعة", "Review")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigate("/queue/no-shows");
                }}
                style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.05)" }}
              >
                {chooseLocalized(language, "تأكيد الكل كغياب", "Mark all no-show")}
              </Button>
            </div>
          </div>
          {showOldNoShows ? (
            <ul className="mt-3 divide-y divide-amber-200 rounded-lg border border-amber-200 bg-card max-h-[300px] overflow-y-auto">
              {oldNoShowCandidates.map((candidate) => renderNoShowCandidate(candidate, true))}
            </ul>
          ) : null}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden" role="region" aria-label={chooseLocalized(language, "المواعيد المجدولة بدون حضور", "Scheduled but not checked in")}>
          <div className="p-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{chooseLocalized(language, "المواعيد المجدولة بدون حضور", "Scheduled but not checked in")}</h3>
              <p className="text-sm text-muted-foreground">{notEnteredQueueEntries.length} / {notEnteredCount}</p>
            </div>
          </div>
          {notEnteredQueueEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <p>{hasActiveFilters ? filteredEmptyMessage : notCheckedInEmptyMessage}</p>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" size="sm" onClick={clearQueueFilters} className="mt-3">
                  {filteredClearLabel}
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[620px] overflow-y-auto">
              {notEnteredQueueEntries.map((entry) => renderQueueEntry(entry, false))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden" role="region" aria-label={chooseLocalized(language, "مسجلو الحضور / في الانتظار", "Checked in / waiting")}>
          <div className="p-4 border-b border-border flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{chooseLocalized(language, "مسجلو الحضور / في الانتظار", "Checked in / waiting")}</h3>
              <p className="text-sm text-muted-foreground">{enteredQueueEntries.length} / {enteredCount}</p>
            </div>
            {queue ? (
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{t("queue.waiting", { count: queue.summary.waiting_count })}</span>
                <span>{t("queue.noShows", { count: queue.summary.no_show_count })}</span>
              </div>
            ) : null}
          </div>
          {enteredQueueEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <p>{hasActiveFilters ? filteredEmptyMessage : checkedInEmptyMessage}</p>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" size="sm" onClick={clearQueueFilters} className="mt-3">
                  {filteredClearLabel}
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-border max-h-[620px] overflow-y-auto">
              {enteredQueueEntries.map((entry) => renderQueueEntry(entry, true))}
            </ul>
          )}
        </Card>
      </div>
      {selectedPatientId ? (
        <PatientDrawer patientId={selectedPatientId} onClose={() => setSelectedPatientId(null)} />
      ) : null}
      <Dialog open={!!patientRequirementAlert} onClose={() => setPatientRequirementAlert(null)}>
        <DialogContent
          maxWidth="560px"
          role="dialog"
          aria-modal="true"
          aria-labelledby="queue-patient-requirement-title"
          className="border-red-300 bg-red-50 text-red-950"
        >
          {patientRequirementAlert ? (
            <>
              <DialogHeader>
                <DialogTitle id="queue-patient-requirement-title" className="text-lg text-red-950">
                  {t("common.validationError")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm font-semibold leading-6">{patientRequirementAlert.message}</p>
                <p className="text-sm leading-6">{t("queue.requirements.completeMissingData")}</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setPatientRequirementAlert(null)}>
                  {t("common.dismiss")}
                </Button>
                {patientRequirementAlert.patientId ? (
                  <Button type="button" variant="secondary" onClick={openPatientRequirementRegistration}>
                    <ExternalLink size={14} />
                    {t("queue.requirements.editPatientInformation")}
                  </Button>
                ) : null}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
     </div>
  );
}

function QueueStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "amber" | "sky";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-border bg-muted/30 text-foreground";

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      <p className="text-[10px] font-mono uppercase tracking-[0.12em] opacity-75">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
