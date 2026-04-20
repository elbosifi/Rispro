import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { Button, Card } from "@/components/shared";

interface Props {
  appointmentSummary: {
    bookingId: number;
    patientId: number | null;
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
    <Card className="p-6" style={{ background: "rgba(34, 197, 94, 0.1)" }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: "var(--green)" }}>
        Appointment Created Successfully
      </h3>
      <div className="space-y-2 mb-6">
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">Patient:</span> {appointmentSummary.patientName}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">Date:</span> {appointmentSummary.bookingDate}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">Modality:</span> {appointmentSummary.modalityName}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">Exam Type:</span> {appointmentSummary.examTypeName || "—"}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">Mode:</span> {appointmentSummary.wasOverride ? "Supervisor override" : "Standard"}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 mb-6">
        <Button type="button" variant="secondary" onClick={onPrintSlip}>Print Slip</Button>
        <Button type="button" variant="secondary" onClick={onViewDetails}>View Details</Button>
        <Button type="button" variant="primary" onClick={onCreateAnother}>Create Another</Button>
      </div>
      <div>
        <RequestDocumentsPanel
          appointmentId={appointmentSummary.bookingId}
          patientId={appointmentSummary.patientId}
          appointmentRefType="v2_booking"
          title="Attach Request (Later)"
        />
      </div>
    </Card>
  );
}
