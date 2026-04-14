interface Props {
  appointmentSummary: {
    patientName: string;
    bookingDate: string;
    modalityName: string;
    examTypeName?: string | null;
    wasOverride: boolean;
  };
  onPrintSlip: () => void;
  onCreateAnother: () => void;
  onViewDetails: () => void;
}

export function AppointmentSuccessState({ appointmentSummary, onPrintSlip, onCreateAnother, onViewDetails }: Props) {
  return (
    <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 10, padding: 16 }}>
      <h3 style={{ margin: 0, color: "#15803d", fontSize: 16 }}>Appointment Created Successfully</h3>
      <div style={{ marginTop: 8, fontSize: 13, color: "#166534" }}>
        <div>Patient: {appointmentSummary.patientName}</div>
        <div>Date: {appointmentSummary.bookingDate}</div>
        <div>Modality: {appointmentSummary.modalityName}</div>
        <div>Exam Type: {appointmentSummary.examTypeName || "—"}</div>
        <div>Mode: {appointmentSummary.wasOverride ? "Supervisor override" : "Standard"}</div>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={onPrintSlip}>Print Slip</button>
        <button type="button" onClick={onViewDetails}>View Details</button>
        <button type="button" onClick={onCreateAnother}>Create Another</button>
      </div>
    </div>
  );
}
