import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import dcmjs from "dcmjs";
import { pool } from "../db/pool.js";
import type { OrthancInstanceDetails, OrthancStudyDetails } from "./authoritative-orthanc-service.js";
import { enqueueClinicalDocumentExportsForAppointment } from "./clinical-document-export-queue-service.js";
import { claimNextClinicalDocumentExport, processClaimedClinicalDocumentExport, type ClinicalDocumentProcessorDependencies } from "./clinical-document-export-service.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

test.after(async () => { await pool.end().catch(() => undefined); });

function parseDicom(buffer: Buffer): Record<string, unknown> {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return DicomMetaDictionary.naturalizeDataset(parsed.dict) as Record<string, unknown>;
}

test("request and clinical documents export into separate exact-name unnumbered series in one authoritative study", async (t) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 11);
  const created = { patientId: 0, modalityId: 0, examTypeId: 0, policySetId: 0, policyVersionId: 0, bookingId: 0 };
  const documentIds: number[] = [];
  const exportIds: number[] = [];
  const uploaded = new Map<string, OrthancInstanceDetails>();
  const datasets: Record<string, unknown>[] = [];
  const uidSuffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const studyUid = `2.25.${uidSuffix}`;
  const patientPrimaryId = `PID-${suffix}`;

  try {
    try { await pool.query("select 1 from clinical_document_exports limit 1"); } catch { t.skip("Disposable PostgreSQL is not migrated or is unavailable."); return; }
    const modality = await pool.query<{ id: number }>("select id from modalities where upper(code)='CT' order by id limit 1");
    assert.ok(modality.rows[0], "The disposable test database must contain the seeded CT modality.");
    created.modalityId = Number(modality.rows[0].id);
    created.examTypeId = Number((await pool.query<{ id: number }>("insert into exam_types(modality_id,code,name_ar,name_en) values($1,$2,$3,$4) returning id", [created.modalityId, `SERIES_${suffix}`, "فحص", "Series test"])).rows[0]!.id);
    created.policySetId = Number((await pool.query<{ id: number }>("insert into appointments_v2.policy_sets(key,name) values($1,'Series test') returning id", [`series_test_${suffix}`])).rows[0]!.id);
    created.policyVersionId = Number((await pool.query<{ id: number }>("insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'published',$2) returning id", [created.policySetId, `hash-${suffix}`])).rows[0]!.id);
    created.patientId = Number((await pool.query<{ id: number }>("insert into patients(mrn,national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,normalized_arabic_name,age_years,sex,phone_1) values($1,$2,'other',$3,$4,$5,$4,40,'O',$6) returning id", [`SERIES-MRN-${suffix}`, `8${suffix}`, patientPrimaryId, "مريض اختبار", "Series Patient", `09${suffix.slice(0, 8)}`])).rows[0]!.id);
    created.bookingId = Number((await pool.query<{ id: number }>("insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,case_category,status,completed_at,policy_version_id,study_instance_uid) values($1,$2,$3,current_date,'non_oncology','completed',now(),$4,$5) returning id", [created.patientId, created.modalityId, created.examTypeId, created.policyVersionId, studyUid])).rows[0]!.id);
    const accession = `V2-${String(created.bookingId).padStart(6, "0")}`;

    for (const [index, kind] of ["appointment_request", "appointment_request", "clinical_document", "clinical_document"].entries()) {
      const result = await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,$2,'manual_upload',$3,$4,'image/png',3,$5) returning id", [created.patientId, kind, `${kind}-${index}.png`, `documents/export-test/${suffix}-${index}.png`, created.bookingId]);
      documentIds.push(Number(result.rows[0]!.id));
    }
    const legacyDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `legacy-${suffix}.png`, `documents/export-test/${suffix}-legacy.png`])).rows[0]!.id);
    documentIds.push(legacyDocumentId);
    const legacySeriesUid = `2.25.${uidSuffix}9000`;
    exportIds.push(Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,representation_type,series_number,study_instance_uid,series_instance_uid,exported_at,verified_at) values($1,$2,'exported','secondary_capture',9000,$3,$4,now(),now()) returning id", [legacyDocumentId, created.bookingId, studyUid, legacySeriesUid])).rows[0]!.id));

    exportIds.push(...await enqueueClinicalDocumentExportsForAppointment(created.bookingId));
    assert.equal(exportIds.length, 5);

    const study: OrthancStudyDetails = { orthancStudyId: "study-1", studyInstanceUid: studyUid, accessionNumber: accession, patientId: patientPrimaryId, patientName: "Series^Patient", patientBirthDate: null, patientSex: "O", studyDate: new Date().toISOString().slice(0, 10).replaceAll("-", ""), studyDescription: null, modalitiesInStudy: ["CT"], seriesCount: 1, instanceCount: 1 };
    const orthancClient = {
      findStudy: async () => ({ status: "matched" as const, matchKey: "study_instance_uid" as const, study }),
      findInstanceBySopInstanceUid: async (uid: string) => uploaded.get(uid) ?? null,
      uploadDicomInstance: async (bytes: Buffer) => {
        const dataset = parseDicom(bytes);
        datasets.push(dataset);
        const instance: OrthancInstanceDetails = {
          orthancInstanceId: `instance-${datasets.length}`,
          orthancSeriesId: `series-${String(dataset.SeriesInstanceUID)}`,
          orthancStudyId: study.orthancStudyId,
          studyInstanceUid: String(dataset.StudyInstanceUID),
          seriesInstanceUid: String(dataset.SeriesInstanceUID),
          sopInstanceUid: String(dataset.SOPInstanceUID),
          patientId: String(dataset.PatientID),
          accessionNumber: String(dataset.AccessionNumber),
          modality: String(dataset.Modality),
        };
        uploaded.set(instance.sopInstanceUid!, instance);
        return instance;
      },
    };
    const dependencies: ClinicalDocumentProcessorDependencies = {
      createOrthancClient: async () => orthancClient,
      readDocumentBytes: async () => Buffer.from("image"),
      renderDocument: async () => ({ directory: "unused", pages: [{ pageNumber: 1, path: "page-1", rows: 1, columns: 1 }] }),
      readRenderedPage: async () => Buffer.from([1, 2, 3]),
      cleanupRenderedDocument: async () => undefined,
    };

    for (let index = 0; index < 4; index += 1) {
      const row = await claimNextClinicalDocumentExport(`series-test-${suffix}-${index}`);
      assert.ok(row);
      await processClaimedClinicalDocumentExport(row, dependencies);
    }
    assert.equal(await claimNextClinicalDocumentExport(`series-test-empty-${suffix}`), null);

    const rows = await pool.query<{ document_type: string; status: string; study_instance_uid: string; series_instance_uid: string; series_number: number | null; last_error: string | null }>("select d.document_type,e.status,e.study_instance_uid,e.series_instance_uid,e.series_number,e.last_error from clinical_document_exports e join documents d on d.id=e.document_id where e.id=any($1::bigint[]) and e.id<>$2 order by e.id", [exportIds, exportIds[0]]);
    assert.equal(rows.rowCount, 4);
    assert.ok(rows.rows.every((row) => row.status === "exported" && row.study_instance_uid === studyUid && row.series_number === null), JSON.stringify(rows.rows));
    const requestSeries = new Set(rows.rows.filter((row) => row.document_type === "appointment_request").map((row) => row.series_instance_uid));
    const clinicalSeries = new Set(rows.rows.filter((row) => row.document_type === "clinical_document").map((row) => row.series_instance_uid));
    assert.equal(requestSeries.size, 1);
    assert.equal(clinicalSeries.size, 1);
    assert.notEqual([...requestSeries][0], [...clinicalSeries][0]);
    assert.notEqual([...clinicalSeries][0], legacySeriesUid);
    assert.deepEqual(datasets.map((dataset) => dataset.SeriesDescription).sort(), ["Clinical Documents", "Clinical Documents", "Request Documents", "Request Documents"]);
    assert.ok(datasets.every((dataset) => dataset.StudyInstanceUID === studyUid));
    assert.ok(datasets.every((dataset) => dataset.SeriesNumber == null || dataset.SeriesNumber === ""));
    assert.deepEqual(datasets.filter((dataset) => dataset.SeriesDescription === "Request Documents").map((dataset) => dataset.InstanceNumber), [1, 2]);
    assert.deepEqual(datasets.filter((dataset) => dataset.SeriesDescription === "Clinical Documents").map((dataset) => dataset.InstanceNumber), [1, 2]);

    const partialDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `partial-${suffix}.png`, `documents/export-test/${suffix}-partial.png`])).rows[0]!.id);
    documentIds.push(partialDocumentId);
    const partialSeriesUid = `2.25.${uidSuffix}9001`;
    const firstPageSopUid = `2.25.${uidSuffix}90011`;
    const partialExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,representation_type,series_number,study_instance_uid,series_instance_uid,expected_page_count,exported_page_count,verified_page_count,next_retry_at) values($1,$2,'pending','secondary_capture',9001,$3,$4,2,1,1,now()) returning id", [partialDocumentId, created.bookingId, studyUid, partialSeriesUid])).rows[0]!.id);
    exportIds.push(partialExportId);
    const pixels = Buffer.from([1, 2, 3]);
    await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status,orthanc_instance_id,orthanc_series_id,exported_at,verified_at) values($1,1,1,$2,$3,$4,1,1,'verified','legacy-page-1','legacy-series',now(),now())", [partialExportId, firstPageSopUid, partialSeriesUid, createHash("sha256").update(pixels).digest("hex")]);
    uploaded.set(firstPageSopUid, { orthancInstanceId: "legacy-page-1", orthancSeriesId: "legacy-series", orthancStudyId: study.orthancStudyId, studyInstanceUid: studyUid, seriesInstanceUid: partialSeriesUid, sopInstanceUid: firstPageSopUid, patientId: patientPrimaryId, accessionNumber: accession, modality: "CT" });
    const partialRow = await claimNextClinicalDocumentExport(`series-test-partial-${suffix}`);
    assert.equal(Number(partialRow?.id), partialExportId);
    await processClaimedClinicalDocumentExport(partialRow!, {
      ...dependencies,
      renderDocument: async () => ({ directory: "unused", pages: [{ pageNumber: 1, path: "page-1", rows: 1, columns: 1 }, { pageNumber: 2, path: "page-2", rows: 1, columns: 1 }] }),
    });
    const partialResult = await pool.query<{ status: string; series_number: number | null; series_instance_uid: string; verified_page_count: number }>("select status,series_number,series_instance_uid,verified_page_count from clinical_document_exports where id=$1", [partialExportId]);
    assert.deepEqual(partialResult.rows[0], { status: "exported", series_number: 9001, series_instance_uid: partialSeriesUid, verified_page_count: 2 });
    assert.equal(datasets.at(-1)?.SeriesDescription, "RISpro Scanned Documents");
    assert.equal(datasets.at(-1)?.SeriesNumber, 9001);
  } finally {
    if (exportIds.length) await pool.query("delete from audit_log where entity_type='clinical_document_export' and entity_id=any($1::bigint[])", [exportIds]);
    if (created.bookingId) await pool.query("delete from clinical_document_exports where appointment_id=$1", [created.bookingId]);
    if (documentIds.length) await pool.query("delete from documents where id=any($1::bigint[])", [documentIds]);
    if (created.bookingId) await pool.query("delete from appointments_v2.bookings where id=$1", [created.bookingId]);
    if (created.patientId) await pool.query("delete from patients where id=$1", [created.patientId]);
    if (created.examTypeId) await pool.query("delete from exam_types where id=$1", [created.examTypeId]);
    if (created.policyVersionId) await pool.query("delete from appointments_v2.policy_versions where id=$1", [created.policyVersionId]);
    if (created.policySetId) await pool.query("delete from appointments_v2.policy_sets where id=$1", [created.policySetId]);
  }
});
