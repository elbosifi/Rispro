import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { containsArabic, drawPdfText, ensureArabicPdfFonts, processPdfText } from "@/lib/pdf-text-utils";

function patientName(appointment: AppointmentWithDetails): string {
  return appointment.arabicFullName || appointment.englishFullName || "Patient";
}

export async function createAccessionLabelPdfBlob(
  appointment: AppointmentWithDetails,
  size: { widthMm: number; heightMm: number }
): Promise<Blob> {
  const doc = new jsPDF({ orientation: size.widthMm >= size.heightMm ? "landscape" : "portrait", unit: "mm", format: [size.widthMm, size.heightMm], compress: true });
  await ensureArabicPdfFonts(doc);
  const margin = 2;
  const qrSize = Math.max(10, Math.min(size.heightMm - margin * 2, size.widthMm * 0.32));
  const qr = await QRCode.toDataURL(appointment.accessionNumber, { margin: 0, width: 220 });
  const name = patientName(appointment);
  doc.setFontSize(Math.max(7, Math.min(11, size.heightMm * 0.34)));
  const textWidth = size.widthMm - qrSize - margin * 3;
  let displayName = name;
  doc.setFont("NotoNaskhArabic", "bold");
  while (displayName.length > 2 && doc.getTextWidth(processPdfText(doc, `${displayName}…`)) > textWidth) displayName = displayName.slice(0, -1);
  if (displayName !== name) displayName = `${displayName.trimEnd()}…`;
  drawPdfText(doc, displayName, containsArabic(name) ? margin + textWidth : margin, margin + 4.2, { align: containsArabic(name) ? "right" : "left", bold: true, maxWidth: textWidth });
  doc.setFontSize(Math.max(6, Math.min(9, size.heightMm * 0.27)));
  const lines = [
    appointment.accessionNumber,
    [appointment.modalityCode || appointment.modalityNameEn, appointment.appointmentDate].filter(Boolean).join("  "),
    appointment.mrn ? `MRN ${appointment.mrn}` : "",
  ].filter(Boolean);
  lines.forEach((line, index) => drawPdfText(doc, line, margin, margin + 9 + index * 4, { maxWidth: textWidth }));
  doc.addImage(qr, "PNG", size.widthMm - qrSize - margin, (size.heightMm - qrSize) / 2, qrSize, qrSize);
  return doc.output("blob");
}
