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

  const token = String(apt.publicCancelToken || "").trim();
  const cancelUrl =
    token.length > 0 ? `${window.location.origin}/public/cancel-appointment?t=${encodeURIComponent(token)}` : null;
  let qrDataUrl: string | null = null;
  if (cancelUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(cancelUrl, { width: 120, margin: 1 });
    } catch {
      qrDataUrl = null;
    }
  }
  const logoUrl = `${window.location.origin}/assets/nccb-logo.png`;
  const barcodeUrl = generateBarcodeDataUri(apt.accessionNumber || `V2-${apt.id}`);
  const now = new Date().toLocaleString();
  const rawCaseCategory = (apt as { caseCategory?: string }).caseCategory;
  const categoryLabel = rawCaseCategory ? toTitleCase(rawCaseCategory) : "—";
  const rows = [
    { icon: "P", label: "Patient Name", value: apt.englishFullName || apt.arabicFullName || "—" },
    { icon: "ID", label: "MRN / Patient ID", value: apt.mrn || apt.nationalId || "—" },
    { icon: "No", label: "Appointment No.", value: apt.accessionNumber || `V2-${apt.id}` },
    { icon: "M", label: "Modality", value: apt.modalityNameEn || "—" },
    { icon: "E", label: "Exam", value: apt.examNameEn || "—" },
    { icon: "D", label: "Date", value: formatSlipDate(apt.appointmentDate), highlight: true },
    { icon: "C", label: "Category", value: categoryLabel },
  ];
  const notesText =
    apt.notes ||
    apt.modalityGeneralInstructionEn ||
    apt.modalityGeneralInstructionAr ||
    "Please arrive 15 minutes before your appointment. Bring previous imaging and referral form.";

  printWindow.document.write(`
    <html>
      <head>
        <title>Appointment Slip</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1f2937; background: #efefef; }
          .sheet { width: 100%; border: 1px solid #c9c9c9; border-radius: 14px; padding: 22px 24px; background: #efefef; }
          .top { display: grid; grid-template-columns: 1fr 250px; gap: 22px; align-items: start; }
          .brand-wrap { display: flex; gap: 16px; align-items: center; }
          .logo { width: 126px; height: 126px; object-fit: contain; }
          .brand-title { color: #b11116; margin: 0; font-size: 56px; font-weight: 800; line-height: 1.08; letter-spacing: -0.4px; }
          .brand-sub { margin: 6px 0 0; font-size: 24px; color: #24272c; }
          .rule { margin-top: 14px; display: flex; align-items: center; gap: 14px; }
          .rule-line { flex: 1; height: 2px; background: #d34f53; opacity: 0.8; }
          .rule-dot { width: 14px; height: 14px; border-radius: 50%; background: #b11116; }
          .slip-title { margin: 16px 0 0; color: #b11116; letter-spacing: 10px; text-transform: uppercase; font-size: 52px; font-weight: 500; }
          .qr-card { border: 1.8px solid #e2676d; border-radius: 16px; background: #f8f8f8; padding: 12px; }
          .qr-card img { width: 100%; display: block; border-radius: 2px; }
          .qr-title { margin-top: 12px; color: #b11116; text-transform: uppercase; font-size: 18px; font-weight: 800; line-height: 1.45; }
          .qr-note { margin-top: 12px; font-size: 13px; color: #2f3135; line-height: 1.45; }
          .rows { margin-top: 26px; border-top: 1px solid #d3d4d6; }
          .info-row { display: grid; grid-template-columns: 330px 24px 1fr; align-items: center; min-height: 74px; border-bottom: 1px solid #d3d4d6; }
          .info-label-wrap { display: flex; align-items: center; gap: 14px; font-size: 38px; color: #25282d; }
          .info-icon { min-width: 52px; display: inline-flex; align-items: center; justify-content: center; height: 52px; border-radius: 12px; background: #b11116; color: white; font-weight: 800; font-size: 18px; letter-spacing: 0.02em; }
          .info-label { font-size: 42px; color: #22262b; }
          .pipe { text-align: center; color: #9ca3af; font-size: 42px; }
          .info-value { font-size: 47px; font-weight: 700; color: #0f1115; }
          .info-value.highlight { color: #b11116; }
          .notes { margin-top: 16px; display: grid; grid-template-columns: 72px 1fr; gap: 12px; background: #e8e1e2; border-radius: 14px; padding: 14px; }
          .notes-icon { width: 58px; height: 58px; border-radius: 10px; background: #b11116; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; }
          .notes-title { margin: 0; color: #b11116; font-size: 44px; font-weight: 800; }
          .notes-text { margin: 6px 0 0; font-size: 39px; line-height: 1.45; color: #20242a; }
          .mid-divider { margin: 18px 0 12px; display: flex; align-items: center; gap: 14px; }
          .meta-strip { display: grid; grid-template-columns: 1fr 1fr 1.3fr; gap: 0; border-bottom: 1px solid transparent; }
          .meta-item { display: flex; align-items: center; gap: 10px; padding: 8px 8px; border-right: 1px solid #c7c8cb; }
          .meta-item:last-child { border-right: none; }
          .meta-icon { width: 48px; height: 48px; border-radius: 50%; border: 3px solid #b11116; color: #b11116; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; }
          .meta-text { font-size: 35px; line-height: 1.32; color: #20242a; }
          .meta-text strong { color: #b11116; }
          .queue { margin-top: 16px; border: 1.8px solid #e2676d; border-radius: 14px; padding: 16px; background: #f3f3f3; }
          .queue-title { text-align: center; margin: 0 0 10px; color: #b11116; text-transform: uppercase; font-size: 50px; font-weight: 800; letter-spacing: 1px; }
          .queue img { width: 100%; height: 95px; display: block; }
          .queue-label { text-align: center; margin: 10px 0 0; font-size: 26px; letter-spacing: 0.08em; color: #1f2937; }
          .small-muted { color: #6b7280; font-size: 12px; }
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
                  qrDataUrl
                    ? `<img src="${escapeHtml(qrDataUrl)}" alt="Cancellation QR Code" />`
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
            <div>
              <p class="notes-title">Notes / Preparation:</p>
              <p class="notes-text">${escapeHtml(notesText)}</p>
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
            <img src="${escapeHtml(barcodeUrl)}" alt="Queue barcode" />
            <p class="queue-label">${escapeHtml(apt.accessionNumber || `V2-${apt.id}`)}</p>
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
