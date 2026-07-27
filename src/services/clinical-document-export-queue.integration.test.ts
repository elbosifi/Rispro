import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../db/pool.js";
import { enqueueClinicalDocumentExportsForAppointment } from "./clinical-document-export-queue-service.js";
import { claimNextClinicalDocumentExport } from "./clinical-document-export-service.js";

test("clinical document export queue is idempotent, excludes Reception documents, and claims only completed appointments", async (t) => {
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 11);
  let patientId: number | null = null;
  let modalityId: number | null = null;
  let examTypeId: number | null = null;
  let policySetId: number | null = null;
  let policyVersionId: number | null = null;
  let bookingId: number | null = null;
  let clinicalDocumentId: number | null = null;
  let receptionDocumentId: number | null = null;

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
    assert.equal(firstQueue.length, 1);
    const secondQueue = await enqueueClinicalDocumentExportsForAppointment(bookingId);
    assert.deepEqual(secondQueue, []);

    const incompleteClaim = await claimNextClinicalDocumentExport(`queue-test-${suffix}`);
    assert.equal(incompleteClaim, null);

    await client.query("update appointments_v2.bookings set status='completed', completed_at=now() where id=$1", [bookingId]);
    const claimed = await claimNextClinicalDocumentExport(`queue-test-${suffix}`);
    assert.equal(claimed?.document_id, clinicalDocumentId);
    assert.equal(claimed?.appointment_id, bookingId);
    assert.equal(claimed?.status, "exporting");
    assert.equal((await claimNextClinicalDocumentExport(`queue-test-second-${suffix}`))?.id, undefined);
    await client.query("update clinical_document_exports set export_lease_expires_at=now()-interval '1 second' where id=$1", [claimed?.id]);
    const recovered = await claimNextClinicalDocumentExport(`queue-test-recovered-${suffix}`);
    assert.equal(recovered?.id, claimed?.id);
    assert.equal(recovered?.status, "exporting");

    const receptionRows = await client.query("select 1 from clinical_document_exports where document_id=$1", [receptionDocumentId]);
    assert.equal(receptionRows.rowCount, 0);
  } finally {
    await client.query("delete from clinical_document_exports where appointment_id=$1", [bookingId]);
    await client.query("delete from documents where id = any($1::bigint[])", [[clinicalDocumentId, receptionDocumentId].filter((id): id is number => id !== null)]);
    await client.query("delete from appointments_v2.bookings where id=$1", [bookingId]);
    await client.query("delete from patients where id=$1", [patientId]);
    await client.query("delete from exam_types where id=$1", [examTypeId]);
    await client.query("delete from modalities where id=$1", [modalityId]);
    await client.query("delete from appointments_v2.policy_versions where id=$1", [policyVersionId]);
    await client.query("delete from appointments_v2.policy_sets where id=$1", [policySetId]);
    client.release();
  }
});
