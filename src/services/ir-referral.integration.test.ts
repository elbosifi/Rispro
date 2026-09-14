import assert from "node:assert/strict";
import { test } from "node:test";
import { pool } from "../db/pool.js";
import { createBooking } from "../modules/appointments-v2/booking/services/create-booking.service.js";
import { canReachDatabase, cleanupTestData, isDatabaseAvailable, seedTestData, setupTestDatabase } from "../modules/appointments-v2/tests/integration/helpers.js";
import { assertDicomRemapJobIrReferralAccess, cleanupDicomRemapStagingStorage, createDicomRemapStagingContext } from "./dicom-remap-service.js";
import { attachDocumentToIrReferral, confirmIrReferralMaterials, createIrReferral, createIrReferralScheduleRequest, deleteIrReferralDocument, findIrReferralById, recordIrReferralDecision, uploadIrReferralDocument } from "./ir-referral-service.js";
import { deleteDocumentById, uploadDocument } from "./document-service.js";

const prefix = "IR_REFERRAL_TEST_";
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;

test("IR referral readiness and Appointment V2 booking link are authoritative", { skip: skipEnv }, async () => {
  await pool.query("delete from ir_referral_schedule_requests where ir_referral_case_id in (select id from ir_referral_cases where created_by_user_id in (select id from users where username ilike $1))", ["irreferraltest%"]);
  await pool.query("delete from ir_referral_cases where created_by_user_id in (select id from users where username ilike $1)", ["irreferraltest%"]);
  await pool.query("delete from doctor_portal.doctor_profiles where user_id in (select id from users where username ilike $1)", ["irreferraltest%"]);
  await cleanupTestData(prefix);
  const setup = await setupTestDatabase(prefix);
  const data = await seedTestData(setup.schemaName, prefix);
  const profile = await pool.query<{ id: number }>(`insert into doctor_portal.doctor_profiles(user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise) values($1,$2,'consultant',true,true,true,true) returning id`, [data.userId, `${prefix} Doctor`]);
  const doctorId = Number(profile.rows[0]!.id);
  const actor = { userId: data.userId, appRole: "supervisor" as const };
  const documentIds: number[] = [];
  try {
    const referral = await createIrReferral(actor, { patientId: data.patientId, requestedProcedure: "IR biopsy", clinicalIndication: "Focused integration proof", assignedDoctorId: doctorId, notifyAssignedDoctor: false });
    assert.equal(referral.status, "preparing");
    const remapContext = await createDicomRemapStagingContext(data.userId, null, referral.id);
    assert.equal(Number(remapContext.job.ir_referral_case_id), referral.id);
    await assertDicomRemapJobIrReferralAccess(remapContext.job.id, data.userId, referral.id);
    await assert.rejects(() => assertDicomRemapJobIrReferralAccess(remapContext.job.id, data.userId, referral.id + 1), { statusCode: 403 });
    await cleanupDicomRemapStagingStorage(remapContext.storageKey);
    await pool.query("delete from dicom_remap_jobs where id=$1", [remapContext.job.id]);
    await assert.rejects(() => confirmIrReferralMaterials(actor, referral.id, { documentsConfirmed: true, imagesConfirmed: false }), { statusCode: 400 });
    const ready = await confirmIrReferralMaterials(actor, referral.id, { documentsConfirmed: true, imagesConfirmed: true });
    assert.equal(ready.status, "ready_for_review");
    const repeatedReady = await confirmIrReferralMaterials(actor, referral.id, { documentsConfirmed: true, imagesConfirmed: true });
    assert.equal(repeatedReady.status, "ready_for_review");
    const needsInformation = await recordIrReferralDecision(actor, referral.id, { assessmentText: "Prior assessment", decision: "needs_information", decisionNote: "Please add the prior report" });
    assert.equal(needsInformation.status, "needs_information");
    assert.equal(needsInformation.assessmentText, "Prior assessment");
    assert.equal(needsInformation.decisionNote, "Please add the prior report");
    await assert.rejects(() => recordIrReferralDecision(actor, referral.id, { assessmentText: "Should not review", decision: "eligible_for_intervention" }), { statusCode: 409 });
    const additionalDocument = await uploadIrReferralDocument(actor, referral.id, {
      originalFilename: "additional-ir-report.pdf",
      mimeType: "application/pdf",
      fileContentBase64: Buffer.from("%PDF-1.4\nadditional IR report\n%%EOF").toString("base64"),
    });
    documentIds.push(Number(additionalDocument.id));
    assert.deepEqual(await deleteIrReferralDocument(actor, referral.id, additionalDocument.id), { deleted: true, documentId: Number(additionalDocument.id) });
    const replacementDocument = await uploadIrReferralDocument(actor, referral.id, {
      originalFilename: "replacement-ir-report.pdf",
      mimeType: "application/pdf",
      fileContentBase64: Buffer.from("%PDF-1.4\nreplacement IR report\n%%EOF").toString("base64"),
    });
    documentIds.push(Number(replacementDocument.id));
    const needsInformationRemap = await createDicomRemapStagingContext(data.userId, null, referral.id);
    assert.equal(Number(needsInformationRemap.job.ir_referral_case_id), referral.id);
    await assertDicomRemapJobIrReferralAccess(needsInformationRemap.job.id, data.userId, referral.id);
    await cleanupDicomRemapStagingStorage(needsInformationRemap.storageKey);
    await pool.query("delete from dicom_remap_jobs where id=$1", [needsInformationRemap.job.id]);
    const readyAgain = await confirmIrReferralMaterials(actor, referral.id, { documentsConfirmed: true, imagesConfirmed: true, note: "Additional report attached" });
    assert.equal(readyAgain.status, "ready_for_review");
    assert.equal(readyAgain.assessmentText, "Prior assessment");
    assert.equal(readyAgain.decision, "needs_information");
    assert.equal(readyAgain.decisionNote, "Please add the prior report");
    await assert.rejects(() => createDicomRemapStagingContext(data.userId, null, referral.id), { statusCode: 409 });
    const notifications = await pool.query<{ count: string }>("select count(*)::text as count from doctor_portal.reporting_board_notification_events where ir_referral_case_id=$1 and event_type='ir_referral_ready_for_review'", [referral.id]);
    assert.equal(Number(notifications.rows[0]!.count), 1);
    const emails = await pool.query<{ count: string }>("select count(*)::text as count from email_outbox where related_entity_type='ir_referral_case' and related_entity_id=$1", [String(referral.id)]);
    assert.equal(Number(emails.rows[0]!.count), 0);
    await recordIrReferralDecision(actor, referral.id, { assessmentText: "Suitable", decision: "eligible_for_intervention" });
    const schedule = await createIrReferralScheduleRequest(actor, referral.id, { modalityId: data.modalityId, examTypeId: data.examTypeId, urgency: "routine", technologistInstruction: "IR preparation" });
    assert.equal(schedule.status, "pending_scheduling");
    const booking = await createBooking({ irReferralScheduleRequestId: schedule.id, patientId: data.patientId, modalityId: data.modalityId, examTypeId: data.examTypeId, bookingDate: "2039-07-01", bookingTime: "10:00", caseCategory: "non_oncology", requiresReport: false }, data.userId, "supervisor", data.policySetKey);
    const scheduled = await findIrReferralById(referral.id);
    assert.equal(scheduled?.status, "scheduled");
    const request = await pool.query<{ appointment_id: number; status: string }>("select appointment_id, status from ir_referral_schedule_requests where id=$1", [schedule.id]);
    assert.equal(Number(request.rows[0]!.appointment_id), Number(booking.booking.id));
    assert.equal(request.rows[0]!.status, "scheduled");
    await assert.rejects(() => uploadIrReferralDocument(actor, referral.id, {
      originalFilename: "scheduled-ir-report.pdf",
      mimeType: "application/pdf",
      fileContentBase64: Buffer.from("%PDF-1.4\nscheduled IR report\n%%EOF").toString("base64"),
    }), { statusCode: 409 });
    const unsuitableReferral = await createIrReferral(actor, { patientId: data.patientId, requestedProcedure: "IR drainage", clinicalIndication: "Not suitable guard", assignedDoctorId: doctorId, notifyAssignedDoctor: false });
    await confirmIrReferralMaterials(actor, unsuitableReferral.id, { documentsConfirmed: true, imagesConfirmed: true });
    await recordIrReferralDecision(actor, unsuitableReferral.id, { assessmentText: "Not suitable assessment", decision: "not_suitable", decisionNote: "Not suitable for intervention" });
    await assert.rejects(() => uploadIrReferralDocument(actor, unsuitableReferral.id, {
      originalFilename: "not-suitable-ir-report.pdf",
      mimeType: "application/pdf",
      fileContentBase64: Buffer.from("%PDF-1.4\nnot suitable IR report\n%%EOF").toString("base64"),
    }), { statusCode: 409 });
  } finally { for (const documentId of [...documentIds].reverse()) await deleteDocumentById(documentId, data.userId).catch(() => undefined); await pool.query("delete from ir_referral_schedule_requests where ir_referral_case_id in (select id from ir_referral_cases where assigned_doctor_id=$1)", [doctorId]); await pool.query("delete from ir_referral_cases where assigned_doctor_id=$1", [doctorId]); await pool.query("delete from doctor_portal.doctor_profiles where id=$1", [doctorId]); await setup.cleanup(); }
});

test("IR referral document deletion uses one transaction and protects shared documents", { skip: skipEnv, timeout: 10000 }, async () => {
  const setup = await setupTestDatabase(prefix);
  const data = await seedTestData(setup.schemaName, prefix);
  const profile = await pool.query<{ id: number }>(`insert into doctor_portal.doctor_profiles(user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise) values($1,$2,'consultant',true,true,true,true) returning id`, [data.userId, `${prefix} Delete Doctor`]);
  const doctorId = Number(profile.rows[0]!.id);
  const actor = { userId: data.userId, appRole: "supervisor" as const };
  let sharedDocumentId: number | null = null;
  try {
    const referral = await createIrReferral(actor, { patientId: data.patientId, requestedProcedure: "IR biopsy", clinicalIndication: "Deletion transaction proof", assignedDoctorId: doctorId, notifyAssignedDoctor: false });
    const document = await uploadDocument({ patientId: data.patientId, documentType: "ir_referral", originalFilename: "deletable-ir-report.pdf", mimeType: "application/pdf", fileContentBase64: Buffer.from("%PDF-1.4\ndeletable IR report\n%%EOF").toString("base64"), source: "manual_upload" }, actor.userId);
    await attachDocumentToIrReferral(actor, referral.id, document.id);
    assert.deepEqual(await deleteIrReferralDocument(actor, referral.id, document.id), { deleted: true, documentId: Number(document.id) });
    const deletedDocument = await pool.query("select id from documents where id=$1", [document.id]);
    assert.equal(deletedDocument.rowCount, 0);
    const deletedLink = await pool.query("select document_id from ir_referral_documents where ir_referral_case_id=$1 and document_id=$2", [referral.id, document.id]);
    assert.equal(deletedLink.rowCount, 0);
    const audit = await pool.query<{ count: string }>("select count(*)::text as count from audit_log where entity_type='ir_referral_case' and entity_id=$1 and action_type='ir_referral_document_removed'", [referral.id]);
    assert.equal(Number(audit.rows[0]!.count), 1);
    const documentAudit = await pool.query<{ count: string }>("select count(*)::text as count from audit_log where entity_type='document' and entity_id=$1 and action_type='delete'", [document.id]);
    assert.equal(Number(documentAudit.rows[0]!.count), 1);

    const otherReferral = await createIrReferral(actor, { patientId: data.patientId, requestedProcedure: "IR drainage", clinicalIndication: "Shared document guard", assignedDoctorId: doctorId, notifyAssignedDoctor: false });
    const sharedDocument = await uploadDocument({ patientId: data.patientId, documentType: "ir_referral", originalFilename: "shared-ir-report.pdf", mimeType: "application/pdf", fileContentBase64: Buffer.from("%PDF-1.4\nshared IR report\n%%EOF").toString("base64"), source: "manual_upload" }, actor.userId);
    sharedDocumentId = Number(sharedDocument.id);
    await attachDocumentToIrReferral(actor, referral.id, sharedDocument.id);
    await attachDocumentToIrReferral(actor, otherReferral.id, sharedDocument.id);
    await assert.rejects(() => deleteIrReferralDocument(actor, referral.id, sharedDocument.id), { statusCode: 409 });
    const sharedLinks = await pool.query("select document_id from ir_referral_documents where document_id=$1", [sharedDocument.id]);
    assert.equal(sharedLinks.rowCount, 2);
  } finally {
    if (sharedDocumentId != null) {
      await pool.query("delete from ir_referral_documents where document_id=$1", [sharedDocumentId]);
      await deleteDocumentById(sharedDocumentId, data.userId).catch(() => undefined);
    }
    await pool.query("delete from ir_referral_schedule_requests where ir_referral_case_id in (select id from ir_referral_cases where assigned_doctor_id=$1)", [doctorId]);
    await pool.query("delete from ir_referral_cases where assigned_doctor_id=$1", [doctorId]);
    await pool.query("delete from doctor_portal.doctor_profiles where id=$1", [doctorId]);
    await setup.cleanup();
  }
});

test("IR referrals expose the canonical DICOM patient identifier", { skip: skipEnv }, async () => {
  const setup = await setupTestDatabase(prefix);
  const data = await seedTestData(setup.schemaName, prefix);
  const profile = await pool.query<{ id: number }>(`insert into doctor_portal.doctor_profiles(user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise) values($1,$2,'consultant',true,true,true,true) returning id`, [data.userId, `${prefix} Identity Doctor`]);
  const doctorId = Number(profile.rows[0]!.id);
  const actor = { userId: data.userId, appRole: "supervisor" as const };
  try {
    await pool.query("update patients set mrn='MRN-TEST', identifier_value='IDENTIFIER12', national_id='NATIONALTEST' where id=$1", [data.patientId]);
    const typeResult = await pool.query<{ id: number }>("select id from patient_identifier_types where code='other' limit 1");
    await pool.query("insert into patient_identifiers(patient_id, identifier_type_id, value, normalized_value, is_primary, created_by_user_id, updated_by_user_id) values($1,$2,'DICOM-ID-TEST','dicom-id-test',true,$3,$3)", [data.patientId, Number(typeResult.rows[0]!.id), data.userId]);
    const referral = await createIrReferral(actor, { patientId: data.patientId, requestedProcedure: "IR biopsy", clinicalIndication: "Canonical identity proof", assignedDoctorId: doctorId, notifyAssignedDoctor: false });
    assert.equal(referral.patientDicomId, "DICOM-ID-TEST");
    assert.notEqual(referral.patientDicomId, referral.patientMrn);
    await pool.query("delete from patient_identifiers where patient_id=$1", [data.patientId]);
    const identifierValueFallback = await findIrReferralById(referral.id);
    assert.equal(identifierValueFallback?.patientDicomId, "IDENTIFIER12");
    await pool.query("update patients set identifier_value=null where id=$1", [data.patientId]);
    const nationalIdFallback = await findIrReferralById(referral.id);
    assert.equal(nationalIdFallback?.patientDicomId, "NATIONALTEST");
  } finally { await pool.query("delete from patient_identifiers where patient_id=$1", [data.patientId]); await pool.query("delete from ir_referral_schedule_requests where ir_referral_case_id in (select id from ir_referral_cases where assigned_doctor_id=$1)", [doctorId]); await pool.query("delete from ir_referral_cases where assigned_doctor_id=$1", [doctorId]); await pool.query("delete from doctor_portal.doctor_profiles where id=$1", [doctorId]); await setup.cleanup(); }
});
