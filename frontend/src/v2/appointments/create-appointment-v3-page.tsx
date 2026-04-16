import { createV2Booking, evaluateV2Scheduling, useV2Lookups, useV2SpecialReasonCodes, useV2Priorities } from "./api";
import { CreateAppointmentTab } from "./components/CreateAppointmentTab";
import { useAuth } from "@/providers/auth-provider";

export function AppointmentsV3CreatePage() {
  const { user } = useAuth();
  const lookups = useV2Lookups();
  const specialReasons = useV2SpecialReasonCodes();
  const priorities = useV2Priorities();

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
        Primary appointment creation workflow.
      </p>

      <CreateAppointmentTab
        patientLookups={{}}
        modalityOptions={lookups.data?.modalities ?? []}
        examTypeOptions={[]}
        specialReasonOptions={specialReasons.data ?? []}
        priorityOptions={priorities.data ?? []}
        schedulingEngineEnabled
        canUseNonStandardCapacityModes={user?.role === "supervisor"}
        onCreateAppointment={createV2Booking}
        onEvaluateAvailability={evaluateV2Scheduling}
      />

      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
        Special reason code is stored as audit metadata and does not define independent scheduling policy behavior.
      </div>
    </div>
  );
}
