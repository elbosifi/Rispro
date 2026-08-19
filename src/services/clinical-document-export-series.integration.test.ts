import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import dcmjs from "dcmjs";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import type { OrthancInstanceDetails, OrthancStudyDetails } from "./authoritative-orthanc-service.js";
import { enqueueClinicalDocumentExportsForAppointment } from "./clinical-document-export-queue-service.js";
import { claimNextClinicalDocumentExport, processClaimedClinicalDocumentExport, rebuildClinicalDocumentSecondaryCaptures, retryClinicalDocumentExport, type ClinicalDocumentProcessorDependencies } from "./clinical-document-export-service.js";

const { DicomMessage, DicomMetaDictionary } = dcmjs.data;

test.after(async () => { await pool.end().catch(() => undefined); });

function parseDicom(buffer: Buffer): Record<string, unknown> {
  const parsed = DicomMessage.readFile(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return DicomMetaDictionary.naturalizeDataset(parsed.dict) as Record<string, unknown>;
}

test("request and clinical documents export into separate exact-name unnumbered series in one authoritative study", async (t) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 11);
  const directDestination = `authoritative_orthanc:test:${suffix}`;
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
    created.bookingId = Number((await pool.query<{ id: number }>("insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,case_category,status,completed_at,policy_version_id,study_instance_uid) values($1,$2,$3,date '2026-08-18','non_oncology','completed',now(),$4,$5) returning id", [created.patientId, created.modalityId, created.examTypeId, created.policyVersionId, studyUid])).rows[0]!.id);
    const accession = `V2-${String(created.bookingId).padStart(6, "0")}`;

    for (const [index, kind] of ["appointment_request", "appointment_request", "clinical_document", "clinical_document"].entries()) {
      const result = await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,$2,'manual_upload',$3,$4,'image/png',3,$5) returning id", [created.patientId, kind, `${kind}-${index}.png`, `documents/export-test/${suffix}-${index}.png`, created.bookingId]);
      documentIds.push(Number(result.rows[0]!.id));
    }
    const legacyDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `legacy-${suffix}.png`, `documents/export-test/${suffix}-legacy.png`])).rows[0]!.id);
    documentIds.push(legacyDocumentId);
    const legacySeriesUid = `2.25.${uidSuffix}9000`;
    exportIds.push(Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,status,representation_type,series_number,study_instance_uid,series_instance_uid,exported_at,verified_at) values($1,$2,'exported','secondary_capture',9000,$3,$4,now(),now()) returning id", [legacyDocumentId, created.bookingId, studyUid, legacySeriesUid])).rows[0]!.id));

    const queuedExportIds = await enqueueClinicalDocumentExportsForAppointment(created.bookingId);
    exportIds.push(...queuedExportIds);
    await pool.query("update clinical_document_exports set destination_key=$1 where id=any($2::bigint[])", [directDestination, queuedExportIds]);
    assert.equal(exportIds.length, 5);

    const study: OrthancStudyDetails = { orthancStudyId: "study-1", studyInstanceUid: studyUid, accessionNumber: accession, patientId: patientPrimaryId, patientName: "Series^Patient", patientBirthDate: null, patientSex: "O", studyDate: "20260818", studyTime: "101530", studyDescription: "CT Chest", modalitiesInStudy: ["CT"], seriesCount: 1, instanceCount: 1 };
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
      const row = await claimNextClinicalDocumentExport(`series-test-${suffix}-${index}`, 300, directDestination);
      assert.ok(row);
      await processClaimedClinicalDocumentExport(row, dependencies);
    }
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
    assert.ok(datasets.filter((dataset) => dataset.SeriesInstanceUID === [...requestSeries][0]).every((dataset) => dataset.SeriesDescription === "Request Documents"));
    assert.ok(datasets.filter((dataset) => dataset.SeriesInstanceUID === [...clinicalSeries][0]).every((dataset) => dataset.SeriesDescription === "Clinical Documents"));
    assert.deepEqual(datasets.filter((dataset) => dataset.SeriesInstanceUID === [...requestSeries][0]).map((dataset) => dataset.InstanceNumber), [1, 2]);
    assert.deepEqual(datasets.filter((dataset) => dataset.SeriesInstanceUID === [...clinicalSeries][0]).map((dataset) => dataset.InstanceNumber), [1, 2]);

    const partialDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `partial-${suffix}.png`, `documents/export-test/${suffix}-partial.png`])).rows[0]!.id);
    documentIds.push(partialDocumentId);
    const partialSeriesUid = `2.25.${uidSuffix}9001`;
    const firstPageSopUid = `2.25.${uidSuffix}90011`;
    const partialExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,representation_type,series_number,study_instance_uid,series_instance_uid,expected_page_count,exported_page_count,verified_page_count,next_retry_at) values($1,$2,$3,'pending','secondary_capture',9001,$4,$5,2,1,1,now()) returning id", [partialDocumentId, created.bookingId, directDestination, studyUid, partialSeriesUid])).rows[0]!.id);
    exportIds.push(partialExportId);
    const pixels = Buffer.from([1, 2, 3]);
    await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status,orthanc_instance_id,orthanc_series_id,exported_at,verified_at) values($1,1,1,$2,$3,$4,1,1,'verified','legacy-page-1','legacy-series',now(),now())", [partialExportId, firstPageSopUid, partialSeriesUid, createHash("sha256").update(pixels).digest("hex")]);
    uploaded.set(firstPageSopUid, { orthancInstanceId: "legacy-page-1", orthancSeriesId: "legacy-series", orthancStudyId: study.orthancStudyId, studyInstanceUid: studyUid, seriesInstanceUid: partialSeriesUid, sopInstanceUid: firstPageSopUid, patientId: patientPrimaryId, accessionNumber: accession, modality: "CT" });
    const partialRow = await claimNextClinicalDocumentExport(`series-test-partial-${suffix}`, 300, directDestination);
    assert.equal(Number(partialRow?.id), partialExportId);
    await processClaimedClinicalDocumentExport(partialRow!, {
      ...dependencies,
      renderDocument: async () => ({ directory: "unused", pages: [{ pageNumber: 1, path: "page-1", rows: 1, columns: 1 }, { pageNumber: 2, path: "page-2", rows: 1, columns: 1 }] }),
    });
    const partialResult = await pool.query<{ status: string; series_number: number | null; series_instance_uid: string; verified_page_count: number }>("select status,series_number,series_instance_uid,verified_page_count from clinical_document_exports where id=$1", [partialExportId]);
    assert.deepEqual(partialResult.rows[0], { status: "exported", series_number: 9001, series_instance_uid: partialSeriesUid, verified_page_count: 2 });
    assert.equal(datasets.at(-1)?.SeriesDescription, "Clinical Documents");
    assert.equal(datasets.at(-1)?.SeriesNumber, 9001);

    await t.test("recovers an Orthanc-uploaded legacy SOP whose local page is still pending", async () => {
      const crashDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `crash-${suffix}.png`, `documents/export-test/${suffix}-crash.png`])).rows[0]!.id);
      documentIds.push(crashDocumentId);
      const crashSeriesUid = `2.25.${uidSuffix}9100`;
      const crashSopUid = `2.25.${uidSuffix}91001`;
      const crashExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,representation_type,series_number,study_instance_uid,series_instance_uid,expected_page_count,exported_page_count,verified_page_count,next_retry_at) values($1,$2,$3,'pending','secondary_capture',9000,$4,$5,1,0,0,now()) returning id", [crashDocumentId, created.bookingId, directDestination, studyUid, crashSeriesUid])).rows[0]!.id);
      exportIds.push(crashExportId);
      const pixelSha = createHash("sha256").update(pixels).digest("hex");
      await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status) values($1,1,1,$2,$3,$4,1,1,'pending')", [crashExportId, crashSopUid, crashSeriesUid, pixelSha]);
      uploaded.set(crashSopUid, { orthancInstanceId: "crash-page-1", orthancSeriesId: "crash-series", orthancStudyId: study.orthancStudyId, studyInstanceUid: studyUid, seriesInstanceUid: crashSeriesUid, sopInstanceUid: crashSopUid, patientId: patientPrimaryId, accessionNumber: accession, modality: "CT" });
      const pendingPage = await pool.query<{ status: string; exported_at: string | null; verified_at: string | null }>("select status,exported_at,verified_at from clinical_document_export_instances where export_id=$1", [crashExportId]);
      assert.deepEqual(pendingPage.rows[0], { status: "pending", exported_at: null, verified_at: null });
      const lookupCountBeforeRecovery = sopLookups.length;
      const uploadCountBeforeRecovery = uploadCallCount;

      const crashRow = await claimNextClinicalDocumentExport(`series-test-crash-${suffix}`, 300, directDestination);
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
      const untouchedExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,representation_type,series_number,study_instance_uid,series_instance_uid,exported_page_count,verified_page_count,next_retry_at) values($1,$2,$3,'pending','secondary_capture',9000,$4,$5,0,0,now()) returning id", [untouchedDocumentId, created.bookingId, directDestination, studyUid, untouchedSeriesUid])).rows[0]!.id);
      exportIds.push(untouchedExportId);

      const untouchedRow = await claimNextClinicalDocumentExport(`series-test-untouched-${suffix}`, 300, directDestination);
      assert.equal(Number(untouchedRow?.id), untouchedExportId);
      await processClaimedClinicalDocumentExport(untouchedRow!, dependencies);

      const untouchedResult = await pool.query<{ status: string; series_number: number | null; series_instance_uid: string }>("select status,series_number,series_instance_uid from clinical_document_exports where id=$1", [untouchedExportId]);
      assert.equal(untouchedResult.rows[0]?.status, "exported");
      assert.equal(untouchedResult.rows[0]?.series_number, null);
      assert.notEqual(untouchedResult.rows[0]?.series_instance_uid, untouchedSeriesUid);
      assert.equal(datasets.at(-1)?.SeriesDescription, "Clinical Documents");
      assert.ok(datasets.at(-1)?.SeriesNumber == null || datasets.at(-1)?.SeriesNumber === "");
    });

    await t.test("schedules retryable failures below the limit and blocks exhaustion until manual retry", async () => {
      const failingClient = { ...orthancClient, findStudy: async () => ({ status: "not_found" as const, matchKey: "study_instance_uid" as const, study: null }) };
      const failingDependencies: ClinicalDocumentProcessorDependencies = { ...dependencies, createOrthancClient: async () => failingClient };
      const belowLimitDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `retry-${suffix}.png`, `documents/export-test/${suffix}-retry.png`])).rows[0]!.id);
      documentIds.push(belowLimitDocumentId);
      const belowLimitExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,attempt_count,representation_type,next_retry_at) values($1,$2,$3,'pending',6,'secondary_capture',now()) returning id", [belowLimitDocumentId, created.bookingId, directDestination])).rows[0]!.id);
      exportIds.push(belowLimitExportId);
      const belowLimitRow = await claimNextClinicalDocumentExport(`series-test-retry-${suffix}`, 300, directDestination);
      assert.equal(Number(belowLimitRow?.id), belowLimitExportId);
      await processClaimedClinicalDocumentExport(belowLimitRow!, failingDependencies);
      const scheduled = await pool.query<{ status: string; attempt_count: number; next_retry_at: string | null }>("select status,attempt_count,next_retry_at from clinical_document_exports where id=$1", [belowLimitExportId]);
      assert.equal(scheduled.rows[0]?.status, "failed");
      assert.equal(Number(scheduled.rows[0]?.attempt_count), 7);
      assert.ok(scheduled.rows[0]?.next_retry_at);

      const exhaustedDocumentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'clinical_document','manual_upload',$2,$3,'image/png',3) returning id", [created.patientId, `exhausted-${suffix}.png`, `documents/export-test/${suffix}-exhausted.png`])).rows[0]!.id);
      documentIds.push(exhaustedDocumentId);
      const stable = { study: studyUid, series: `2.25.${uidSuffix}9300`, sop: `2.25.${uidSuffix}93001` };
      const exhaustedExportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,attempt_count,representation_type,series_number,study_instance_uid,series_instance_uid,sop_instance_uid,expected_page_count,next_retry_at) values($1,$2,$3,'pending',7,'secondary_capture',9000,$4,$5,$6,1,now()) returning id", [exhaustedDocumentId, created.bookingId, directDestination, stable.study, stable.series, stable.sop])).rows[0]!.id);
      exportIds.push(exhaustedExportId);
      await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status) values($1,1,1,$2,$3,$4,1,1,'pending')", [exhaustedExportId, stable.sop, stable.series, createHash("sha256").update(pixels).digest("hex")]);
      uploaded.set(stable.sop, { orthancInstanceId: "exhausted-page-1", orthancSeriesId: "legacy-exhausted-series", orthancStudyId: study.orthancStudyId, studyInstanceUid: studyUid, seriesInstanceUid: stable.series, sopInstanceUid: stable.sop, patientId: patientPrimaryId, accessionNumber: accession, modality: "CT" });
      const exhaustedRow = await claimNextClinicalDocumentExport(`series-test-exhausted-${suffix}`, 300, directDestination);
      assert.equal(Number(exhaustedRow?.id), exhaustedExportId);
      await processClaimedClinicalDocumentExport(exhaustedRow!, failingDependencies);
      const exhausted = await pool.query<{ status: string; attempt_count: number; next_retry_at: string | null; last_error: string; study_instance_uid: string; series_instance_uid: string; sop_instance_uid: string }>("select status,attempt_count,next_retry_at,last_error,study_instance_uid,series_instance_uid,sop_instance_uid from clinical_document_exports where id=$1", [exhaustedExportId]);
      assert.equal(exhausted.rows[0]?.status, "blocked");
      assert.equal(Number(exhausted.rows[0]?.attempt_count), 8);
      assert.equal(exhausted.rows[0]?.next_retry_at, null);
      assert.match(exhausted.rows[0]?.last_error || "", /Automatic retry limit reached/);
      assert.equal(await claimNextClinicalDocumentExport(`series-test-exhausted-auto-${suffix}`, 300, directDestination), null);

      const remoteRetryId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,attempt_count,representation_type,study_instance_uid,series_instance_uid,sop_instance_uid,next_retry_at) values($1,$2,'orthanc_remote:TEST_PACS','failed',3,'secondary_capture',$3,$4,$5,now()) returning id", [exhaustedDocumentId, created.bookingId, stable.study, stable.series, `${stable.sop}.2`])).rows[0]!.id);
      exportIds.push(remoteRetryId);
      const remoteRetry = await retryClinicalDocumentExport(remoteRetryId, created.userId);
      assert.equal(remoteRetry.status, "pending");
      assert.equal(remoteRetry.attempt_count, 0);
      assert.equal(remoteRetry.study_instance_uid, stable.study);
      assert.equal(remoteRetry.series_instance_uid, stable.series);
      assert.equal(remoteRetry.sop_instance_uid, `${stable.sop}.2`);
      await pool.query("update clinical_document_exports set status='blocked', next_retry_at=null where id=$1", [remoteRetryId]);

      await assert.rejects(() => retryClinicalDocumentExport(exhaustedExportId, created.userId));
      assert.equal((await pool.query<{ status: string }>("select status from clinical_document_exports where id=$1", [exhaustedExportId])).rows[0]?.status, "blocked");
    });

    await t.test("processes selected-PACS SC exports with persisted retry identifiers and SOP acknowledgement", async (remoteT) => {
      await pool.query("update appointments_v2.bookings set study_instance_uid=null where id=$1", [created.bookingId]);
      const remoteStudyUid = `2.25.${uidSuffix}9400`;
      const lookupCriteria: Array<Record<string, string>> = [];
      const captured: Record<string, unknown>[] = [];
      let failNextStore = false;
      let mismatchNextStore = false;
      const remoteDependencies: ClinicalDocumentProcessorDependencies = {
        ...dependencies,
        createOrthancClient: async () => { throw new Error("remote export must not create an authoritative Orthanc client"); },
        searchRemoteStudies: async ({ criteria }) => {
          lookupCriteria.push(criteria as Record<string, string>);
          return { target: { type: "remote_modality" as const, key: "TEST_PACS", name: "TEST_PACS", isDefault: false }, studies: [{ patientId: patientPrimaryId, patientName: "Series^Patient", accessionNumber: accession, modality: "CT", description: "CT Chest", studyDescription: "CT Chest", studyDate: "20260818", studyTime: "101530", studyInstanceUid: remoteStudyUid }] };
        },
        storeDicomStraight: async ({ dicomBytes }) => {
          const dataset = parseDicom(dicomBytes); captured.push(dataset);
          if (failNextStore) { failNextStore = false; throw new HttpError(502, "temporary store failure", { code: "orthanc_store_failed" }); }
          return { sopClassUid: String(dataset.SOPClassUID), sopInstanceUid: mismatchNextStore ? "1.2.3.999" : String(dataset.SOPInstanceUID) };
        },
      };
      const createRemoteExport = async (name: string, representationType = "secondary_capture", documentType = "clinical_document") => {
        const documentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,$2,'manual_upload',$3,$4,'image/png',3,$5) returning id", [created.patientId, documentType, `${name}-${suffix}.png`, `documents/export-test/${name}-${suffix}.png`, created.bookingId])).rows[0]!.id);
        documentIds.push(documentId);
        const exportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,representation_type,next_retry_at) values($1,$2,'orthanc_remote:TEST_PACS','pending',$3,now()) returning id", [documentId, created.bookingId, representationType])).rows[0]!.id);
        exportIds.push(exportId); return exportId;
      };
      const firstId = await createRemoteExport("remote-first", "secondary_capture", "appointment_request");
      const firstRow = await claimNextClinicalDocumentExport(`remote-first-${suffix}`, 300, "orthanc_remote:");
      assert.equal(Number(firstRow?.id), firstId);
      await processClaimedClinicalDocumentExport(firstRow!, remoteDependencies);
      assert.deepEqual(lookupCriteria[0], { accessionNumber: accession });
      const first = (await pool.query<{ status: string; study_instance_uid: string; series_instance_uid: string; sop_instance_uid: string; orthanc_instance_id: string | null; orthanc_series_id: string | null }>("select status,study_instance_uid,series_instance_uid,sop_instance_uid,orthanc_instance_id,orthanc_series_id from clinical_document_exports where id=$1", [firstId])).rows[0]!;
      assert.equal(first.status, "exported"); assert.equal(first.study_instance_uid, remoteStudyUid);
      const firstPage = (await pool.query<{ series_instance_uid: string; sop_instance_uid: string }>("select series_instance_uid,sop_instance_uid from clinical_document_export_instances where export_id=$1", [firstId])).rows[0]!;
      assert.equal(captured[0]?.StudyInstanceUID, remoteStudyUid); assert.equal(captured[0]?.SeriesInstanceUID, firstPage.series_instance_uid); assert.equal(captured[0]?.SOPInstanceUID, firstPage.sop_instance_uid); assert.equal(captured[0]?.AccessionNumber, accession);
      assert.equal(captured[0]?.StudyDate, "20260818"); assert.equal(captured[0]?.StudyTime, "101530"); assert.equal(captured[0]?.StudyDescription, "CT Chest"); assert.equal(captured[0]?.SeriesDescription, "Request Documents");
      assert.equal((await pool.query<{ status: string }>("select status from clinical_document_export_instances where export_id=$1", [firstId])).rows[0]?.status, "verified");

      const clinicalId = await createRemoteExport("remote-clinical");
      const clinicalRow = await claimNextClinicalDocumentExport(`remote-clinical-${suffix}`, 300, "orthanc_remote:");
      assert.equal(Number(clinicalRow?.id), clinicalId);
      await processClaimedClinicalDocumentExport(clinicalRow!, remoteDependencies);
      const clinicalPage = (await pool.query<{ series_instance_uid: string }>("select series_instance_uid from clinical_document_export_instances where export_id=$1", [clinicalId])).rows[0]!;
      assert.notEqual(clinicalPage.series_instance_uid, firstPage.series_instance_uid);
      assert.equal(captured.at(-1)?.StudyInstanceUID, remoteStudyUid);
      assert.equal(captured.at(-1)?.StudyDate, "20260818"); assert.equal(captured.at(-1)?.StudyTime, "101530"); assert.equal(captured.at(-1)?.StudyDescription, "CT Chest"); assert.equal(captured.at(-1)?.SeriesDescription, "Clinical Documents");

      const retryId = await createRemoteExport("remote-retry"); failNextStore = true;
      const failedRow = await claimNextClinicalDocumentExport(`remote-failed-${suffix}`, 300, "orthanc_remote:");
      assert.equal(Number(failedRow?.id), retryId); await processClaimedClinicalDocumentExport(failedRow!, remoteDependencies);
      const failed = (await pool.query<{ status: string; next_retry_at: string | null; study_instance_uid: string; series_instance_uid: string }>("select status,next_retry_at,study_instance_uid,series_instance_uid from clinical_document_exports where id=$1", [retryId])).rows[0]!;
      assert.equal(failed.status, "failed"); assert.ok(failed.next_retry_at); assert.equal(failed.study_instance_uid, remoteStudyUid);
      const failedPage = (await pool.query<{ series_instance_uid: string; sop_instance_uid: string }>("select series_instance_uid,sop_instance_uid from clinical_document_export_instances where export_id=$1", [retryId])).rows[0]!;
      await pool.query("update clinical_document_exports set next_retry_at=now() where id=$1", [retryId]);
      const retriedRow = await claimNextClinicalDocumentExport(`remote-retry-${suffix}`, 300, "orthanc_remote:");
      await processClaimedClinicalDocumentExport(retriedRow!, remoteDependencies);
      assert.deepEqual(lookupCriteria.at(-1), { studyInstanceUid: remoteStudyUid });
      const retried = (await pool.query<{ status: string; series_instance_uid: string }>("select status,series_instance_uid from clinical_document_exports where id=$1", [retryId])).rows[0]!;
      const retriedPage = (await pool.query<{ series_instance_uid: string; sop_instance_uid: string }>("select series_instance_uid,sop_instance_uid from clinical_document_export_instances where export_id=$1", [retryId])).rows[0]!;
      assert.equal(retried.status, "exported"); assert.equal(retried.series_instance_uid, failed.series_instance_uid); assert.equal(retriedPage.series_instance_uid, failedPage.series_instance_uid); assert.equal(retriedPage.sop_instance_uid, failedPage.sop_instance_uid);

      const mismatchId = await createRemoteExport("remote-mismatch"); mismatchNextStore = true;
      const mismatchRow = await claimNextClinicalDocumentExport(`remote-mismatch-${suffix}`, 300, "orthanc_remote:"); await processClaimedClinicalDocumentExport(mismatchRow!, remoteDependencies); mismatchNextStore = false;
      assert.equal((await pool.query<{ status: string; last_error: string }>("select status,last_error from clinical_document_exports where id=$1", [mismatchId])).rows[0]?.status, "blocked");
      assert.match((await pool.query<{ last_error: string }>("select last_error from clinical_document_exports where id=$1", [mismatchId])).rows[0]?.last_error || "", /different SOPInstanceUID/i);
      assert.equal((await pool.query<{ status: string }>("select status from clinical_document_export_instances where export_id=$1", [mismatchId])).rows[0]?.status, "blocked");

      const unsupportedId = await createRemoteExport("remote-unsupported", "encapsulated_pdf");
      const unsupportedRow = await claimNextClinicalDocumentExport(`remote-unsupported-${suffix}`, 300, "orthanc_remote:"); await processClaimedClinicalDocumentExport(unsupportedRow!, remoteDependencies);
      assert.match((await pool.query<{ last_error: string }>("select last_error from clinical_document_exports where id=$1", [unsupportedId])).rows[0]?.last_error || "", /Secondary Capture only/i);

      await remoteT.test("rebuilds an exported appointment/destination SC set with new Series and SOP UIDs", async () => {
        const requestOldSeriesUid = `2.25.${uidSuffix}9500`;
        const clinicalOldSeriesUid = `2.25.${uidSuffix}9600`;
        const oldSopUids: string[] = [];
        const rebuildIds: number[] = [];
        const createExistingExport = async (index: number, documentType: "appointment_request" | "clinical_document", destinationKey: string, rowStudyUid: string, status: "pending" | "exporting" | "exported" | "failed" | "blocked" = "exported") => {
          const documentId = Number((await pool.query<{ id: number }>("insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,$2,'manual_upload',$3,$4,'image/png',3,$5) returning id", [created.patientId, documentType, `rebuild-${index}-${suffix}.png`, `documents/export-test/rebuild-${index}-${suffix}.png`, created.bookingId])).rows[0]!.id);
          documentIds.push(documentId);
          const baseSeriesUid = documentType === "appointment_request" ? requestOldSeriesUid : clinicalOldSeriesUid;
          const seriesUid = destinationKey === "orthanc_remote:REBUILD_PACS" ? baseSeriesUid : `${baseSeriesUid}.${index}`;
          const sopUid = `2.25.${uidSuffix}97${index}`;
          const instanceNumber = destinationKey === "orthanc_remote:REBUILD_PACS" ? (index % 2) + 1 : 1;
          const exportId = Number((await pool.query<{ id: number }>("insert into clinical_document_exports(document_id,appointment_id,destination_key,status,representation_type,study_instance_uid,series_instance_uid,expected_page_count,exported_page_count,verified_page_count,orthanc_study_id,orthanc_series_id,orthanc_instance_id,exported_at,verified_at,next_retry_at) values($1,$2,$3,$4,'secondary_capture',$5,$6,1,1,1,'old-study','old-series','old-instance',now(),now(),now()) returning id", [documentId, created.bookingId, destinationKey, status, rowStudyUid, seriesUid])).rows[0]!.id);
          exportIds.push(exportId); rebuildIds.push(exportId); oldSopUids.push(sopUid);
          await pool.query("insert into clinical_document_export_instances(export_id,page_number,instance_number,sop_instance_uid,series_instance_uid,pixel_sha256,rows,columns,status,orthanc_instance_id,orthanc_series_id,exported_at,verified_at) values($1,1,$2,$3,$4,$5,1,1,'verified','old-page','old-series',now(),now())", [exportId, instanceNumber, sopUid, seriesUid, createHash("sha256").update(pixels).digest("hex")]);
          return exportId;
        };

        for (let index = 0; index < 4; index += 1) await createExistingExport(index, index < 2 ? "appointment_request" : "clinical_document", "orthanc_remote:REBUILD_PACS", remoteStudyUid);
        const capturedStart = captured.length;
        const rebuild = await rebuildClinicalDocumentSecondaryCaptures(rebuildIds[0]!, created.userId);
        assert.deepEqual(rebuild, { queued: 4, exportIds: rebuildIds, appointmentId: created.bookingId });
        const rebuildAudits = await pool.query<{ entity_id: number }>("select entity_id from audit_log where entity_type='clinical_document_export' and action_type='clinical_document_export_rebuild_requested' and entity_id=any($1::bigint[]) order by entity_id", [rebuildIds]);
        assert.deepEqual(rebuildAudits.rows.map((row) => Number(row.entity_id)), rebuildIds);
        const resetRows = await pool.query<{ id: number; destination_key: string; status: string; attempt_count: number; study_instance_uid: string; series_instance_uid: string | null; sop_instance_uid: string | null; expected_page_count: number | null; exported_page_count: number; verified_page_count: number; series_number: number | null; orthanc_study_id: string | null; orthanc_series_id: string | null; orthanc_instance_id: string | null; exported_at: string | null; verified_at: string | null }>("select id,destination_key,status,attempt_count,study_instance_uid,series_instance_uid,sop_instance_uid,expected_page_count,exported_page_count,verified_page_count,series_number,orthanc_study_id,orthanc_series_id,orthanc_instance_id,exported_at,verified_at from clinical_document_exports where id=any($1::bigint[]) order by id", [rebuildIds]);
        assert.ok(resetRows.rows.every((row) => row.destination_key === "orthanc_remote:REBUILD_PACS" && row.status === "pending" && row.attempt_count === 0 && row.study_instance_uid === remoteStudyUid && row.series_instance_uid === null && row.sop_instance_uid === null && row.expected_page_count === null && row.exported_page_count === 0 && row.verified_page_count === 0 && row.series_number === null && row.orthanc_study_id === null && row.orthanc_series_id === null && row.orthanc_instance_id === null && row.exported_at === null && row.verified_at === null));
        assert.equal(Number((await pool.query<{ count: number }>("select count(*)::int count from clinical_document_export_instances where export_id=any($1::bigint[])", [rebuildIds])).rows[0]?.count), 0);

        for (let index = 0; index < rebuildIds.length; index += 1) {
          const rebuiltRow = await claimNextClinicalDocumentExport(`remote-rebuild-${suffix}-${index}`, 300, "orthanc_remote:REBUILD_PACS");
          assert.ok(rebuiltRow);
          await processClaimedClinicalDocumentExport(rebuiltRow, remoteDependencies);
        }
        const rebuiltRows = await pool.query<{ id: number; document_type: string; destination_key: string; study_instance_uid: string; series_instance_uid: string; sop_instance_uid: string }>("select e.id,d.document_type,e.destination_key,e.study_instance_uid,i.series_instance_uid,i.sop_instance_uid from clinical_document_exports e join documents d on d.id=e.document_id join clinical_document_export_instances i on i.export_id=e.id where e.id=any($1::bigint[]) order by e.id", [rebuildIds]);
        const newRequestSeries = new Set(rebuiltRows.rows.filter((row) => row.document_type === "appointment_request").map((row) => row.series_instance_uid));
        const newClinicalSeries = new Set(rebuiltRows.rows.filter((row) => row.document_type === "clinical_document").map((row) => row.series_instance_uid));
        assert.equal(newRequestSeries.size, 1); assert.equal(newClinicalSeries.size, 1);
        assert.notEqual([...newRequestSeries][0], requestOldSeriesUid); assert.notEqual([...newClinicalSeries][0], clinicalOldSeriesUid); assert.notEqual([...newRequestSeries][0], [...newClinicalSeries][0]);
        assert.ok(rebuiltRows.rows.every((row) => row.study_instance_uid === remoteStudyUid && row.destination_key === "orthanc_remote:REBUILD_PACS" && !oldSopUids.includes(row.sop_instance_uid)));
        const rebuiltDatasets = captured.slice(capturedStart);
        assert.equal(rebuiltDatasets.length, 4);
        assert.ok(rebuiltDatasets.every((dataset) => dataset.StudyInstanceUID === remoteStudyUid && dataset.StudyDate === "20260818" && dataset.StudyTime === "101530" && dataset.StudyDescription === "CT Chest"));
        assert.ok(rebuiltDatasets.filter((dataset) => dataset.SeriesInstanceUID === [...newRequestSeries][0]).every((dataset) => dataset.SeriesDescription === "Request Documents"));
        assert.ok(rebuiltDatasets.filter((dataset) => dataset.SeriesInstanceUID === [...newClinicalSeries][0]).every((dataset) => dataset.SeriesDescription === "Clinical Documents"));

        const pendingAnchor = await createExistingExport(10, "appointment_request", "orthanc_remote:PENDING_PACS", remoteStudyUid, "pending");
        const pendingMatch = await createExistingExport(11, "clinical_document", "orthanc_remote:PENDING_PACS", remoteStudyUid, "pending");
        assert.deepEqual(await rebuildClinicalDocumentSecondaryCaptures(pendingAnchor, created.userId), { queued: 2, exportIds: [pendingAnchor, pendingMatch], appointmentId: created.bookingId });
        const pendingResetRows = await pool.query<{ status: string; study_instance_uid: string; series_instance_uid: string | null; sop_instance_uid: string | null }>("select status,study_instance_uid,series_instance_uid,sop_instance_uid from clinical_document_exports where id=any($1::bigint[]) order by id", [[pendingAnchor, pendingMatch]]);
        assert.ok(pendingResetRows.rows.every((row) => row.status === "pending" && row.study_instance_uid === remoteStudyUid && row.series_instance_uid === null && row.sop_instance_uid === null));
        const failedAnchor = await createExistingExport(14, "appointment_request", "orthanc_remote:FAILED_PACS", remoteStudyUid, "failed");
        assert.equal((await rebuildClinicalDocumentSecondaryCaptures(failedAnchor, created.userId)).queued, 1);
        const blockedAnchor = await createExistingExport(15, "clinical_document", "orthanc_remote:BLOCKED_PACS", remoteStudyUid, "blocked");
        assert.equal((await rebuildClinicalDocumentSecondaryCaptures(blockedAnchor, created.userId)).queued, 1);
        const activeAnchor = await createExistingExport(16, "appointment_request", "orthanc_remote:ACTIVE_PACS", remoteStudyUid);
        const activeMatch = await createExistingExport(17, "clinical_document", "orthanc_remote:ACTIVE_PACS", remoteStudyUid, "exporting");
        await assert.rejects(() => rebuildClinicalDocumentSecondaryCaptures(activeAnchor, created.userId), /matching export is exporting/i);
        await assert.rejects(() => rebuildClinicalDocumentSecondaryCaptures(activeMatch, created.userId), /Only pending, exported, failed, or blocked Secondary Capture exports/i);
        const conflictAnchor = await createExistingExport(12, "appointment_request", "orthanc_remote:CONFLICT_PACS", `${remoteStudyUid}.1`);
        await createExistingExport(13, "clinical_document", "orthanc_remote:CONFLICT_PACS", `${remoteStudyUid}.2`);
        await assert.rejects(() => rebuildClinicalDocumentSecondaryCaptures(conflictAnchor, created.userId), /conflicting StudyInstanceUIDs/i);
        const unsupportedAnchorDocumentId = Number((await pool.query<{ document_id: number }>("select document_id from clinical_document_exports where id=$1", [rebuildIds[0]])).rows[0]!.document_id);
        await pool.query("update documents set document_type='other' where id=$1", [unsupportedAnchorDocumentId]);
        await assert.rejects(() => rebuildClinicalDocumentSecondaryCaptures(rebuildIds[0]!, created.userId), /Only pending, exported, failed, or blocked Secondary Capture exports/i);
        await pool.query("update documents set document_type='appointment_request' where id=$1", [unsupportedAnchorDocumentId]);
      });
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
