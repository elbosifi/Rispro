import assert from "node:assert/strict";
import { test } from "node:test";
import { pool } from "../db/pool.js";
import { createBooking } from "../modules/appointments-v2/booking/services/create-booking.service.js";
import { canReachDatabase, cleanupTestData, isDatabaseAvailable, seedTestData, setupTestDatabase } from "../modules/appointments-v2/tests/integration/helpers.js";
import { assertDicomRemapJobIrReferralAccess, cleanupDicomRemapStagingStorage, createDicomRemapStagingContext } from "./dicom-remap-service.js";
import { confirmIrReferralMaterials, createIrReferral, createIrReferralScheduleRequest, findIrReferralById, recordIrReferralDecision } from "./ir-referral-service.js";

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
  } finally { await pool.query("delete from ir_referral_schedule_requests where ir_referral_case_id in (select id from ir_referral_cases where assigned_doctor_id=$1)", [doctorId]); await pool.query("delete from ir_referral_cases where assigned_doctor_id=$1", [doctorId]); await pool.query("delete from doctor_portal.doctor_profiles where id=$1", [doctorId]); await setup.cleanup(); }
});
