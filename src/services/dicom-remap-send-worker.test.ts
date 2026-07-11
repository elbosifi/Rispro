import test from "node:test";
import assert from "node:assert/strict";
import { __dicomRemapTestables, type DicomRemapJobRow } from "./dicom-remap-service.js";
import { runDicomRemapSendWorkerTick } from "./dicom-remap-send-worker.js";

function sendingJob(): DicomRemapJobRow {
  return {
    id: 91, created_by_user_id: 7, status: "sending", source_orthanc_study_id: "study", modified_orthanc_study_id: "study",
    rispro_patient_id: 4, destination_pacs_key: "PACS_MAIN", original_patient_id: null, original_patient_name: null,
    original_patient_sex: null, original_patient_birth_date: null, replacement_patient_id: null, replacement_patient_name: null,
    replacement_patient_sex: null, replacement_patient_birth_date: null, send_result: null, orthanc_send_job_id: "orthanc-job-91",
    send_attempt_count: 1, send_started_at: null, send_completed_at: null, send_last_checked_at: null, send_last_heartbeat_at: null,
    send_error_code: null, send_error_details: null, error_message: null, cancellation_reason: null,
    created_at: "2026-07-11T00:00:00.000Z", updated_at: "2026-07-11T00:00:00.000Z",
  };
}

test.afterEach(() => __dicomRemapTestables.resetTestOverrides());

test("worker resumes an existing sending job and leaves an Orthanc Running job sending", async () => {
  const responses = [{ rows: [] }, { rows: [sendingJob()] }, { rows: [] }];
  __dicomRemapTestables.setQueryForTests(async () => responses.shift() as never);
  __dicomRemapTestables.setOrthancFetchForTests(async () => ({ status: 200, ok: true, text: "{}", json: { ID: "orthanc-job-91", State: "Running", Type: "DicomModalityStore" } }));
  const result = await runDicomRemapSendWorkerTick({ batchSize: 5, staleEnqueueMinutes: 10 });
  assert.deepEqual(result, { checked: 1, staleFailed: 0 });
});
