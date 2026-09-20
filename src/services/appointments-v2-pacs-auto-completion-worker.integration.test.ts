import { after, before, describe, it, type SuiteContext } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import {
  __resetOrthancFetchForTests,
  __resetOrthancSettingsForTests,
  __setOrthancFetchForTests,
  __setOrthancSettingsForTests,
} from "./orthanc-study-verification-service.js";
import {
  __resetPacsStartWorklistSyncForTests,
  __setPacsStartWorklistSyncForTests,
  runAppointmentsV2PacsAutoCompletionTick,
  upsertPacsAutoCompletionSetting,
} from "./appointments-v2-pacs-auto-completion-worker.js";
import { updateBookingStatusManual } from "../modules/appointments-v2/booking/services/status-booking.service.js";
import {
  canReachDatabase,
  cleanupTestData,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
} from "../modules/appointments-v2/tests/integration/helpers.js";

const PREFIX = "PACS_ACTIVITY_";

describe("appointments-v2 PACS acquisition activity worker", () => {
  let testData: Awaited<ReturnType<typeof seedTestData>>;
  let modalityCode = "";
  let studyDateOverride: string | null = null;
  const bookingIds: number[] = [];
  let observation: { series: number | null; instances: number | null; lastUpdate: string | null } = {
    series: 1,
    instances: 10,
    lastUpdate: "20260911T090000",
  };

  before(async (t: SuiteContext) => {
    if (!isDatabaseAvailable() || !(await canReachDatabase())) {
      (t as unknown as { skip: () => void }).skip();
      return;
    }
    await setupTestDatabase(PREFIX);
    testData = await seedTestData("appointments_v2", PREFIX);
    __setOrthancSettingsForTests({
      enabled: true, shadowMode: false, connectionMode: "internal", baseUrl: "http://orthanc:8042",
      username: "", password: "", timeoutSeconds: 10, verifyTls: true,
      sendOnlyWhenPatientEntersQueue: false, worklistTarget: "", strategyPreference: "put_first", mwlCompatibility: {},
    });
    __setOrthancFetchForTests(async (path) => {
      if (path === "/tools/find") return response(["study-1"]);
      if (path === "/studies/study-1") return response({
        ID: "study-1",
        LastUpdate: observation.lastUpdate,
        MainDicomTags: { StudyInstanceUID: "1.2.3", StudyDate: studyDateOverride ?? new Date().toISOString().slice(0, 10).replace(/-/g, ""), Modality: modalityCode },
        PatientMainDicomTags: {},
        CountSeries: observation.series,
        CountInstances: observation.instances,
      });
      if (path === "/studies/study-1/statistics") return response({ CountSeries: observation.series, CountInstances: observation.instances });
      throw new Error(`Unexpected Orthanc path ${path}`);
    });
    modalityCode = String((await pool.query<{ code: string }>(`select code from modalities where id = $1`, [testData.modalityId])).rows[0]?.code || "");
    await pool.query(
      `insert into appointments_v2.pacs_auto_completion_settings (modality_id, enabled, orthanc_target_type, matching_strategy, completion_threshold, minimum_series_count, below_minimum_series_action, poll_interval_minutes, inactivity_completion_minutes, lookback_hours, stop_after_hours)
       values ($1, true, 'local', 'study_uid_preferred_accession_fallback', 'study_exists', 2, 'leave_unchanged', 1, 10, 24, 720)
       on conflict (modality_id) do update set enabled = true, completion_threshold = 'study_exists', minimum_series_count = 2, below_minimum_series_action = 'leave_unchanged', poll_interval_minutes = 1, inactivity_completion_minutes = 10, lookback_hours = 24, stop_after_hours = 720`,
      [testData.modalityId]
    );
  });

  after(async () => {
    __resetPacsStartWorklistSyncForTests();
    __resetOrthancFetchForTests();
    __resetOrthancSettingsForTests();
    await cleanupTestData(PREFIX);
  });

  async function createBooking(status = "scheduled"): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings (
        patient_id, modality_id, exam_type_id, reporting_priority_id, booking_date, booking_time,
        case_category, status, policy_version_id, capacity_resolution_mode, uses_special_quota, is_walk_in,
        created_by_user_id, updated_by_user_id
      ) values ($1, $2, $3, null, current_date, '09:00:00', 'non_oncology', $4, $5, 'standard', false, false, $6, $6)
      returning id`,
      [testData.patientId, testData.modalityId, testData.examTypeId, status, testData.policyVersionId, testData.userId]
    );
    const id = Number(result.rows[0]!.id);
    bookingIds.push(id);
    return id;
  }

  async function clearThrottle(bookingId: number): Promise<void> {
    await pool.query(`delete from appointments_v2.pacs_auto_completion_verification_history where booking_id = $1`, [bookingId]);
  }

  async function addMatchedMppsEvent(bookingId: number, performedStepStatus: "IN PROGRESS" | "COMPLETED" | "DISCONTINUED", receivedAt: string): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `
        insert into mpps_event_log (
          dedupe_key, event_type, source_ae_title, performed_step_status, payload_json,
          correlated_appointment_id, correlation_status, processing_status, received_at
        ) values ($1, 'n-create', 'PACS_ACTIVITY_TEST', $2, '{}'::jsonb, $3, 'matched', 'processed', $4::timestamptz)
        returning id
      `,
      [`${PREFIX}${bookingId}-${performedStepStatus}-${receivedAt}-${Math.random()}`, performedStepStatus, bookingId, receivedAt]
    );
    return Number(result.rows[0]?.id);
  }

  async function configureStandardAutoCompletion(): Promise<void> {
    await pool.query(
      `
        update appointments_v2.pacs_auto_completion_settings
        set enabled = true, completion_threshold = 'study_exists', minimum_series_count = 2,
          below_minimum_series_action = 'leave_unchanged', poll_interval_minutes = 1,
          inactivity_completion_minutes = 10, mpps_stale_fallback_minutes = 30,
          lookback_hours = 24, stop_after_hours = 720
        where modality_id = $1
      `,
      [testData.modalityId]
    );
  }

  it("keeps a committed PACS start when post-commit MWL scheduling throws", async () => {
    observation = { series: 1, instances: 10, lastUpdate: "20260911T085500" };
    const bookingId = await createBooking();
    let schedulingCalls = 0;
    __setPacsStartWorklistSyncForTests(() => {
      schedulingCalls += 1;
      throw new Error("forced MWL scheduling failure");
    });
    try {
      const tick = await runAppointmentsV2PacsAutoCompletionTick();
      const booking = await pool.query<{
        status: string;
        source: string | null;
        activity: Date | null;
        instances: number | null;
      }>(
        `select status, acquisition_status_source as source, pacs_last_activity_at as activity, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
        [bookingId]
      );
      assert.equal(tick.checked, 1);
      assert.equal(schedulingCalls, 1);
      assert.equal(booking.rows[0]?.status, "in-progress");
      assert.equal(booking.rows[0]?.source, "pacs");
      assert.ok(booking.rows[0]?.activity);
      assert.equal(booking.rows[0]?.instances, 10);
    } finally {
      __resetPacsStartWorklistSyncForTests();
    }
  });

  it("requires PACS activity newer than reopen-for-scanning before starting a fresh attempt", async () => {
    await configureStandardAutoCompletion();
    const bookingId = await createBooking("waiting");
    await pool.query(`update appointments_v2.bookings set reopened_for_scanning_at = '2026-09-11T08:59:30Z'::timestamptz where id = $1`, [bookingId]);
    observation = { series: 1, instances: 10, lastUpdate: "20260911T085900" };

    await runAppointmentsV2PacsAutoCompletionTick();
    const oldStudy = await pool.query<{ status: string; reopened_for_scanning_at: Date | null }>(
      `select status, reopened_for_scanning_at from appointments_v2.bookings where id = $1`, [bookingId]
    );
    assert.equal(oldStudy.rows[0]?.status, "waiting");
    assert.ok(oldStudy.rows[0]?.reopened_for_scanning_at);

    await clearThrottle(bookingId);
    observation = { series: 1, instances: 11, lastUpdate: "20260911T090000" };
    await runAppointmentsV2PacsAutoCompletionTick();
    const freshStudy = await pool.query<{ status: string; source: string | null; reopened_for_scanning_at: Date | null }>(
      `select status, acquisition_status_source as source, reopened_for_scanning_at from appointments_v2.bookings where id = $1`, [bookingId]
    );
    assert.equal(freshStudy.rows[0]?.status, "in-progress");
    assert.equal(freshStudy.rows[0]?.source, "pacs");
    assert.equal(freshStudy.rows[0]?.reopened_for_scanning_at, null);
  });

  it("uses a date-safe start lookback, keeps old PACS acquisitions monitored, and records a first-seen fallback", async () => {
    await configureStandardAutoCompletion();
    observation = { series: 1, instances: 10, lastUpdate: "20260911T085400" };
    const boundaryId = await createBooking();
    await pool.query(`update appointments_v2.bookings set booking_date = (now() - interval '24 hours')::date where id = $1`, [boundaryId]);
    studyDateOverride = String((await pool.query<{ date: string }>(`select (now() - interval '24 hours')::date::text as date`)).rows[0]?.date || "").replace(/-/g, "");
    await runAppointmentsV2PacsAutoCompletionTick();
    const boundary = await pool.query<{ status: string; first_seen: Date | null }>(
      `select status, pacs_first_seen_at as first_seen from appointments_v2.bookings where id = $1`, [boundaryId]
    );
    assert.equal(boundary.rows[0]?.status, "in-progress");
    assert.ok(boundary.rows[0]?.first_seen);
    studyDateOverride = null;

    const oldPacsId = await createBooking("in-progress");
    await pool.query(
      `
        update appointments_v2.bookings
        set booking_date = current_date - 10, acquisition_status_source = 'pacs',
          pacs_first_seen_at = now(), pacs_last_activity_at = now(),
          pacs_last_observed_instance_count = 10, pacs_last_observed_series_count = 1,
          pacs_last_observed_orthanc_update_at = '2026-09-11T08:54:00Z'
        where id = $1
      `,
      [oldPacsId]
    );
    await clearThrottle(oldPacsId);
    await runAppointmentsV2PacsAutoCompletionTick();
    const oldPacs = await pool.query<{ status: string; checks: string }>(
      `select b.status, count(h.id)::text as checks from appointments_v2.bookings b left join appointments_v2.pacs_auto_completion_verification_history h on h.booking_id = b.id where b.id = $1 group by b.id`,
      [oldPacsId]
    );
    assert.equal(oldPacs.rows[0]?.status, "in-progress");
    assert.equal(oldPacs.rows[0]?.checks, "1");
  });

  it("times out PACS tracking once without terminally changing the booking", async () => {
    await configureStandardAutoCompletion();
    await pool.query(`update appointments_v2.pacs_auto_completion_settings set stop_after_hours = 72 where modality_id = $1`, [testData.modalityId]);
    const bookingId = await createBooking("in-progress");
    await pool.query(
      `update appointments_v2.bookings set acquisition_status_source = 'pacs', pacs_first_seen_at = now() - interval '73 hours' where id = $1`,
      [bookingId]
    );
    await runAppointmentsV2PacsAutoCompletionTick();
    const timedOut = await pool.query<{ status: string; disabled_at: Date | null; reason: string | null; audits: string }>(
      `
        select b.status, b.pacs_auto_completion_disabled_at as disabled_at, b.pacs_auto_completion_disabled_reason as reason,
          (select count(*)::text from audit_log where entity_type = 'appointment_v2_booking' and entity_id = b.id and action_type = 'orthanc_auto_completion_tracking_timeout') as audits
        from appointments_v2.bookings b where b.id = $1
      `,
      [bookingId]
    );
    assert.equal(timedOut.rows[0]?.status, "in-progress");
    assert.ok(timedOut.rows[0]?.disabled_at);
    assert.match(timedOut.rows[0]?.reason || "", /tracking exceeded/);
    assert.equal(timedOut.rows[0]?.audits, "1");
    await runAppointmentsV2PacsAutoCompletionTick();
    const auditCount = await pool.query<{ count: string }>(`select count(*)::text as count from audit_log where entity_type = 'appointment_v2_booking' and entity_id = $1 and action_type = 'orthanc_auto_completion_tracking_timeout'`, [bookingId]);
    assert.equal(auditCount.rows[0]?.count, "1");
  });

  it("rescues only stale MPPS IN PROGRESS through a fresh PACS inactivity baseline", async () => {
    await configureStandardAutoCompletion();
    observation = { series: 1, instances: 10, lastUpdate: "20260911T085700" };
    const bookingId = await createBooking("in-progress");
    await pool.query(
      `update appointments_v2.bookings set acquisition_status_source = 'mpps', pacs_auto_completion_disabled_at = now(), pacs_auto_completion_disabled_by_user_id = null where id = $1`,
      [bookingId]
    );
    const latestEventId = await addMatchedMppsEvent(bookingId, "IN PROGRESS", new Date(Date.now() - 31 * 60_000).toISOString());
    await runAppointmentsV2PacsAutoCompletionTick();
    const initialized = await pool.query<{ status: string; source: string | null; activity: Date | null }>(
      `select status, acquisition_status_source as source, pacs_last_activity_at as activity from appointments_v2.bookings where id = $1`, [bookingId]
    );
    assert.equal(initialized.rows[0]?.status, "in-progress");
    assert.equal(initialized.rows[0]?.source, "mpps");
    assert.ok(initialized.rows[0]?.activity);

    await clearThrottle(bookingId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = now() - interval '11 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    const completed = await pool.query<{ status: string; source: string | null; auto_completed_by: string | null }>(
      `select status, acquisition_status_source as source, auto_completed_by from appointments_v2.bookings where id = $1`, [bookingId]
    );
    assert.deepEqual(completed.rows[0], { status: "completed", source: "pacs", auto_completed_by: "orthanc_pacs_auto_completion" });
    const fallbackAudit = await pool.query<{ count: string }>(
      `select count(*)::text as count from audit_log where entity_type = 'appointment_v2_booking' and entity_id = $1 and new_values->>'pacsFallbackReason' = 'stale_mpps'`,
      [bookingId]
    );
    assert.equal(fallbackAudit.rows[0]?.count, "1");
    const completedHistory = await pool.query<{ completed_booking: boolean }>(`select completed_booking from appointments_v2.pacs_auto_completion_verification_history where booking_id = $1 order by id desc limit 1`, [bookingId]);
    assert.equal(completedHistory.rows[0]?.completed_booking, true);
    assert.ok(latestEventId > 0);
  });

  it("keeps healthy, terminal, newer, and manually disabled MPPS cases out of PACS rescue", async () => {
    await configureStandardAutoCompletion();
    const cases: Array<{ status: "IN PROGRESS" | "COMPLETED" | "DISCONTINUED"; receivedAt: string; manual: boolean }> = [
      { status: "IN PROGRESS", receivedAt: new Date().toISOString(), manual: false },
      { status: "COMPLETED", receivedAt: new Date(Date.now() - 31 * 60_000).toISOString(), manual: false },
      { status: "DISCONTINUED", receivedAt: new Date(Date.now() - 31 * 60_000).toISOString(), manual: false },
      { status: "IN PROGRESS", receivedAt: new Date(Date.now() - 31 * 60_000).toISOString(), manual: true },
    ];
    const ids: number[] = [];
    for (const item of cases) {
      const id = await createBooking("in-progress");
      ids.push(id);
      await pool.query(
        `update appointments_v2.bookings set acquisition_status_source = 'mpps', pacs_auto_completion_disabled_at = now(), pacs_auto_completion_disabled_by_user_id = $2 where id = $1`,
        [id, item.manual ? testData.userId : null]
      );
      await addMatchedMppsEvent(id, item.status, item.receivedAt);
    }
    await runAppointmentsV2PacsAutoCompletionTick();
    const protectedRows = await pool.query<{ id: number; status: string; source: string | null; checks: string }>(
      `select b.id, b.status, b.acquisition_status_source as source, count(h.id)::text as checks from appointments_v2.bookings b left join appointments_v2.pacs_auto_completion_verification_history h on h.booking_id = b.id where b.id = any($1::bigint[]) group by b.id order by b.id`,
      [ids]
    );
    assert.equal(protectedRows.rows.length, 4);
    for (const row of protectedRows.rows) {
      assert.equal(row.status, "in-progress");
      assert.equal(row.source, "mpps");
      assert.equal(row.checks, "0");
    }
  });

  it("starts, tracks activity, waits for inactivity, and uses the canonical completed state", async () => {
    observation = { series: 1, instances: 10, lastUpdate: "20260911T090000" };
    const bookingId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    const startedBooking = await pool.query<{ status: string; source: string | null; completed_at: Date | null; auto_completed_by: string | null; activity: Date | null }>(
      `select status, acquisition_status_source as source, completed_at, auto_completed_by, pacs_last_activity_at as activity from appointments_v2.bookings where id = $1`, [bookingId]
    );
    assert.deepEqual(startedBooking.rows[0] && { status: startedBooking.rows[0].status, source: startedBooking.rows[0].source, completed_at: startedBooking.rows[0].completed_at, auto_completed_by: startedBooking.rows[0].auto_completed_by }, { status: "in-progress", source: "pacs", completed_at: null, auto_completed_by: null });
    const firstActivity = startedBooking.rows[0]!.activity!.getTime();

    await clearThrottle(bookingId);
    observation = { series: 1, instances: 15, lastUpdate: "20260911T090100" };
    await runAppointmentsV2PacsAutoCompletionTick();
    const trackedBooking = await pool.query<{ status: string; activity: Date | null }>(`select status, pacs_last_activity_at as activity from appointments_v2.bookings where id = $1`, [bookingId]);
    assert.equal(trackedBooking.rows[0]?.status, "in-progress");
    assert.ok(trackedBooking.rows[0]?.activity && trackedBooking.rows[0].activity.getTime() >= firstActivity);

    await clearThrottle(bookingId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '9 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [bookingId])).rows[0]?.status, "in-progress");

    await clearThrottle(bookingId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '11 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    const completedBooking = await pool.query<{ status: string; completed_at: Date | null; auto_completed_by: string | null }>(`select status, completed_at, auto_completed_by from appointments_v2.bookings where id = $1`, [bookingId]);
    assert.equal(completedBooking.rows[0]?.status, "completed");
    assert.ok(completedBooking.rows[0]?.completed_at);
    assert.equal(completedBooking.rows[0]?.auto_completed_by, "orthanc_pacs_auto_completion");
    const completedHistory = await pool.query<{ completed_booking: boolean }>(
      `select completed_booking from appointments_v2.pacs_auto_completion_verification_history where booking_id = $1 order by id desc limit 1`,
      [bookingId]
    );
    assert.equal(completedHistory.rows[0]?.completed_booking, true);
  });

  it("activity, missing measurements, below-minimum studies, and MPPS ownership cannot be incorrectly completed", async () => {
    observation = { series: 0, instances: 0, lastUpdate: "20260911T085000" };
    const scheduledZeroId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [scheduledZeroId])).rows[0]?.status, "scheduled");

    observation = { series: 0, instances: null, lastUpdate: "20260911T085001" };
    const scheduledZeroOrUnknownId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [scheduledZeroOrUnknownId])).rows[0]?.status, "scheduled");

    observation = { series: null, instances: null, lastUpdate: null };
    const scheduledUnknownId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [scheduledUnknownId])).rows[0]?.status, "scheduled");

    observation = { series: 0, instances: 0, lastUpdate: "20260911T085000" };
    const zeroTrackingId = await createBooking("in-progress");
    await pool.query(
      `update appointments_v2.bookings set acquisition_status_source = 'pacs', pacs_last_activity_at = current_timestamp - interval '11 minutes', pacs_last_observed_instance_count = 10, pacs_last_observed_series_count = 1, pacs_last_observed_orthanc_update_at = '2026-09-11T08:00:00Z' where id = $1`,
      [zeroTrackingId]
    );
    await runAppointmentsV2PacsAutoCompletionTick();
    const zeroChanged = await pool.query<{ status: string; activity: Date | null; instances: number | null }>(
      `select status, pacs_last_activity_at as activity, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
      [zeroTrackingId]
    );
    assert.equal(zeroChanged.rows[0]?.status, "in-progress");
    assert.equal(zeroChanged.rows[0]?.instances, 0);
    const zeroActivity = zeroChanged.rows[0]?.activity?.getTime();

    await clearThrottle(zeroTrackingId);
    await runAppointmentsV2PacsAutoCompletionTick();
    const zeroUnchanged = await pool.query<{ status: string; activity: Date | null }>(
      `select status, pacs_last_activity_at as activity from appointments_v2.bookings where id = $1`,
      [zeroTrackingId]
    );
    assert.equal(zeroUnchanged.rows[0]?.status, "in-progress");
    assert.equal(zeroUnchanged.rows[0]?.activity?.getTime(), zeroActivity);

    await clearThrottle(zeroTrackingId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '11 minutes' where id = $1`, [zeroTrackingId]);
    observation = { series: 1, instances: 5, lastUpdate: "20260911T085100" };
    await runAppointmentsV2PacsAutoCompletionTick();
    const zeroIncreased = await pool.query<{ status: string; activity: Date | null; instances: number | null }>(
      `select status, pacs_last_activity_at as activity, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
      [zeroTrackingId]
    );
    assert.equal(zeroIncreased.rows[0]?.status, "in-progress");
    assert.equal(zeroIncreased.rows[0]?.instances, 5);
    assert.ok((zeroIncreased.rows[0]?.activity?.getTime() || 0) > (zeroActivity || 0));

    observation = { series: 1, instances: 15, lastUpdate: "20260911T091000" };
    const changedId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'pacs', pacs_last_activity_at = now() - interval '11 minutes', pacs_last_observed_instance_count = 10, pacs_last_observed_series_count = 1, pacs_last_observed_orthanc_update_at = '2026-09-11T09:00:00Z' where id = $1`, [changedId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [changedId])).rows[0]?.status, "in-progress");

    const noEvidenceId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'pacs', pacs_last_activity_at = now() - interval '11 minutes' where id = $1`, [noEvidenceId]);
    await clearThrottle(changedId);
    observation = { series: null, instances: null, lastUpdate: null };
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [noEvidenceId])).rows[0]?.status, "in-progress");

    await pool.query(`update appointments_v2.pacs_auto_completion_settings set completion_threshold = 'series_exists', minimum_series_count = 2, below_minimum_series_action = 'discontinue' where modality_id = $1`, [testData.modalityId]);
    observation = { series: 1, instances: 1, lastUpdate: "20260911T092000" };
    const belowMinimumId = await createBooking();
    await clearThrottle(noEvidenceId);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [belowMinimumId])).rows[0]?.status, "in-progress");
    await clearThrottle(belowMinimumId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = now() - interval '11 minutes' where id = $1`, [belowMinimumId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [belowMinimumId])).rows[0]?.status, "discontinued");
    const discontinuedHistory = await pool.query<{ completed_booking: boolean }>(
      `select completed_booking from appointments_v2.pacs_auto_completion_verification_history where booking_id = $1 order by id desc limit 1`,
      [belowMinimumId]
    );
    assert.equal(discontinuedHistory.rows[0]?.completed_booking, false);

    const mppsOwnedId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'mpps' where id = $1`, [mppsOwnedId]);
    await clearThrottle(changedId);
    await clearThrottle(noEvidenceId);
    await runAppointmentsV2PacsAutoCompletionTick();
    const mppsOwned = await pool.query<{ status: string; source: string | null }>(`select status, acquisition_status_source as source from appointments_v2.bookings where id = $1`, [mppsOwnedId]);
    assert.equal(mppsOwned.rows[0]?.status, "in-progress");
    assert.equal(mppsOwned.rows[0]?.source, "mpps");

    const manuallyOverriddenId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'pacs' where id = $1`, [manuallyOverriddenId]);
    await updateBookingStatusManual(manuallyOverriddenId, "waiting", null, testData.userId, "supervisor");
    await runAppointmentsV2PacsAutoCompletionTick();
    const manuallyOverridden = await pool.query<{ status: string; disabled_at: Date | null; disabled_by: number | null }>(
      `select status, pacs_auto_completion_disabled_at as disabled_at, pacs_auto_completion_disabled_by_user_id as disabled_by from appointments_v2.bookings where id = $1`,
      [manuallyOverriddenId]
    );
    assert.equal(manuallyOverridden.rows[0]?.status, "waiting");
    assert.ok(manuallyOverridden.rows[0]?.disabled_at);
    assert.equal(Number(manuallyOverridden.rows[0]?.disabled_by), Number(testData.userId));
  });

  it("uses each modality's configured inactivity timeout instead of a fixed operational timeout", async () => {
    await pool.query(
      `update appointments_v2.pacs_auto_completion_settings
       set completion_threshold = 'study_exists', minimum_series_count = 2,
           below_minimum_series_action = 'leave_unchanged', poll_interval_minutes = 1,
           inactivity_completion_minutes = 20
       where modality_id = $1`,
      [testData.modalityId]
    );
    observation = { series: 1, instances: 10, lastUpdate: "20260911T093000" };
    const bookingId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();

    await clearThrottle(bookingId);
    await pool.query(
      `update appointments_v2.bookings
       set pacs_last_activity_at = current_timestamp - interval '11 minutes'
       where id = $1`,
      [bookingId]
    );
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [bookingId])).rows[0]?.status, "in-progress");

    await clearThrottle(bookingId);
    await pool.query(
      `update appointments_v2.bookings
       set pacs_last_activity_at = current_timestamp - interval '21 minutes'
       where id = $1`,
      [bookingId]
    );
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [bookingId])).rows[0]?.status, "completed");
  });

  it("validates PACS poll and inactivity settings while retaining stale-client compatibility", async () => {
    const save = (payload: Record<string, unknown>) => upsertPacsAutoCompletionSetting(
      testData.modalityId,
      payload,
      testData.userId as never
    );

    const valid = await save({ pollIntervalMinutes: 2, inactivityCompletionMinutes: 10 });
    assert.equal(valid.poll_interval_minutes, 2);
    assert.equal(valid.inactivity_completion_minutes, 10);
    assert.equal(valid.mpps_stale_fallback_minutes, 180);

    const validFallback = await save({ inactivityCompletionMinutes: 10, mppsStaleFallbackMinutes: 30 });
    assert.equal(validFallback.mpps_stale_fallback_minutes, 30);
    await assert.rejects(
      () => save({ inactivityCompletionMinutes: 10, mppsStaleFallbackMinutes: 29 }),
      { name: "HttpError", statusCode: 400, message: "mppsStaleFallbackMinutes must be at least 30." }
    );
    await assert.rejects(
      () => save({ inactivityCompletionMinutes: 30, mppsStaleFallbackMinutes: 30 }),
      { name: "HttpError", statusCode: 400, message: "mppsStaleFallbackMinutes must be greater than inactivityCompletionMinutes." }
    );

    await assert.rejects(
      () => save({ pollIntervalMinutes: 10, inactivityCompletionMinutes: 10 }),
      { name: "HttpError", statusCode: 400, message: "pollIntervalMinutes must be less than inactivityCompletionMinutes." }
    );
    await assert.rejects(
      () => save({ pollIntervalMinutes: 15, inactivityCompletionMinutes: 10 }),
      { name: "HttpError", statusCode: 400, message: "pollIntervalMinutes must be less than inactivityCompletionMinutes." }
    );

    const boundary = await save({ pollIntervalMinutes: 9, inactivityCompletionMinutes: 10 });
    assert.equal(boundary.poll_interval_minutes, 9);
    assert.equal(boundary.inactivity_completion_minutes, 10);

    const staleClient = await save({ pollIntervalMinutes: 15 });
    assert.equal(staleClient.poll_interval_minutes, 15);
    assert.equal(staleClient.inactivity_completion_minutes, 16);
  });

  it("uses remote SERIES C-FIND activity for PACS-owned inactivity completion without overriding MPPS", async () => {
    const remoteObservation = { series: 5, instances: 300, includeInstanceCounts: true, failSeriesQuery: false };
    __setOrthancFetchForTests(async (path, options) => {
      if (path === "/modalities/REMOTE/query") {
        const level = (options?.body as { Level?: string } | undefined)?.Level;
        if (level === "Study") return response({ ID: "remote-study-query" });
        if (level === "Series") {
          return remoteObservation.failSeriesQuery
            ? { status: 503, ok: false, text: "temporary remote failure", json: null }
            : response({ ID: "remote-series-query" });
        }
      }
      if (path === "/queries/remote-study-query/answers") return response(["0"]);
      if (path === "/queries/remote-study-query/answers/0/content") return response({
        StudyInstanceUID: "1.2.840.remote-study",
        AccessionNumber: "V2-REMOTE",
        StudyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        Modality: modalityCode,
      });
      if (path === "/queries/remote-series-query/answers") {
        return response(Array.from({ length: remoteObservation.series }, (_, index) => String(index)));
      }
      const seriesAnswer = path.match(/^\/queries\/remote-series-query\/answers\/(\d+)\/content$/);
      if (seriesAnswer) {
        const index = Number(seriesAnswer[1]);
        const base = Math.floor(remoteObservation.instances / remoteObservation.series);
        const remainder = remoteObservation.instances % remoteObservation.series;
        return response({
          SeriesInstanceUID: `1.2.840.remote-study.${index + 1}`,
          ...(remoteObservation.includeInstanceCounts
            ? { NumberOfSeriesRelatedInstances: String(base + (index < remainder ? 1 : 0)) }
            : {}),
        });
      }
      throw new Error(`Unexpected Orthanc path ${path}`);
    });
    await pool.query(
      `update appointments_v2.pacs_auto_completion_settings
       set enabled = true, orthanc_target_type = 'remote_modality', orthanc_target_key = 'REMOTE',
           completion_threshold = 'study_exists', minimum_series_count = 2,
           below_minimum_series_action = 'leave_unchanged', poll_interval_minutes = 1,
           inactivity_completion_minutes = 10
       where modality_id = $1`,
      [testData.modalityId]
    );

    const bookingId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    const started = await pool.query<{ status: string; source: string | null; activity: Date | null; series: number | null; instances: number | null }>(
      `select status, acquisition_status_source as source, pacs_last_activity_at as activity, pacs_last_observed_series_count as series, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    assert.deepEqual(started.rows[0] && {
      status: started.rows[0].status,
      source: started.rows[0].source,
      series: started.rows[0].series,
      instances: started.rows[0].instances,
    }, { status: "in-progress", source: "pacs", series: 5, instances: 300 });

    await clearThrottle(bookingId);
    remoteObservation.series = 7;
    remoteObservation.instances = 420;
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '11 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    const changed = await pool.query<{ status: string; activity: Date | null; series: number | null; instances: number | null }>(
      `select status, pacs_last_activity_at as activity, pacs_last_observed_series_count as series, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    assert.deepEqual(changed.rows[0] && {
      status: changed.rows[0].status,
      series: changed.rows[0].series,
      instances: changed.rows[0].instances,
    }, { status: "in-progress", series: 7, instances: 420 });
    assert.ok((changed.rows[0]?.activity?.getTime() || 0) > (started.rows[0]?.activity?.getTime() || 0));

    await clearThrottle(bookingId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '9 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [bookingId])).rows[0]?.status, "in-progress");

    await clearThrottle(bookingId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '11 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [bookingId])).rows[0]?.status, "completed");

    remoteObservation.series = 5;
    remoteObservation.includeInstanceCounts = false;
    const seriesOnlyId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    const seriesOnlyStarted = await pool.query<{ status: string; source: string | null; activity: Date | null; series: number | null; instances: number | null }>(
      `select status, acquisition_status_source as source, pacs_last_activity_at as activity, pacs_last_observed_series_count as series, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
      [seriesOnlyId]
    );
    assert.deepEqual(seriesOnlyStarted.rows[0] && {
      status: seriesOnlyStarted.rows[0].status,
      source: seriesOnlyStarted.rows[0].source,
      series: seriesOnlyStarted.rows[0].series,
      instances: seriesOnlyStarted.rows[0].instances,
    }, { status: "in-progress", source: "pacs", series: 5, instances: null });
    await clearThrottle(seriesOnlyId);
    remoteObservation.series = 7;
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '11 minutes' where id = $1`, [seriesOnlyId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    const seriesOnlyChanged = await pool.query<{ status: string; activity: Date | null; series: number | null; instances: number | null }>(
      `select status, pacs_last_activity_at as activity, pacs_last_observed_series_count as series, pacs_last_observed_instance_count as instances from appointments_v2.bookings where id = $1`,
      [seriesOnlyId]
    );
    assert.deepEqual(seriesOnlyChanged.rows[0] && {
      status: seriesOnlyChanged.rows[0].status,
      series: seriesOnlyChanged.rows[0].series,
      instances: seriesOnlyChanged.rows[0].instances,
    }, { status: "in-progress", series: 7, instances: null });
    assert.ok((seriesOnlyChanged.rows[0]?.activity?.getTime() || 0) > (seriesOnlyStarted.rows[0]?.activity?.getTime() || 0));

    await clearThrottle(seriesOnlyId);
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = current_timestamp - interval '11 minutes' where id = $1`, [seriesOnlyId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [seriesOnlyId])).rows[0]?.status, "completed");

    remoteObservation.failSeriesQuery = true;
    const failedUnstartedId = await createBooking();
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [failedUnstartedId])).rows[0]?.status, "scheduled");

    const failedEnrichmentId = await createBooking("in-progress");
    await pool.query(
      `update appointments_v2.bookings
       set acquisition_status_source = 'pacs', pacs_last_activity_at = current_timestamp - interval '11 minutes',
           pacs_last_observed_series_count = 7, pacs_last_observed_instance_count = 420
       where id = $1`,
      [failedEnrichmentId]
    );
    await runAppointmentsV2PacsAutoCompletionTick();
    assert.equal((await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [failedEnrichmentId])).rows[0]?.status, "in-progress");
    const failureHistory = await pool.query<{ result_json: { remoteSeriesQuerySucceeded?: boolean } }>(
      `select result_json from appointments_v2.pacs_auto_completion_verification_history where booking_id = $1 order by id desc limit 1`,
      [failedEnrichmentId]
    );
    assert.equal(failureHistory.rows[0]?.result_json.remoteSeriesQuerySucceeded, false);

    const mppsOwnedId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'mpps' where id = $1`, [mppsOwnedId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    const mppsOwned = await pool.query<{ status: string; source: string | null }>(
      `select status, acquisition_status_source as source from appointments_v2.bookings where id = $1`, [mppsOwnedId]
    );
    assert.deepEqual(mppsOwned.rows[0], { status: "in-progress", source: "mpps" });
  });
});

function response(json: unknown) {
  return { status: 200, ok: true, text: JSON.stringify(json), json };
}
