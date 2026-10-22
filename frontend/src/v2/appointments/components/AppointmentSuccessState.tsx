import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { MessageCircle } from "lucide-react";
import { MriPrimaryScreeningBadges } from "@/components/appointments/mri-primary-screening-badges";
import { Button } from "@/components/shared";

interface Props {
  appointmentSummary: {
    bookingId: number;
    patientId: number | null;
    patientName: string;
    bookingDate: string;
    modalityName: string;
    examTypeName?: string | null;
    wasOverride: boolean;
    publicAppointmentUrl?: string | null;
    mriPrimaryScreeningResult?: "no_known_implant_reported" | "implant_reported_review_required" | null;
  };
  onPrintView: () => void;
  onPrintNow: () => void;
  printNowDisabled?: boolean;
  onSendWhatsapp?: () => void;
  onCreateAnother: () => void;
  onViewDetails: () => void;
}

export function AppointmentSuccessState({
  appointmentSummary,
  onPrintView,
  onPrintNow,
  printNowDisabled = false,
  onSendWhatsapp,
  onCreateAnother,
  onViewDetails,
}: Props) {
  const { language } = useLanguage();
  const publicAppointmentUrl = String(appointmentSummary.publicAppointmentUrl || "").trim();
  return (
    <div className="card-shell p-6" style={{ borderColor: "var(--state-success-border)", boxShadow: "var(--shadow-sm)" }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: "var(--state-success-text)" }}>
        {t(language, "appointments.create.successTitle")}
      </h3>
      <div className="space-y-2 mb-6 rounded-lg border border-border bg-muted/30 p-4">
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
      {appointmentSummary.mriPrimaryScreeningResult ? <div className="mb-6"><MriPrimaryScreeningBadges result={appointmentSummary.mriPrimaryScreeningResult} /></div> : null}
      <div className="grid grid-cols-1 gap-2 mb-6 sm:grid-cols-2">
        <Button type="button" variant="secondary" className="px-6" onClick={onPrintView}>{t(language, "appointments.create.printView")}</Button>
        <Button type="button" variant="secondary" className="px-6" onClick={onPrintNow} disabled={printNowDisabled}>{t(language, "appointments.create.printNow")}</Button>
        {publicAppointmentUrl ? (
          <Button
            type="button"
            variant="secondary"
            className="px-6"
            onClick={() => window.open(publicAppointmentUrl, "_blank", "noopener,noreferrer")}
          >
            {t(language, "registrations.viewAppointmentLink")}
          </Button>
        ) : null}
        {onSendWhatsapp ? (
          <Button
            type="button"
            variant="secondary"
            className="inline-flex items-center gap-2 px-6"
            onClick={onSendWhatsapp}
            style={{ backgroundColor: "#25D366", borderColor: "#25D366", color: "#fff" }}
          >
            <MessageCircle className="h-4 w-4" />
            {t(language, "registrations.whatsappOpen")}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" className="px-6" onClick={onViewDetails}>{t(language, "appointments.create.viewDetails")}</Button>
        <Button type="button" className="px-6" onClick={onCreateAnother}>{t(language, "appointments.create.createAnother")}</Button>
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
