import { createV2Booking, evaluateV2Scheduling, useV2Lookups, useV2SpecialReasonCodes, useV2Priorities } from "./api";
import { CreateAppointmentTab } from "./components/CreateAppointmentTab";
import { useAuth } from "@/providers/auth-provider";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPatientById } from "@/lib/api-hooks";
import type { SelectedPatient } from "./hooks/useCreateAppointmentForm";

export function AppointmentsV3CreatePage() {
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get("patientId");
  const { user } = useAuth();
  const lookups = useV2Lookups();
  const specialReasons = useV2SpecialReasonCodes();
  const priorities = useV2Priorities();
  const parsedPatientId = urlPatientId ? Number(urlPatientId) : null;
  const hasValidPatientId = Number.isInteger(parsedPatientId) && (parsedPatientId as number) > 0;

  const preloadPatientQuery = useQuery({
    queryKey: ["patient-by-id", parsedPatientId],
    queryFn: () => fetchPatientById(parsedPatientId as number),
    enabled: hasValidPatientId,
    staleTime: 1000 * 60 * 5
  });

  const initialSelectedPatient: SelectedPatient | null = preloadPatientQuery.data
    ? {
        id: preloadPatientQuery.data.id,
        arabicFullName: preloadPatientQuery.data.arabicFullName,
        englishFullName: preloadPatientQuery.data.englishFullName,
        identifierType: preloadPatientQuery.data.identifierType,
        identifierValue: preloadPatientQuery.data.identifierValue,
        nationalId: preloadPatientQuery.data.nationalId,
        mrn: preloadPatientQuery.data.mrn,
        sex: preloadPatientQuery.data.sex,
        ageYears: preloadPatientQuery.data.ageYears,
        demographicsEstimated: preloadPatientQuery.data.demographicsEstimated
      }
    : null;

  if (lookups.isLoading) {
    return <div style={{ padding: 24 }}>Loading booking lookups...</div>;
  }

  if (lookups.isError) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Failed to load lookups: {(lookups.error as Error)?.message}</div>;
  }

  if (priorities.isLoading) {
    return <div style={{ padding: 24 }}>Loading priorities...</div>;
  }

  if (priorities.isError) {
    return (
      <div style={{ padding: 24, color: "#dc2626" }}>
        Failed to load priorities: {(priorities.error as Error)?.message}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24, display: "grid", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Create Appointment</h1>
      <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: 13 }}>
        Primary appointment creation workflow with evaluated capacity and exam-mix visibility.
      </p>

      <CreateAppointmentTab
        patientLookups={{}}
        modalityOptions={lookups.data?.modalities ?? []}
        examTypeOptions={[]}
        specialReasonOptions={specialReasons.data ?? []}
        priorityOptions={priorities.data ?? []}
        schedulingEngineEnabled
        canUseNonStandardCapacityModes={user?.role === "supervisor"}
        initialSelectedPatient={initialSelectedPatient}
        onCreateAppointment={createV2Booking}
        onEvaluateAvailability={evaluateV2Scheduling}
      />

      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
        Special reason code is stored as audit metadata and does not define independent scheduling policy behavior.
      </div>
    </div>
  );
}
