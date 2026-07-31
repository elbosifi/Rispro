import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, ChevronRight, ClipboardList, Pencil, Printer, X } from "lucide-react";
import { authorizePatientNoShowBooking } from "@/lib/api-hooks";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { statusLabel, t } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import { useAuth } from "@/providers/auth-provider";
import { Badge, Button } from "@/components/shared";
import { RequestComparisonModal } from "@/components/patients/request-comparison-modal";
import { PatientSummaryContent } from "@/components/patients/patient-summary-content";
import { patientDirectorySummaryQueryKey, usePatientDirectorySummary } from "@/components/patients/patient-summary-formatters";

export function PatientDrawer({ patientId, onClose }: { patientId: number; onClose: () => void }) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isRtl = language === "ar";
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const canRequestComparison = ["receptionist", "administrative", "modality_staff", "doctor", "supervisor", "super_admin"].includes(user?.role || "");
  const patientQuery = usePatientDirectorySummary(patientId);
  const authorizeNoShow = useMutation({
    mutationFn: (reason: string) => authorizePatientNoShowBooking(patientId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: patientDirectorySummaryQueryKey(patientId) });
      pushToast({ type: "success", title: language === "ar" ? "تم السماح بالحجز" : "Booking authorized", message: language === "ar" ? "تم رفع تقييد الحجز بعد عدم الحضور." : "No-show booking restriction cleared." });
    },
    onError: (error) => pushToast({ type: "error", title: language === "ar" ? "تعذر السماح بالحجز" : "Authorization failed", message: error instanceof Error ? error.message : "Unable to authorize booking." }),
  });

  const handleAuthorizeNoShow = () => {
    const reason = window.prompt(language === "ar" ? "سبب السماح بالحجز بعد عدم الحضور" : "Reason to authorize booking after no-show");
    if (reason?.trim()) authorizeNoShow.mutate(reason.trim());
  };

  const shell = (content: React.ReactNode, drawerTestId?: string) => (
    <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} data-testid="patient-drawer-backdrop">
      <div className={`fixed inset-y-0 z-[80] flex w-full max-w-md flex-col overflow-hidden bg-background shadow-xl ${isRtl ? "left-0 border-r border-border" : "right-0 border-l border-border"}`} onClick={(event) => event.stopPropagation()} data-testid={drawerTestId}>
        {content}
      </div>
    </div>
  );

  if (patientQuery.isLoading) return shell(<div className="flex flex-1 items-center justify-center"><div className="spinner-industrial h-8 w-8" /></div>);
  if (patientQuery.isError) return shell(<div className="flex flex-1 items-center justify-center p-4 text-center"><div><p className="text-red-500">Failed to load patient details</p><Button variant="outline" size="sm" onClick={onClose} className="mt-2">Close</Button></div></div>);
  if (!patientQuery.data) return null;

  const summary = patientQuery.data;
  const canAuthorizeNoShow = user?.role === "super_admin" || (user?.role === "supervisor" && summary.category !== "non_oncology");
  const lastAppointmentId = summary.lastAppointment?.id ?? null;

  return shell(
    <>
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-lg font-bold">{t(language, "patients.directory.drawer.title")}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t(language, "toast.close")}><X size={18} /></Button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        <PatientSummaryContent
          summary={summary}
          variant="drawer"
          canAuthorizeNoShow={canAuthorizeNoShow}
          authorizeNoShowPending={authorizeNoShow.isPending}
          onAuthorizeNoShow={handleAuthorizeNoShow}
        />
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">{t(language, "patients.directory.drawer.recentAppointments")}</h3>
          {summary.recentAppointments.length === 0 ? <p className="text-sm text-muted-foreground">{t(language, "patients.directory.noAppointments")}</p> : <div className="space-y-2">{summary.recentAppointments.slice(0, 5).map((appointment) => <button key={appointment.id} type="button" onClick={() => navigate(`/registrations?appointmentId=${appointment.id}&patientId=${patientId}`)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 text-start transition-colors hover:border-accent/30 hover:bg-accent/5 focus:outline-none focus:ring-2 focus:ring-accent/30"><div className="min-w-0"><div className="font-medium" dir="ltr">{appointment.date}</div><div className="text-xs text-muted-foreground">{appointment.modalityName}</div></div><div className="flex shrink-0 items-center gap-2"><Badge variant={appointment.status === "completed" ? "success" : appointment.status === "cancelled" ? "error" : "neutral"} size="sm">{statusLabel(language, appointment.status)}</Badge><span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">{t(language, "patients.directory.action.manageRegistration")}<ChevronRight size={14} /></span></div></button>)}</div>}
        </section>
      </div>
      <div className="border-t border-border p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">{t(language, "patients.directory.drawer.quickActions")}</h3>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/edit`)}><Pencil size={14} />{t(language, "patients.directory.action.edit")}</Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/appointments?patientId=${patientId}`)}><CalendarPlus size={14} />{t(language, "patients.directory.action.createAppointment")}</Button>
          {canRequestComparison ? <Button size="sm" variant="outline" onClick={() => setShowComparisonModal(true)}><ClipboardList size={14} />Request comparison</Button> : null}
          {lastAppointmentId != null ? <><Button size="sm" variant="outline" onClick={() => navigate(`/registrations?appointmentId=${lastAppointmentId}&patientId=${patientId}`)}><ChevronRight size={14} />{t(language, "patients.directory.action.manageRegistration")}</Button><Button size="sm" variant="outline" onClick={() => void printAppointmentSlipById(lastAppointmentId, language)}><Printer size={14} />{t(language, "patients.directory.action.print")}</Button></> : null}
        </div>
      </div>
      {showComparisonModal ? <RequestComparisonModal patientId={patientId} onClose={() => setShowComparisonModal(false)} /> : null}
    </>
  );
}
