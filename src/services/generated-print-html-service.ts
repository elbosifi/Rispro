import QRCode from "qrcode";

export const SERVER_PRINT_FONT_FAMILY = "Noto Naskh Arabic";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pageDocument(widthMm: number, heightMm: number, body: string, extraCss: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { width: ${widthMm}mm; height: ${heightMm}mm; margin: 0; overflow: hidden; }
    body { font-family: "${SERVER_PRINT_FONT_FAMILY}", "Noto Sans Arabic", Arial, sans-serif; color: #111; background: #fff; }
    ${extraCss}
  </style></head><body>${body}</body></html>`;
}

export interface AccessionLabelHtmlData {
  patientName: string;
  accessionNumber: string;
  modality: string;
  appointmentDate: string;
  mrn: string;
}

export async function buildAccessionLabelHtml(data: AccessionLabelHtmlData, widthMm: number, heightMm: number): Promise<string> {
  const qrSvg = await QRCode.toString(data.accessionNumber, { type: "svg", margin: 0, width: 220 });
  const details = [data.accessionNumber, [data.modality, data.appointmentDate].filter(Boolean).join("  "), data.mrn ? `MRN ${data.mrn}` : ""].filter(Boolean);
  return pageDocument(widthMm, heightMm, `<main data-accession-label-document="true"><section><strong dir="auto">${escapeHtml(data.patientName || "Patient")}</strong>${details.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}</section><figure aria-label="Accession QR code">${qrSvg}</figure></main>`, `
    main { width: 100%; height: 100%; padding: 2mm; display: grid; grid-template-columns: minmax(0, 1fr) min(${Math.max(10, Math.min(heightMm - 4, widthMm * 0.32))}mm, 32%); gap: 2mm; align-items: center; }
    section { min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 1mm; }
    strong { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: clamp(7pt, ${Math.max(7, Math.min(11, heightMm * 0.34))}pt, 11pt); line-height: 1.25; }
    span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: "${SERVER_PRINT_FONT_FAMILY}", "Noto Sans Arabic", Arial, sans-serif; font-size: clamp(6pt, ${Math.max(6, Math.min(9, heightMm * 0.27))}pt, 9pt); line-height: 1.2; }
    figure { margin: 0; width: 100%; aspect-ratio: 1; } figure svg { display: block; width: 100%; height: 100%; }
  `);
}

export function buildIrSpecimenLabelHtml(data: { patientName: string; accessionNumber: string; specimenText: string; printedAt: Date | string }, widthMm: number, heightMm: number): string {
  const printedAt = data.printedAt instanceof Date
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Tripoli", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(data.printedAt).replace(",", "")
    : data.printedAt;
  return pageDocument(widthMm, heightMm, `<main data-ir-specimen-label-document="true"><strong dir="auto">${escapeHtml(data.patientName || "Patient")}</strong><span>${escapeHtml(data.accessionNumber)}</span><span>${escapeHtml(printedAt)}</span><p dir="auto">${escapeHtml(data.specimenText)}</p></main>`, `
    main { width: 100%; height: 100%; box-sizing: border-box; padding: 2mm; display: flex; flex-direction: column; gap: .7mm; overflow: hidden; }
    strong { font-size: clamp(8pt, ${Math.max(8, Math.min(12, heightMm * .38))}pt, 12pt); line-height: 1.15; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    span { font-size: clamp(6pt, ${Math.max(6, Math.min(8, heightMm * .23))}pt, 8pt); line-height: 1.15; }
    p { margin: .3mm 0 0; font-size: clamp(7pt, ${Math.max(7, Math.min(9, heightMm * .28))}pt, 9pt); line-height: 1.2; overflow: hidden; overflow-wrap: anywhere; }
  `);
}

export interface PrinterTestHtmlData {
  printerName: string;
  documentType: string;
  widthMm: number;
  heightMm: number;
  orientation: "portrait" | "landscape";
  customPaperSize: boolean;
  rasterize: boolean;
  generatedAt: string;
}

export function buildPrinterTestHtml(data: PrinterTestHtmlData): string {
  const lines = [
    `Queue: ${data.printerName}`,
    `Profile: ${data.documentType}`,
    `Paper: ${data.widthMm} x ${data.heightMm} mm`,
    `Orientation: ${data.orientation}`,
    `Custom media: ${data.customPaperSize ? "yes" : "no"}`,
    `Rasterize: ${data.rasterize ? "yes" : "no"}`,
    `Generated: ${data.generatedAt}`,
  ];
  return pageDocument(data.widthMm, data.heightMm, `<main data-printer-test-document="true"><h1>RISpro printer test</h1>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</main>`, `main { width: 100%; height: 100%; padding: clamp(2mm, 6%, 8mm); overflow: hidden; } h1 { margin: 0 0 3mm; font: 700 clamp(6pt, 4vw, 14pt) Arial, sans-serif; } p { margin: 0 0 1.5mm; overflow-wrap: anywhere; font: 400 clamp(5pt, 3vw, 10pt) Arial, sans-serif; }`);
}
