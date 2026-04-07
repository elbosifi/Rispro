import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";

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

export function printAppointmentSlip(apt: AppointmentWithDetails): void {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const now = new Date().toLocaleString();
  printWindow.document.write(`
    <html>
      <head>
        <title>Appointment Slip</title>
        <style>
          @page { size: A5 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
          .slip { width: 100%; min-height: 100%; border: 2px solid #0f766e; border-radius: 14px; padding: 16px; }
          .header { text-align: center; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #d1d5db; }
          .brand { margin: 0; font-size: 20px; font-weight: 800; color: #0f766e; }
          .title { margin: 4px 0 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.16em; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; font-size: 12px; }
          .field { min-height: 48px; padding: 8px 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; }
          .field.full { grid-column: 1 / -1; }
          .label { display: block; margin-bottom: 4px; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
          .value { font-size: 13px; font-weight: 700; color: #111827; word-break: break-word; }
          .footer { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #d1d5db; display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: #6b7280; }
          .rtl { direction: rtl; text-align: right; }
        </style>
      </head>
      <body>
        <div class="slip">
          <div class="header">
            <p class="brand">RISpro Reception</p>
            <p class="title">Appointment Slip</p>
          </div>
          <div class="meta">
            ${slipField("Accession", apt.accessionNumber)}
            ${slipField("Appointment Date", formatDateLy(apt.appointmentDate))}
            ${slipField("Patient", apt.arabicFullName, true)}
            ${slipField("English Name", apt.englishFullName || "—")}
            ${slipField("National ID", apt.nationalId || "—")}
            ${slipField("MRN", apt.mrn || "—")}
            ${slipField("Age / Sex", `${apt.ageYears ?? "—"} / ${apt.sex || "—"}`)}
            ${slipField("Phone", apt.phone1 || "—")}
            ${slipField("Modality", apt.modalityNameEn || "—")}
            ${(apt.modalityGeneralInstructionAr || apt.modalityGeneralInstructionEn) ? slipField("Modality Notes", apt.modalityGeneralInstructionAr || apt.modalityGeneralInstructionEn || "—", Boolean(apt.modalityGeneralInstructionAr)) : ""}
            ${slipField("Exam", apt.examNameEn || "—")}
            ${slipField("Priority", apt.priorityNameEn || "Normal")}
            ${slipField("Status", apt.status || "—")}
            ${slipField("Walk-In", apt.isWalkIn ? "Yes" : "No")}
            ${slipField("Sequence", String(apt.dailySequence ?? "—"))}
            ${slipField("Slot", apt.modalitySlotNumber ? String(apt.modalitySlotNumber) : "—")}
            ${slipField("Created", apt.createdAt ? formatDateLy(apt.createdAt) : "—")}
            ${apt.notes ? `<div class="field full"><span class="label">Notes</span><span class="value">${escapeHtml(apt.notes)}</span></div>` : ""}
          </div>
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
        <div><div class="label">Priority</div><div class="value">${escapeHtml(apt.priorityNameEn || "Normal")}</div></div>
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
