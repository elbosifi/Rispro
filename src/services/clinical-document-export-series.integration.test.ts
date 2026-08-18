import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import dcmjs from "dcmjs";
import { pool } from "../db/pool.js";
import type { OrthancInstanceDetails, OrthancStudyDetails } from "./authoritative-orthanc-service.js";
import { enqueueClinicalDocumentExportsForAppointment } from "./clinical-document-export-queue-service.js";
import { claimNextClinicalDocumentExport, processClaimedClinicalDocumentExport, retryClinicalDocumentExport, type ClinicalDocumentProcessorDependencies } from "./clinical-document-export-service.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

test.after(async () => { await pool.end().catch(() => undefined); });

function parseDicom(buffer: Buffer): Record<string, unknown> {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return DicomMetaDictionary.naturalizeDataset(parsed.dict) as Record<string, unknown>;
}

test("request and clinical documents export into separate exact-name unnumbered series in one authoritative study", async (t) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 11);
  const created = { patientId: 0, modalityId: 0, examTypeId: 0, policySetId: 0, policyVersionId: 0, bookingId: 0, userId: 0 };
  const documentIds: number[] = [];
  const exportIds: number[] = [];
  const uploaded = new Map<string, OrthancInstanceDetails>();
  const datasets: Record<string, unknown>[] = [];
  const sopLookups: string[] = [];
  let uploadCallCount = 0;
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
    created.userId = Number((await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,'Series Test','x','supervisor',true) returning id", [`series-test-${suffix}`])).rows[0]!.id);
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
      findInstanceBySopInstanceUid: async (uid: string) => {
        sopLookups.push(uid);
        return uploaded.get(uid) ?? null;
      },
      uploadDicomInstance: async (bytes: Buffer) => {
        uploadCallCount += 1;
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
    assert.ok(datasets.every((dataset) => dataset.StudyInstanceUID === studyUid));
    assert.ok(datasets.every((dataset) => dataset.SeriesNumber == null || dataset.SeriesNumber === ""));
    assert.ok(datasets.every((dataset) => dataset.SeriesDescription == null || dataset.SeriesDescription === ""));
    assert.deepEqual(datasets.filter((dataset) => dataset.SeriesInstanceUID === [...requestSeries][0]).map((dataset) => dataset.InstanceNumber), [1, 2]);
    assert.deepEqual(datasets.filter((dataset) => dataset.SeriesInstanceUID === [...clinicalSeries][0]).map((dataset) => dataset.InstanceNumber), [1, 2]);

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
    assert.ok(datasets.at(-1)?.SeriesDescription == null || datasets.at(-1)?.SeriesDescription === "");
    assert.equal(datasets.at(-1)?.SeriesNumber, 9001);

    await t.test("recovers an Orthanc-uploaded legacy SOP whose local page is still pending", async () => {
      const crashDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `crash-${suffix}.png`, `documents/export-test/${suffix}-crash.png`])).rows[0]!.id);
      documentIds.push(crashDocumentId);
      const crashSeriesUid = `2.25.${uidSuffix}9100`;
      const crashSopUid = `2.25.${uidSuffix}91001`;
      const crashExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,representation_type,series_number,study_instance_uid,series_instance_uid,expected_page_count,exported_page_count,verified_page_count,next_retry_at) values($1,$2,'pending','secondary_capture',9000,$3,$4,1,0,0,now()) returning id", [crashDocumentId, created.bookingId, studyUid, crashSeriesUid])).rows[0]!.id);
      exportIds.push(crashExportId);
      const pixelSha = createHash("sha256").update(pixels).digest("hex");
      await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status) values($1,1,1,$2,$3,$4,1,1,'pending')", [crashExportId, crashSopUid, crashSeriesUid, pixelSha]);
      uploaded.set(crashSopUid, { orthancInstanceId: "crash-page-1", orthancSeriesId: "crash-series", orthancStudyId: study.orthancStudyId, studyInstanceUid: studyUid, seriesInstanceUid: crashSeriesUid, sopInstanceUid: crashSopUid, patientId: patientPrimaryId, accessionNumber: accession, modality: "CT" });
      const pendingPage = await pool.query<{ status: string; exported_at: string | null; verified_at: string | null }>("select status,exported_at,verified_at from clinical_document_export_instances where export_id=$1", [crashExportId]);
      assert.deepEqual(pendingPage.rows[0], { status: "pending", exported_at: null, verified_at: null });
      const lookupCountBeforeRecovery = sopLookups.length;
      const uploadCountBeforeRecovery = uploadCallCount;

      const crashRow = await claimNextClinicalDocumentExport(`series-test-crash-${suffix}`);
      assert.equal(Number(crashRow?.id), crashExportId);
      await processClaimedClinicalDocumentExport(crashRow!, dependencies);

      assert.deepEqual(sopLookups.slice(lookupCountBeforeRecovery), [crashSopUid]);
      assert.equal(uploadCallCount, uploadCountBeforeRecovery);
      const recoveredExport = await pool.query<{ status: string; series_number: number | null; series_instance_uid: string; verified_page_count: number }>("select status,series_number,series_instance_uid,verified_page_count from clinical_document_exports where id=$1", [crashExportId]);
      assert.deepEqual(recoveredExport.rows[0], { status: "exported", series_number: 9000, series_instance_uid: crashSeriesUid, verified_page_count: 1 });
      const recoveredPage = await pool.query<{ status: string; sop_instance_uid: string; series_instance_uid: string; exported_at: string | null; verified_at: string | null }>("select status,sop_instance_uid,series_instance_uid,exported_at,verified_at from clinical_document_export_instances where export_id=$1", [crashExportId]);
      assert.equal(recoveredPage.rows[0]?.status, "verified");
      assert.equal(recoveredPage.rows[0]?.sop_instance_uid, crashSopUid);
      assert.equal(recoveredPage.rows[0]?.series_instance_uid, crashSeriesUid);
      assert.ok(recoveredPage.rows[0]?.exported_at);
      assert.ok(recoveredPage.rows[0]?.verified_at);
    });

    await t.test("normalizes only a genuinely untouched numbered legacy export", async () => {
      const untouchedDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `untouched-${suffix}.png`, `documents/export-test/${suffix}-untouched.png`])).rows[0]!.id);
      documentIds.push(untouchedDocumentId);
      const untouchedSeriesUid = `2.25.${uidSuffix}9200`;
      const untouchedExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,representation_type,series_number,study_instance_uid,series_instance_uid,exported_page_count,verified_page_count,next_retry_at) values($1,$2,'pending','secondary_capture',9000,$3,$4,0,0,now()) returning id", [untouchedDocumentId, created.bookingId, studyUid, untouchedSeriesUid])).rows[0]!.id);
      exportIds.push(untouchedExportId);

      const untouchedRow = await claimNextClinicalDocumentExport(`series-test-untouched-${suffix}`);
      assert.equal(Number(untouchedRow?.id), untouchedExportId);
      await processClaimedClinicalDocumentExport(untouchedRow!, dependencies);

      const untouchedResult = await pool.query<{ status: string; series_number: number | null; series_instance_uid: string }>("select status,series_number,series_instance_uid from clinical_document_exports where id=$1", [untouchedExportId]);
      assert.equal(untouchedResult.rows[0]?.status, "exported");
      assert.equal(untouchedResult.rows[0]?.series_number, null);
      assert.notEqual(untouchedResult.rows[0]?.series_instance_uid, untouchedSeriesUid);
      assert.ok(datasets.at(-1)?.SeriesDescription == null || datasets.at(-1)?.SeriesDescription === "");
      assert.ok(datasets.at(-1)?.SeriesNumber == null || datasets.at(-1)?.SeriesNumber === "");
    });

    await t.test("schedules retryable failures below the limit and blocks exhaustion until manual retry", async () => {
      const failingClient = { ...orthancClient, findStudy: async () => ({ status: "not_found" as const, matchKey: "study_instance_uid" as const, study: null }) };
      const failingDependencies: ClinicalDocumentProcessorDependencies = { ...dependencies, createOrthancClient: async () => failingClient };
      const belowLimitDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `retry-${suffix}.png`, `documents/export-test/${suffix}-retry.png`])).rows[0]!.id);
      documentIds.push(belowLimitDocumentId);
      const belowLimitExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,attempt_count,representation_type,next_retry_at) values($1,$2,'pending',6,'secondary_capture',now()) returning id", [belowLimitDocumentId, created.bookingId])).rows[0]!.id);
      exportIds.push(belowLimitExportId);
      const belowLimitRow = await claimNextClinicalDocumentExport(`series-test-retry-${suffix}`);
      assert.equal(Number(belowLimitRow?.id), belowLimitExportId);
      await processClaimedClinicalDocumentExport(belowLimitRow!, failingDependencies);
      const scheduled = await pool.query<{ status: string; attempt_count: number; next_retry_at: string | null }>("select status,attempt_count,next_retry_at from clinical_document_exports where id=$1", [belowLimitExportId]);
      assert.equal(scheduled.rows[0]?.status, "failed");
      assert.equal(Number(scheduled.rows[0]?.attempt_count), 7);
      assert.ok(scheduled.rows[0]?.next_retry_at);

      const exhaustedDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `exhausted-${suffix}.png`, `documents/export-test/${suffix}-exhausted.png`])).rows[0]!.id);
      documentIds.push(exhaustedDocumentId);
      const stable = { study: studyUid, series: `2.25.${uidSuffix}9300`, sop: `2.25.${uidSuffix}93001` };
      const exhaustedExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,attempt_count,representation_type,series_number,study_instance_uid,series_instance_uid,sop_instance_uid,expected_page_count,next_retry_at) values($1,$2,'pending',7,'secondary_capture',9000,$3,$4,$5,1,now()) returning id", [exhaustedDocumentId, created.bookingId, stable.study, stable.series, stable.sop])).rows[0]!.id);
      exportIds.push(exhaustedExportId);
      await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status) values($1,1,1,$2,$3,$4,1,1,'pending')", [exhaustedExportId, stable.sop, stable.series, createHash("sha256").update(pixels).digest("hex")]);
      uploaded.set(stable.sop, { orthancInstanceId: "exhausted-page-1", orthancSeriesId: "legacy-exhausted-series", orthancStudyId: study.orthancStudyId, studyInstanceUid: studyUid, seriesInstanceUid: stable.series, sopInstanceUid: stable.sop, patientId: patientPrimaryId, accessionNumber: accession, modality: "CT" });
      const exhaustedRow = await claimNextClinicalDocumentExport(`series-test-exhausted-${suffix}`);
      assert.equal(Number(exhaustedRow?.id), exhaustedExportId);
      await processClaimedClinicalDocumentExport(exhaustedRow!, failingDependencies);
      const exhausted = await pool.query<{ status: string; attempt_count: number; next_retry_at: string | null; last_error: string; study_instance_uid: string; series_instance_uid: string; sop_instance_uid: string }>("select status,attempt_count,next_retry_at,last_error,study_instance_uid,series_instance_uid,sop_instance_uid from clinical_document_exports where id=$1", [exhaustedExportId]);
      assert.equal(exhausted.rows[0]?.status, "blocked");
      assert.equal(Number(exhausted.rows[0]?.attempt_count), 8);
      assert.equal(exhausted.rows[0]?.next_retry_at, null);
      assert.match(exhausted.rows[0]?.last_error || "", /Automatic retry limit reached/);
      assert.equal(await claimNextClinicalDocumentExport(`series-test-exhausted-auto-${suffix}`), null);

      const manualRetry = await retryClinicalDocumentExport(exhaustedExportId, created.userId);
      assert.equal(manualRetry.status, "pending");
      assert.equal(manualRetry.attempt_count, 0);
      assert.equal(manualRetry.study_instance_uid, stable.study);
      assert.equal(manualRetry.series_instance_uid, stable.series);
      assert.equal(manualRetry.sop_instance_uid, stable.sop);
      assert.equal((await pool.query<{ sop_instance_uid: string }>("select sop_instance_uid from clinical_document_export_instances where export_id=$1", [exhaustedExportId])).rows[0]?.sop_instance_uid, stable.sop);
      const retriedRow = await claimNextClinicalDocumentExport(`series-test-manual-${suffix}`);
      assert.equal(Number(retriedRow?.id), exhaustedExportId);
      await processClaimedClinicalDocumentExport(retriedRow!, dependencies);
      assert.equal((await pool.query<{ status: string }>("select status from clinical_document_exports where id=$1", [exhaustedExportId])).rows[0]?.status, "exported");
      assert.equal((await pool.query<{ sop_instance_uid: string; status: string }>("select sop_instance_uid,status from clinical_document_export_instances where export_id=$1", [exhaustedExportId])).rows[0]?.sop_instance_uid, stable.sop);
    });
  } finally {
    if (exportIds.length) await pool.query("delete from audit_log where entity_type='clinical_document_export' and entity_id=any($1::bigint[])", [exportIds]);
    if (created.bookingId) await pool.query("delete from clinical_document_exports where appointment_id=$1", [created.bookingId]);
    if (documentIds.length) await pool.query("delete from documents where id=any($1::bigint[])", [documentIds]);
    if (created.bookingId) await pool.query("delete from appointments_v2.bookings where id=$1", [created.bookingId]);
    if (created.patientId) await pool.query("delete from patients where id=$1", [created.patientId]);
    if (created.userId) await pool.query("delete from users where id=$1", [created.userId]);
    if (created.examTypeId) await pool.query("delete from exam_types where id=$1", [created.examTypeId]);
    if (created.policyVersionId) await pool.query("delete from appointments_v2.policy_versions where id=$1", [created.policyVersionId]);
    if (created.policySetId) await pool.query("delete from appointments_v2.policy_sets where id=$1", [created.policySetId]);
  }
});
