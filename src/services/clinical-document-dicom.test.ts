import assert from "node:assert/strict";
import test from "node:test";
import dcmjs from "dcmjs";
import sharp from "sharp";
import { createClinicalDocumentDicom, createClinicalDocumentSecondaryCapture, documentSeriesDescription, documentSeriesKind, normalizeClinicalDocumentToPdf, normalizeRisproModalityCode, ENCAPSULATED_PDF_STORAGE_SOP_CLASS_UID, SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID } from "./clinical-document-dicom.js";

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
  seriesKind: "clinical" as const,
};

function parse(buffer: Buffer): Record<string, unknown> {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return DicomMetaDictionary.naturalizeDataset(parsed.dict) as Record<string, unknown>;
}

function parseRaw(buffer: Buffer): Record<string, { vr?: string; Value?: unknown[] }> {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return parsed.dict as Record<string, { vr?: string; Value?: unknown[] }>;
}

function encapsulatedBytes(value: unknown): Buffer {
  const item = Array.isArray(value) ? value[0] : value;
  if (item instanceof ArrayBuffer) return Buffer.from(item);
  if (ArrayBuffer.isView(item)) return Buffer.from(item.buffer, item.byteOffset, item.byteLength);
  throw new Error("DICOM EncapsulatedDocument did not contain bytes.");
}

function pixelBytes(value: unknown): Buffer {
  if (Array.isArray(value)) return pixelBytes(value[0]);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("DICOM PixelData did not contain native bytes.");
}

function assertUnnumberedSeries(buffer: Buffer, dataset: Record<string, unknown>): void {
  assert.ok(dataset.SeriesNumber == null || dataset.SeriesNumber === "");
  const rawValue = parseRaw(buffer)["00200011"]?.Value;
  assert.ok(rawValue == null || rawValue.length === 0 || rawValue.every((value) => String(value ?? "").trim() === ""));
}

function assertAbsentOrEmptySecondaryCaptureMetadata(buffer: Buffer, dataset: Record<string, unknown>, allowSeriesDescription = false): void {
  const raw = parseRaw(buffer);
  const tags: Record<string, string> = {
    StudyDate: "00080020", StudyTime: "00080030", SeriesDescription: "0008103E", StudyDescription: "00081030",
    ContentDate: "00080023", ContentTime: "00080033", InstanceCreationDate: "00080012", InstanceCreationTime: "00080013",
    AcquisitionDate: "00080022", AcquisitionTime: "00080032", AcquisitionDateTime: "0008002A", SeriesDate: "00080021", SeriesTime: "00080031",
    ProtocolName: "00181030", RequestedProcedureDescription: "00321060", Manufacturer: "00080070",
  };
  for (const [name, tag] of Object.entries(tags)) {
    if (allowSeriesDescription && name === "SeriesDescription") continue;
    const value = raw[tag]?.Value;
    assert.ok(value == null || value.length === 0 || value.every((item) => String(item ?? "").trim() === ""), `${name} must be absent or empty`);
    assert.ok(dataset[name] == null || String(dataset[name]).trim() === "", `${name} must be absent or empty when naturalized`);
  }
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
  assert.equal(dataset.SeriesDescription, "Clinical Documents");
  assert.doesNotMatch(String(dataset.SeriesDescription), /RISpro|Scanned/);
  assertUnnumberedSeries(dicom, dataset);
  assert.equal(dataset.InstanceNumber, Number(metadata.instanceNumber));
  assert.equal(dataset.StudyDate, metadata.studyDate);
  assert.equal(dataset.Manufacturer, "RISpro");
  assert.equal(dataset.MIMETypeOfEncapsulatedDocument, "application/pdf");
  assert.match(encapsulatedBytes(dataset.EncapsulatedDocument).toString("ascii"), /^%PDF-/);
});

test("uses exact semantic descriptions for unnumbered Encapsulated PDF series", async () => {
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n", "ascii");
  for (const [seriesKind, expected] of [["request", "Request Documents"], ["clinical", "Clinical Documents"]] as const) {
    const dicom = await createClinicalDocumentDicom(pdf, "application/pdf", { ...metadata, seriesKind, sopInstanceUid: seriesKind === "request" ? "2.25.901" : "2.25.902" });
    const dataset = parse(dicom);
    assert.equal(dataset.SeriesDescription, expected);
    assertUnnumberedSeries(dicom, dataset);
  }
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

test("creates minimal RGB Secondary Capture MR and CT pages with native PixelData", async () => {
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0]);
  for (const [modality, expectedModality, sopInstanceUid, instanceNumber] of [["MRI", "MR", "2.25.457", 4], ["CT", "CT", "2.25.458", 5]] as const) {
    const suppliedDateMetadata = { ...metadata, sopInstanceUid, modality, instanceNumber, studyDate: "19991231", studyTime: "120000", contentDate: "19991231", contentTime: "120000" };
    const dicom = await createClinicalDocumentSecondaryCapture(pixels, 1, 2, suppliedDateMetadata);
    const dataset = parse(dicom);
    assert.equal(dataset.SOPClassUID, SECONDARY_CAPTURE_IMAGE_STORAGE_SOP_CLASS_UID);
    assert.match(dicom.toString("latin1"), /1\.2\.840\.10008\.1\.2\.1/);
    assert.equal(dataset.StudyInstanceUID, metadata.studyInstanceUid); assert.equal(dataset.SeriesInstanceUID, metadata.seriesInstanceUid);
    assert.equal(dataset.SOPInstanceUID, sopInstanceUid); assert.equal(dataset.PatientID, metadata.patientId); assert.deepEqual(dataset.PatientName, [{ Alphabetic: metadata.patientName }]); assert.equal(dataset.AccessionNumber, metadata.accessionNumber);
    assert.equal(dataset.Modality, expectedModality); assert.equal(dataset.ConversionType, "SD");
    assert.equal(dataset.Rows, 1); assert.equal(dataset.Columns, 2); assert.equal(dataset.SamplesPerPixel, 3); assert.equal(dataset.PlanarConfiguration, 0);
    assert.equal(dataset.PhotometricInterpretation, "RGB"); assert.equal(dataset.BitsAllocated, 8); assert.equal(dataset.BitsStored, 8); assert.equal(dataset.HighBit, 7); assert.equal(dataset.PixelRepresentation, 0);
    assert.equal(pixelBytes(dataset.PixelData).length, Number(dataset.Rows) * Number(dataset.Columns) * 3);
    assert.equal(dataset.BurnedInAnnotation, "YES"); assertUnnumberedSeries(dicom, dataset); assert.equal(dataset.InstanceNumber, instanceNumber);
    const rawPixelData = parseRaw(dicom)["7FE00010"];
    assert.equal(rawPixelData?.vr, "OW");
    assert.equal(pixelBytes(rawPixelData?.Value).length, Number(dataset.Rows) * Number(dataset.Columns) * 3);
    assert.equal(dataset.InstanceNumber, instanceNumber); assert.equal(dataset.BurnedInAnnotation, "YES");
    assertAbsentOrEmptySecondaryCaptureMetadata(dicom, dataset);
    for (const tag of ["SliceThickness", "ImagePositionPatient", "ImageOrientationPatient", "MagneticFieldStrength", "EchoTime", "RepetitionTime"]) assert.equal(dataset[tag], undefined);
  }
});

test("emits an explicit reconciliation SeriesDescription without DICOM date or time values", async () => {
  const dicom = await createClinicalDocumentSecondaryCapture(Buffer.from([255, 255, 255]), 1, 1, {
    ...metadata,
    modality: "CT",
    instanceNumber: 1,
    seriesDescription: "RISpro Patient Identity Reconciliation",
  });
  const dataset = parse(dicom);
  assert.equal(dataset.SeriesDescription, "RISpro Patient Identity Reconciliation");
  assertAbsentOrEmptySecondaryCaptureMetadata(dicom, dataset, true);
});

test("maps only supported RISpro modality aliases", () => {
  for (const [input, expected] of [["MRI", "MR"], ["MR", "MR"], ["CT", "CT"], ["ultrasound", "US"], ["Mammography", "MG"], ["X-ray", "DX"], ["CR", "CR"], ["PET", "PT"], ["nuclear_medicine", "NM"]]) assert.equal(normalizeRisproModalityCode(input), expected);
  assert.equal(normalizeRisproModalityCode("DOC"), null);
  assert.equal(normalizeRisproModalityCode("unknown"), null);
});

test("maps only supported semantic document series kinds", () => {
  assert.equal(documentSeriesKind("appointment_request"), "request");
  assert.equal(documentSeriesKind("clinical_document"), "clinical");
  assert.equal(documentSeriesDescription("request"), "Request Documents");
  assert.equal(documentSeriesDescription("clinical"), "Clinical Documents");
  assert.throws(() => documentSeriesKind("other"), /Unsupported document type/);
});

test("preserves a historical series number only for explicit legacy recovery", async () => {
  const pixels = Buffer.from([255, 255, 255]);
  const dicom = await createClinicalDocumentSecondaryCapture(pixels, 1, 1, {
    ...metadata,
    modality: "CT",
    instanceNumber: 1,
    legacySeriesNumber: 9000,
  });
  const dataset = parse(dicom);
  assertAbsentOrEmptySecondaryCaptureMetadata(dicom, dataset);
  assert.equal(dataset.SeriesNumber, 9000);
});

test("rejects unsupported or malformed source files safely", async () => {
  await assert.rejects(() => normalizeClinicalDocumentToPdf(Buffer.from("not a document"), "text/plain"), /unsupported/i);
  await assert.rejects(() => normalizeClinicalDocumentToPdf(Buffer.from("not a PDF"), "application/pdf"), /not a PDF/i);
});
