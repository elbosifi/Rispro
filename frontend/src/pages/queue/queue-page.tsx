import { useState, useRef, useCallback, useEffect, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ExternalLink, RefreshCw, Search, UserRound } from "lucide-react";
import { fetchQueueSnapshot, scanIntoQueue, addWalkIn, confirmNoShow, confirmAllOldNoShows, cancelAppointment, searchPatients, fetchAppointmentLookups, fetchSettings } from "@/lib/api-hooks";
import type { QueueEntry, QueueSnapshot, Patient } from "@/types/api";
import { todayIsoDateLy } from "@/lib/date-format";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized } from "@/lib/i18n";
import { getPatientRequirementReasonCodes, getPatientRequirementStaffMessage } from "@/lib/patient-requirement-messages";
import { pushToast } from "@/lib/toast";
import { Button, Card, Input, Badge, SectionLabel } from "@/components/shared";
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
  return error instanceof Error ? error.message : null;
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

  const noShowMutation = useMutation({
    mutationFn: ({ appointmentId, reason }: { appointmentId: number; reason: string }) =>
      confirmNoShow(appointmentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    }
  });
  const oldNoShowBulkMutation = useMutation({
    mutationFn: (reason: string) => confirmAllOldNoShows(reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      pushToast({
        type: "success",
        title: chooseLocalized(language, "تم تأكيد الغياب", "No-shows confirmed"),
        message: chooseLocalized(language, "تم تحديث مواعيد الغياب القديمة.", "Old no-show candidates were updated.")
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
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: t("queue.cancelFailedTitle"),
        message: err?.message || t("queue.cancelFailedMessage")
      });
    }
  });

  const handleScan = (e: FormEvent) => {
    e.preventDefault();
    if (scanValue.trim()) {
      pendingScanEntryRef.current = null;
      scanMutation.mutate(scanValue.trim());
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
    noShowMutation.mutate({ appointmentId, reason: t("queue.noShowReason") });
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
  const oldNoShowCandidates = queue?.oldNoShowCandidates ?? [];
  const lastUpdatedLabel = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString(language === "ar" ? "ar-LY" : "en", { hour: "2-digit", minute: "2-digit" })
    : t("queue.lastUpdatedUnknown");
  const enteredQueueLabel = language === "ar" ? "دخلوا إلى قائمة الإنتظار" : "Entered Queue";
  const notEnteredQueueLabel = language === "ar" ? "المريض لم يصل بعد" : "Not Entered Yet";
  const scheduledLabel = language === "ar" ? "مجدول" : "Scheduled";
  const walkInLabel = language === "ar" ? "دخول مباشر" : "Walk-in";
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
  const renderQueueEntry = (entry: QueueSnapshot["queueEntries"][number], inQueue: boolean) => (
    <li key={entry.id} className="p-4 flex flex-col gap-3 hover:bg-muted/50 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <button
            type="button"
            className="text-start font-medium text-lg underline-offset-2 hover:text-accent hover:underline focus:outline-none focus:ring-2 focus:ring-accent/30"
            onClick={() => setSelectedPatientId(entry.patientId)}
          >
            {chooseLocalized(language, entry.arabicFullName, entry.englishFullName)}
          </button>
          <p className="text-sm text-muted-foreground font-mono">#{entry.queueNumber} - {entry.accessionNumber}</p>
          <p className="text-sm text-muted-foreground">
            {chooseLocalized(language, entry.modalityNameAr, entry.modalityNameEn)}
            {entry.examNameEn || entry.examNameAr ? ` • ${chooseLocalized(language, entry.examNameAr, entry.examNameEn)}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {entry.phone1 || t("queue.noId")} • {entry.nationalId || t("queue.noId")}
          </p>
          {entry.notes && <p className="text-sm text-muted-foreground">{entry.notes}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={inQueue ? "warning" : "neutral"}
            size="sm"
          >
            {inQueue ? entry.queueStatus : scheduledLabel}
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
          {queue?.reviewActive && entry.appointmentStatus === "scheduled" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleNoShow(entry.appointmentId)}
              style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.05)" }}
            >
              {t("queue.markNoShow")}
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
        variant="secondary"
        onClick={() => noShowMutation.mutate({
          appointmentId: candidate.appointmentId,
          reason: oldCandidate
            ? chooseLocalized(language, "تأكيد غياب قديم من قائمة التنظيف", "Old no-show cleanup confirmation")
            : t("queue.noShowReason"),
        })}
        disabled={noShowMutation.isPending}
        style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.05)" }}
      >
        {t("queue.markNoShow")}
      </Button>
    </li>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-3 sm:space-y-4 lg:hidden">
        <div className="flex items-center gap-4">
          <SectionLabel pulsing>{t("queue.managementLabel")}</SectionLabel>
        </div>
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display" style={{ color: "var(--foreground)" }}>
              <span className="gradient-text">{t("queue.pageTitle")}</span>
            </h1>
            <p className="mt-2 text-muted-foreground">
              {t("queue.pageSubtitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <QueueStat label={t("queue.totalAppointments")} value={queue?.summary.total_appointments ?? queueEntries.length} />
        <QueueStat label={enteredQueueLabel} value={enteredCount} tone="amber" />
        <QueueStat label={notEnteredQueueLabel} value={notEnteredCount} />
        <QueueStat label={walkInLabel} value={walkInCount} tone="sky" />
      </div>

      {patientRequirementAlert ? (
        <Card className="border-red-300 bg-red-50 p-4 text-red-900 shadow-sm sm:p-5" role="alert">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t("common.validationError")}</h2>
              <p className="text-sm font-medium">{patientRequirementAlert.message}</p>
              <p className="text-sm">{t("queue.requirements.completeMissingData")}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {patientRequirementAlert.patientId ? (
                <Button type="button" variant="secondary" onClick={openPatientRequirementRegistration}>
                  <ExternalLink size={14} />
                  {t("queue.manageRegistration")}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={() => setPatientRequirementAlert(null)}>
                {t("common.dismiss")}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
         <div className="space-y-4">
           <Card className="p-4 sm:p-5">
             <h3 className="text-lg font-semibold mb-4">{t("queue.scanAccession")}</h3>
             <div className="mb-3">
               <Button
                 type="button"
                 variant="secondary"
                 size="sm"
                 onClick={() => window.open("/queue/check-in", "_blank", "noopener,noreferrer")}
               >
                 {t("queue.openFullScreenCheckIn")}
               </Button>
             </div>
             <form onSubmit={handleScan} className="flex gap-2">
               <Input
                 type="text"
                 value={scanValue}
                 onChange={(e) => setScanValue(e.target.value)}
                 placeholder={t("queue.scanPlaceholder")}
                 dir="ltr"
                 className="flex-1"
               />
               <Button type="submit" disabled={scanMutation.isPending || !scanValue.trim()}>
                 {t("queue.scan")}
               </Button>
             </form>
           </Card>

           {isWalkInEnabled && (
           <Card className="p-4 sm:p-5">
             <h3 className="text-lg font-semibold mb-4">{t("queue.walkInPatient")}</h3>
            <div className="relative mb-4">
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
              <div className="mb-4 p-4 border-accent/30 rounded-xl" style={{ background: "rgba(0, 82, 255, 0.05)" }}>
                <p className="text-sm font-medium text-accent">
                  {t("queue.selected", { name: chooseLocalized(language, selectedWalkIn.arabicFullName, selectedWalkIn.englishFullName) })}
                </p>
              </div>
            )}
            
            {/* Modality Selector */}
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2 text-foreground">
                {t("queue.selectModality")}
              </label>
              <select
                value={selectedModalityId}
                onChange={(e) => setSelectedModalityId(e.target.value)}
                className="input-premium w-full"
              >
                <option value="">{t("queue.chooseModality")}</option>
                {modalities.map((modality) => (
                  <option key={modality.id} value={modality.id}>
                    {chooseLocalized(language, modality.nameAr, modality.nameEn)}
                  </option>
                ))}
              </select>
            </div>
            
             <Button variant="secondary" onClick={handleWalkInSubmit} disabled={walkInMutation.isPending || !selectedWalkIn || !selectedModalityId} className="w-full">
               {walkInMutation.isPending ? t("queue.adding") : t("queue.addToQueue")}
             </Button>
           </Card>
           )}
         </div>

         <div className="lg:col-span-2">
           <Card className="mb-4 p-3 sm:p-4">
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
                 {(queueSearch || queueView !== "all" || queueModalityId) && (
                   <Button
                     type="button"
                     variant="ghost"
                     size="sm"
                     onClick={() => {
                       setQueueSearch("");
                       setQueueView("all");
                       setQueueModalityId("");
                     }}
                   >
                     {t("calendar.clearFilters")}
                   </Button>
                 )}
               </div>
             </div>
           </Card>
           <Card className="overflow-hidden mb-4">
             <div className="p-4 border-b border-border flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
               <div>
                 <h3 className="text-lg sm:text-xl font-semibold">
                   {chooseLocalized(language, "تنظيف الغياب القديم", "Old no-show cleanup")}
                 </h3>
                 <p className="text-sm text-muted-foreground">
                   {chooseLocalized(
                     language,
                     `مواعيد مجدولة أقدم من ${queue?.autoNoShowCleanupDays ?? 1} يوم`,
                     `Scheduled appointments older than ${queue?.autoNoShowCleanupDays ?? 1} day(s)`
                   )}
                 </p>
               </div>
               <div className="flex flex-wrap gap-2">
                 <Button
                   type="button"
                   variant="secondary"
                   size="sm"
                   onClick={() => setShowOldNoShows((current) => !current)}
                 >
                   {showOldNoShows
                     ? chooseLocalized(language, "إخفاء", "Hide")
                     : chooseLocalized(language, `عرض (${oldNoShowCandidates.length})`, `Show (${oldNoShowCandidates.length})`)}
                 </Button>
                 {oldNoShowCandidates.length > 0 && (
                   <Button
                     type="button"
                     variant="secondary"
                     size="sm"
                     disabled={oldNoShowBulkMutation.isPending}
                     onClick={() => {
                       if (!window.confirm(chooseLocalized(language, "تأكيد كل المواعيد القديمة كغياب؟", "Mark all old candidates as no-show?"))) return;
                       oldNoShowBulkMutation.mutate(chooseLocalized(language, "تأكيد جماعي للغياب القديم", "Bulk old no-show cleanup confirmation"));
                     }}
                     style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)", backgroundColor: "rgba(239, 68, 68, 0.05)" }}
                   >
                     {chooseLocalized(language, "تأكيد الكل كغياب", "Mark all no-show")}
                   </Button>
                 )}
               </div>
             </div>
             {showOldNoShows ? (
               oldNoShowCandidates.length === 0 ? (
                 <div className="p-8 text-center text-muted-foreground">{t("queue.empty")}</div>
               ) : (
                 <ul className="divide-y divide-border max-h-[360px] overflow-y-auto">
                   {oldNoShowCandidates.map((candidate) => renderNoShowCandidate(candidate, true))}
                 </ul>
               )
             ) : null}
           </Card>
           <Card className="overflow-hidden mb-4">
             <div className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
               <h3 className="text-lg sm:text-xl font-semibold">{t("queue.todayQueue")} - {enteredQueueLabel}</h3>
               {queue && (
                 <div className="flex gap-4 text-sm text-muted-foreground">
                   <span>{t("queue.waiting", { count: queue.summary.waiting_count })}</span>
                   <span>{t("queue.noShows", { count: queue.summary.no_show_count })}</span>
                 </div>
               )}
             </div>

             {enteredQueueEntries.length === 0 ? (
               <div className="p-12 text-center text-muted-foreground">{t("queue.empty")}</div>
             ) : (
               <ul className="divide-y divide-border max-h-[600px] overflow-y-auto">
                 {enteredQueueEntries.map((entry) => renderQueueEntry(entry, true))}
               </ul>
             )}
           </Card>
           <Card className="overflow-hidden">
             <div className="p-4 border-b border-border">
               <h3 className="text-lg sm:text-xl font-semibold">{t("queue.todayQueue")} - {notEnteredQueueLabel}</h3>
             </div>
             {notEnteredQueueEntries.length === 0 ? (
               <div className="p-8 text-center text-muted-foreground">{t("queue.empty")}</div>
             ) : (
               <ul className="divide-y divide-border max-h-[450px] overflow-y-auto">
                 {notEnteredQueueEntries.map((entry) => renderQueueEntry(entry, false))}
               </ul>
             )}
           </Card>
         </div>
       </div>
      {selectedPatientId ? (
        <PatientDrawer patientId={selectedPatientId} onClose={() => setSelectedPatientId(null)} />
      ) : null}
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
