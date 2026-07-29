import { randomUUID } from "node:crypto";
import sharp from "sharp";
import dcmjs from "dcmjs";

const { datasetToBuffer } = dcmjs.data;

export const ENCAPSULATED_PDF_STORAGE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.104.1";
export const SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID = "1.2.840.10008.5.1.4.1.1.7";
const IMPLEMENTATION_CLASS_UID = "2.25.329038087439464931464405735134857";

export type ClinicalDocumentDicomMetadata = {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  patientId: string;
  patientName: string;
  patientBirthDate?: string | null;
  patientSex?: string | null;
  accessionNumber: string;
  documentTitle: string;
  originalFilename: string;
  studyDate?: string | null;
  studyTime?: string | null;
  instanceNumber?: string | null;
  contentDate?: string;
  contentTime?: string;
};

export type SecondaryCaptureMetadata = Omit<ClinicalDocumentDicomMetadata, "documentTitle" | "originalFilename" | "instanceNumber"> & {
  modality: string;
  seriesNumber: number;
  instanceNumber: number;
};

const MODALITY_ALIASES: Record<string, string> = {
  MRI: "MR", MR: "MR", CT: "CT", US: "US", ULTRASOUND: "US",
  MAMMO: "MG", MAMMOGRAPHY: "MG", MG: "MG", XR: "DX", XRAY: "DX", X_RAY: "DX", DX: "DX",
  CR: "CR", PET: "PT", PT: "PT", NM: "NM", NUCLEAR_MEDICINE: "NM",
};

/** Maps RISpro modality codes to valid DICOM modality values.  There is deliberately no SC/OT/DOC fallback. */
export function normalizeRisproModalityCode(value: unknown): string | null {
  const code = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return MODALITY_ALIASES[code] || null;
}

export function createClinicalDocumentUid(): string {
  return `2.25.${BigInt(`0x${randomUUID().replaceAll("-", "")}`).toString(10)}`;
}

function cleanText(value: unknown, fallback: string): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim() || fallback;
}

function dicomDate(value: unknown): string | undefined {
  const normalized = String(value ?? "").replace(/[^0-9]/g, "").slice(0, 8);
  return /^\d{8}$/.test(normalized) ? normalized : undefined;
}

function nowDicomParts(): { date: string; time: string } {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 23).replace(/[^0-9]/g, "");
  return { date, time };
}

function assertPdf(bytes: Buffer): void {
  if (!bytes.subarray(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("The source file is not a PDF.");
  }
  if (!bytes.includes(Buffer.from("%%EOF", "ascii"))) throw new Error("The source PDF is incomplete.");
}

function makeImagePdf(jpeg: Buffer, width: number, height: number): Buffer {
  const pageWidth = 612;
  const pageHeight = 792;
  const scale = Math.min(pageWidth / width, pageHeight / height);
  const imageWidth = Math.max(1, Math.round(width * scale));
  const imageHeight = Math.max(1, Math.round(height * scale));
  const x = Math.round((pageWidth - imageWidth) / 2);
  const y = Math.round((pageHeight - imageHeight) / 2);
  const content = Buffer.from(`q\n${imageWidth} 0 0 ${imageHeight} ${x} ${y} cm\n/Im0 Do\nQ\n`, "ascii");
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>", "ascii"),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"), content, Buffer.from("endstream", "ascii")]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, "ascii"), jpeg, Buffer.from("\nendstream", "ascii")]),
  ];
  const header = Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "binary");
  const chunks: Buffer[] = [header];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "ascii"), objects[index]!, Buffer.from("\nendobj\n", "ascii"));
  }
  const xrefOffset = Buffer.concat(chunks).length;
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (let index = 1; index < offsets.length; index += 1) xref.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join(""), "ascii"));
  return Buffer.concat(chunks);
}

export async function normalizeClinicalDocumentToPdf(bytes: Buffer, mimeType: string): Promise<Buffer> {
  const mime = String(mimeType || "").trim().toLowerCase();
  if (mime === "application/pdf") {
    assertPdf(bytes);
    return bytes;
  }
  if (mime !== "image/jpeg" && mime !== "image/png") throw new Error("Unsupported clinical document source type.");
  const image = sharp(bytes, { failOn: "error" }).flatten({ background: "#ffffff" }).jpeg({ quality: 100, chromaSubsampling: "4:4:4" });
  const [metadata, jpeg] = await Promise.all([image.clone().metadata(), image.toBuffer()]);
  if (!metadata.width || !metadata.height) throw new Error("The image has no usable dimensions.");
  return makeImagePdf(jpeg, metadata.width, metadata.height);
}

export async function createClinicalDocumentDicom(bytes: Buffer, mimeType: string, metadata: ClinicalDocumentDicomMetadata): Promise<Buffer> {
  if (!metadata.studyInstanceUid || !metadata.seriesInstanceUid || !metadata.sopInstanceUid) throw new Error("Clinical document DICOM identifiers are incomplete.");
  const pdf = await normalizeClinicalDocumentToPdf(bytes, mimeType);
  const generated = nowDicomParts();
  const contentDate = dicomDate(metadata.contentDate) || generated.date;
  const contentTime = cleanText(metadata.contentTime, generated.time);
  const dataset = {
    _meta: {
      FileMetaInformationVersion: new Uint8Array([0, 1]),
      MediaStorageSOPClassUID: ENCAPSULATED_PDF_STORAGE_SOP_CLASS_UID,
      MediaStorageSOPInstanceUID: metadata.sopInstanceUid,
      TransferSyntaxUID: "1.2.840.10008.1.2.1",
      ImplementationClassUID: IMPLEMENTATION_CLASS_UID,
      ImplementationVersionName: "RISPRO_CLIN_DOC_1",
    },
    SpecificCharacterSet: "ISO_IR 192",
    SOPClassUID: ENCAPSULATED_PDF_STORAGE_SOP_CLASS_UID,
    SOPInstanceUID: metadata.sopInstanceUid,
    StudyInstanceUID: metadata.studyInstanceUid,
    SeriesInstanceUID: metadata.seriesInstanceUid,
    Modality: "DOC",
    ConversionType: "WSD",
    SeriesDescription: "RISpro Clinical Documents",
    PatientID: cleanText(metadata.patientId, "UNKNOWN"),
    PatientName: cleanText(metadata.patientName, "UNKNOWN"),
    PatientBirthDate: dicomDate(metadata.patientBirthDate) || "",
    PatientSex: cleanText(metadata.patientSex, "").slice(0, 1).toUpperCase(),
    StudyDate: dicomDate(metadata.studyDate) || "",
    StudyTime: cleanText(metadata.studyTime, ""),
    ReferringPhysicianName: "",
    StudyID: "",
    AccessionNumber: cleanText(metadata.accessionNumber, "UNKNOWN"),
    SeriesNumber: "1",
    DocumentTitle: cleanText(metadata.documentTitle || metadata.originalFilename, "Clinical Document").slice(0, 64),
    ConceptNameCodeSequence: [],
    MIMETypeOfEncapsulatedDocument: "application/pdf",
    EncapsulatedDocument: new Uint8Array(pdf),
    BurnedInAnnotation: "YES",
    AcquisitionDateTime: "",
    ContentDate: contentDate,
    ContentTime: contentTime,
    Manufacturer: "RISpro",
    InstanceNumber: cleanText(metadata.instanceNumber, "1"),
    InstanceCreationDate: contentDate,
    InstanceCreationTime: contentTime,
  };
  return Buffer.from(datasetToBuffer(dataset));
}

/** Creates an uncompressed 8-bit RGB Secondary Capture image. */
export async function createClinicalDocumentSecondaryCapture(rgbPixels: Buffer, rows: number, columns: number, metadata: SecondaryCaptureMetadata): Promise<Buffer> {
  if (!metadata.studyInstanceUid || !metadata.seriesInstanceUid || !metadata.sopInstanceUid) throw new Error("Clinical document DICOM identifiers are incomplete.");
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rgbPixels.length !== rows * columns * 3) throw new Error("Secondary Capture pixel data is invalid.");
  if (!normalizeRisproModalityCode(metadata.modality)) throw new Error("The RISpro modality code cannot be mapped to a DICOM modality.");
  const generated = nowDicomParts();
  const contentDate = dicomDate(metadata.contentDate) || generated.date;
  const contentTime = cleanText(metadata.contentTime, generated.time);
  const dataset = {
    _meta: { FileMetaInformationVersion: new Uint8Array([0, 1]), MediaStorageSOPClassUID: SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID, MediaStorageSOPInstanceUID: metadata.sopInstanceUid, TransferSyntaxUID: "1.2.840.10008.1.2.1", ImplementationClassUID: IMPLEMENTATION_CLASS_UID, ImplementationVersionName: "RISPRO_CLIN_DOC_2" },
    SpecificCharacterSet: "ISO_IR 192", SOPClassUID: SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID, SOPInstanceUID: metadata.sopInstanceUid,
    StudyInstanceUID: metadata.studyInstanceUid, SeriesInstanceUID: metadata.seriesInstanceUid, Modality: metadata.modality,
    ImageType: ["DERIVED", "SECONDARY"], ConversionType: "SD", SeriesDescription: "RISpro Scanned Documents",
    PatientID: cleanText(metadata.patientId, "UNKNOWN"), PatientName: cleanText(metadata.patientName, "UNKNOWN"), PatientBirthDate: dicomDate(metadata.patientBirthDate) || "", PatientSex: cleanText(metadata.patientSex, "").slice(0, 1).toUpperCase(),
    AccessionNumber: cleanText(metadata.accessionNumber, "UNKNOWN"), StudyDate: dicomDate(metadata.studyDate) || "", StudyTime: cleanText(metadata.studyTime, ""),
    SeriesNumber: String(metadata.seriesNumber), InstanceNumber: String(metadata.instanceNumber), BurnedInAnnotation: "YES", Manufacturer: "RISpro",
    Rows: rows, Columns: columns, SamplesPerPixel: 3, PhotometricInterpretation: "RGB", PlanarConfiguration: 0, BitsAllocated: 8, BitsStored: 8, HighBit: 7, PixelRepresentation: 0, PixelData: new Uint8Array(rgbPixels),
    ContentDate: contentDate, ContentTime: contentTime, InstanceCreationDate: contentDate, InstanceCreationTime: contentTime,
  };
  return Buffer.from(datasetToBuffer(dataset));
}
