import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import type { AppointmentWithDetails } from "@/lib/mappers";

function patientName(appointment: AppointmentWithDetails): string {
  return appointment.arabicFullName || appointment.englishFullName || "Patient";
}

export async function createAccessionLabelPdfBlob(
  appointment: AppointmentWithDetails,
  size: { widthMm: number; heightMm: number }
): Promise<Blob> {
  const doc = new jsPDF({ orientation: size.widthMm >= size.heightMm ? "landscape" : "portrait", unit: "mm", format: [size.widthMm, size.heightMm], compress: true });
  const margin = 2;
  const qrSize = Math.max(10, Math.min(size.heightMm - margin * 2, size.widthMm * 0.32));
  const qr = await QRCode.toDataURL(appointment.accessionNumber, { margin: 0, width: 220 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(Math.max(7, Math.min(11, size.heightMm * 0.34)));
  doc.text(patientName(appointment), margin, margin + 4.2, { maxWidth: size.widthMm - qrSize - margin * 3 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(Math.max(6, Math.min(9, size.heightMm * 0.27)));
  const lines = [
    appointment.accessionNumber,
    [appointment.modalityCode || appointment.modalityNameEn, appointment.appointmentDate].filter(Boolean).join("  "),
    appointment.mrn ? `MRN ${appointment.mrn}` : "",
  ].filter(Boolean);
  lines.forEach((line, index) => doc.text(line, margin, margin + 9 + index * 4, { maxWidth: size.widthMm - qrSize - margin * 3 }));
  doc.addImage(qr, "PNG", size.widthMm - qrSize - margin, (size.heightMm - qrSize) / 2, qrSize, qrSize);
  return doc.output("blob");
}

