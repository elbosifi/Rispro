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
    lookupHistoricalPacsByPatientId: async () => [],
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
        const postPath = (id: string | number) => `${getPath(id)}/attestations`;

        for (const invalidId of [0, -1, "not-a-number"]) {
          const response = await fetchJson(app.baseUrl, getPath(invalidId), { cookie: permittedCookie });
          assert.equal(response.status, 400);
        }
        assert.equal((await fetchJson(app.baseUrl, postPath(0), { method: "POST", cookie: permittedCookie, body: {} })).status, 400);
        for (const status of ["approved", "yes", "", null]) {
          const response = await fetchJson(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid: candidateUid, status } });
          assert.equal(response.status, 400);
        }
        for (const studyInstanceUid of ["", "   "]) {
          const response = await fetchJson(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid, status: "confirmed" } });
          assert.equal(response.status, 400);
        }

        assert.equal((await fetchJson(app.baseUrl, getPath(genericBookingId))).status, 401);
        assert.equal((await fetchJson(app.baseUrl, getPath(genericBookingId), { cookie: createTestAuthCookie(testData.userId, "doctor") })).status, 403);

        const genericResponse = await fetchJson<Record<string, unknown>>(app.baseUrl, getPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(genericResponse.status, 200, "A non-CT/MRI Modality booking must resolve through getModalityAppointmentContext");
        assert.ok(Array.isArray((genericResponse.data.history as Record<string, unknown>).items));

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
          const response = await fetchJson(app.baseUrl, postPath(attestationBookingId), { method: "POST", cookie: permittedCookie, body: { studyInstanceUid, status: "confirmed" } });
          assert.equal(response.status, 404);
        }

        const audit = await pool.query<{ action_type: string; changed_by_user_id: number; new_values: { patientId: number; studyInstanceUid: string; status: string } }>(
          "select action_type, changed_by_user_id, new_values from audit_log where entity_type='historical_pacs_patient_attestation' and changed_by_user_id=$1 order by id desc limit 1", [testData.userId],
        );
        assert.deepEqual(audit.rows[0], { action_type: "historical_pacs_patient_denied", changed_by_user_id: testData.userId, new_values: { patientId: testData.patientId, studyInstanceUid: candidateUid, status: "denied" } });
        assert.equal(reconciliationRequests.mock.calls.length, 0, "Attestation must not request reconciliation or a PACS mutation");

        failCandidateDiscovery = true;
        const partialFailure = await fetchJson<Record<string, unknown>>(app.baseUrl, getPath(genericBookingId), { cookie: permittedCookie });
        assert.equal(partialFailure.status, 200);
        assert.ok(Array.isArray((partialFailure.data.history as Record<string, unknown>).items));
        assert.deepEqual(partialFailure.data.historicalCandidates, []);
        assert.equal(partialFailure.data.historicalPacsIndexStatus, "unavailable");
        assert.equal(partialFailure.data.historicalCandidatesError, true);
      } finally {
        failCandidateDiscovery = false;
        reconciliationRequests.mock.resetCalls();
        if (app) await app.close();
        await pool.query("delete from historical_pacs_patient_attestations where study_instance_uid in ($1, $2)", [candidateUid, otherPatientUid]);
        await testDb.cleanup();
      }
    });
  });
}
