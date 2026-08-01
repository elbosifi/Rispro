import { jsPDF } from "jspdf";
import type { PrinterProfile } from "@/types/printing";

export function createPrinterTestPdfBlob(profile: PrinterProfile, generatedAt = new Date()): Blob {
  const doc = new jsPDF({ orientation: profile.paperWidthMm >= profile.paperHeightMm ? "landscape" : "portrait", unit: "mm", format: [profile.paperWidthMm, profile.paperHeightMm], compress: false });
  const margin = Math.min(8, Math.max(2, Math.min(profile.paperWidthMm, profile.paperHeightMm) * 0.06));
  const lineHeight = Math.min(7, Math.max(2.5, (profile.paperHeightMm - margin * 2) / 8));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(Math.min(14, Math.max(6, lineHeight * 2.2)));
  doc.text("RISpro printer test", margin, margin + lineHeight);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(Math.min(10, Math.max(5, lineHeight * 1.65)));
  const lines = [
    `Queue: ${profile.printerName}`,
    `Profile: ${profile.documentType}`,
    `Paper: ${profile.paperWidthMm} x ${profile.paperHeightMm} mm`,
    `Orientation: ${profile.orientation}`,
    `Custom media: ${profile.customPaperSize ? "yes" : "no"}`,
    `Rasterize: ${profile.rasterize ? "yes" : "no"}`,
    `Generated: ${generatedAt.toISOString()}`,
  ];
  lines.forEach((line, index) => doc.text(line, margin, margin + lineHeight * (index + 2), { maxWidth: profile.paperWidthMm - margin * 2 }));
  return doc.output("blob");
}
