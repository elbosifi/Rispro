import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../db/pool.js";
import { enqueueClinicalDocumentExportsForAppointment, reconcileClinicalDocumentExports } from "./clinical-document-export-queue-service.js";
import { claimNextClinicalDocumentExport, getClinicalDocumentExportOperationsSummary, retryClinicalDocumentExport } from "./clinical-document-export-service.js";

test.after(async () => { await pool.end().catch(() => undefined); });

test("document export queue includes request and clinical documents, deduplicates exact links, and claims only completed appointments", async (t) => {
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 11);
  let patientId: number | null = null;
  let modalityId: number | null = null;
  let examTypeId: number | null = null;
  let policySetId: number | null = null;
  let policyVersionId: number | null = null;
  let bookingId: number | null = null;
  let secondBookingId: number | null = null;
  let clinicalDocumentId: number | null = null;
  let receptionDocumentId: number | null = null;
  let linkedClinicalDocumentId: number | null = null;
  let historicalClinicalDocumentId: number | null = null;
  let unrelatedClinicalDocumentId: number | null = null;
  let userId: number | null = null;
  const exportIds = new Set<number>();

  try {
    try { await client.query("select 1 from clinical_document_exports limit 1"); } catch { t.skip("Disposable PostgreSQL is not migrated or is unavailable."); return; }

    const modality = await client.query<{ id: number }>(
      "insert into modalities(code,name_ar,name_en) values($1,$2,$3) returning id",
      [`EXPORT_${suffix}`, "اختبار التصدير", "Export test"],
    );
    modalityId = modality.rows[0]!.id;
    const exam = await client.query<{ id: number }>(
      "insert into exam_types(modality_id,code,name_ar,name_en) values($1,$2,$3,$4) returning id",
      [modalityId, `EXPORT_EXAM_${suffix}`, "فحص التصدير", "Export exam"],
    );
    examTypeId = exam.rows[0]!.id;
    const policySet = await client.query<{ id: number }>(
      "insert into appointments_v2.policy_sets(key,name) values($1,$2) returning id",
      [`export_test_${suffix}`, "Export test"],
    );
    policySetId = policySet.rows[0]!.id;
    const policyVersion = await client.query<{ id: number }>(
      "insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash) values($1,1,'published',$2) returning id",
      [policySetId, `hash-${suffix}`],
    );
    policyVersionId = policyVersion.rows[0]!.id;
    const patient = await client.query<{ id: number }>(
      "insert into patients(mrn,national_id,arabic_full_name,english_full_name,normalized_arabic_name,age_years,sex,phone_1) values($1,$2,$3,$4,$5,40,'O',$6) returning id",
      [`EXPORT-MRN-${suffix}`, `9${suffix}`, "مريض اختبار", "Export Patient", "مريض اختبار", `09${suffix.slice(0, 8)}`],
    );
    patientId = patient.rows[0]!.id;
    const booking = await client.query<{ id: number }>(
      "insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,case_category,status,policy_version_id) values($1,$2,$3,current_date,'non_oncology','scheduled',$4) returning id",
      [patientId, modalityId, examTypeId, policyVersionId],
    );
    bookingId = booking.rows[0]!.id;
    secondBookingId = Number((await client.query<{ id: number }>(
      "insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,case_category,status,policy_version_id) values($1,$2,$3,current_date + 1,'non_oncology','scheduled',$4) returning id",
      [patientId, modalityId, examTypeId, policyVersionId],
    )).rows[0]!.id);
    const clinicalDocument = await client.query<{ id: number }>(
      "insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,'clinical_document','modality_scan_automation',$2,$3,'application/pdf',5,$4) returning id",
      [patientId, `clinical-${suffix}.pdf`, `documents/export-test/${suffix}.pdf`, bookingId],
    );
    clinicalDocumentId = clinicalDocument.rows[0]!.id;
    const receptionDocument = await client.query<{ id: number }>(
      "insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,'appointment_request','request_scan_automation',$2,$3,'application/pdf',5,$4) returning id",
      [patientId, `request-${suffix}.pdf`, `documents/export-test/${suffix}-request.pdf`, bookingId],
    );
    receptionDocumentId = receptionDocument.rows[0]!.id;

    const firstQueue = await enqueueClinicalDocumentExportsForAppointment(bookingId);
    assert.equal(firstQueue.length, 2);
    firstQueue.forEach((id) => exportIds.add(id));
    const secondQueue = await enqueueClinicalDocumentExportsForAppointment(bookingId);
    assert.deepEqual(secondQueue, []);

    await client.query("insert into document_appointment_links(document_id,appointment_id) values($1,$2)", [receptionDocumentId, bookingId]);
    assert.deepEqual(await enqueueClinicalDocumentExportsForAppointment(bookingId), []);

    const linkedClinicalDocument = await client.query<{ id: number }>(
      "insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size) values($1,'appointment_request','manual_upload',$2,$3,'application/pdf',5) returning id",
      [patientId, `linked-${suffix}.pdf`, `documents/export-test/${suffix}-linked.pdf`],
    );
    linkedClinicalDocumentId = linkedClinicalDocument.rows[0]!.id;
    await client.query("insert into document_appointment_links(document_id,appointment_id) values($1,$2)", [linkedClinicalDocumentId, bookingId]);
    await client.query("insert into document_appointment_links(document_id,appointment_id) values($1,$2)", [linkedClinicalDocumentId, secondBookingId]);
    const linkedQueue = await enqueueClinicalDocumentExportsForAppointment(bookingId);
    assert.equal(linkedQueue.length, 1);
    linkedQueue.forEach((id) => exportIds.add(id));
    assert.deepEqual(await enqueueClinicalDocumentExportsForAppointment(bookingId), []);
    const secondAppointmentQueue = await enqueueClinicalDocumentExportsForAppointment(secondBookingId);
    assert.equal(secondAppointmentQueue.length, 1);
    secondAppointmentQueue.forEach((id) => exportIds.add(id));

    const historical = await client.query<{ id: number }>(
      "insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,'clinical_document','manual_upload',$2,$3,'application/pdf',5,$4) returning id",
      [patientId, `historical-${suffix}.pdf`, `documents/export-test/${suffix}-historical.pdf`, bookingId],
    );
    historicalClinicalDocumentId = historical.rows[0]!.id;
    const unrelated = await client.query<{ id: number }>(
      "insert into documents(patient_id,document_type,source,original_filename,stored_path,mime_type,file_size,v2_booking_id) values($1,'other','modality_scan_automation',$2,$3,'application/pdf',5,$4) returning id",
      [patientId, `unrelated-${suffix}.pdf`, `documents/export-test/${suffix}-unrelated.pdf`, bookingId],
    );
    unrelatedClinicalDocumentId = unrelated.rows[0]!.id;
    assert.equal(await reconcileClinicalDocumentExports(), 1);
    assert.equal(await reconcileClinicalDocumentExports(), 0);
    const historicalExports = await client.query<{ id: number }>("select id from clinical_document_exports where document_id=$1", [historicalClinicalDocumentId]);
    assert.equal(historicalExports.rowCount, 1);
    historicalExports.rows.forEach((row) => exportIds.add(row.id));
    assert.equal((await client.query("select 1 from clinical_document_exports where document_id=$1", [unrelatedClinicalDocumentId])).rowCount, 0);

    const incompleteClaim = await claimNextClinicalDocumentExport(`queue-test-${suffix}`);
    assert.equal(incompleteClaim, null);

    await client.query("update appointments_v2.bookings set status='completed', completed_at=now() where id=$1", [bookingId]);
    const qualifyingDocumentIds = new Set([clinicalDocumentId, receptionDocumentId, linkedClinicalDocumentId, historicalClinicalDocumentId]);
    const claimedByDocument = new Map<number, number>();
    while (claimedByDocument.size < qualifyingDocumentIds.size) {
      const claimed = await claimNextClinicalDocumentExport(`queue-test-${suffix}-${claimedByDocument.size}`);
      assert.ok(claimed);
      assert.equal(claimed.appointment_id, bookingId);
      assert.equal(claimed.status, "exporting");
      assert.ok(qualifyingDocumentIds.has(claimed.document_id));
      claimedByDocument.set(claimed.document_id, claimed.id);
      exportIds.add(claimed.id);
    }
    assert.deepEqual(new Set(claimedByDocument.keys()), qualifyingDocumentIds);
    assert.equal(await claimNextClinicalDocumentExport(`queue-test-empty-${suffix}`), null);
    const directExportId = claimedByDocument.get(clinicalDocumentId)!;
    await client.query("update clinical_document_exports set export_lease_expires_at=now()-interval '1 second' where id=$1", [directExportId]);
    const recovered = await claimNextClinicalDocumentExport(`queue-test-recovered-${suffix}`);
    assert.equal(recovered?.id, directExportId);
    assert.equal(recovered?.status, "exporting");

    const user = await client.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'x','supervisor',true) returning id", [`export-test-${suffix}`, "Clinical export test"]);
    userId = user.rows[0]!.id;
    const stableUids = { study: `2.25.${Date.now()}${suffix}`, series: `2.25.${Date.now()}${suffix}1`, sop: `2.25.${Date.now()}${suffix}2` };
    await client.query(
      "update clinical_document_exports set status='blocked', attempt_count=4, next_retry_at=now()+interval '1 hour', last_error='Patient identity conflict', export_lease_owner='stale-worker', export_lease_expires_at=now()+interval '1 minute', study_instance_uid=$2, series_instance_uid=$3, sop_instance_uid=$4, updated_at=now() where id=$1",
      [directExportId, stableUids.study, stableUids.series, stableUids.sop],
    );
    const operationsSummary = await getClinicalDocumentExportOperationsSummary();
    assert.ok(operationsSummary.failed >= 1);
    assert.ok(operationsSummary.latestFailures.some((item) => item.id === Number(directExportId) && item.status === "blocked" && item.retryPermitted));
    const blockedRetry = await retryClinicalDocumentExport(directExportId, userId!);
    assert.equal(blockedRetry.status, "pending");
    assert.equal(blockedRetry.attempt_count, 0);
    assert.equal(blockedRetry.next_retry_at, null);
    assert.equal(blockedRetry.last_error, null);
    assert.equal(blockedRetry.export_lease_owner, null);
    assert.equal(blockedRetry.export_lease_expires_at, null);
    assert.equal(blockedRetry.study_instance_uid, stableUids.study);
    assert.equal(blockedRetry.series_instance_uid, stableUids.series);
    assert.equal(blockedRetry.sop_instance_uid, stableUids.sop);
    const blockedAudit = await client.query<{ old_values: { status?: string } }>("select old_values from audit_log where entity_type='clinical_document_export' and entity_id=$1 and action_type='clinical_document_export_manual_retry_requested' order by id desc limit 1", [directExportId]);
    assert.equal(blockedAudit.rows[0]?.old_values.status, "blocked");

    await client.query("update clinical_document_exports set status='failed', attempt_count=2, next_retry_at=now()+interval '1 hour', last_error='Temporary Orthanc failure' where id=$1", [directExportId]);
    const failedRetry = await retryClinicalDocumentExport(directExportId, userId!);
    assert.equal(failedRetry.status, "pending");
    assert.equal(failedRetry.sop_instance_uid, stableUids.sop);

    await client.query("update clinical_document_exports set status='exported' where id=$1", [directExportId]);
    await assert.rejects(() => retryClinicalDocumentExport(directExportId, userId!), /Only failed or blocked clinical document exports can be retried/);

    const receptionRows = await client.query("select 1 from clinical_document_exports where document_id=$1", [receptionDocumentId]);
    assert.equal(receptionRows.rowCount, 1);
  } finally {
    if (exportIds.size) await client.query("delete from audit_log where entity_type='clinical_document_export' and entity_id=any($1::bigint[])", [[...exportIds]]);
    await client.query("delete from clinical_document_exports where appointment_id=any($1::bigint[])", [[bookingId, secondBookingId].filter((id): id is number => id !== null)]);
    await client.query("delete from documents where id = any($1::bigint[])", [[clinicalDocumentId, receptionDocumentId, linkedClinicalDocumentId, historicalClinicalDocumentId, unrelatedClinicalDocumentId].filter((id): id is number => id !== null)]);
    await client.query("delete from appointments_v2.bookings where id=any($1::bigint[])", [[bookingId, secondBookingId].filter((id): id is number => id !== null)]);
    await client.query("delete from patients where id=$1", [patientId]);
    await client.query("delete from exam_types where id=$1", [examTypeId]);
    await client.query("delete from modalities where id=$1", [modalityId]);
    await client.query("delete from appointments_v2.policy_versions where id=$1", [policyVersionId]);
    await client.query("delete from appointments_v2.policy_sets where id=$1", [policySetId]);
    await client.query("delete from users where id=$1", [userId]);
    client.release();
  }
});
