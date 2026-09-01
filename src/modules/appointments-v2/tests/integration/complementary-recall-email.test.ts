import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool } from "../../../../db/pool.js";
import { enqueueEmail } from "../../../../services/email-outbox-service.js";
import { getEmailNotificationRule, setEmailNotificationTemplate } from "../../../../services/email-notification-rules-service.js";
import { getComplementaryRecallCompletionEmailStatuses, queueManualComplementaryRecallCompletedEmail } from "../../recall/complementary-recall-email.js";
import { createComplementaryRecall, completeComplementaryRecallForBooking, getComplementaryRecall, linkComplementaryRecallBooking, listComplementaryRecalls } from "../../recall/complementary-recall.service.js";
import { canReachDatabase, isDatabaseAvailable, seedTestData, setupTestDatabase, type TestData } from "./helpers.js";

const TEST_PREFIX = "RECALL_EMAIL_";
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const metadata = { reasonCode: "technical_equipment_problem", qaClassification: "technical_repeat", urgency: "routine", dueAt: null, reportingDisposition: "supplement_original_report" } as const;

describe("Additional Imaging completion email", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let reportingDoctorUserId: number;
  let reportingDoctorId: number;
  let reportingDoctorEmail: string;
  let secondDoctorUserId: number;
  let secondDoctorId: number;
  let secondDoctorEmail: string;
  let originalConfig: { enabled: boolean; smtp_password_secret: unknown };
  let originalRule: { enabled: boolean; subject_template: string; text_body_template: string };

  async function transaction<T>(run: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try { await client.query("begin"); const result = await run(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async function makeDoctor(label: string) {
    const email = `recall-email-${label}-${testData.userId}@example.test`;
    const user = await pool.query<{ id: number }>("insert into users (username, email, full_name, password_hash, role, is_active) values ($1, $2, $3, $4, 'doctor', true) returning id", [`recall-email-${label}-${testData.userId}`, email, `Recall Email ${label}`, "unused-password-hash"]);
    const userId = Number(user.rows[0]!.id);
    const profile = await pool.query<{ id: number }>("insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active, can_assign_protocols) values ($1, $2, 'consultant', true, true) returning id", [userId, `Recall Email ${label}`]);
    return { userId, doctorId: Number(profile.rows[0]!.id), email };
  }

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    await pool.query("update modalities set name_en = 'Computed tomography' where id = $1", [testData.modalityId]);
    originalConfig = (await pool.query<typeof originalConfig>("select enabled, smtp_password_secret from email_smtp_configuration where id = 1")).rows[0]!;
    originalRule = (await pool.query<typeof originalRule>("select enabled, subject_template, text_body_template from email_notification_rules where event_type = 'additional_imaging_completed'")).rows[0]!;
    const first = await makeDoctor("a"); reportingDoctorUserId = first.userId; reportingDoctorId = first.doctorId; reportingDoctorEmail = first.email;
    const second = await makeDoctor("b"); secondDoctorUserId = second.userId; secondDoctorId = second.doctorId; secondDoctorEmail = second.email;
  });

  after(async () => {
    if (!testData) return;
    const recalls = await pool.query<{ id: string; original_appointment_id: string }>("select id::text, original_appointment_id::text from appointments_v2.complementary_recall_requests where requested_by_user_id in (select id from users where username like 'recallemail%')", []);
    const recallIds = recalls.rows.map((row) => row.id);
    const originalIds = recalls.rows.map((row) => row.original_appointment_id);
    await pool.query("delete from email_outbox where related_entity_type = 'complementary_recall_request' and related_entity_id = any($1::text[])", [recallIds]);
    await pool.query("update email_smtp_configuration set enabled = $1, smtp_password_secret = $2 where id = 1", [originalConfig.enabled, originalConfig.smtp_password_secret]);
    await pool.query("update email_notification_rules set enabled = $1, subject_template = $2, text_body_template = $3 where event_type = 'additional_imaging_completed'", [originalRule.enabled, originalRule.subject_template, originalRule.text_body_template]);
    await pool.query("delete from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[])", [originalIds]);
    await pool.query("delete from audit_log where entity_type = 'complementary_recall_request' and entity_id = any($1::bigint[])", [recallIds]);
    await pool.query("delete from appointments_v2.complementary_recall_requests where id = any($1::bigint[])", [recallIds]);
    await pool.query("delete from doctor_portal.doctor_profiles where id = any($1::bigint[])", [[reportingDoctorId, secondDoctorId]]);
    await pool.query("delete from users where id = any($1::bigint[])", [[reportingDoctorUserId, secondDoctorUserId]]);
    await testDb.cleanup();
  });

  async function originalBooking(): Promise<number> {
    const row = await pool.query<{ id: number }>("insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, booking_time, status, case_category, policy_version_id, created_by_user_id, updated_by_user_id) values ($1,$2,$3,'2039-07-12','09:00','completed','non_oncology',$4,$5,$5) returning id", [testData.patientId, testData.modalityId, testData.examTypeId, testData.policyVersionId, testData.userId]);
    return Number(row.rows[0]!.id);
  }

  async function scheduledRecall(): Promise<{ id: number; originalId: number; bookingId: number }> {
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { ...metadata, originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat acquisition", requestedByUserId: testData.userId }));
    const bookingId = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, recall, bookingId, testData.userId));
    return { id: recall.id, originalId, bookingId };
  }

  async function assign(originalId: number, doctorId = reportingDoctorId) {
    await pool.query("insert into doctor_portal.case_team_assignments (appointment_id, assigned_doctor_id, modality_id, assignment_type, status) values ($1,$2,$3,'reporting','active')", [originalId, doctorId, testData.modalityId]);
  }

  async function complete(doctorId: number | null = reportingDoctorId) {
    const item = await scheduledRecall();
    if (doctorId) await assign(item.originalId, doctorId);
    await transaction((client) => completeComplementaryRecallForBooking(client, item.bookingId, testData.userId));
    return item;
  }

  async function configureEmail(enabled: boolean, ruleEnabled: boolean, credentials = false) {
    await pool.query("update email_smtp_configuration set enabled = $1, smtp_password_secret = $2 where id = 1", [enabled, credentials ? {} : null]);
    await pool.query("update email_notification_rules set enabled = $1 where event_type = 'additional_imaging_completed'", [ruleEnabled]);
  }

  async function existingMessage(recallId: number, doctorUserId: number, status: string, eventType = "additional_imaging_completed") {
    const queued = await enqueueEmail({ eventType, recipientUserId: doctorUserId, recipientEmail: "existing@example.test", subject: "Existing", textBody: "Existing", idempotencyKey: `${eventType}:${recallId}:${doctorUserId}:${status}:${crypto.randomUUID()}`, relatedEntityType: "complementary_recall_request", relatedEntityId: String(recallId), createdByUserId: testData.userId });
    await pool.query("update email_outbox set status = $2, accepted_at = case when $2 = 'accepted' then now() else null end where id = $1", [queued.id, status]);
    return queued.id;
  }

  async function manual(recallId: number, forceResend = false) {
    return transaction((client) => queueManualComplementaryRecallCompletedEmail(client, { recallRequestId: recallId, actorUserId: testData.userId, forceResend }));
  }

  it("honors the automatic event switch independently of global outbound email", async () => {
    if (!testData) return;
    await configureEmail(true, false);
    const disabled = await complete();
    assert.equal((await getComplementaryRecall(disabled.id))?.status, "completed");
    assert.equal((await pool.query("select id from email_outbox where related_entity_id = $1", [String(disabled.id)])).rowCount, 0);

    await configureEmail(false, true);
    const globallyDisabled = await complete();
    assert.equal((await getComplementaryRecall(globallyDisabled.id))?.status, "completed");
    assert.equal((await pool.query("select id from email_outbox where related_entity_id = $1", [String(globallyDisabled.id)])).rowCount, 0);
  });

  it("fails open without an active eligible reporting doctor, email address, or active user", async () => {
    if (!testData) return;
    await configureEmail(true, true);
    const noAssignment = await complete(null);
    const noEmail = await scheduledRecall();
    await assign(noEmail.originalId);
    await pool.query("update users set email = null where id = $1", [reportingDoctorUserId]);
    await transaction((client) => completeComplementaryRecallForBooking(client, noEmail.bookingId, testData.userId));
    await pool.query("update users set email = $1, is_active = false where id = $2", [reportingDoctorEmail, reportingDoctorUserId]);
    const inactive = await complete();
    await pool.query("update users set is_active = true where id = $1", [reportingDoctorUserId]);
    await pool.query("update doctor_portal.doctor_profiles set active = false where id = $1", [reportingDoctorId]);
    const inactiveProfile = await complete();
    await pool.query("update doctor_portal.doctor_profiles set active = true where id = $1", [reportingDoctorId]);
    for (const id of [noAssignment.id, noEmail.id, inactive.id, inactiveProfile.id]) {
      assert.equal((await getComplementaryRecall(id))?.status, "completed");
      assert.equal((await pool.query("select id from email_outbox where related_entity_id = $1", [String(id)])).rowCount, 0);
    }
  });

  it("resolves the assignment present at completion time and renders a custom snapshot", async () => {
    if (!testData) return;
    await configureEmail(true, true);
    const first = await scheduledRecall();
    await assign(first.originalId, secondDoctorId);
    await transaction((client) => completeComplementaryRecallForBooking(client, first.bookingId, testData.userId));
    const firstEmail = (await pool.query<{ recipient_user_id: number; recipient_email: string }>("select recipient_user_id, recipient_email from email_outbox where related_entity_id = $1", [String(first.id)])).rows[0]!;
    assert.equal(Number(firstEmail.recipient_user_id), secondDoctorUserId);
    assert.equal(firstEmail.recipient_email, secondDoctorEmail);

    await setEmailNotificationTemplate("additional_imaging_completed", { subjectTemplate: "A {{modality}} {{additional_imaging_accession}}", textBodyTemplate: "A {{patient_name}} {{original_accession}} {{reporting_action}}" }, testData.userId);
    const snapshot = await complete();
    const beforeChange = (await pool.query<{ subject: string; text_body: string }>("select subject, text_body from email_outbox where related_entity_id = $1", [String(snapshot.id)])).rows[0]!;
    await setEmailNotificationTemplate("additional_imaging_completed", { subjectTemplate: "B {{original_accession}}", textBodyTemplate: "B {{modality}}" }, testData.userId);
    const future = await complete();
    const afterChange = (await pool.query<{ subject: string; text_body: string }>("select subject, text_body from email_outbox where related_entity_id = $1", [String(future.id)])).rows[0]!;
    assert.match(beforeChange.subject, /^A .* \/ Computed tomography/);
    assert.match(beforeChange.text_body, /^A /);
    assert.match(afterChange.subject, /^B V2-/);
    assert.match(afterChange.text_body, /^B .* \/ Computed tomography$/);
    assert.doesNotMatch(beforeChange.subject, /{{/);
    assert.doesNotMatch(beforeChange.text_body, /{{/);
  });

  it("allows manual send with automatic notifications disabled and writes a safe audit", async () => {
    if (!testData) return;
    await configureEmail(true, false, true);
    const item = await complete();
    const result = await manual(item.id);
    assert.equal(Number(result.recipientUserId), reportingDoctorUserId);
    const row = (await pool.query<{ event_type: string; recipient_email: string; status: string }>("select event_type, recipient_email, status from email_outbox where id = $1", [result.outboxId])).rows[0]!;
    assert.deepEqual(row, { event_type: "additional_imaging_completed_manual", recipient_email: reportingDoctorEmail, status: "pending" });
    const audit = (await pool.query<{ new_values: unknown }>("select new_values from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_completion_email_manually_queued' order by id desc limit 1", [item.id])).rows[0]!;
    const auditText = JSON.stringify(audit.new_values);
    assert.doesNotMatch(auditText, /patient|@example|Existing|RISpro/);
  });

  it("rejects manual sends when globally disabled, before completion, or without a current recipient", async () => {
    if (!testData) return;
    await configureEmail(false, false, true);
    const globallyDisabled = await complete();
    await assert.rejects(() => manual(globallyDisabled.id), (error: any) => error?.statusCode === 409 && error.message === "Outbound email is disabled.");

    await configureEmail(true, false, true);
    const pending = await scheduledRecall();
    await assert.rejects(() => manual(pending.id), (error: any) => error?.statusCode === 409 && /must be completed/.test(error.message));
    const noAssignment = await complete(null);
    await assert.rejects(() => manual(noAssignment.id), (error: any) => error?.statusCode === 409 && /No active reporting doctor/.test(error.message));
    const noEmail = await complete();
    await pool.query("update users set email = null where id = $1", [reportingDoctorUserId]);
    await assert.rejects(() => manual(noEmail.id), (error: any) => error?.statusCode === 409 && /no valid email/.test(error.message));
    await pool.query("update users set email = $1 where id = $2", [reportingDoctorEmail, reportingDoctorUserId]);
  });

  it("protects active jobs, requires force for accepted mail, and permits failed retries", async () => {
    if (!testData) return;
    await configureEmail(true, false, true);
    for (const status of ["pending", "processing", "retry_scheduled"]) {
      const item = await complete();
      await existingMessage(item.id, reportingDoctorUserId, status);
      await assert.rejects(() => manual(item.id), (error: any) => error?.statusCode === 409 && /already queued/.test(error.message));
    }
    const accepted = await complete();
    await existingMessage(accepted.id, reportingDoctorUserId, "accepted");
    await assert.rejects(() => manual(accepted.id), (error: any) => error?.statusCode === 409 && /already been notified/.test(error.message));
    const forced = await manual(accepted.id, true);
    assert.equal((await pool.query("select id from email_outbox where related_entity_id = $1 and event_type = 'additional_imaging_completed_manual'", [String(accepted.id)])).rowCount, 1);
    assert.equal(forced.status, "pending");
    const failed = await complete();
    await existingMessage(failed.id, reportingDoctorUserId, "failed");
    const retried = await manual(failed.id);
    assert.equal(retried.status, "pending");
  });

  it("prevents concurrent manual double clicks from creating two messages", async () => {
    if (!testData) return;
    await configureEmail(true, false, true);
    const item = await complete();
    const results = await Promise.allSettled([manual(item.id), manual(item.id)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await pool.query("select id from email_outbox where related_entity_id = $1 and event_type = 'additional_imaging_completed_manual'", [String(item.id)])).rowCount, 1);
  });

  it("uses the current doctor after reassignment and does not inherit the old doctor's acceptance", async () => {
    if (!testData) return;
    await configureEmail(true, true, true);
    const item = await complete(reportingDoctorId);
    await pool.query("update email_outbox set status = 'accepted', accepted_at = now() where related_entity_id = $1 and recipient_user_id = $2", [String(item.id), reportingDoctorUserId]);
    await pool.query("update doctor_portal.case_team_assignments set status = 'superseded' where appointment_id = $1 and assigned_doctor_id = $2", [item.originalId, reportingDoctorId]);
    await assign(item.originalId, secondDoctorId);
    const status = (await getComplementaryRecallCompletionEmailStatuses([item.id])).get(item.id)!;
    assert.equal(Number(status.recipientUserId), secondDoctorUserId);
    assert.equal(status.hasAccepted, false);
    assert.equal(status.latestStatus, null);
    const result = await manual(item.id);
    assert.equal(Number((await pool.query<{ recipient_user_id: number }>("select recipient_user_id from email_outbox where id = $1", [result.outboxId])).rows[0]!.recipient_user_id), secondDoctorUserId);
  });

  it("maps current-recipient outbox statuses in one batched status query", async () => {
    const queryCalls: string[] = [];
    const rows = [1, 2, 3, 4].map((id) => ({ id, original_appointment_id: id + 100, recall_appointment_id: id + 200, reception_instruction: null, technologist_instruction: "x", reason_code: null, qa_classification: null, urgency: null, due_at: null, reporting_disposition: null, status: "completed", requested_by_user_id: 1, requested_at: "2039-01-01T00:00:00.000Z", reception_seen_at: null, reception_acknowledged_at: null, reception_acknowledged_by_user_id: null, scheduled_at: null, completed_at: null, cancelled_at: null, patient_phone_1: null, patient_phone_2: null, contact_attempts: null }));
    const fakeDb = { query: async (sql: string, params?: unknown[]) => { queryCalls.push(sql); if (sql.includes("left join email_outbox")) return { rows: [{ id: 1, recipient_user_id: 11, recipient_display_name: "A", recipient_email: "a@example.test", status: "pending", created_at: "2039-01-01T00:00:00.000Z", accepted_at: null }, { id: 2, recipient_user_id: 12, recipient_display_name: "B", recipient_email: "b@example.test", status: "accepted", created_at: "2039-01-01T00:00:00.000Z", accepted_at: "2039-01-01T00:01:00.000Z" }, { id: 3, recipient_user_id: 13, recipient_display_name: "C", recipient_email: "c@example.test", status: "failed", created_at: "2039-01-01T00:00:00.000Z", accepted_at: null }] }; return { rows }; } };
    const result = await listComplementaryRecalls(fakeDb as any);
    assert.equal(queryCalls.length, 2);
    assert.deepEqual(result.map((row) => row.completionEmailNotification?.latestStatus), ["pending", "accepted", "failed", null]);
    assert.equal(result[1]?.completionEmailNotification?.hasAccepted, true);
  });
});
