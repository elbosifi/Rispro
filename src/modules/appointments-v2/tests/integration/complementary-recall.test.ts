import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import { createBooking } from "../../booking/services/create-booking.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { completeComplementaryRecallForBooking, complementaryRecallUnseenCount, createComplementaryRecall, getComplementaryRecall, getComplementaryRecallBookingContext, linkComplementaryRecallBooking, listComplementaryRecalls, markComplementaryRecallsSeen, reopenComplementaryRecallForUncompletedBooking, updateComplementaryRecallInstructions, withdrawComplementaryRecall } from "../../recall/complementary-recall.service.js";
import { resolveMwlEligibilityForBooking } from "../../../../services/mwl-eligibility-service.js";
import { canReachDatabase, isDatabaseAvailable, seedTestData, setupTestDatabase, type TestData } from "./helpers.js";

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "RECALL_";

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
  });

  it("joins the reception work queue and keeps unseen independent of scheduled state", async () => {
    if (!testData) return;
    const unseenBefore = await complementaryRecallUnseenCount();
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: "Call before booking", technologistInstruction: "Repeat delayed phase", requestedByUserId: testData.userId }));
    const rows = await listComplementaryRecalls();
    const row = rows.find((item) => item.id === recall.id);
    assert.equal(row?.originalAppointmentId, originalId);
    assert.ok(row?.patientDisplayName);
    assert.ok(row?.patientIdentifier || row?.patientMrn);
    assert.equal(row?.receptionInstruction, "Call before booking");
    assert.equal(row?.technologistInstruction, "Repeat delayed phase");
    assert.ok(row?.originalAccession);
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore + 1);
    await transaction((client) => markComplementaryRecallsSeen(client, [recall.id], testData.userId));
    assert.equal((await getComplementaryRecall(recall.id))?.status, "pending_scheduling");
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore);
  });

  it("links, seeds, reopens, completes, and never reuses a StudyInstanceUID", async () => {
    if (!testData) return;
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat contrast phase", requestedByUserId: testData.userId }));
    await assert.rejects(() => createBooking({ complementaryRecallRequestId: recall.id, patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: "2039-06-13", bookingTime: "10:00", caseCategory: "non_oncology", studyInstanceUid: "1.2.3" }, testData.userId, "supervisor", testData.policySetKey), { statusCode: 400 });
    const created = await createBooking({ complementaryRecallRequestId: recall.id, patientId: testData.patientId, modalityId: testData.modalityId, examTypeId: testData.examTypeId, bookingDate: "2039-06-13", bookingTime: "10:00", caseCategory: "non_oncology" }, testData.userId, "supervisor", testData.policySetKey);
    const returnBookingId = Number(created.booking.id);
    const scheduled = await getComplementaryRecall(recall.id);
    assert.equal(scheduled?.recallAppointmentId, returnBookingId);
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

  it("allows withdrawal only before a return appointment is booked", async () => {
    if (!testData) return;
    const originalId = await originalBooking();
    const recall = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: originalId, receptionInstruction: null, technologistInstruction: "Repeat acquisition", requestedByUserId: testData.userId }));
    const returnId = await originalBooking();
    await transaction((client) => linkComplementaryRecallBooking(client, recall, returnId, testData.userId));
    await assert.rejects(() => transaction((client) => withdrawComplementaryRecall(client, recall.id, testData.userId)), { statusCode: 409 });
    await transaction((client) => reopenComplementaryRecallForUncompletedBooking(client, returnId, testData.userId, "no-show"));
    const reopened = await getComplementaryRecall(recall.id);
    assert.equal(reopened?.status, "pending_scheduling");
    assert.equal(reopened?.recallAppointmentId, null);
    const cancelled = await transaction((client) => withdrawComplementaryRecall(client, recall.id, testData.userId));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.recallAppointmentId, null);
    assert.equal((await pool.query("select id from appointments_v2.bookings where id = $1", [returnId])).rowCount, 1);
  });

  it("edits only pending instructions and makes the request unseen again", async () => {
    if (!testData) return;
    const unseenBefore = await complementaryRecallUnseenCount();
    const pendingOriginalId = await originalBooking();
    const pending = await transaction((client) => createComplementaryRecall(client, { originalAppointmentId: pendingOriginalId, receptionInstruction: "Old reception", technologistInstruction: "Old technologist", requestedByUserId: testData.userId }));
    await transaction((client) => markComplementaryRecallsSeen(client, [pending.id], testData.userId));
    assert.equal(await complementaryRecallUnseenCount(), unseenBefore);
    const updated = await transaction((client) => updateComplementaryRecallInstructions(client, pending.id, { receptionInstruction: "  New reception  ", technologistInstruction: "  New technologist  ", actorUserId: testData.userId }));
    assert.equal(updated.receptionInstruction, "New reception");
    assert.equal(updated.technologistInstruction, "New technologist");
    assert.equal(updated.status, "pending_scheduling");
    assert.equal(updated.recallAppointmentId, null);
    assert.equal((await getComplementaryRecall(pending.id))?.receptionSeenAt, null);
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
