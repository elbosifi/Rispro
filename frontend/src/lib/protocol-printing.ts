export type ProtocolPrintModality = "CT" | "MRI";

export interface ProtocolPrintCtPhase {
  orderIndex: number;
  phase: string | null;
  timing: string | null;
  coverage: string | null;
  reconstruction: string | null;
  instructions: string | null;
  isRequired: boolean;
}

export interface ProtocolPrintMriSequence {
  orderIndex: number;
  scanner: string | null;
  sequence: string | null;
  vendorSequenceName: string | null;
  plane: string | null;
  coverage: string | null;
  bValuesTiming: string | null;
  notes: string | null;
  isRequired: boolean;
}

export interface ProtocolPrintSheet {
  patientName: string;
  mrn: string | null;
  accession: string | null;
  appointmentDateTime: string | null;
  modality: ProtocolPrintModality;
  exam: string | null;
  category: string | null;
  clinicalNotes: string | null;
  protocolName: string;
  versionNumber: string;
  scanner: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  protocolInstructions: string | null;
  contrastInstructions: string | null;
  ctPhases?: ProtocolPrintCtPhase[];
  mriSequences?: ProtocolPrintMriSequence[];
}

const EMPTY_VALUE = "-";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  return escapeHtml(String(value));
}

function longText(value: string | null | undefined): string {
  return value?.trim() ? escapeHtml(value.trim()).replaceAll("\n", "<br>") : EMPTY_VALUE;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function row(label: string, value: string | null | undefined): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${text(value)}</dd></div>`;
}

function ctTable(phases: ProtocolPrintCtPhase[]): string {
  if (phases.length === 0) return `<p class="empty">No CT phases listed.</p>`;
  return `
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Phase</th>
          <th>Timing</th>
          <th>Coverage</th>
          <th>Reconstruction</th>
          <th>Instructions</th>
          <th>Required</th>
        </tr>
      </thead>
      <tbody>
        ${phases.map((phase) => `
          <tr>
            <td>${text(phase.orderIndex)}</td>
            <td>${text(phase.phase)}</td>
            <td>${text(phase.timing)}</td>
            <td>${text(phase.coverage)}</td>
            <td>${text(phase.reconstruction)}</td>
            <td>${longText(phase.instructions)}</td>
            <td>${yesNo(phase.isRequired)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function mriTable(sequences: ProtocolPrintMriSequence[]): string {
  if (sequences.length === 0) return `<p class="empty">No MRI sequences listed.</p>`;
  return `
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Scanner</th>
          <th>Sequence</th>
          <th>Vendor sequence</th>
          <th>Plane</th>
          <th>Coverage</th>
          <th>b-values / timing</th>
          <th>Notes</th>
          <th>Required</th>
        </tr>
      </thead>
      <tbody>
        ${sequences.map((sequence) => `
          <tr>
            <td>${text(sequence.orderIndex)}</td>
            <td>${text(sequence.scanner)}</td>
            <td>${text(sequence.sequence)}</td>
            <td>${text(sequence.vendorSequenceName)}</td>
            <td>${text(sequence.plane)}</td>
            <td>${text(sequence.coverage)}</td>
            <td>${text(sequence.bValuesTiming)}</td>
            <td>${longText(sequence.notes)}</td>
            <td>${yesNo(sequence.isRequired)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function html(sheet: ProtocolPrintSheet): string {
  const printedAt = new Date().toLocaleString();
  const detailTable = sheet.modality === "CT"
    ? ctTable(sheet.ctPhases ?? [])
    : mriTable(sheet.mriSequences ?? []);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Protocol sheet - ${text(sheet.accession)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 28px; color: #111827; font: 12px/1.45 Arial, sans-serif; }
    header { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 20px; }
    h2 { margin: 18px 0 8px; font-size: 14px; }
    .muted { color: #4b5563; }
    .toolbar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 16px; }
    .toolbar button { border: 1px solid #9ca3af; border-radius: 6px; background: #fff; color: #111827; cursor: pointer; font: 700 12px Arial, sans-serif; padding: 7px 12px; }
    .toolbar button:first-child { background: #0f766e; border-color: #0f766e; color: #fff; }
    dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 14px; margin: 0; }
    dt { color: #4b5563; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    dd { margin: 2px 0 0; font-weight: 700; }
    .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; margin-top: 10px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
    th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; word-break: break-word; }
    th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .empty { color: #6b7280; }
    @media print {
      body { margin: 16mm; }
      .toolbar { display: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar" aria-label="Protocol print controls">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <header>
    <h1>NCCB / RISpro Protocol Sheet</h1>
    <p class="muted">Printed ${text(printedAt)}</p>
  </header>
  <section>
    <dl>
      ${row("Patient", sheet.patientName)}
      ${row("MRN", sheet.mrn)}
      ${row("Accession", sheet.accession)}
      ${row("Appointment", sheet.appointmentDateTime)}
      ${row("Modality", sheet.modality)}
      ${row("Exam", sheet.exam)}
      ${row("Category", sheet.category)}
    </dl>
    <div class="box"><strong>Clinical notes</strong><br>${longText(sheet.clinicalNotes)}</div>
  </section>
  <section>
    <h2>Protocol</h2>
    <dl>
      ${row("Name", `${sheet.protocolName} v${sheet.versionNumber}`)}
      ${row("Scanner", sheet.scanner)}
      ${row("Assigned by", sheet.assignedBy)}
      ${row("Assigned at", sheet.assignedAt)}
    </dl>
    <div class="two">
      <div class="box"><strong>Protocol instructions</strong><br>${longText(sheet.protocolInstructions)}</div>
      <div class="box"><strong>Contrast/preparation instructions</strong><br>${longText(sheet.contrastInstructions)}</div>
    </div>
  </section>
  <section>
    <h2>${sheet.modality === "CT" ? "CT phases" : "MRI sequences"}</h2>
    ${detailTable}
  </section>
</body>
</html>`;
}

export function printProtocolSheet(sheet: ProtocolPrintSheet): void {
  const printWindow = window.open("", "_blank", "width=980,height=900");
  if (!printWindow) {
    console.warn("Unable to open protocol print window. Check popup blocker settings.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html(sheet));
  printWindow.document.close();
  try {
    printWindow.opener = null;
  } catch {
    // Some browsers make opener read-only. The print sheet remains self-contained.
  }
}
