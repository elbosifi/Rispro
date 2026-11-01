import QRCode from "qrcode";
import type { InstitutionIdentity } from "./institution-identity-service.js";
import type { Identity } from "../modules/reporting/reporting-service.js";

export const SERVER_PRINT_FONT_FAMILY = "Noto Naskh Arabic";

export interface NativeReportPrintData {
  id?: number; studyKey?:string; appointmentId: number | null; status: string; identity: Identity;
  institution?: InstitutionIdentity | null;
  sections: Record<string,string>; author: string; finalizer: string | null; finalizedAt: Date | string | null;
  keyImages: { id: string; caption: string; provenance: Record<string,unknown> }[];
  addenda: { text?: string; author?: string; signedAt?: string | Date }[];
}

// DICOM dates are calendar dates, not UTC instants. Reject incomplete or invalid
// dates and never substitute today's date for a missing examination date.
export function reportCalendarDate(value: unknown): string {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(value ?? ""));
  if (!match) return "";
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number(y) >= 1800 && !isNaN(+date) && date.toISOString().startsWith(`${y}-${m}-${d}`) ? `${y}-${m}-${d}` : "";
}
export function ageAtExamination(birth: unknown, study: unknown): string {
  const dob = reportCalendarDate(birth), exam = reportCalendarDate(study);
  if (!dob || !exam || dob > exam) return "";
  const years = Number(exam.slice(0,4)) - Number(dob.slice(0,4)) - (exam.slice(5) < dob.slice(5) ? 1 : 0);
  if (years > 130) return "";
  if (years) return `${years} y`;
  const months = (Number(exam.slice(0,4)) - Number(dob.slice(0,4))) * 12 + Number(exam.slice(5,7)) - Number(dob.slice(5,7)) - (exam.slice(8) < dob.slice(8) ? 1 : 0);
  return months > 0 ? `${months} mo` : `${Math.floor((Date.parse(exam) - Date.parse(dob)) / 86400000)} d`;
}
function reportTimestamp(value: string | Date | null | undefined): string {
  if (!value || isNaN(+new Date(value))) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Tripoli", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) + " (Africa/Tripoli)";
}
function cssString(value: string): string {
  return '"' + value.replace(/[\\"\n\r<>]/g, char => "\\" + char.charCodeAt(0).toString(16) + " ") + '"';
}

export function buildNativeReportHtml(report: NativeReportPrintData): string {
  const e = escapeHtml, institution = report.institution, identity = report.identity;
  const final = report.status === "final";
  const labels = { clinicalHistory:"Clinical Data", technique:"Protocol / Technique", comparison:"Comparison", findings:"Findings", impression:"Impression" };
  const date = reportCalendarDate(identity.studyDate);
  const time = /^(\d{2})(\d{2})(\d{2})(?:\.\d+)?$/.exec(identity.studyTime || "");
  const studyTime = time && Number(time[1]) < 24 && Number(time[2]) < 60 && Number(time[3]) < 60 ? `${time[1]}:${time[2]}:${time[3]}` : "";
  const metadata = [
    ["Patient name", identity.patientName], ["Patient ID", identity.patientIdentifier],
    ["Date of birth", reportCalendarDate(identity.birthDate)], ["Age at exam", ageAtExamination(identity.birthDate, identity.studyDate)],
    ["Sex", /^(M|F|O|male|female|other)$/i.test(identity.sex || "") ? identity.sex : ""],
    ["Study date / time", [date, date ? studyTime : ""].filter(Boolean).join(" ")],
    ["Modality", identity.modality], ["Accession number", identity.accession],
  ].filter(([,value]) => value);
  const metaRows = [metadata.slice(0,5), metadata.slice(5)].filter(row => row.length);
  const footer = institution ? [institution.hospitalNameEn || institution.hospitalNameAr, institution.website].filter(Boolean).join(" | ") : "";
  const logo = (src: string, alt: string) => src && (src === "/assets/nccb-logo.png" || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src)) ? `<img src="${e(src)}" alt="${alt}">` : "";
  return `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8"><title>Radiology report</title><style>
    @font-face{font-family:"${SERVER_PRINT_FONT_FAMILY}";src:url('/api/native-reporting/print-font/regular') format('truetype');font-weight:400}
    @font-face{font-family:"${SERVER_PRINT_FONT_FAMILY}";src:url('/api/native-reporting/print-font/bold') format('truetype');font-weight:700}
    @page{size:A4 portrait;margin:12mm 12mm 17mm;@bottom-center{content:${cssString(footer)};font:7pt Arial,"${SERVER_PRINT_FONT_FAMILY}",sans-serif;white-space:pre-wrap}@bottom-right{content:counter(page) " / " counter(pages);font:7pt Arial,sans-serif}}
    *{box-sizing:border-box}body{margin:0;color:#000;background:#fff;font:10.5pt/1.28 Arial,"${SERVER_PRINT_FONT_FAMILY}",sans-serif;overflow-wrap:anywhere}
    .report-document{width:100%;border-collapse:collapse;table-layout:fixed}.report-document>thead{display:table-header-group}.report-body{padding:0;vertical-align:top}
    .header-space td{height:1mm;padding:0}
    .institution{font-size:10pt;line-height:1.3}.institution td{vertical-align:middle;border-bottom:.6pt solid #333;padding:0 0 2mm}.institution p{margin:0}.institution .hospital{font-weight:700}.institution .arabic{text-align:right;font-family:"${SERVER_PRINT_FONT_FAMILY}",Arial,sans-serif;font-size:11pt}.institution .logos{text-align:center}.logos img{max-width:22mm;max-height:20mm;object-fit:contain}.logos img+img{max-width:10mm;max-height:12mm}
    h1{margin:2mm 0 3mm;text-align:center;font-size:13pt;font-weight:600;line-height:1.3;break-after:avoid}h2{margin:0 0 1.2mm;font-size:10.5pt;font-weight:700;line-height:1.25;break-after:avoid}
    .metadata{width:100%;border-collapse:collapse;margin:0 0 2mm;table-layout:fixed;font-size:9pt}.metadata tr{border-bottom:.4pt solid #777;break-inside:avoid}.metadata tr:first-child{border-top:.6pt solid #333}.metadata td{padding:1.5mm 2mm;vertical-align:top}.metadata span{display:block;font-size:8pt;margin-bottom:.5mm}
    section{padding:1.5mm 1mm;border-bottom:.4pt solid #999}p.narrative{white-space:pre-wrap;margin:0;orphans:3;widows:3;overflow-wrap:anywhere}.draft{font-size:10pt;font-weight:700;text-align:center;margin:1mm 0 2mm}.unrecorded{font-size:8pt;margin:0 0 2mm}
    .key-images{padding-top:2mm}.image-grid{display:block}.image-row{display:flex;gap:2mm;break-inside:avoid;page-break-inside:avoid;margin-bottom:2mm}figure{flex:0 0 calc((100% - 4mm)/3);min-width:0;margin:0;break-inside:avoid;page-break-inside:avoid}figure img{display:block;width:100%;height:auto;max-height:65mm;object-fit:contain}figcaption{font-size:8pt;line-height:1.2;white-space:pre-wrap;padding-top:1mm}
    .signoff{display:flex;align-items:center;justify-content:space-between;gap:4mm;padding:2mm 1mm;border-top:.6pt solid #333;border-bottom:.6pt solid #333;margin-top:3mm;font-size:9pt;break-inside:avoid}.signoff span{min-width:0}.help{font:10pt Arial,sans-serif;margin:0 0 4mm}
    @media screen{body{max-width:186mm;margin:8mm auto;padding:0 3mm}}@media print{.help{display:none}}
    </style></head><body><p class="help">Use Print / Save as PDF (Ctrl+P). A4 portrait. Disable browser headers and footers.</p>
    <table class="report-document"><colgroup><col style="width:43%"><col style="width:14%"><col style="width:43%"></colgroup><thead>${institution ? `<tr class="institution"><td dir="ltr"><p class="hospital">${e(institution.hospitalNameEn)}</p><p>${e(institution.departmentNameEn)}</p></td><td class="logos">${logo(institution.hospitalLogo,"Hospital logo")}${logo(institution.departmentLogo,"Department logo")}</td><td class="arabic" dir="rtl" lang="ar"><p class="hospital">${e(institution.hospitalNameAr)}</p><p>${e(institution.departmentNameAr)}</p></td></tr>` : '<tr><td colspan="3"><p class="unrecorded">Institutional identity was not recorded with this report.</p></td></tr>'}${!final ? '<tr><td colspan="3"><div class="draft">DRAFT / UNSIGNED</div></td></tr>' : ""}<tr class="header-space"><td colspan="3"></td></tr></thead><tbody><tr><td colspan="3" class="report-body">
    <h1 dir="auto">${e(identity.examination || "Radiology report")}</h1>
    ${metadata.length ? `<table class="metadata" aria-label="Patient and examination information">${metaRows.map(row=>`<tr>${row.map(([label,value])=>`<td colspan="${row.length===3 && label==='Accession number'?3:1}"><span>${e(label)}</span><bdi>${e(value)}</bdi></td>`).join("")}</tr>`).join("")}</table>` : ""}
    ${Object.entries(labels).filter(([key])=>report.sections[key]?.trim()).map(([key,label])=>`<section><h2>${label}</h2><p class="narrative" dir="auto">${e(report.sections[key])}</p></section>`).join("")}
    ${report.addenda.map(a=>`<section><h2>Signed addendum</h2><p class="narrative" dir="auto">${e(a.text)}</p><p>${e(a.author)} | ${e(reportTimestamp(a.signedAt))}</p></section>`).join("")}
    ${report.keyImages.length ? `<section class="key-images"><h2>Key images</h2><div class="image-grid">${Array.from({length:Math.ceil(report.keyImages.length/3)},(_,row)=>`<div class="image-row">${report.keyImages.slice(row*3,row*3+3).map((image,index)=>`<figure><img alt="Report illustration ${row*3+index+1}" src="/api/native-reporting/${report.studyKey && report.id ? "reports/"+report.id : "appointments/"+report.appointmentId}/images/${encodeURIComponent(image.id)}"><figcaption dir="auto">${e(image.caption)}${image.provenance.prior ? ' (prior study)' : ''}</figcaption></figure>`).join("")}</div>`).join("")}</div></section>` : ""}
    <div class="signoff"><span dir="auto">${e(final ? report.finalizer : report.author)}</span><span>${final ? e(reportTimestamp(report.finalizedAt)) : ""}</span><span>${final ? 'FINAL / SIGNED' : 'DRAFT / UNSIGNED'}</span></div>
    </td></tr></tbody></table></body></html>`;
}

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
    strong { font-size: clamp(8pt, ${Math.max(8, Math.min(12, heightMm * .38))}pt, 12pt); line-height: 1.15; max-height: 2.3em; overflow: hidden; overflow-wrap: anywhere; }
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
