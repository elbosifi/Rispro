import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="92" viewBox="0 0 ${totalWidth} 92" preserveAspectRatio="none">
      <rect width="${totalWidth}" height="92" fill="#ffffff"/>
      ${bars.map((bar) => `<rect x="${bar.x}" y="4" width="${bar.w}" height="84" fill="#111111"/>`).join("")}
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function printAppointmentSlip(apt: AppointmentWithDetails): void {
  void printAppointmentSlipInternal(apt);
}

async function printAppointmentSlipInternal(apt: AppointmentWithDetails): Promise<void> {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const barcodeUrl = generateBarcodeDataUri(apt.accessionNumber || `V2-${apt.id}`);

  const CALIBRATION = {
    pageWidthMm: 148,
    pageHeightMm: 210,
    offsetXmm: 0,
    offsetYmm: 0,
    topBlankMm: 58,
    bottomBlankMm: 56,
    leftInsetMm: 10,
    rightInsetMm: 10,
    contentPaddingMm: 3,
  } as const;

  const contentWidthMm = CALIBRATION.pageWidthMm - CALIBRATION.leftInsetMm - CALIBRATION.rightInsetMm;
  const contentHeightMm = CALIBRATION.pageHeightMm - CALIBRATION.topBlankMm - CALIBRATION.bottomBlankMm;
  const rows = [
    { label: "Patient Name", value: apt.englishFullName || apt.arabicFullName || "—" },
    { label: "MRN / Patient ID", value: apt.mrn || apt.nationalId || "—" },
    { label: "Appointment No.", value: apt.accessionNumber || `V2-${apt.id}` },
    { label: "Modality", value: apt.modalityNameAr || apt.modalityNameEn || "—" },
    { label: "Exam", value: apt.examNameAr || apt.examNameEn || "—" },
    { label: "Date", value: formatSlipDate(apt.appointmentDate) },
  ];
  const notesText =
    apt.notes ||
    apt.modalityGeneralInstructionEn ||
    apt.modalityGeneralInstructionAr;

  printWindow.document.write(`
    <html>
      <head>
        <title>Appointment Slip</title>
        <style>
          :root {
            --page-width-mm: ${CALIBRATION.pageWidthMm}mm;
            --page-height-mm: ${CALIBRATION.pageHeightMm}mm;
            --offset-x-mm: ${CALIBRATION.offsetXmm}mm;
            --offset-y-mm: ${CALIBRATION.offsetYmm}mm;
            --top-blank-mm: ${CALIBRATION.topBlankMm}mm;
            --bottom-blank-mm: ${CALIBRATION.bottomBlankMm}mm;
            --left-inset-mm: ${CALIBRATION.leftInsetMm}mm;
            --right-inset-mm: ${CALIBRATION.rightInsetMm}mm;
            --content-width-mm: ${contentWidthMm}mm;
            --content-height-mm: ${contentHeightMm}mm;
            --content-padding-mm: ${CALIBRATION.contentPaddingMm}mm;
          }
          @page { size: 148mm 210mm; margin: 0; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            width: var(--page-width-mm);
            height: var(--page-height-mm);
            font-family: Arial, Helvetica, sans-serif;
            color: #000000;
            background: #ffffff;
          }
          .page {
            position: relative;
            width: var(--page-width-mm);
            height: var(--page-height-mm);
            overflow: hidden;
          }
          .content-box {
            position: absolute;
            left: calc(var(--left-inset-mm) + var(--offset-x-mm));
            top: calc(var(--top-blank-mm) + var(--offset-y-mm));
            width: var(--content-width-mm);
            height: var(--content-height-mm);
            padding: var(--content-padding-mm);
            overflow: hidden;
            color: #000000;
          }
          .content-inner {
            width: 100%;
            height: 100%;
            display: grid;
            grid-template-rows: auto auto 1fr auto;
            gap: 1.3mm;
          }
          .row-list {
            display: grid;
            grid-template-rows: repeat(6, 1fr);
            gap: 0.9mm;
            min-height: 37mm;
          }
          .row {
            display: grid;
            grid-template-columns: 36mm 1fr;
            align-items: center;
            min-height: 5.4mm;
            border-bottom: 0.2mm solid #d7d7d7;
          }
          .label {
            font-size: 3.1mm;
            font-weight: 600;
            color: #000000;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding-right: 2mm;
          }
          .value {
            font-size: 3.3mm;
            font-weight: 700;
            color: #000000;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .notes {
            border: 0.2mm solid #d7d7d7;
            padding: 1.6mm;
            min-height: 12mm;
            max-height: 16mm;
            overflow: hidden;
          }
          .notes-title {
            margin: 0 0 0.8mm;
            font-size: 3.1mm;
            font-weight: 700;
          }
          .notes-text {
            margin: 0;
            font-size: 2.9mm;
            line-height: 1.25;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            overflow: hidden;
          }
          .barcode-block {
            align-self: end;
            width: 100%;
          }
          .barcode-caption {
            margin: 0 0 1mm;
            text-align: center;
            font-size: 3.4mm;
            font-weight: 700;
            text-transform: none;
          }
          .barcode {
            width: 100%;
            height: 13mm;
            display: block;
            border: 0.2mm solid #d7d7d7;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="content-box">
            <div class="content-inner">
              <div class="row-list">
                ${rows
                  .map(
                    (row) => `
                      <div class="row">
                        <div class="label">${escapeHtml(row.label)}</div>
                        <div class="value">${escapeHtml(row.value)}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
              ${
                notesText
                  ? `
                <div class="notes">
                  <p class="notes-title">Notes / Preparation</p>
                  <p class="notes-text">${escapeHtml(notesText)}</p>
                </div>
              `
                  : ``
              }
              <div></div>
              <div class="barcode-block">
                <p class="barcode-caption">Scan to Enter The Queue</p>
                <img class="barcode" src="${escapeHtml(barcodeUrl)}" alt="Queue barcode" />
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
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
