import { useState, useRef, useCallback, useEffect, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchQueueSnapshot, scanIntoQueue, addWalkIn, confirmNoShow, cancelAppointment, searchPatients, fetchAppointmentLookups, fetchSettings } from "@/lib/api-hooks";
import type { QueueSnapshot, Patient } from "@/types/api";
import { todayIsoDateLy } from "@/lib/date-format";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { Button, Card, Input, Badge, SectionLabel } from "@/components/shared";

export default function QueuePage() {
  const { language, t } = useLanguage();
  const [scanValue, setScanValue] = useState("");
  const [walkInSearch, setWalkInSearch] = useState("");
  const [walkInResults, setWalkInResults] = useState<Patient[]>([]);
  const [selectedWalkIn, setSelectedWalkIn] = useState<Patient | null>(null);
  const [selectedModalityId, setSelectedModalityId] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

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

  const { data: queue } = useQuery<QueueSnapshot>({
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
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      pushToast({
        type: "success",
        title: t("queue.scanSuccess"),
        message: t("queue.scanSuccess")
      });
    },
    onError: (err) => {
      pushToast({
        type: "error",
        title: t("queue.scanFailed"),
        message: err.message || t("queue.scanFailed")
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
    }
  });

  const noShowMutation = useMutation({
    mutationFn: ({ appointmentId, reason }: { appointmentId: number; reason: string }) =>
      confirmNoShow(appointmentId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
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
      scanMutation.mutate(scanValue.trim());
    }
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
  const enteredQueueEntries = queue?.queueEntries.filter((entry) => entry.appointmentStatus !== "scheduled") ?? [];
  const notEnteredQueueEntries = queue?.queueEntries.filter((entry) => entry.appointmentStatus === "scheduled") ?? [];
  const enteredQueueLabel = language === "ar" ? "دخلوا إلى قائمة الإنتظار" : "Entered Queue";
  const notEnteredQueueLabel = language === "ar" ? "المريض لم يصل بعد" : "Not Entered Yet";
  const scheduledLabel = language === "ar" ? "مجدول" : "Scheduled";
  const walkInLabel = language === "ar" ? "دخول مباشر" : "Walk-in";
  const renderQueueEntry = (entry: QueueSnapshot["queueEntries"][number], inQueue: boolean) => (
    <li key={entry.id} className="p-4 flex flex-col gap-3 hover:bg-muted/50 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div>
          <p className="font-medium text-lg">
            {chooseLocalized(language, entry.arabicFullName, entry.englishFullName)}
          </p>
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
     </div>
  );
}
