import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import { createBooking } from "../../booking/services/create-booking.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { voidBookingByStaff } from "../../booking/services/void-booking.service.js";
import { acknowledgeComplementaryRecall, completeComplementaryRecallForBooking, complementaryRecallReceptionSummary, complementaryRecallUnseenCount, createComplementaryRecall as createComplementaryRecallRecord, getComplementaryRecall, getComplementaryRecallBookingContext, linkComplementaryRecallBooking, listComplementaryRecalls, markComplementaryRecallsSeen, reopenComplementaryRecallForUncompletedBooking, updateComplementaryRecallInstructions as updateComplementaryRecallRecord, withdrawComplementaryRecall } from "../../recall/complementary-recall.service.js";
import { resolveMwlEligibilityForBooking } from "../../../../services/mwl-eligibility-service.js";
import { canReachDatabase, isDatabaseAvailable, seedTestData, setupTestDatabase, type TestData } from "./helpers.js";

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "RECALL_";
const recallMetadata = { reasonCode: "technical_equipment_problem", qaClassification: "technical_repeat", urgency: "routine", dueAt: null, reportingDisposition: "supplement_original_report" } as const;
type RecallCreateInput = Omit<Parameters<typeof createComplementaryRecallRecord>[1], keyof typeof recallMetadata> & Partial<Pick<Parameters<typeof createComplementaryRecallRecord>[1], keyof typeof recallMetadata>>;
type RecallUpdateInput = Omit<Parameters<typeof updateComplementaryRecallRecord>[2], keyof typeof recallMetadata> & Partial<Pick<Parameters<typeof updateComplementaryRecallRecord>[2], keyof typeof recallMetadata>>;

function createComplementaryRecall(client: import("pg").PoolClient, input: RecallCreateInput) {
  return createComplementaryRecallRecord(client, { ...recallMetadata, ...input });
}

function updateComplementaryRecallInstructions(client: import("pg").PoolClient, id: number, input: RecallUpdateInput) {
  return updateComplementaryRecallRecord(client, id, { ...recallMetadata, ...input });
}

describe("Complementary recall — integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;

  async function transaction<T>(run: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try { await client.query("begin"); const result = await run(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  async function originalBooking(overrides: Partial<{ patientId: number; modalityId: number; examTypeId: number | null; status: string }> = {}): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings (patient_id, modality_id, exam_type_id, booking_date, booking_time, status, case_category, policy_version_id, created_by_user_id, updated_by_user_id)
       values ($1, $2, $3, '2039-06-12', '09:00', $4, 'non_oncology', $5, $6, $6) returning id`,
      [overrides.patientId ?? testData.patientId, overrides.modalityId ?? testData.modalityId, overrides.examTypeId === undefined ? testData.examTypeId : overrides.examTypeId, overrides.status ?? "completed", testData.policyVersionId, testData.userId]
    );
    return Number(result.rows[0]!.id);
  }

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    await pool.query("update modalities set name_en = 'Computed tomography' where id = $1", [testData.modalityId]);
  });

  after(async () => {
    if (!testData) return;
    await pool.query(`delete from appointment_protocol_assignments where appointment_id in (select recall_appointment_id from appointments_v2.complementary_recall_requests where requested_by_user_id = $1 and recall_appointment_id is not null)`, [testData.userId]);
    await pool.query("delete from appointments_v2.complementary_recall_requests where requested_by_user_id = $1", [testData.userId]);
    await testDb.cleanup();
  });

  it("validates eligible originals, instruction, and duplicate active recalls", async () => {
    if (!testData) return;
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: "Reception note", technologistInstruction: "Repeat axial acquisition", requestedByUserId: testData.userId }));
    assert.equal(recall.status, "pending_scheduling");
    assert.equal(recall.dueAt, null);
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId })), { statusCode: 409 });
    const missingExamOriginalId = await originalBooking({ examTypeId: null });
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: missingExamOriginalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId })), { statusCode: 409 });
    const blankInstructionOriginalId = await originalBooking();
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: blankInstructionOriginalId, receptionInstruction: null, technologistInstruction: "   ", requestedByUserId: testData.userId })), { statusCode: 400 });
    const nonProtocolingModality = await pool.query<{ id: number }>("insert into modalities(name_ar, name_en, code, daily_capacity, is_active) values ('X', 'Ultrasound', $1, 10, true) returning id", [`${TEST_PREFIX}US`]);
    const nonProtocolingOriginalId = await originalBooking({ modalityId: Number(nonProtocolingModality.rows[0]!.id) });
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: nonProtocolingOriginalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId })), { statusCode: 409 });
    for (const status of ["scheduled", "arrived", "waiting", "no-show", "cancelled", "discontinued", "voided"]) {
      const ineligibleId = await originalBooking({ status });
      await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: ineligibleId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId })), { statusCode: 409 });
    }
    const invalidMetadataOriginalId = await originalBooking();
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: invalidMetadataOriginalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId, reasonCode: "invalid" })), { statusCode: 400 });
    const invalidQaOriginalId = await originalBooking();
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: invalidQaOriginalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId, qaClassification: "invalid" })), { statusCode: 400 });
    const invalidUrgencyOriginalId = await originalBooking();
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: invalidUrgencyOriginalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId, urgency: "invalid" })), { statusCode: 400 });
    const invalidReportingOriginalId = await originalBooking();
    await assert.rejects(() => transaction((client) => createComplementaryRecall(client, { originalAppointmentId: invalidReportingOriginalId, receptionInstruction: null, technologistInstruction: "Repeat", requestedByUserId: testData.userId, reportingDisposition: "invalid" })), { statusCode: 400 });
  });

  it("joins the reception work queue and keeps unseen independent of scheduled state", async () => {
    if (!testData) return;
    const summaryBefore = await complementaryRecallReceptionSummary();
    const unseenBefore = await complementaryRecallUnseenCount();
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: "Call before booking", technologistInstruction: "Repeat delayed phase", requestedByUserId: testData.userId, reasonCode: "missing_sequence_phase", qaClassification: "acquisition_error", urgency: "within_24_hours", dueAt: "2039-06-13T10:30:00.000Z", reportingDisposition: "separate_report" }));
    const rows = await listComplementaryRecalls();
    const row = rows.find((item) => item.id === recall.id);
    assert.equal(row?.originalAppointmentId, originalId);
    assert.ok(row?.patientDisplayName);
    assert.ok(row?.patientIdentifier || row?.patientMrn);
    assert.equal(row?.receptionInstruction, "Call before booking");
    assert.equal(row?.technologistInstruction, "Repeat delayed phase");
    assert.equal(recall.reasonCode, "missing_sequence_phase");
    assert.equal(recall.qaClassification, "acquisition_error");
    assert.equal(recall.urgency, "within_24_hours");
    assert.equal(recall.dueAt, "2039-06-13T10:30:00.000Z");
    assert.equal(recall.reportingDisposition, "separate_report");
    assert.equal(recall.receptionAcknowledgedAt, null);
    assert.equal(recall.receptionAcknowledgedByUserId, null);
    const fetched = await getComplementaryRecall(recall.id);
    assert.equal(fetched?.reasonCode, "missing_sequence_phase");
    assert.equal(fetched?.dueAt, "2039-06-13T10:30:00.000Z");
    assert.equal(row?.qaClassification, "acquisition_error");
    assert.equal(row?.urgency, "within_24_hours");
    assert.equal(row?.reportingDisposition, "separate_report");
    assert.equal(row?.receptionAcknowledgedAt, null);
    assert.equal(row?.receptionAcknowledgedByUserId, null);
    const createAudit = await pool.query<{ new_values: { reasonCode: string; qaClassification: string; urgency: string; dueAt: string; reportingDisposition: string } }>("select new_values from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_requested' order by id desc limit 1", [recall.id]);
    assert.deepEqual(createAudit.rows[0]?.new_values, { originalAppointmentId: originalId, status: "pending_scheduling", reasonCode: "missing_sequence_phase", qaClassification: "acquisition_error", urgency: "within_24_hours", dueAt: "2039-06-13T10:30:00.000Z", reportingDisposition: "separate_report" });
    assert.ok(row?.originalAccession);
    assert.deepEqual(await complementaryRecallReceptionSummary(), { pendingCount: summaryBefore.pendingCount + 1, unseenPendingCount: summaryBefore.unseenPendingCount + 1 });
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore + 1);
    await transaction((client) => markComplementaryRecallsSeen(client, [recall.id], testData.userId));
    assert.equal((await getComplementaryRecall(recall.id))?.status, "pending_scheduling");
    assert.deepEqual(await complementaryRecallReceptionSummary(), { pendingCount: summaryBefore.pendingCount + 1, unseenPendingCount: summaryBefore.unseenPendingCount });
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore);
  });

  it("acknowledges pending requests idempotently, preserves Seen, and rejects closed states", async () => {
    if (!testData) return;
    const unseenOriginalId = await originalBooking();
    const unseen = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: unseenOriginalId, receptionInstruction: null, technologistInstruction: "Acknowledge me", requestedByUserId: testData.userId }));
    const first = await transaction((client) => acknowledgeComplementaryRecall(client, unseen.id, testData.userId));
    assert.equal(first.receptionAcknowledgedByUserId, testData.userId);
    assert.ok(first.receptionAcknowledgedAt);
    assert.ok(first.receptionSeenAt);
    assert.equal(Number((await pool.query<{ reception_seen_by_user_id: number }>("select reception_seen_by_user_id from appointments_v2.complementary_recall_requests where id = $1", [unseen.id])).rows[0]?.reception_seen_by_user_id), testData.userId);
    const firstSeenAt = new Date(first.receptionSeenAt!).toISOString();
    const firstAcknowledgedAt = first.receptionAcknowledgedAt;
    const retry = await transaction((client) => acknowledgeComplementaryRecall(client, unseen.id, testData.userId + 1));
    assert.equal(retry.receptionAcknowledgedAt, firstAcknowledgedAt);
    assert.equal(retry.receptionAcknowledgedByUserId, testData.userId);
    assert.equal(new Date(retry.receptionSeenAt!).toISOString(), firstSeenAt);
    assert.equal((await pool.query("select count(*) from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_acknowledged'", [unseen.id])).rows[0]?.count, "1");

    const alreadySeenOriginalId = await originalBooking();
    const alreadySeen = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: alreadySeenOriginalId, receptionInstruction: null, technologistInstruction: "Already seen", requestedByUserId: testData.userId }));
    const originalSeenAt = "2039-06-20T08:00:00.000Z";
    await pool.query("update appointments_v2.complementary_recall_requests set reception_seen_at = $2, reception_seen_by_user_id = $3 where id = $1", [alreadySeen.id, originalSeenAt, testData.userId]);
    const alreadySeenAck = await transaction((client) => acknowledgeComplementaryRecall(client, alreadySeen.id, testData.userId));
    assert.equal(new Date(alreadySeenAck.receptionSeenAt!).toISOString(), originalSeenAt);
    assert.equal(Number((await pool.query<{ reception_seen_by_user_id: number }>("select reception_seen_by_user_id from appointments_v2.complementary_recall_requests where id = $1", [alreadySeen.id])).rows[0]?.reception_seen_by_user_id), testData.userId);

    const scheduledOriginalId = await originalBooking();
    const scheduled = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: scheduledOriginalId, receptionInstruction: null, technologistInstruction: "Scheduled", requestedByUserId: testData.userId }));
    const scheduledBooking = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, scheduled, scheduledBooking, testData.userId));
    await assert.rejects(() => transaction((client) => acknowledgeComplementaryRecall(client, scheduled.id, testData.userId)), { statusCode: 409 });
    const completedOriginalId = await originalBooking();
    const completed = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: completedOriginalId, receptionInstruction: null, technologistInstruction: "Completed", requestedByUserId: testData.userId }));
    const completedBooking = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, completed, completedBooking, testData.userId));
    await transaction((client) => completeComplementaryRecallForBooking(client, completedBooking, testData.userId));
    await assert.rejects(() => transaction((client) => acknowledgeComplementaryRecall(client, completed.id, testData.userId)), { statusCode: 409 });
    const cancelledOriginalId = await originalBooking();
    const cancelled = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: cancelledOriginalId, receptionInstruction: null, technologistInstruction: "Cancelled", requestedByUserId: testData.userId }));
    await transaction((client) => withdrawComplementaryRecall(client, cancelled.id, testData.userId));
    await assert.rejects(() => transaction((client) => acknowledgeComplementaryRecall(client, cancelled.id, testData.userId)), { statusCode: 409 });
  });

  it("links, seeds, reopens, completes, and never reuses a StudyInstanceUID", async () => {
    if (!testData) return;
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat contrast phase", requestedByUserId: testData.userId }));
    const summaryAfterCreate = await complementaryRecallReceptionSummary();
    await assert.rejects(() => createBooking({ complementaryRecallRequestId: recall.id, patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: "2039-06-13", bookingTime: "10:00", caseCategory: "non_oncology", studyInstanceUid: "1.2.3" }, testData.userId, "supervisor", testData.policySetKey), { statusCode: 400 });
    const created = await createBooking({ complementaryRecallRequestId: recall.id, patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: "2039-06-13", bookingTime: "10:00", caseCategory: "non_oncology" }, testData.userId, "supervisor", testData.policySetKey);
    const returnBookingId = Number(created.booking.id);
    const scheduled = await getComplementaryRecall(recall.id);
    assert.equal(scheduled?.recallAppointmentId, returnBookingId);
    assert.equal((await complementaryRecallReceptionSummary()).pendingCount, summaryAfterCreate.pendingCount - 1);
    const assignment = await pool.query<{ free_text_protocol: string; scanner_id: number | null }>("select free_text_protocol, scanner_id from appointment_protocol_assignments where appointment_id = $1", [returnBookingId]);
    assert.deepEqual(assignment.rows[0], { free_text_protocol: "Repeat contrast phase", scanner_id: null });
    const eligibility = await resolveMwlEligibilityForBooking(returnBookingId);
    assert.equal(eligibility.activeProtocolAssignmentExists, true);
    assert.equal(eligibility.holdReason, null);
    await cancelBooking(returnBookingId, testData.userId);
    assert.equal((await getComplementaryRecall(recall.id))?.status, "pending_scheduling");
    const rebooked = await createBooking({ complementaryRecallRequestId: recall.id, patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: "2039-06-14", bookingTime: "10:00", caseCategory: "non_oncology" }, testData.userId, "supervisor", testData.policySetKey);
    await transaction((client) => completeComplementaryRecallForBooking(client, Number(rebooked.booking.id), testData.userId));
    assert.equal((await getComplementaryRecall(recall.id))?.status, "completed");
    await assert.rejects(() => getComplementaryRecallBookingContext(recall.id), { statusCode: 409 });
  });

  it("reopens a completed complementary appointment through the super_admin void path", async () => {
    if (!testData) return;
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat acquisition", requestedByUserId: testData.userId }));
    const acknowledged = await transaction((client) => acknowledgeComplementaryRecall(client, recall.id, testData.userId));
    const created = await createBooking({ complementaryRecallRequestId: recall.id, patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: "2039-06-15", bookingTime: "10:00", caseCategory: "non_oncology" }, testData.userId, "supervisor", testData.policySetKey);
    const recallBookingId = Number(created.booking.id);
    await transaction((client) => markComplementaryRecallsSeen(client, [recall.id], testData.userId));
    await transaction((client) => completeComplementaryRecallForBooking(client, recallBookingId, testData.userId));
    await pool.query("update appointments_v2.bookings set status = 'completed', completed_at = now() where id = $1", [recallBookingId]);
    await voidBookingByStaff(recallBookingId, testData.userId, "super_admin", "Corrected completion");
    const reopened = await getComplementaryRecall(recall.id);
    assert.equal(reopened?.status, "pending_scheduling");
    assert.equal(reopened?.recallAppointmentId, null);
    assert.equal(reopened?.scheduledAt, null);
    assert.equal(reopened?.completedAt, null);
    assert.equal(reopened?.receptionSeenAt, null);
    assert.equal(reopened?.receptionAcknowledgedAt, acknowledged.receptionAcknowledgedAt);
    assert.equal(reopened?.receptionAcknowledgedByUserId, testData.userId);
    const audit = await pool.query<{ old_values: { status: string; recallAppointmentId: number; scheduledAt: string; completedAt: string }; new_values: { status: string; recallAppointmentId: null; previousRecallAppointmentId: number; reason: string } }>("select old_values, new_values from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_reopened_after_uncompleted_booking' order by id desc limit 1", [recall.id]);
    assert.equal(audit.rows[0]?.old_values.status, "completed");
    assert.equal(audit.rows[0]?.old_values.recallAppointmentId, recallBookingId);
    assert.ok(audit.rows[0]?.old_values.scheduledAt);
    assert.ok(audit.rows[0]?.old_values.completedAt);
    assert.deepEqual(audit.rows[0]?.new_values, { status: "pending_scheduling", recallAppointmentId: null, previousRecallAppointmentId: recallBookingId, reason: "voided" });
  });

  it("allows withdrawal only before a return appointment is booked", async () => {
    if (!testData) return;
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat acquisition", requestedByUserId: testData.userId }));
    const acknowledged = await transaction((client) => acknowledgeComplementaryRecall(client, recall.id, testData.userId));
    await transaction((client) => markComplementaryRecallsSeen(client, [recall.id], testData.userId));
    const returnId = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, recall, returnId, testData.userId));
    await assert.rejects(() => transaction((client) => withdrawComplementaryRecall(client, recall.id, testData.userId)), { statusCode: 409 });
    const summaryBeforeReopen = await complementaryRecallReceptionSummary();
    await transaction((client) => reopenComplementaryRecallForUncompletedBooking(client, returnId, testData.userId, "no-show"));
    const reopened = await getComplementaryRecall(recall.id);
    assert.equal(reopened?.status, "pending_scheduling");
    assert.equal(reopened?.recallAppointmentId, null);
    assert.equal(reopened?.receptionSeenAt, null);
    assert.equal(reopened?.receptionAcknowledgedAt, acknowledged.receptionAcknowledgedAt);
    assert.equal(reopened?.receptionAcknowledgedByUserId, testData.userId);
    const listed = (await listComplementaryRecalls()).find((item) => item.id === recall.id);
    assert.equal(listed?.previousAttemptAppointmentId, returnId);
    assert.equal(listed?.previousAttemptReason, "no-show");
    assert.ok(listed?.previousAttemptAt);
    assert.deepEqual(await complementaryRecallReceptionSummary(), { pendingCount: summaryBeforeReopen.pendingCount + 1, unseenPendingCount: summaryBeforeReopen.unseenPendingCount + 1 });
    const cancelled = await transaction((client) => withdrawComplementaryRecall(client, recall.id, testData.userId));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.recallAppointmentId, null);
    assert.equal((await pool.query("select id from appointments_v2.bookings where id = $1", [returnId])).rowCount, 1);
  });

  it("clears acknowledgement only for meaningful request changes", async () => {
    if (!testData) return;
    const meaningfulChanges: Array<{ name: string; input: Partial<RecallUpdateInput> }> = [
      { name: "receptionInstruction", input: { receptionInstruction: "Updated reception" } },
      { name: "technologistInstruction", input: { technologistInstruction: "Updated technologist" } },
      { name: "reasonCode", input: { reasonCode: "incorrect_protocol" } },
      { name: "urgency", input: { urgency: "same_day" } },
      { name: "dueAt", input: { dueAt: "2039-06-21T08:00:00.000Z" } },
    ];
    for (const change of meaningfulChanges) {
      const originalId = await originalBooking();
      const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: "Original reception", technologistInstruction: "Original technologist", reasonCode: "technical_equipment_problem", qaClassification: "technical_repeat", urgency: "routine", dueAt: null, reportingDisposition: "supplement_original_report", requestedByUserId: testData.userId }));
      const acknowledged = await transaction((client) => acknowledgeComplementaryRecall(client, recall.id, testData.userId));
      assert.ok(acknowledged.receptionAcknowledgedAt);
      await transaction((client) => updateComplementaryRecallInstructions(client, recall.id, { receptionInstruction: "Original reception", technologistInstruction: "Original technologist", reasonCode: "technical_equipment_problem", qaClassification: "technical_repeat", urgency: "routine", dueAt: null, reportingDisposition: "supplement_original_report", ...change.input, actorUserId: testData.userId }));
      const updated = await getComplementaryRecall(recall.id);
      assert.equal(updated?.receptionAcknowledgedAt, null, change.name);
      assert.equal(updated?.receptionAcknowledgedByUserId, null, change.name);
      assert.equal(updated?.receptionSeenAt, null, change.name);
      const audit = await pool.query<{ old_values: { acknowledgedAt: string; acknowledgedByUserId: number }; new_values: { acknowledgedAt: null; acknowledgedByUserId: null; reason: string; changedByUserId: number } }>("select old_values, new_values from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_acknowledgement_cleared_by_request_update'", [recall.id]);
      assert.equal(audit.rows.length, 1, change.name);
      assert.ok(audit.rows[0]?.old_values.acknowledgedAt, change.name);
      assert.equal(audit.rows[0]?.old_values.acknowledgedByUserId, testData.userId, change.name);
      assert.equal(audit.rows[0]?.new_values.reason, "meaningful recall fields changed", change.name);
      assert.equal(audit.rows[0]?.new_values.changedByUserId, testData.userId, change.name);
    }

    for (const change of [{ qaClassification: "protocol_error" }, { reportingDisposition: "no_separate_report" }] as const) {
      const originalId = await originalBooking();
      const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: "Original reception", technologistInstruction: "Original technologist", reasonCode: "technical_equipment_problem", qaClassification: "technical_repeat", urgency: "routine", dueAt: null, reportingDisposition: "supplement_original_report", requestedByUserId: testData.userId }));
      const acknowledged = await transaction((client) => acknowledgeComplementaryRecall(client, recall.id, testData.userId));
      await transaction((client) => updateComplementaryRecallInstructions(client, recall.id, { receptionInstruction: "Original reception", technologistInstruction: "Original technologist", reasonCode: "technical_equipment_problem", qaClassification: "technical_repeat", urgency: "routine", dueAt: null, reportingDisposition: "supplement_original_report", ...change, actorUserId: testData.userId }));
      const updated = await getComplementaryRecall(recall.id);
      assert.equal(updated?.receptionAcknowledgedAt, acknowledged.receptionAcknowledgedAt);
      assert.equal(updated?.receptionAcknowledgedByUserId, testData.userId);
      assert.equal(updated?.receptionSeenAt, null);
      assert.equal((await pool.query("select count(*) from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_acknowledgement_cleared_by_request_update'", [recall.id])).rows[0]?.count, "0");
    }
  });

  it("preserves acknowledgement when cancelled or discontinued returns reopen", async () => {
    if (!testData) return;
    for (const reason of ["cancelled", "discontinued"] as const) {
      const originalId = await originalBooking();
      const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: `Reopen ${reason}`, requestedByUserId: testData.userId }));
      const acknowledged = await transaction((client) => acknowledgeComplementaryRecall(client, recall.id, testData.userId));
      const returnId = await originalBooking();
      await transaction((client) => linkComplementaryRecallBooking(client, recall, returnId, testData.userId));
      await transaction((client) => reopenComplementaryRecallForUncompletedBooking(client, returnId, testData.userId, reason));
      const reopened = await getComplementaryRecall(recall.id);
      assert.equal(reopened?.receptionAcknowledgedAt, acknowledged.receptionAcknowledgedAt, reason);
      assert.equal(reopened?.receptionAcknowledgedByUserId, testData.userId, reason);
      assert.equal(reopened?.receptionSeenAt, null, reason);
    }
  });

  it("edits only pending instructions and makes the request unseen again", async () => {
    if (!testData) return;
    const summaryBefore = await complementaryRecallReceptionSummary();
    const unseenBefore = await complementaryRecallUnseenCount();
    const pendingOriginalId = await originalBooking();
    const pending = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: pendingOriginalId, receptionInstruction: "Old reception", technologistInstruction: "Old technologist", requestedByUserId: testData.userId }));
    await transaction((client) => markComplementaryRecallsSeen(client, [pending.id], testData.userId));
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore);
    const updated = await transaction((client) => updateComplementaryRecallInstructions(client, pending.id, { receptionInstruction: "  New reception  ", technologistInstruction: "  New technologist  ", reasonCode: "incorrect_protocol", qaClassification: "protocol_error", urgency: "same_day", dueAt: "2039-06-16T08:00:00.000Z", reportingDisposition: "no_separate_report", actorUserId: testData.userId }));
    assert.equal(updated.receptionInstruction, "New reception");
    assert.equal(updated.technologistInstruction, "New technologist");
    assert.equal(updated.reasonCode, "incorrect_protocol");
    assert.equal(updated.qaClassification, "protocol_error");
    assert.equal(updated.urgency, "same_day");
    assert.equal(updated.dueAt, "2039-06-16T08:00:00.000Z");
    assert.equal(updated.reportingDisposition, "no_separate_report");
    const updateAudit = await pool.query<{ new_values: { reasonCode: string; qaClassification: string; urgency: string; dueAt: string; reportingDisposition: string } }>("select new_values from audit_log where entity_type = 'complementary_recall_request' and entity_id = $1 and action_type = 'complementary_recall_instructions_updated' order by id desc limit 1", [pending.id]);
    assert.equal(updateAudit.rows[0]?.new_values.reasonCode, "incorrect_protocol");
    assert.equal(updateAudit.rows[0]?.new_values.qaClassification, "protocol_error");
    assert.equal(updateAudit.rows[0]?.new_values.urgency, "same_day");
    assert.equal(updateAudit.rows[0]?.new_values.dueAt, "2039-06-16T08:00:00.000Z");
    assert.equal(updateAudit.rows[0]?.new_values.reportingDisposition, "no_separate_report");
    assert.equal(updated.status, "pending_scheduling");
    assert.equal(updated.recallAppointmentId, null);
    assert.equal((await getComplementaryRecall(pending.id))?.receptionSeenAt, null);
    assert.equal((await complementaryRecallReceptionSummary()).pendingCount, summaryBefore.pendingCount + 1);
    assert.equal((await complementaryRecallReceptionSummary()).unseenPendingCount, summaryBefore.unseenPendingCount + 1);
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore + 1);
    await assert.rejects(() => transaction((client) => updateComplementaryRecallInstructions(client, pending.id, { receptionInstruction: null, technologistInstruction: "   ", actorUserId: testData.userId })), { statusCode: 400 });

    const scheduledOriginalId = await originalBooking();
    const scheduled = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: scheduledOriginalId, receptionInstruction: null, technologistInstruction: "Scheduled", requestedByUserId: testData.userId }));
    const scheduledReturnId = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, scheduled, scheduledReturnId, testData.userId));
    await assert.rejects(() => transaction((client) => updateComplementaryRecallInstructions(client, scheduled.id, { receptionInstruction: null, technologistInstruction: "Nope", actorUserId: testData.userId })), { statusCode: 409 });

    const completedOriginalId = await originalBooking();
    const completed = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: completedOriginalId, receptionInstruction: null, technologistInstruction: "Completed", requestedByUserId: testData.userId }));
    const completedReturn = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, completed, completedReturn, testData.userId));
    await transaction((client) => completeComplementaryRecallForBooking(client, completedReturn, testData.userId));
    await assert.rejects(() => transaction((client) => updateComplementaryRecallInstructions(client, completed.id, { receptionInstruction: null, technologistInstruction: "Nope", actorUserId: testData.userId })), { statusCode: 409 });

    const withdrawnOriginalId = await originalBooking();
    const withdrawn = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: withdrawnOriginalId, receptionInstruction: null, technologistInstruction: "Withdrawn", requestedByUserId: testData.userId }));
    await transaction((client) => withdrawComplementaryRecall(client, withdrawn.id, testData.userId));
    await assert.rejects(() => transaction((client) => updateComplementaryRecallInstructions(client, withdrawn.id, { receptionInstruction: null, technologistInstruction: "Nope", actorUserId: testData.userId })), { statusCode: 409 });
  });
});
