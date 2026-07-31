import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { getAppointmentById } from "@/lib/api-hooks";
import { AppointmentDetailsReadOnly } from "@/components/appointments/appointment-information-view";
import { PatientSummaryContent } from "@/components/patients/patient-summary-content";
import { usePatientDirectorySummary } from "@/components/patients/patient-summary-formatters";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { DoctorProtocolingAppointment } from "@/types/api";

type DetailsTab = "appointment" | "patient";

function DrawerUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert"><p>{message}</p><button type="button" onClick={onRetry} className="mt-2 rounded border border-red-300 px-2 py-1 text-xs font-semibold">Retry</button></div>;
}

export function ProtocolingAppointmentDetailsDrawer({ appointment, onClose }: { appointment: DoctorProtocolingAppointment; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<DetailsTab>("appointment");
  const appointmentQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointment-details", appointment.appointmentId],
    queryFn: () => getAppointmentById(appointment.appointmentId),
    staleTime: 30_000,
  });
  const patientQuery = usePatientDirectorySummary(appointment.patientId);
  const fullAppointment = appointmentQuery.data as AppointmentWithDetails | undefined;

  return <>
    <button type="button" aria-label="Close appointment and patient details" className="absolute inset-0 z-30 cursor-default bg-black/10" onClick={onClose} />
    <aside className="absolute inset-y-0 end-0 z-40 flex w-full max-w-[520px] min-w-0 flex-col border-s bg-background shadow-2xl sm:w-[480px]" role="complementary" aria-label="Appointment and patient details" data-testid="protocoling-details-drawer">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0"><h2 className="truncate text-base font-semibold">Appointment &amp; patient details</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{appointment.patientEnglishName || appointment.patientArabicName || appointment.patientMrn || `Patient ${appointment.patientId}`}</p></div>
        <button type="button" onClick={onClose} className="rounded border p-1.5" aria-label="Close appointment and patient details" title="Close"><X size={17} aria-hidden="true" /></button>
      </header>
      <div className="flex shrink-0 gap-1 border-b px-3 py-2" role="tablist" aria-label="Details sections" style={{ borderColor: "var(--border)" }}>
        {([ ["appointment", "Appointment"], ["patient", "Patient"] ] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === tab ? "bg-accent/10 text-accent" : "text-muted-foreground"}`}>{label}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {activeTab === "appointment" ? <>
          {appointmentQuery.isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading appointment details...</p> : null}
          {appointmentQuery.isError ? <DrawerUnavailable message="Appointment details are unavailable right now." onRetry={() => void appointmentQuery.refetch()} /> : null}
          {fullAppointment ? <AppointmentDetailsReadOnly appointment={fullAppointment} readOnly /> : null}
          {!appointmentQuery.isLoading && !appointmentQuery.isError && !fullAppointment ? <p className="text-sm text-muted-foreground">Appointment details are unavailable.</p> : null}
        </> : <>
          {patientQuery.isLoading ? <p className="text-sm text-muted-foreground" role="status">Loading patient details...</p> : null}
          {patientQuery.isError ? <DrawerUnavailable message="Patient details are unavailable right now." onRetry={() => void patientQuery.refetch()} /> : null}
          {patientQuery.data ? <PatientSummaryContent summary={patientQuery.data} variant="drawer" /> : null}
          {!patientQuery.isLoading && !patientQuery.isError && !patientQuery.data ? <p className="text-sm text-muted-foreground">Patient details are unavailable.</p> : null}
        </>}
      </div>
    </aside>
  </>;
}
