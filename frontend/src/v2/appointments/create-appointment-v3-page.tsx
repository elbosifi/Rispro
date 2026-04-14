import { createV2Booking, evaluateV2Scheduling, useV2Lookups, useV2SpecialReasonCodes } from "./api";
import { CreateAppointmentTab } from "./components/CreateAppointmentTab";

const FLAG_ENABLED = String(import.meta.env.VITE_ENABLE_APPOINTMENTS_V3_CREATE ?? "false").toLowerCase() === "true";

export function AppointmentsV3CreatePage() {
  const lookups = useV2Lookups();
  const specialReasons = useV2SpecialReasonCodes();

  if (!FLAG_ENABLED) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Appointments V3 (Internal)</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted, #64748b)" }}>
          V3 create workflow is disabled. Enable <code>VITE_ENABLE_APPOINTMENTS_V3_CREATE=true</code> for controlled rollout.
        </p>
      </div>
    );
  }

  if (lookups.isLoading) {
    return <div style={{ padding: 24 }}>Loading V3 booking lookups...</div>;
  }

  if (lookups.isError) {
    return <div style={{ padding: 24, color: "#dc2626" }}>Failed to load lookups: {(lookups.error as Error)?.message}</div>;
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24, display: "grid", gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Appointments V3 - Create Appointment</h1>
      <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: 13 }}>
        Controlled replacement path: this route is internal and non-default until parity and scenario validation are signed off.
      </p>

      <CreateAppointmentTab
        patientLookups={{}}
        modalityOptions={lookups.data?.modalities ?? []}
        examTypeOptions={[]}
        specialReasonOptions={specialReasons.data ?? []}
        schedulingEngineEnabled
        onCreateAppointment={createV2Booking}
        onEvaluateAvailability={evaluateV2Scheduling}
        onSupervisorOverride={async () => {
          // Backend booking endpoint remains the authoritative source for supervisor authentication.
          return { ok: true };
        }}
      />

      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>
        Special reason code is stored as audit metadata and does not define independent scheduling policy behavior.
      </div>
    </div>
  );
}
