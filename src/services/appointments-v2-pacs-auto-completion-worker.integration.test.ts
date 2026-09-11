import { after, before, describe, it, type SuiteContext } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import {
  __resetOrthancFetchForTests,
  __resetOrthancSettingsForTests,
  __setOrthancFetchForTests,
  __setOrthancSettingsForTests,
} from "./orthanc-study-verification-service.js";
import { runAppointmentsV2PacsAutoCompletionTick } from "./appointments-v2-pacs-auto-completion-worker.js";
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
        MainDicomTags: { StudyInstanceUID: "1.2.3", StudyDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""), Modality: modalityCode },
        PatientMainDicomTags: {},
        CountSeries: observation.series,
        CountInstances: observation.instances,
      });
      if (path === "/studies/study-1/statistics") return response({ CountSeries: observation.series, CountInstances: observation.instances });
      throw new Error(`Unexpected Orthanc path ${path}`);
    });
    modalityCode = String((await pool.query<{ code: string }>(`select code from modalities where id = $1`, [testData.modalityId])).rows[0]?.code || "");
    await pool.query(
      `insert into appointments_v2.pacs_auto_completion_settings (modality_id, enabled, orthanc_target_type, matching_strategy, completion_threshold, minimum_series_count, below_minimum_series_action, poll_interval_minutes, lookback_hours, stop_after_hours)
       values ($1, true, 'local', 'study_uid_preferred_accession_fallback', 'study_exists', 2, 'leave_unchanged', 1, 24, 72)
       on conflict (modality_id) do update set enabled = true, completion_threshold = 'study_exists', minimum_series_count = 2, below_minimum_series_action = 'leave_unchanged', poll_interval_minutes = 1, lookback_hours = 24, stop_after_hours = 72`,
      [testData.modalityId]
    );
  });

  after(async () => {
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
    await pool.query(`update appointments_v2.bookings set pacs_last_activity_at = now() - interval '11 minutes' where id = $1`, [bookingId]);
    await runAppointmentsV2PacsAutoCompletionTick();
    const completedBooking = await pool.query<{ status: string; completed_at: Date | null; auto_completed_by: string | null }>(`select status, completed_at, auto_completed_by from appointments_v2.bookings where id = $1`, [bookingId]);
    assert.equal(completedBooking.rows[0]?.status, "completed");
    assert.ok(completedBooking.rows[0]?.completed_at);
    assert.equal(completedBooking.rows[0]?.auto_completed_by, "orthanc_pacs_auto_completion");
  });

  it("activity, missing measurements, below-minimum studies, and MPPS ownership cannot be incorrectly completed", async () => {
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
});

function response(json: unknown) {
  return { status: 200, ok: true, text: JSON.stringify(json), json };
}
