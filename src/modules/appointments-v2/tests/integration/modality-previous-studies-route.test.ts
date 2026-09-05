import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { randomUUID } from "node:crypto";
import { pool } from "../../../../db/pool.js";
import {
  canReachDatabase,
  createTestApp,
  createTestAuthCookie,
  fetchJson,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
} from "./helpers.js";

const TEST_PREFIX = "MODALITY_PREVIOUS_STUDIES_";
const candidateUid = "1.2.840.113619.2.55.3.604688433.1";
const otherPatientUid = "1.2.840.113619.2.55.3.604688433.2";
let failCandidateDiscovery = false;
let manualPatientIdLookupCandidates: unknown[] = [];
const reconciliationRequests = mock.fn();

mock.module("../../../../services/historical-pacs-index-service.js", {
  namedExports: {
    discoverHistoricalPacsCandidatesForPatient: async (patientId: number) => {
      if (failCandidateDiscovery) throw new Error("historical candidate lookup failed");
      return {
        candidates: [{
          historicalPatientId: `HIST-${patientId}`,
          patientName: "Historical Patient",
          patientBirthDate: "19801231",
          patientSex: "F",
          classification: "strong_demographic",
          reasons: ["exact_normalized_name"],
          authoritative: false,
          matchRank: 1,
          nameSimilarity: 1,
          phoneticMatchCount: 0,
          studyCount: 1,
          studies: [{
            orthancStudyId: `orthanc-${patientId}`,
            studyInstanceUid: patientId === otherPatientId ? otherPatientUid : candidateUid,
            accessionNumber: null,
            patientId: null,
            patientName: null,
            patientBirthDate: null,
            patientSex: null,
            studyDate: "20240102",
            studyDescription: "Historical CT",
            modalitiesInStudy: ["CT"],
            seriesCount: 2,
            instanceCount: 10,
          }],
        }],
        indexStatus: "ready",
        lastSuccessAt: "2026-08-20T00:00:00.000Z",
      };
    },
    getHistoricalPacsReconciliationForPatient: async () => [],
    lookupHistoricalPacsByPatientId: async () => manualPatientIdLookupCandidates,
  },
});

mock.module("../../../../services/patient-identity-reconciliation-service.js", {
  namedExports: {
    getPatientIdentityReconciliationForStudies: async () => [],
    requestPatientIdentityReconciliation: reconciliationRequests,
  },
});

let otherPatientId = 0;

async function createBooking(patientId: number, modalityId: number, policyVersionId: number, userId: number): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings
       (patient_id, modality_id, booking_date, booking_time, case_category, status, policy_version_id, created_by_user_id, updated_by_user_id)
     values ($1, $2, current_date, '09:00', 'non_oncology', 'waiting', $3, $4, $4)
     returning id`,
    [patientId, modalityId, policyVersionId, userId],
  );
  return result.rows[0]!.id;
}

if (!isDatabaseAvailable()) {
  describe("Modality Previous Studies routes", { skip: "DATABASE_URL not set" }, () => {});
} else {
  describe("Modality Previous Studies routes", () => {
    it("enforces route validation, access, server-derived attestation identity, membership, audit, and safe candidate failure", async () => {
      if (!await canReachDatabase()) return;

      const testDb = await setupTestDatabase(TEST_PREFIX);
      let app: Awaited<ReturnType<typeof createTestApp>> | null = null;
      try {
        const testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
        const runId = randomUUID().replace(/-/g, "").slice(0, 10);
        const otherPatient = await pool.query<{ id: number }>(
          `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
           values ($1, $2, $3, $4, 'F', 40, '0912345678', 'national_id', $5) returning id`,
          [`${TEST_PREFIX}${runId} Other`, `${TEST_PREFIX}${runId} Other Patient`, `2${runId.slice(0, 11).padEnd(11, "0")}`, `${TEST_PREFIX}${runId} Other`, `2${runId.slice(0, 11).padEnd(11, "0")}`],
        );
        otherPatientId = Number(otherPatient.rows[0]!.id);

        const genericBookingId = await createBooking(testData.patientId, testData.modalityId, testData.policyVersionId, testData.userId);
        const ctModality = await pool.query<{ id: number }>("select id from modalities where code = 'CT' limit 1");
        assert.ok(ctModality.rows[0], "The disposable DB must include the baseline CT modality");
        const attestationBookingId = await createBooking(testData.patientId, ctModality.rows[0]!.id, testData.policyVersionId, testData.userId);
        const otherBookingId = await createBooking(otherPatientId, ctModality.rows[0]!.id, testData.policyVersionId, testData.userId);
        void otherBookingId;

        app = await createTestApp();
        const permittedCookie = createTestAuthCookie(testData.userId, "supervisor");
        const getPath = (id: string | number) => `/api/v2/read/modality/appointments/${id}/previous-studies`;
        const historyPath = (id: string | number) => `${getPath(id)}/history`;
        const historicalCandidatesPath = (id: string | number) => `${getPath(id)}/historical-candidates`;
        const oldPatientIdPath = (id: string | number) => `${getPath(id)}/old-patient-id`;
        const sonicPath = (id: string | number, query: string) => `${getPath(id)}/open-sonicdicom${query}`;
        const postPath = (id: string | number) => `${getPath(id)}/attestations`;

        for (const invalidId of [0, -1, "not-a-number"]) {
          const response: { status: number } = await fetchJson<unknown>(app.baseUrl, getPath(invalidId), { cookie: permittedCookie });
          assert.equal(response.status, 400);
          assert.equal((await fetchJson<unknown>(app.baseUrl, historyPath(invalidId), { cookie: permittedCookie })).status, 400);
          assert.equal((await fetchJson<unknown>(app.baseUrl, historicalCandidatesPath(invalidId), { cookie: permittedCookie })).status, 400);
        }
        assert.equal((await fetchJson(app.baseUrl, postPath(0), { method: "POST", cookie: permittedCookie, body: {} })).status, 400);
        for (const status of ["approved", "yes", "", null]) {
          const response: { status: number } = await fetchJson<unknown>(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid: candidateUid, status } });
          assert.equal(response.status, 400);
        }
        for (const studyInstanceUid of ["", "   "]) {
          const response: { status: number } = await fetchJson<unknown>(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid, status: "confirmed" } });
          assert.equal(response.status, 400);
        }

        assert.equal((await fetchJson(app.baseUrl, getPath(genericBookingId))).status, 401);
        assert.equal((await fetchJson(app.baseUrl, getPath(genericBookingId), { cookie: createTestAuthCookie(testData.userId, "doctor") })).status, 403);
        assert.equal((await fetchJson(app.baseUrl, historyPath(genericBookingId))).status, 401);
        assert.equal((await fetchJson(app.baseUrl, historicalCandidatesPath(genericBookingId))).status, 401);
        assert.equal((await fetchJson(app.baseUrl, historyPath(genericBookingId), { cookie: createTestAuthCookie(testData.userId, "doctor") })).status, 403);
        assert.equal((await fetchJson(app.baseUrl, historicalCandidatesPath(genericBookingId), { cookie: createTestAuthCookie(testData.userId, "doctor") })).status, 403);

        const genericResponse = await fetchJson<Record<string, unknown>>(app.baseUrl, getPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(genericResponse.status, 200, "A non-CT/MRI Modality booking must resolve through getModalityAppointmentContext");
        assert.ok(Array.isArray((genericResponse.data.history as Record<string, unknown>).items));
        const focusedHistory = await fetchJson<Record<string, unknown>>(app.baseUrl, historyPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(focusedHistory.status, 200);
        assert.ok(Array.isArray(focusedHistory.data.items));
        const focusedCandidates = await fetchJson<Record<string, unknown>>(app.baseUrl, historicalCandidatesPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(focusedCandidates.status, 200);
        assert.ok(Array.isArray(focusedCandidates.data.historicalCandidates));
        assert.equal((await fetchJson(app.baseUrl, historyPath(999999999), { cookie: permittedCookie })).status, 404);
        assert.equal((await fetchJson(app.baseUrl, historicalCandidatesPath(999999999), { cookie: permittedCookie })).status, 404);

        manualPatientIdLookupCandidates = [{
          historicalPatientId: "OLD-MANUAL",
          patientName: "Manual Historical Patient",
          patientBirthDate: "19801231",
          patientSex: "F",
          classification: "possible",
          reasons: ["manual_patient_id_search"],
          authoritative: true,
          matchRank: 1,
          nameSimilarity: 0,
          phoneticMatchCount: 0,
          studyCount: 1,
          studies: [{
            orthancStudyId: "manual-orthanc",
            studyInstanceUid: "1.2.manual",
            accessionNumber: "MANUAL-ACC",
            patientId: "OLD-MANUAL",
            patientName: "Manual Historical Patient",
            patientBirthDate: "19801231",
            patientSex: "F",
            studyDate: "20240102",
            studyDescription: "Manual historical CT",
            modalitiesInStudy: ["CT"],
            seriesCount: 1,
            instanceCount: 1,
          }],
        }];
        assert.equal((await fetchJson(app.baseUrl, oldPatientIdPath(attestationBookingId), { method: "POST" })).status, 401);
        assert.equal((await fetchJson(app.baseUrl, oldPatientIdPath(attestationBookingId), { method: "POST", cookie: createTestAuthCookie(testData.userId, "doctor") })).status, 403);
        assert.equal((await fetchJson(app.baseUrl, oldPatientIdPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: {} })).status, 400);
        assert.equal((await fetchJson(app.baseUrl, oldPatientIdPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { patientId: "" } })).status, 400);
        assert.equal((await fetchJson(app.baseUrl, oldPatientIdPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { patientId: "x".repeat(257) } })).status, 400);
        const manualSearch = await fetchJson<{ candidates: Array<{ historicalPatientId: string }> }>(app.baseUrl, oldPatientIdPath(attestationBookingId), {
          method: "POST",
          cookie: permittedCookie,
          body: { patientId: "OLD-MANUAL", currentPatientId: otherPatientId, recordedByUserId: 999999 },
        });
        assert.equal(manualSearch.status, 200);
        assert.equal(manualSearch.data.candidates[0]?.historicalPatientId, "OLD-MANUAL");

        assert.equal((await fetchJson(app.baseUrl, `${getPath(attestationBookingId)}/patient-identity-reconciliation`, { method: "POST", cookie: permittedCookie, body: {} })).status, 404);

        assert.equal((await fetch(app.baseUrl + sonicPath(attestationBookingId, "?scope=patient"), { redirect: "manual" })).status, 401);
        assert.equal((await fetch(app.baseUrl + sonicPath(attestationBookingId, "?scope=patient"), { headers: { Cookie: createTestAuthCookie(testData.userId, "doctor") }, redirect: "manual" })).status, 403);
        const patientIdentity = await pool.query<{ patient_id: string }>(
          "select coalesce(nullif(trim(identifier_value), ''), nullif(trim(national_id), '')) as patient_id from patients where id=$1",
          [testData.patientId],
        );
        assert.ok(patientIdentity.rows[0]?.patient_id);
        const storedSonicSetting = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null }>(
          "select setting_value, updated_by_user_id from system_settings where category='sonicdicom_reports' and setting_key='config' limit 1",
        );
        const originalSonicSetting = storedSonicSetting.rows[0] ?? null;
        await pool.query(
          `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
           values ('sonicdicom_reports', 'config', $1::jsonb, $2)
           on conflict (category, setting_key) do update
           set setting_value=excluded.setting_value, updated_by_user_id=excluded.updated_by_user_id, updated_at=now()`,
          [JSON.stringify({ value: { sonicDicomReportsEnabled: true, sonicDicomPublicBaseUrl: "https://sonic.example/viewer", sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer" } }), testData.userId],
        );
        try {
          const patientOpen = await fetch(app.baseUrl + sonicPath(attestationBookingId, "?scope=patient"), { headers: { Cookie: permittedCookie, Host: "192.168.1.20" }, redirect: "manual" });
          assert.equal(patientOpen.status, 302);
          assert.equal(patientOpen.headers.get("location"), `http://192.168.1.30/viewer/#/list?patientid=${encodeURIComponent(patientIdentity.rows[0]!.patient_id)}`);
          const studyOpen = await fetch(app.baseUrl + sonicPath(attestationBookingId, "?scope=study&accession=V2-" + String(attestationBookingId).padStart(6, "0")), { headers: { Cookie: permittedCookie, Host: "192.168.1.20" }, redirect: "manual" });
          assert.equal(studyOpen.status, 302);
          assert.match(studyOpen.headers.get("location") ?? "", /#\/viewer\?accessionnumber=V2-0/);
          assert.equal((await fetch(app.baseUrl + sonicPath(999999999, "?scope=patient"), { headers: { Cookie: permittedCookie }, redirect: "manual" })).status, 404);
        } finally {
          if (originalSonicSetting) {
            await pool.query(
              "update system_settings set setting_value=$1::jsonb, updated_by_user_id=$2, updated_at=now() where category='sonicdicom_reports' and setting_key='config'",
              [JSON.stringify(originalSonicSetting.setting_value), originalSonicSetting.updated_by_user_id],
            );
          } else {
            await pool.query("delete from system_settings where category='sonicdicom_reports' and setting_key='config'");
          }
        }

        const accepted = await fetchJson<{ attestation: Record<string, unknown> }>(app.baseUrl, postPath(attestationBookingId), {
          method: "POST",
          cookie: permittedCookie,
          body: { studyInstanceUid: candidateUid, status: "confirmed", patientId: otherPatientId, recordedByUserId: 999999 },
        });
        assert.equal(accepted.status, 200);
        assert.equal(accepted.data.attestation.status, "confirmed");
        assert.equal(Number(accepted.data.attestation.recordedByUserId), testData.userId);

        const persisted = await pool.query<{ patient_id: number; status: string; recorded_by_user_id: number; recorded_at: string }>(
          "select patient_id, status, recorded_by_user_id, recorded_at::text from historical_pacs_patient_attestations where patient_id=$1 and study_instance_uid=$2", [testData.patientId, candidateUid],
        );
        assert.deepEqual(persisted.rows.map((row) => ({ ...row, patient_id: Number(row.patient_id), recorded_by_user_id: Number(row.recorded_by_user_id) })), [{ patient_id: testData.patientId, status: "confirmed", recorded_by_user_id: testData.userId, recorded_at: persisted.rows[0]!.recorded_at }]);
        assert.ok(persisted.rows[0]!.recorded_at);

        const denied = await fetchJson<{ attestation: Record<string, unknown> }>(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid: candidateUid, status: "denied" } });
        assert.equal(denied.status, 200);
        assert.equal(denied.data.attestation.status, "denied");
        const updated = await pool.query<{ count: string; status: string; recorded_by_user_id: number }>("select count(*)::text as count, max(status) as status, max(recorded_by_user_id)::int as recorded_by_user_id from historical_pacs_patient_attestations where patient_id=$1 and study_instance_uid=$2", [testData.patientId, candidateUid]);
        assert.deepEqual(updated.rows[0], { count: "1", status: "denied", recorded_by_user_id: testData.userId });

        for (const studyInstanceUid of ["1.2.3.arbitrary", otherPatientUid]) {
          const response: { status: number } = await fetchJson<unknown>(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid, status: "confirmed" } });
          assert.equal(response.status, 404);
        }

        const audit = await pool.query<{ action_type: string; changed_by_user_id: string; new_values: { patientId: number; studyInstanceUid: string; status: string } }>(
          "select action_type, changed_by_user_id, new_values from audit_log where entity_type='historical_pacs_patient_attestation' and changed_by_user_id=$1 order by id desc limit 1", [testData.userId],
        );
        const auditRow = audit.rows[0]!;
        assert.deepEqual({ ...auditRow, changed_by_user_id: Number(auditRow.changed_by_user_id) }, { action_type: "historical_pacs_patient_denied", changed_by_user_id: testData.userId, new_values: { patientId: testData.patientId, studyInstanceUid: candidateUid, status: "denied" } });
        assert.equal(reconciliationRequests.mock.calls.length, 0, "Attestation must not request reconciliation or a PACS mutation");

        failCandidateDiscovery = true;
        const focusedHistoryDuringCandidateFailure = await fetchJson<Record<string, unknown>>(app.baseUrl, historyPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(focusedHistoryDuringCandidateFailure.status, 200);
        assert.ok(Array.isArray(focusedHistoryDuringCandidateFailure.data.items));
        const focusedCandidatesDuringFailure = await fetchJson<Record<string, unknown>>(app.baseUrl, historicalCandidatesPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(focusedCandidatesDuringFailure.status, 200);
        assert.deepEqual(focusedCandidatesDuringFailure.data.historicalCandidates, []);
        assert.equal(focusedCandidatesDuringFailure.data.historicalPacsIndexStatus, "unavailable");
        assert.equal(focusedCandidatesDuringFailure.data.historicalCandidatesError, true);
        const partialFailure = await fetchJson<Record<string, unknown>>(app.baseUrl, getPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(partialFailure.status, 200);
        assert.ok(Array.isArray((partialFailure.data.history as Record<string, unknown>).items));
        assert.deepEqual(partialFailure.data.historicalCandidates, []);
        assert.equal(partialFailure.data.historicalPacsIndexStatus, "unavailable");
        assert.equal(partialFailure.data.historicalCandidatesError, true);
      } finally {
        failCandidateDiscovery = false;
        manualPatientIdLookupCandidates = [];
        reconciliationRequests.mock.resetCalls();
        if (app) await app.close();
        await pool.query("delete from historical_pacs_patient_attestations where study_instance_uid in ($1, $2)", [candidateUid, otherPatientUid]);
        await testDb.cleanup();
      }
    });
  });
}
