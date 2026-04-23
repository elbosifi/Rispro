import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

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
  const { language } = useLanguage();
  return (
    <div className="card-shell p-6" style={{ background: "rgba(34, 197, 94, 0.1)" }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: "var(--green)" }}>
        {t(language, "appointments.create.successTitle")}
      </h3>
      <div className="space-y-2 mb-6">
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">{t(language, "appointments.create.patient")}:</span> {appointmentSummary.patientName}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">{t(language, "appointments.create.date")}:</span> {appointmentSummary.bookingDate}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">{t(language, "appointments.create.modality")}:</span> {appointmentSummary.modalityName}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">{t(language, "appointments.create.examType")}:</span> {appointmentSummary.examTypeName || "—"}
        </div>
        <div className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-bold">{t(language, "appointments.create.mode")}:</span> {appointmentSummary.wasOverride ? t(language, "appointments.create.supervisorOverride") : t(language, "appointments.create.standard")}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 mb-6">
        <button type="button" className="btn-secondary" onClick={onPrintSlip}>{t(language, "common.print")}</button>
        <button type="button" className="btn-secondary" onClick={onViewDetails}>{t(language, "appointments.create.viewDetails")}</button>
        <button type="button" className="btn-primary" onClick={onCreateAnother}>{t(language, "appointments.create.createAnother")}</button>
      </div>
      <div>
        <RequestDocumentsPanel
          appointmentId={appointmentSummary.bookingId}
          patientId={appointmentSummary.patientId}
          appointmentRefType="v2_booking"
          title={t(language, "documents.attachRequest")}
          enableLocalScan
        />
      </div>
    </div>
  );
}
