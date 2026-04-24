import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";

function escapeHtml(str: string = ""): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slipField(label: string, value: unknown, rtl = false): string {
  const displayValue = value === null || value === undefined || value === "" ? "—" : String(value);
  return `
    <div class="summary-item ${rtl ? "rtl" : ""}">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${escapeHtml(displayValue)}</span>
    </div>
  `;
}

function slipRow(left: string, right: string): string {
  return `
    <div class="summary-row">
      ${left}
      ${right}
    </div>
  `;
}

function formatSlipDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return formatDateLy(isoDate);
  }
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function generateBarcodeDataUri(value: string): string {
  const clean = value.trim() || "APPOINTMENT";
  const bars: Array<{ x: number; w: number }> = [];
  let x = 16;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const pattern = [1, 2, 1, 3, 2, 1, 2, 3];
    for (let j = 0; j < pattern.length; j += 1) {
      const width = ((code + j * 3) % 3) + pattern[j];
      if (j % 2 === 0) {
        bars.push({ x, w: width });
      }
      x += width + 1;
    }
    x += 3;
  }
  const totalWidth = Math.max(860, x + 16);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="92" viewBox="0 0 ${totalWidth} 92" preserveAspectRatio="xMidYMid meet">
      <rect width="${totalWidth}" height="92" fill="#ffffff"/>
      ${bars.map((bar) => `<rect x="${bar.x}" y="4" width="${bar.w}" height="84" fill="#111111"/>`).join("")}
    </svg>
  `;
}

function normalizeInlineSvg(svg: string): string {
  return svg.replace(/^<\?xml[\s\S]*?\?>\s*/i, "").trim();
}

export interface AppointmentSlipData {
  hospitalName: string;
  departmentName: string;
  patientName: string;
  patientId: string;
  accessionNumber: string;
  modality: string;
  examName: string;
  appointmentDate: string;
  queueQrPayload: string;
  accessionBarcodePayload: string;
}

interface AppointmentSlipRenderData extends AppointmentSlipData {
  modalityInstructions: string;
  examInstructions: string;
  phone: string;
  generatedAt: string;
  arrivalNote: string;
}

type AppointmentSlipPdfMode = "blank" | "preprinted";

const A5_WIDTH_PT = 419.53;
const A5_HEIGHT_PT = 595.28;
const MM_TO_PT = 72 / 25.4;
const PREPRINTED_SAFE_AREA = {
  left: 12 * MM_TO_PT,
  top: 18 * MM_TO_PT,
  right: 12 * MM_TO_PT,
  bottom: 18 * MM_TO_PT,
};

function mm(value: number): number {
  return value * MM_TO_PT;
}

function shorten(value: string, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function wrapLines(doc: jsPDF, value: string, maxWidth: number, maxLines: number): string[] {
  const cleaned = String(value || "").trim();
  if (!cleaned) return ["—"];
  const lines = doc.splitTextToSize(cleaned, maxWidth) as string[];
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = shorten(visible[maxLines - 1], Math.max(12, visible[maxLines - 1].length - 1));
  return visible;
}

function drawBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  options?: { fill?: string; stroke?: string; radius?: number }
) {
  const fill = options?.fill ?? "#ffffff";
  const stroke = options?.stroke ?? "#d1d5db";
  const radius = options?.radius ?? 4;
  doc.setFillColor(fill);
  doc.setDrawColor(stroke);
  doc.roundedRect(x, y, w, h, radius, radius, "FD");
}

function drawLabelValueBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  options?: { labelColor?: string; valueColor?: string; maxLines?: number }
) {
  const labelColor = options?.labelColor ?? "#b11116";
  const valueColor = options?.valueColor ?? "#0f1115";
  const maxLines = options?.maxLines ?? 2;
  drawBox(doc, x, y, w, h, { fill: "#ffffff", stroke: "#d3d4d6", radius: 4 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(labelColor);
  doc.text(shorten(label.toUpperCase(), 24), x + 6, y + 10, { baseline: "top" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(valueColor);
  const valueLines = wrapLines(doc, value, w - 12, maxLines);
  doc.text(valueLines, x + 6, y + 20, { baseline: "top", lineHeightFactor: 1.15 });
}

function buildBarcodeBars(value: string): Array<{ x: number; w: number }> {
  const clean = value.trim() || "APPOINTMENT";
  const bars: Array<{ x: number; w: number }> = [];
  let x = 16;
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    const pattern = [1, 2, 1, 3, 2, 1, 2, 3];
    for (let j = 0; j < pattern.length; j += 1) {
      const width = ((code + j * 3) % 3) + pattern[j];
      if (j % 2 === 0) {
        bars.push({ x, w: width });
      }
      x += width + 1;
    }
    x += 3;
  }
  return bars;
}

async function toDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return toDataUrl(blob);
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await toDataUrl(await response.blob());
  } catch {
    return null;
  }
}

export function buildAppointmentSlipData(apt: AppointmentWithDetails): AppointmentSlipRenderData {
  const token = String(apt.publicCancelToken || "").trim();
  const cancelUrl =
    token.length > 0 ? `${window.location.origin}/public/cancel-appointment?t=${encodeURIComponent(token)}` : "";
  const accession = String(apt.accessionNumber || `V2-${apt.id}`).trim();
  return {
    hospitalName: "National Cancer Center Benghazi",
    departmentName: "Diagnostic Radiology Department",
    patientName: apt.englishFullName || apt.arabicFullName || "—",
    patientId: apt.mrn || apt.nationalId || "—",
    accessionNumber: accession,
    modality: apt.modalityNameEn || "—",
    examName: apt.examNameEn || "—",
    appointmentDate: formatSlipDate(apt.appointmentDate),
    queueQrPayload: cancelUrl || accession,
    accessionBarcodePayload: accession,
    modalityInstructions: String(apt.modalityGeneralInstructionEn || apt.modalityGeneralInstructionAr || "").trim(),
    examInstructions: String(apt.examSpecificInstructionEn || apt.examSpecificInstructionAr || "").trim(),
    phone: apt.phone1 || "—",
    generatedAt: new Date().toLocaleString(),
    arrivalNote: "Please arrive 15 minutes before your appointment",
  };
}

export async function createAppointmentSlipPdfBlob(
  apt: AppointmentWithDetails,
  mode: AppointmentSlipPdfMode = "blank"
): Promise<Blob> {
  const slip = buildAppointmentSlipData(apt);
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: [A5_WIDTH_PT, A5_HEIGHT_PT],
    compress: true,
  });

  // Blank-paper mode uses the full sheet. Preprinted mode stays inside the explicit middle safe area.
  const page = {
    x: 0,
    y: 0,
    w: A5_WIDTH_PT,
    h: A5_HEIGHT_PT,
  };
  const safe = mode === "preprinted"
    ? {
        x: PREPRINTED_SAFE_AREA.left,
        y: PREPRINTED_SAFE_AREA.top,
        w: page.w - PREPRINTED_SAFE_AREA.left - PREPRINTED_SAFE_AREA.right,
        h: page.h - PREPRINTED_SAFE_AREA.top - PREPRINTED_SAFE_AREA.bottom,
      }
    : {
        x: mm(10),
        y: mm(10),
        w: page.w - mm(20),
        h: page.h - mm(20),
      };

  const headerHeight = mode === "blank" ? 82 : 0;
  const qrSize = mode === "blank" ? 64 : 60;
  const barcodeHeight = 36;
  const detailsTop = safe.y + headerHeight + (mode === "blank" ? 8 : 0);
  const detailsLeft = safe.x;
  const detailsWidth = safe.w;
  const columnGap = 8;
  const fieldWidth = (detailsWidth - columnGap) / 2;
  const fieldHeight = 28;
  const rowGap = 4;

  doc.setTextColor("#111827");
  doc.setFillColor("#ffffff");
  doc.rect(page.x, page.y, page.w, page.h, "F");

  if (mode === "blank") {
    const logoDataUrl = await loadImageDataUrl(`${window.location.origin}/assets/nccb-logo.png`);
    if (logoDataUrl) {
      doc.addImage(logoDataUrl, "PNG", safe.x, safe.y, 52, 52);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text("NCCB", safe.x, safe.y + 18);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13.5);
    doc.setTextColor("#b11116");
    doc.text(slip.hospitalName, safe.x + 58, safe.y + 12);
    doc.setFontSize(9.5);
    doc.setTextColor("#1f2937");
    doc.text(slip.departmentName, safe.x + 58, safe.y + 27);
    doc.setFontSize(20);
    doc.setTextColor("#b11116");
    doc.text("APPOINTMENT SLIP", safe.x + 58, safe.y + 52);

    const qrDataUrl = await QRCode.toDataURL(slip.queueQrPayload, { margin: 1, width: 220 });
    doc.setDrawColor("#e2676d");
    doc.setLineWidth(1);
    doc.roundedRect(page.w - safe.x - qrSize - 2, safe.y, qrSize + 2, qrSize + 2, 6, 6, "S");
    doc.addImage(qrDataUrl, "PNG", page.w - safe.x - qrSize - 1, safe.y + 1, qrSize, qrSize);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor("#b11116");
    doc.text("Scan to cancel this appointment", page.w - safe.x - qrSize - 2, safe.y + qrSize + 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor("#374151");
    doc.text("This link is unique to you and your appointment.", page.w - safe.x - qrSize - 2, safe.y + qrSize + 24);
  }

  const rows = [
    { leftLabel: "Patient Name", leftValue: slip.patientName, rightLabel: "MRN / Patient ID", rightValue: slip.patientId },
    { leftLabel: "Appointment No.", leftValue: slip.accessionNumber, rightLabel: "Date", rightValue: slip.appointmentDate },
    { leftLabel: "Modality", leftValue: slip.modality, rightLabel: "Exam", rightValue: slip.examName },
    { leftLabel: "Age / Sex", leftValue: `${apt.ageYears || "—"} / ${apt.sex || "—"}`, rightLabel: "Walk-In", rightValue: apt.isWalkIn ? "Yes" : "No" },
    { leftLabel: "Phone", leftValue: slip.phone, rightLabel: "Arrival", rightValue: slip.arrivalNote },
  ] as const;

  rows.forEach((row, index) => {
    const rowY = detailsTop + index * (fieldHeight + rowGap);
    drawLabelValueBox(doc, detailsLeft, rowY, fieldWidth, fieldHeight, row.leftLabel, row.leftValue, { maxLines: 2 });
    drawLabelValueBox(doc, detailsLeft + fieldWidth + columnGap, rowY, fieldWidth, fieldHeight, row.rightLabel, row.rightValue, { maxLines: 2 });
  });

  const prepTop = detailsTop + rows.length * (fieldHeight + rowGap) + (mode === "blank" ? 4 : 8);
  const prepWidth = detailsWidth;
  if (slip.modalityInstructions || slip.examInstructions) {
    drawBox(doc, detailsLeft, prepTop, prepWidth, mode === "blank" ? 82 : 72, {
      fill: "#ffffff",
      stroke: "#e2676d",
      radius: 6,
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor("#b11116");
    doc.text("Modality Instructions", detailsLeft + 8, prepTop + 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#20242a");
    doc.text(wrapLines(doc, slip.modalityInstructions || "Please follow the department preparation instructions.", prepWidth - 16, 2), detailsLeft + 8, prepTop + 22, {
      baseline: "top",
      lineHeightFactor: 1.15,
    });

    if (slip.examInstructions) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor("#b11116");
      doc.text("Exam Preparation", detailsLeft + 8, prepTop + 48);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor("#20242a");
      doc.text(wrapLines(doc, slip.examInstructions, prepWidth - 16, 2), detailsLeft + 8, prepTop + 60, {
        baseline: "top",
        lineHeightFactor: 1.15,
      });
    }
  }

  if (mode === "blank") {
    const footerY = page.h - safe.y - barcodeHeight - 16;
    doc.setDrawColor("#d3d4d6");
    doc.setLineWidth(0.5);
    doc.line(detailsLeft, footerY - 8, detailsLeft + prepWidth, footerY - 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.25);
    doc.setTextColor("#b11116");
    doc.text("Printed", detailsLeft, footerY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.25);
    doc.setTextColor("#1f2937");
    doc.text(`${slip.generatedAt}`, detailsLeft + 34, footerY);
    doc.text("RISpro", detailsLeft + prepWidth - 34, footerY, { align: "right" });
  }

  const barcodeY = page.h - safe.y - barcodeHeight - (mode === "blank" ? 2 : 0);
  const bars = buildBarcodeBars(slip.accessionBarcodePayload);
  const barPadding = 12;
  const barWidth = page.w - safe.x * 2 - barPadding * 2;
  const scale = barWidth / Math.max(1, bars.at(-1)?.x ?? 1);
  doc.setDrawColor("#b11116");
  doc.setFillColor("#111111");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor("#b11116");
  doc.text("Scan to enter the queue", detailsLeft + prepWidth / 2, barcodeY - 10, { align: "center" });
  doc.setLineWidth(0.5);
  doc.roundedRect(detailsLeft, barcodeY, prepWidth, barcodeHeight, 6, 6, "S");
  const baseX = detailsLeft + barPadding;
  const baseY = barcodeY + 5;
  const barHeight = barcodeHeight - 10;
  for (const bar of bars) {
    doc.rect(baseX + bar.x * scale, baseY, Math.max(0.8, bar.w * scale), barHeight, "F");
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor("#1f2937");
  doc.text(shorten(slip.accessionBarcodePayload, 36), detailsLeft + prepWidth / 2, barcodeY + barcodeHeight + 10, { align: "center" });

  return doc.output("blob");
}

async function waitForImagesToLoad(doc: Document, timeoutMs = 1500): Promise<void> {
  const images = Array.from(doc.images ?? []);
  if (images.length === 0) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let remaining = images.length;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timer = window.setTimeout(finish, timeoutMs);
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) {
        window.clearTimeout(timer);
        finish();
      }
    };

    for (const img of images) {
      if (img.complete) {
        done();
        continue;
      }

      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    }
  });
}

export async function prepareAppointmentSlipHtml(apt: AppointmentWithDetails): Promise<string> {
  const slip = buildAppointmentSlipData(apt);
  let qrSvg: string | null = null;
  if (slip.queueQrPayload) {
    try {
      qrSvg = normalizeInlineSvg(await QRCode.toString(slip.queueQrPayload, { type: "svg", width: 120, margin: 1 }));
    } catch {
      qrSvg = null;
    }
  }
  const logoUrl = `${window.location.origin}/assets/nccb-logo.png`;
  const barcodeSvg = generateBarcodeDataUri(slip.accessionBarcodePayload);
  const now = slip.generatedAt;
  const rows = [
    slipRow(
      slipField("Patient Name", slip.patientName),
      slipField("MRN / Patient ID", slip.patientId)
    ),
    slipRow(
      slipField("Appointment No.", slip.accessionNumber),
      slipField("Date", slip.appointmentDate, true)
    ),
    slipRow(
      slipField("Modality", slip.modality),
      slipField("Exam", slip.examName)
    ),
    slipRow(
      slipField("Phone", slip.phone),
      slipField("Arrival", slip.arrivalNote)
    ),
  ];
  const hasPrepContent = Boolean(slip.modalityInstructions || slip.examInstructions);
  return `
    <html>
      <head>
        <title>Appointment Slip</title>
        <style>
          @page { size: A5 portrait; margin: 4mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1f2937; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sheet {
            width: 100%;
            margin: 0 auto;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 4mm;
            background: #ffffff;
            transform: scale(0.9);
            transform-origin: top center;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .top { display: grid; grid-template-columns: 1fr 114px; gap: 10px; align-items: start; }
          .brand-wrap { display: flex; gap: 8px; align-items: center; }
          .logo { width: 60px; height: 60px; object-fit: contain; }
          .brand-title { color: #b11116; margin: 0; font-size: 18px; font-weight: 800; line-height: 1.05; letter-spacing: -0.2px; }
          .brand-sub { margin: 2px 0 0; font-size: 12px; color: #24272c; }
          .rule { margin-top: 5px; display: flex; align-items: center; gap: 8px; }
          .rule-line { flex: 1; height: 0.35mm; background: #d34f53; opacity: 0.8; }
          .rule-dot { width: 8px; height: 8px; border-radius: 50%; background: #b11116; }
          .slip-title { margin: 6px 0 0; color: #b11116; letter-spacing: 3px; text-transform: uppercase; font-size: 26px; font-weight: 500; }
          .qr-card { border: 1px solid #e2676d; border-radius: 10px; background: #ffffff; padding: 6px; }
          .qr-card svg { width: 100%; display: block; border-radius: 2px; }
          .qr-title { margin-top: 6px; color: #b11116; text-transform: uppercase; font-size: 12px; font-weight: 800; line-height: 1.35; }
          .qr-note { margin-top: 4px; font-size: 10px; color: #2f3135; line-height: 1.35; }
          .rows { margin-top: 8px; border-top: 1px solid #d3d4d6; display: flex; flex-direction: column; gap: 4px; }
          .summary-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .summary-item {
            display: grid;
            grid-template-columns: 108px 1fr;
            align-items: baseline;
            gap: 8px;
            min-height: 34px;
            padding: 5px 6px;
            border: 1px solid #d3d4d6;
            border-radius: 7px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .summary-item .label {
            font-size: 11px;
            color: #b11116;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .summary-item .value {
            font-size: 13px;
            font-weight: 700;
            color: #0f1115;
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .mid-divider { margin: 6px 0 4px; display: flex; align-items: center; gap: 8px; }
          .prep {
            margin-top: 6px;
            display: grid;
            grid-template-columns: 84px 1fr;
            gap: 6px;
            align-items: start;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .prep + .prep { margin-top: 4px; }
          .prep-label {
            color: #b11116;
            font-size: 10px;
            font-weight: 800;
            line-height: 1.25;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .prep-text {
            margin: 0;
            font-size: 11px;
            line-height: 1.25;
            color: #20242a;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
          }
          .meta-strip { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 0; }
          .meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 4px;
            border-right: 1px solid #c7c8cb;
            min-height: 44px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .meta-item:last-child { border-right: none; }
          .meta-icon { width: 24px; height: 24px; border-radius: 50%; border: 1px solid #b11116; color: #b11116; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 10px; }
          .meta-text {
            font-size: 11px;
            line-height: 1.2;
            color: #20242a;
            overflow: hidden;
          }
          .meta-text strong { color: #b11116; }
          .queue {
            margin-top: 7px;
            border: 1px solid #e2676d;
            border-radius: 8px;
            padding: 7px;
            background: #ffffff;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .queue-title { text-align: center; margin: 0 0 3px; color: #b11116; text-transform: uppercase; font-size: 13px; font-weight: 800; letter-spacing: 0.2mm; line-height: 1.08; }
          .queue svg {
            width: auto;
            max-width: 100%;
            height: 40px;
            display: block;
            margin: 0 auto;
          }
          .queue-label { text-align: center; margin: 3px 0 0; font-size: 10px; letter-spacing: 0.08em; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .small-muted { color: #6b7280; font-size: 10px; }
          .rtl { direction: rtl; text-align: right; }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="top">
            <div>
              <div class="brand-wrap">
                <img class="logo" src="${escapeHtml(logoUrl)}" alt="NCCB logo" />
                <div>
                  <p class="brand-title">National Cancer Center Benghazi</p>
                  <p class="brand-sub">Diagnostic Radiology Department</p>
                  <div class="rule">
                    <div class="rule-line"></div>
                    <div class="rule-dot"></div>
                    <div class="rule-line"></div>
                  </div>
                  <h1 class="slip-title">Appointment Slip</h1>
                </div>
              </div>
            </div>
            <div>
              <div class="qr-card">
                ${
                  qrSvg
                    ? `<div class="qr-svg" aria-label="Cancellation QR Code">${qrSvg}</div>`
                    : `<div class="small-muted">QR unavailable</div>`
                }
              </div>
              <div class="qr-title">Scan to cancel this appointment</div>
              <div class="qr-note">This link is unique to you and your appointment.</div>
            </div>
          </div>

          <div class="rows">
            ${rows.join("")}
          </div>

          ${
            hasPrepContent
              ? `
                <div class="prep">
                  <div class="prep-label">Modality Instructions</div>
                  <p class="prep-text">${escapeHtml(slip.modalityInstructions || "Please follow the department preparation instructions.")}</p>
                </div>
                ${
                  slip.examInstructions
                    ? `
                      <div class="prep">
                        <div class="prep-label">Exam Preparation</div>
                        <p class="prep-text">${escapeHtml(slip.examInstructions)}</p>
                      </div>
                    `
                    : ""
                }
              `
              : ""
          }

          <div class="mid-divider">
            <div class="rule-line"></div>
            <div class="rule-dot"></div>
            <div class="rule-line"></div>
          </div>

          <div class="meta-strip">
            <div class="meta-item">
              <span class="meta-icon">T</span>
              <div class="meta-text">${escapeHtml(slip.arrivalNote)}</div>
            </div>
            <div class="meta-item">
              <span class="meta-icon">P</span>
              <div class="meta-text">Phone <strong>${escapeHtml(slip.phone)}</strong></div>
            </div>
            <div class="meta-item">
              <span class="meta-icon">R</span>
              <div class="meta-text">Generated by RISpro<br />Printed: ${escapeHtml(now)}</div>
            </div>
          </div>

          <div class="queue">
            <p class="queue-title">Scan to enter the queue</p>
            <div class="barcode-wrap" aria-label="Queue barcode">${barcodeSvg}</div>
            <p class="queue-label">${escapeHtml(apt.accessionNumber || `V2-${apt.id}`)}</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function getAppointmentSlipFileName(apt: AppointmentWithDetails): string {
  const suffix = String(apt.accessionNumber || `appointment-${apt.id}`)
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `appointment-slip-${suffix || apt.id}.pdf`;
}

export async function downloadAppointmentSlipPdf(apt: AppointmentWithDetails): Promise<void> {
  const blob = await createAppointmentSlipPdfBlob(apt, "blank");
  const fileName = getAppointmentSlipFileName(apt);
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 1000);
}

export function printAppointmentSlip(apt: AppointmentWithDetails): void {
  void printAppointmentSlipInternal(apt);
}

async function printAppointmentSlipInternal(apt: AppointmentWithDetails): Promise<void> {
  const blob = await createAppointmentSlipPdfBlob(apt, "blank");
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.src = url;

  try {
    document.body.appendChild(frame);
    await new Promise<void>((resolve) => {
      frame.addEventListener("load", () => resolve(), { once: true });
    });

    const printWindow = frame.contentWindow;
    if (!printWindow) return;

    await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    printWindow.focus();
    printWindow.print();
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      frame.remove();
    }, 1000);
  }
}

export function printAppointmentList(list: AppointmentWithDetails[], listDate: string): void {
  if (list.length === 0) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const now = new Date().toLocaleString();

  const rows = list
    .map(
      (apt, idx) => `
      <div class="row">
        <div class="arabic"><div class="label">${idx + 1}</div><div class="value">${apt.dailySequence ?? "—"}</div></div>
        <div class="arabic"><div class="label">Patient</div><div class="value">${escapeHtml(apt.arabicFullName)}</div></div>
        <div><div class="label">Accession</div><div class="value">${escapeHtml(apt.accessionNumber)}</div></div>
        <div><div class="label">Date</div><div class="value">${escapeHtml(formatDateLy(apt.appointmentDate))}</div></div>
        <div><div class="label">Modality</div><div class="value">${escapeHtml(apt.modalityNameEn || "—")}</div></div>
        <div><div class="label">Exam</div><div class="value">${escapeHtml(apt.examNameEn || "—")}</div></div>
        <div><div class="label">Priority</div><div class="value">${escapeHtml(apt.priorityNameEn || "Routine")}</div></div>
        <div><div class="label">Status</div><div class="value">${escapeHtml(apt.status || "—")}</div></div>
      </div>
    `
    )
    .join("");

  printWindow.document.write(`
    <html>
      <head>
        <title>Appointment List</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
          .slip { width: 100%; min-height: 100%; border: 1.5px solid #0f766e; border-radius: 12px; padding: 10px; }
          .header { text-align: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #d1d5db; }
          .brand { margin: 0; font-size: 17px; font-weight: 800; color: #0f766e; }
          .title { margin: 3px 0 0; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.14em; }
          .summary { margin: 0 0 8px; font-size: 10px; color: #374151; text-align: center; }
          .row {
            display: grid;
            grid-template-columns: 22mm 2fr 22mm 1fr 22mm 1.1fr 22mm 1.5fr;
            gap: 5px 7px;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 11px;
          }
          .row:nth-child(odd) { background: #f8fafc; }
          .row:nth-child(even) { background: #eef6f5; }
          .label { font-size: 8.5px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
          .value { font-size: 11px; font-weight: 700; color: #111827; word-break: break-word; line-height: 1.25; }
          .arabic { direction: rtl; text-align: right; }
          .footer { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d1d5db; display: flex; justify-content: space-between; gap: 12px; font-size: 8px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="slip">
          <div class="header">
            <p class="brand">RISpro Reception</p>
            <p class="title">Appointment List</p>
          </div>
          <p class="summary">${listDate} — ${list.length} appointments</p>
          ${rows}
          <div class="footer">
            <span>Printed by RISpro</span>
            <span>${escapeHtml(now)}</span>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
