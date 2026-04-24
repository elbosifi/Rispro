import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import QRCode from "qrcode";

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

const PDF_VIEWPORT_WIDTH = 560;
const PDF_VIEWPORT_HEIGHT = 794;

export async function prepareAppointmentSlipHtml(apt: AppointmentWithDetails): Promise<string> {
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
  const modalityPreparation = String(apt.modalityGeneralInstructionEn || apt.modalityGeneralInstructionAr || "").trim();
  const examPreparation = String(apt.examSpecificInstructionEn || apt.examSpecificInstructionAr || "").trim();
  const rows = [
    slipRow(
      slipField("Patient Name", apt.englishFullName || apt.arabicFullName || "—"),
      slipField("MRN / Patient ID", apt.mrn || apt.nationalId || "—")
    ),
    slipRow(
      slipField("Appointment No.", apt.accessionNumber || `V2-${apt.id}`),
      slipField("Date", formatSlipDate(apt.appointmentDate), true)
    ),
    slipRow(
      slipField("Modality", apt.modalityNameEn || "—"),
      slipField("Exam", apt.examNameEn || "—")
    ),
    slipRow(
      slipField("Category", categoryLabel),
      slipField("Phone", apt.phone1 || "—")
    ),
    slipRow(
      slipField("Age / Sex", `${apt.ageYears || "—"} / ${apt.sex || "—"}`),
      slipField("Walk-In", apt.isWalkIn ? "Yes" : "No")
    ),
  ];
  const hasPrepContent = Boolean(modalityPreparation || examPreparation);
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
                  <p class="prep-text">${escapeHtml(modalityPreparation || "Please follow the department preparation instructions.")}</p>
                </div>
                ${
                  examPreparation
                    ? `
                      <div class="prep">
                        <div class="prep-label">Exam Preparation</div>
                        <p class="prep-text">${escapeHtml(examPreparation)}</p>
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
  const html = await prepareAppointmentSlipHtml(apt);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = `${PDF_VIEWPORT_WIDTH}px`;
  frame.style.height = `${PDF_VIEWPORT_HEIGHT}px`;
  frame.style.border = "0";
  frame.style.visibility = "hidden";

  try {
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener("load", () => resolve(), { once: true });
    });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    await loaded;

    const doc = frame.contentDocument;
    if (!doc?.body) return;

    doc.documentElement.style.width = `${PDF_VIEWPORT_WIDTH}px`;
    doc.documentElement.style.margin = "0";
    doc.body.style.width = `${PDF_VIEWPORT_WIDTH}px`;
    doc.body.style.margin = "0";

    await waitForImagesToLoad(doc);

    const { default: html2pdf } = await import("html2pdf.js");
    const content = (doc.body.firstElementChild as HTMLElement | null) ?? doc.body;

    await html2pdf()
      .set({
        filename: getAppointmentSlipFileName(apt),
        margin: 0,
        image: { type: "jpeg", quality: 1 },
        enableLinks: true,
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        html2canvas: {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          windowWidth: PDF_VIEWPORT_WIDTH,
          windowHeight: PDF_VIEWPORT_HEIGHT,
        },
        jsPDF: {
          unit: "mm",
          format: "a5",
          orientation: "portrait",
        },
      } as any)
      .from(content)
      .save();
  } finally {
    frame.remove();
  }
}

export function printAppointmentSlip(apt: AppointmentWithDetails): void {
  void printAppointmentSlipInternal(apt);
}

async function printAppointmentSlipInternal(apt: AppointmentWithDetails): Promise<void> {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  const html = await prepareAppointmentSlipHtml(apt);
  printWindow.document.write(html);
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
