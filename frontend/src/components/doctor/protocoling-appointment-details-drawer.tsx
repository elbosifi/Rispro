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

type DoctorReadOnlyDetailsDrawerProps = {
  patientId: number;
  appointmentId?: number | null;
  initialTab?: DetailsTab;
  patientLabel?: string | null;
  placement?: "contained" | "viewport";
  onClose: () => void;
};

function DrawerUnavailable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert"><p>{message}</p><button type="button" onClick={onRetry} className="mt-2 rounded border border-red-300 px-2 py-1 text-xs font-semibold">Retry</button></div>;
}

export function DoctorReadOnlyDetailsDrawer({
  patientId,
  appointmentId = null,
  initialTab,
  patientLabel,
  placement = "contained",
  onClose,
}: DoctorReadOnlyDetailsDrawerProps) {
  const hasAppointment = appointmentId !== null;
  const [activeTab, setActiveTab] = useState<DetailsTab>(hasAppointment ? initialTab ?? "appointment" : "patient");
  const appointmentQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointment-details", appointmentId],
    queryFn: () => getAppointmentById(appointmentId as number),
    enabled: hasAppointment,
    staleTime: 30_000,
  });
  const patientQuery = usePatientDirectorySummary(patientId);
  const fullAppointment = appointmentQuery.data as AppointmentWithDetails | undefined;
  const resolvedPatientLabel = patientLabel || `Patient ${patientId}`;
  const contained = placement === "contained";

  return <>
    <button type="button" aria-label="Close appointment and patient details" className={`${contained ? "absolute z-30" : "fixed z-[70]"} inset-0 cursor-default bg-black/10`} onClick={onClose} />
    <aside className={`${contained ? "absolute z-40" : "fixed z-[71]"} inset-y-0 end-0 flex w-full max-w-[520px] min-w-0 flex-col border-s bg-background shadow-2xl sm:w-[480px]`} role="complementary" aria-label={hasAppointment ? "Appointment and patient details" : "Patient details"} data-testid={contained ? "protocoling-details-drawer" : "doctor-read-only-details-drawer"}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="min-w-0"><h2 className="truncate text-base font-semibold">{hasAppointment ? "Appointment & patient details" : "Patient details"}</h2><p className="mt-0.5 truncate text-xs text-muted-foreground">{resolvedPatientLabel}</p></div>
        <button type="button" onClick={onClose} className="rounded border p-1.5" aria-label="Close appointment and patient details" title="Close"><X size={17} aria-hidden="true" /></button>
      </header>
      {hasAppointment ? <div className="flex shrink-0 gap-1 border-b px-3 py-2" role="tablist" aria-label="Details sections" style={{ borderColor: "var(--border)" }}>
        {([ ["appointment", "Appointment"], ["patient", "Patient"] ] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`rounded px-3 py-1.5 text-sm font-semibold ${activeTab === tab ? "bg-accent/10 text-accent" : "text-muted-foreground"}`}>{label}</button>)}
      </div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {hasAppointment && activeTab === "appointment" ? <>
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

export function ProtocolingAppointmentDetailsDrawer({ appointment, onClose }: { appointment: DoctorProtocolingAppointment; onClose: () => void }) {
  return <DoctorReadOnlyDetailsDrawer
    patientId={appointment.patientId}
    appointmentId={appointment.appointmentId}
    initialTab="appointment"
    patientLabel={appointment.patientEnglishName || appointment.patientArabicName || appointment.patientMrn}
    placement="contained"
    onClose={onClose}
  />;
}
