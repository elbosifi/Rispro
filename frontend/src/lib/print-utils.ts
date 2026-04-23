import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import QRCode from "qrcode";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slipField(label: string, value: unknown, rtl = false): string {
  return `
    <div class="field ${rtl ? "rtl" : ""}">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${escapeHtml(value ? String(value) : "—")}</span>
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

function toTitleCase(input: string): string {
  return input
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
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

export function printAppointmentSlip(apt: AppointmentWithDetails): void {
  void printAppointmentSlipInternal(apt);
}

async function printAppointmentSlipInternal(apt: AppointmentWithDetails): Promise<void> {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const token = String(apt.publicCancelToken || "").trim();
  const cancelUrl =
    token.length > 0 ? `${window.location.origin}/public/cancel-appointment?t=${encodeURIComponent(token)}` : null;
  let qrSvg: string | null = null;
  if (cancelUrl) {
    try {
      qrSvg = normalizeInlineSvg(await QRCode.toString(cancelUrl, { type: "svg", width: 120, margin: 1 }));
    } catch {
      qrSvg = null;
    }
  }
  const logoUrl = `${window.location.origin}/assets/nccb-logo.png`;
  const barcodeSvg = generateBarcodeDataUri(apt.accessionNumber || `V2-${apt.id}`);
  const now = new Date().toLocaleString();
  const rawCaseCategory = (apt as { caseCategory?: string }).caseCategory;
  const categoryLabel = rawCaseCategory ? toTitleCase(rawCaseCategory) : "—";
  const appointmentNotes = String(apt.notes || "").trim();
  const modalityPreparation = String(apt.modalityGeneralInstructionEn || apt.modalityGeneralInstructionAr || "").trim();
  const examPreparation = String(apt.examSpecificInstructionEn || apt.examSpecificInstructionAr || "").trim();
  const rows = [
    { icon: "P", label: "Patient Name", value: apt.englishFullName || apt.arabicFullName || "—" },
    { icon: "ID", label: "MRN / Patient ID", value: apt.mrn || apt.nationalId || "—" },
    { icon: "No", label: "Appointment No.", value: apt.accessionNumber || `V2-${apt.id}` },
    { icon: "M", label: "Modality", value: apt.modalityNameEn || "—" },
    { icon: "E", label: "Exam", value: apt.examNameEn || "—" },
    { icon: "D", label: "Date", value: formatSlipDate(apt.appointmentDate), highlight: true },
    { icon: "C", label: "Category", value: categoryLabel },
  ];
  const hasPrepContent = Boolean(appointmentNotes || modalityPreparation || examPreparation);

  printWindow.document.write(`
    <html>
      <head>
        <title>Appointment Slip</title>
        <style>
          @page { size: A5 portrait; margin: 6mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1f2937; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .sheet {
            width: 100%;
            margin: 0 auto;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 5mm;
            background: #ffffff;
            transform: scale(0.9);
            transform-origin: top center;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .top { display: grid; grid-template-columns: 1fr 118px; gap: 12px; align-items: start; }
          .brand-wrap { display: flex; gap: 10px; align-items: center; }
          .logo { width: 64px; height: 64px; object-fit: contain; }
          .brand-title { color: #b11116; margin: 0; font-size: 19px; font-weight: 800; line-height: 1.05; letter-spacing: -0.2px; }
          .brand-sub { margin: 2px 0 0; font-size: 13px; color: #24272c; }
          .rule { margin-top: 6px; display: flex; align-items: center; gap: 8px; }
          .rule-line { flex: 1; height: 0.35mm; background: #d34f53; opacity: 0.8; }
          .rule-dot { width: 8px; height: 8px; border-radius: 50%; background: #b11116; }
          .slip-title { margin: 8px 0 0; color: #b11116; letter-spacing: 4px; text-transform: uppercase; font-size: 28px; font-weight: 500; }
          .qr-card { border: 1px solid #e2676d; border-radius: 10px; background: #ffffff; padding: 6px; }
          .qr-card svg { width: 100%; display: block; border-radius: 2px; }
          .qr-title { margin-top: 6px; color: #b11116; text-transform: uppercase; font-size: 12px; font-weight: 800; line-height: 1.35; }
          .qr-note { margin-top: 4px; font-size: 10px; color: #2f3135; line-height: 1.35; }
          .rows { margin-top: 10px; border-top: 1px solid #d3d4d6; }
          .info-row {
            display: grid;
            grid-template-columns: 170px 18px 1fr;
            align-items: center;
            height: 38px;
            border-bottom: 1px solid #d3d4d6;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .info-label-wrap { display: flex; align-items: center; gap: 8px; color: #25282d; }
          .info-icon { min-width: 22px; display: inline-flex; align-items: center; justify-content: center; height: 22px; border-radius: 5px; background: #b11116; color: white; font-weight: 800; font-size: 10px; letter-spacing: 0.02em; }
          .info-label {
            font-size: 13px;
            color: #22262b;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .pipe { text-align: center; color: #9ca3af; font-size: 15px; }
          .info-value {
            font-size: 15px;
            font-weight: 700;
            color: #0f1115;
            line-height: 1.1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .info-value.highlight { color: #b11116; }
          .notes {
            margin-top: 8px;
            display: grid;
            grid-template-columns: 34px 1fr;
            gap: 8px;
            background: #ffffff;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 8px;
            max-height: 130px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .notes-icon { width: 34px; height: 34px; border-radius: 6px; background: #b11116; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; }
          .notes-title { margin: 0; color: #b11116; font-size: 15px; font-weight: 800; }
          .notes-content { display: flex; flex-direction: column; gap: 4px; }
          .prep-item { display: grid; grid-template-columns: 84px 1fr; gap: 6px; align-items: start; }
          .prep-label {
            color: #b11116;
            font-size: 11px;
            font-weight: 800;
            line-height: 1.25;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .notes-text {
            margin: 0;
            font-size: 11.5px;
            line-height: 1.25;
            color: #20242a;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
          }
          .mid-divider { margin: 8px 0 6px; display: flex; align-items: center; gap: 8px; }
          .meta-strip { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 0; }
          .meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px;
            border-right: 1px solid #c7c8cb;
            min-height: 48px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .meta-item:last-child { border-right: none; }
          .meta-icon { width: 24px; height: 24px; border-radius: 50%; border: 1px solid #b11116; color: #b11116; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 10px; }
          .meta-text {
            font-size: 12px;
            line-height: 1.2;
            color: #20242a;
            overflow: hidden;
          }
          .meta-text strong { color: #b11116; }
          .queue {
            margin-top: 8px;
            border: 1px solid #e2676d;
            border-radius: 8px;
            padding: 8px;
            background: #ffffff;
            text-align: center;
            page-break-inside: avoid;
            break-inside: avoid-page;
          }
          .queue-title { text-align: center; margin: 0 0 4px; color: #b11116; text-transform: uppercase; font-size: 14px; font-weight: 800; letter-spacing: 0.2mm; line-height: 1.08; }
          .queue svg {
            width: auto;
            max-width: 100%;
            height: 42px;
            display: block;
            margin: 0 auto;
          }
          .queue-label { text-align: center; margin: 4px 0 0; font-size: 10px; letter-spacing: 0.08em; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
            ${rows
              .map(
                (row) => `
                  <div class="info-row">
                    <div class="info-label-wrap">
                      <span class="info-icon">${escapeHtml(row.icon)}</span>
                      <span class="info-label">${escapeHtml(row.label)}</span>
                    </div>
                    <div class="pipe">|</div>
                    <div class="info-value ${row.highlight ? "highlight" : ""}">${escapeHtml(row.value)}</div>
                  </div>
                `
              )
              .join("")}
          </div>

          <div class="notes">
            <div class="notes-icon">N</div>
            <div class="notes-content">
              <p class="notes-title">Notes / Preparation:</p>
              ${
                hasPrepContent
                  ? `
                    ${appointmentNotes ? `<div class="prep-item"><span class="prep-label">Notes</span><p class="notes-text">${escapeHtml(appointmentNotes)}</p></div>` : ""}
                    ${modalityPreparation ? `<div class="prep-item"><span class="prep-label">Modality Instructions</span><p class="notes-text">${escapeHtml(modalityPreparation)}</p></div>` : ""}
                    ${examPreparation ? `<div class="prep-item"><span class="prep-label">Exam Preparation</span><p class="notes-text">${escapeHtml(examPreparation)}</p></div>` : ""}
                  `
                  : `<p class="notes-text">Please arrive 15 minutes before your appointment. Bring previous imaging and referral form.</p>`
              }
            </div>
          </div>

          <div class="mid-divider">
            <div class="rule-line"></div>
            <div class="rule-dot"></div>
            <div class="rule-line"></div>
          </div>

          <div class="meta-strip">
            <div class="meta-item">
              <span class="meta-icon">T</span>
              <div class="meta-text">Please arrive <strong>15 minutes</strong> before your appointment</div>
            </div>
            <div class="meta-item">
              <span class="meta-icon">P</span>
              <div class="meta-text">Phone <strong>${escapeHtml(apt.phone1 || "—")}</strong></div>
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
  `);
  printWindow.document.close();
  await waitForImagesToLoad(printWindow.document);
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
