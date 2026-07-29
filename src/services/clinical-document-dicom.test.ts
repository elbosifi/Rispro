import assert from "node:assert/strict";
import test from "node:test";
import dcmjs from "dcmjs";
import sharp from "sharp";
import { createClinicalDocumentDicom, createClinicalDocumentSecondaryCapture, normalizeClinicalDocumentToPdf, normalizeRisproModalityCode, ENCAPSULATED_PDF_STORAGE_SOP_CLASS_UID, SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID } from "./clinical-document-dicom.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;
const metadata = {
  studyInstanceUid: "1.2.3.4",
  seriesInstanceUid: "2.25.123",
  sopInstanceUid: "2.25.456",
  patientId: "PATIENT-1",
  patientName: "Doe^Jane",
  accessionNumber: "V2-000001",
  documentTitle: "clinical_document",
  originalFilename: "report.pdf",
  studyDate: "20260727",
  instanceNumber: "17",
};

function parse(buffer: Buffer): Record<string, unknown> {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return DicomMetaDictionary.naturalizeDataset(parsed.dict) as Record<string, unknown>;
}

function encapsulatedBytes(value: unknown): Buffer {
  const item = Array.isArray(value) ? value[0] : value;
  if (item instanceof ArrayBuffer) return Buffer.from(item);
  if (ArrayBuffer.isView(item)) return Buffer.from(item.buffer, item.byteOffset, item.byteLength);
  throw new Error("DICOM EncapsulatedDocument did not contain bytes.");
}

test("creates a valid Encapsulated PDF DICOM instance with stable supplied UIDs", async () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii");
  const dicom = await createClinicalDocumentDicom(pdf, "application/pdf", metadata);
  const dataset = parse(dicom);
  assert.equal(dataset.SOPClassUID, ENCAPSULATED_PDF_STORAGE_SOP_CLASS_UID);
  assert.equal(dataset.StudyInstanceUID, metadata.studyInstanceUid);
  assert.equal(dataset.SeriesInstanceUID, metadata.seriesInstanceUid);
  assert.equal(dataset.SOPInstanceUID, metadata.sopInstanceUid);
  assert.equal(dataset.PatientID, metadata.patientId);
  assert.equal(dataset.SeriesNumber, 1);
  assert.equal(dataset.InstanceNumber, Number(metadata.instanceNumber));
  assert.equal(dataset.StudyDate, metadata.studyDate);
  assert.equal(dataset.Manufacturer, "RISpro");
  assert.equal(dataset.MIMETypeOfEncapsulatedDocument, "application/pdf");
  assert.match(encapsulatedBytes(dataset.EncapsulatedDocument).toString("ascii"), /^%PDF-/);
});

test("converts JPEG and PNG input to PDF before encapsulation", async () => {
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } }).png().toBuffer();
  for (const [mime, source] of [["image/jpeg", jpeg], ["image/png", png]] as const) {
    const pdf = await normalizeClinicalDocumentToPdf(source, mime);
    assert.match(pdf.subarray(0, 8).toString("ascii"), /^%PDF-1\./);
    assert.match(pdf.toString("ascii"), /\/Subtype \/Image/);
    const dicom = await createClinicalDocumentDicom(source, mime, { ...metadata, sopInstanceUid: `2.25.${mime === "image/jpeg" ? "457" : "458"}` });
    assert.match(encapsulatedBytes(parse(dicom).EncapsulatedDocument).toString("ascii"), /^%PDF-/);
  }
});

test("creates parseable RGB Secondary Capture pages with the appointment modality", async () => {
  const dicom = await createClinicalDocumentSecondaryCapture(Buffer.from([255, 0, 0, 0, 255, 0]), 1, 2, { ...metadata, modality: "MR", seriesNumber: 9000, instanceNumber: 4 });
  const dataset = parse(dicom);
  assert.equal(dataset.SOPClassUID, SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID);
  assert.equal(dataset.Modality, "MR");
  assert.equal(dataset.SeriesDescription, "RISpro Scanned Documents");
  assert.deepEqual(dataset.ImageType, ["DERIVED", "SECONDARY"]);
  assert.equal(dataset.ConversionType, "SD");
  assert.equal(dataset.Rows, 1); assert.equal(dataset.Columns, 2); assert.equal(dataset.SamplesPerPixel, 3);
  assert.equal(dataset.PhotometricInterpretation, "RGB"); assert.equal(dataset.BitsAllocated, 8); assert.equal(dataset.HighBit, 7);
  assert.equal(dataset.InstanceNumber, 4); assert.equal(dataset.BurnedInAnnotation, "YES");
});

test("maps only supported RISpro modality aliases", () => {
  for (const [input, expected] of [["MRI", "MR"], ["MR", "MR"], ["CT", "CT"], ["ultrasound", "US"], ["Mammography", "MG"], ["X-ray", "DX"], ["CR", "CR"], ["PET", "PT"], ["nuclear_medicine", "NM"]]) assert.equal(normalizeRisproModalityCode(input), expected);
  assert.equal(normalizeRisproModalityCode("DOC"), null);
  assert.equal(normalizeRisproModalityCode("unknown"), null);
});

test("rejects unsupported or malformed source files safely", async () => {
  await assert.rejects(() => normalizeClinicalDocumentToPdf(Buffer.from("not a document"), "text/plain"), /unsupported/i);
  await assert.rejects(() => normalizeClinicalDocumentToPdf(Buffer.from("not a PDF"), "application/pdf"), /not a PDF/i);
});
