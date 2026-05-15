import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { OrthancAutoCompletionSettingLike } from "./orthanc-study-verification-service.js";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

let service: typeof import("./orthanc-study-verification-service.js");
service = await import("./orthanc-study-verification-service.js");

const baseBooking = {
  id: 42,
  modality_id: 7,
  accession_number: "V2-000042",
  study_instance_uid: "1.2.3",
  appointment_date: "2026-05-04",
  booking_date: "2026-05-04",
  modality_code: "CT",
  national_id: "123456789012",
  mrn: "MRN42",
  patient_primary_id: "MRN42",
};

const baseSetting: OrthancAutoCompletionSettingLike = {
  id: 1,
  modality_id: 7,
  enabled: true,
  orthanc_target_type: "local",
  orthanc_target_key: null,
  matching_strategy: "study_uid_preferred_accession_fallback",
  completion_threshold: "study_exists",
};

beforeEach(() => {
  service.__setOrthancSettingsForTests({
    enabled: true,
    shadowMode: false,
    connectionMode: "internal",
    baseUrl: "http://orthanc:8042",
    username: "",
    password: "",
    timeoutSeconds: 10,
    verifyTls: true,
    worklistTarget: "",
    strategyPreference: "put_first",
  });
});

afterEach(() => {
  service.__resetOrthancFetchForTests();
  service.__resetOrthancSettingsForTests();
});

function orthancResponse(json: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: JSON.stringify(json),
    json,
  };
}

function studyPayload(overrides: Record<string, unknown> = {}) {
  return {
    ID: "study-1",
    MainDicomTags: {
      StudyInstanceUID: "1.2.3",
      AccessionNumber: "V2-000042",
      StudyDate: "20260504",
      Modality: "CT",
      ...((overrides.MainDicomTags as Record<string, unknown>) || {}),
    },
    PatientMainDicomTags: {
      PatientID: "MRN42",
      ...((overrides.PatientMainDicomTags as Record<string, unknown>) || {}),
    },
    CountSeries: 1,
    CountInstances: 2,
    ...overrides,
  };
}

test("UID match returns matched", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload());
    if (path === "/studies/study-1/statistics") return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "matched");
  assert.equal(result.matchKey, "study_instance_uid");
});

test("accession fallback single match returns matched", async () => {
  let findCount = 0;
  const queries: unknown[] = [];
  service.__setOrthancFetchForTests(async (path, options) => {
    if (path === "/tools/find") {
      findCount += 1;
      queries.push(options?.body);
      return orthancResponse(findCount === 1 ? [] : ["study-1"]);
    }
    if (path === "/studies/study-1") return orthancResponse(studyPayload());
    if (path === "/studies/study-1/statistics") return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "matched");
  assert.equal(result.matchKey, "accession_number");
  assert.deepEqual(queries.at(-1), { Level: "Study", Query: { AccessionNumber: "V2-000042" } });
});

test("legacy raw accession fallback is attempted only after padded accession not_found", async () => {
  const accessionQueries: string[] = [];
  service.__setOrthancFetchForTests(async (path, options) => {
    if (path === "/tools/find") {
      const query = options?.body as { Query?: { StudyInstanceUID?: string; AccessionNumber?: string } };
      if (query.Query?.AccessionNumber) accessionQueries.push(query.Query.AccessionNumber);
      if (query.Query?.StudyInstanceUID) return orthancResponse([]);
      return orthancResponse(query.Query?.AccessionNumber === "V2-42" ? ["study-1"] : []);
    }
    if (path === "/studies/study-1") {
      return orthancResponse(studyPayload({ MainDicomTags: { AccessionNumber: "V2-42" } }));
    }
    if (path === "/studies/study-1/statistics") return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "matched");
  assert.deepEqual(accessionQueries, ["V2-000042", "V2-42"]);
  assert.equal(result.matchValue, "V2-42");
  assert.equal(result.resultJson.legacyRawAccessionFallbackUsed, true);
});

test("accession fallback multiple matches is ambiguous", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1", "study-2"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload());
    if (path === "/studies/study-2") return orthancResponse(studyPayload({ ID: "study-2" }));
    if (path.endsWith("/statistics")) return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc({ ...baseBooking, study_instance_uid: null }, baseSetting);
  assert.equal(result.status, "ambiguous");
});

test("patient conflict blocks completion", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload({ PatientMainDicomTags: { PatientID: "OTHER" } }));
    if (path === "/studies/study-1/statistics") return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.lastError, "patient_conflict");
});

test("modality conflict blocks completion", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload({ MainDicomTags: { Modality: "MR" } }));
    if (path === "/studies/study-1/statistics") return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.lastError, "modality_conflict");
});

test("study date conflict blocks completion", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload({ MainDicomTags: { StudyDate: "20260503" } }));
    if (path === "/studies/study-1/statistics") return orthancResponse({ CountSeries: 1, CountInstances: 2 });
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.lastError, "study_date_conflict");
});

test("missing series count fails series_exists", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload({ CountSeries: undefined, CountInstances: undefined }));
    if (path === "/studies/study-1/statistics") return orthancResponse({});
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, { ...baseSetting, completion_threshold: "series_exists" });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.lastError, "series_count_unavailable");
});

test("missing instance count fails instance_exists", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/tools/find") return orthancResponse(["study-1"]);
    if (path === "/studies/study-1") return orthancResponse(studyPayload({ CountSeries: undefined, CountInstances: undefined }));
    if (path === "/studies/study-1/statistics") return orthancResponse({});
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, { ...baseSetting, completion_threshold: "instance_exists" });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.lastError, "instance_count_unavailable");
});

test("remote C-FIND answer without reliable counts only satisfies study_exists", async () => {
  service.__setOrthancFetchForTests(async (path) => {
    if (path === "/modalities/REMOTE/query") return orthancResponse({ ID: "query-1" });
    if (path === "/queries/query-1/answers") return orthancResponse(["0"]);
    if (path === "/queries/query-1/answers/0/content") return orthancResponse(studyPayload());
    throw new Error(`Unexpected path ${path}`);
  });

  const remoteSetting: OrthancAutoCompletionSettingLike = {
    ...baseSetting,
    orthanc_target_type: "remote_modality",
    orthanc_target_key: "REMOTE",
  };
  const studyResult = await service.verifyBookingStudyWithOrthanc({ ...baseBooking, study_instance_uid: null }, remoteSetting);
  assert.equal(studyResult.status, "matched");

  const seriesResult = await service.verifyBookingStudyWithOrthanc(
    { ...baseBooking, study_instance_uid: null },
    { ...remoteSetting, completion_threshold: "series_exists" }
  );
  assert.equal(seriesResult.status, "insufficient_evidence");
  assert.equal(seriesResult.lastError, "series_count_unavailable");
});

test("Orthanc timeout/error returns error with lastError", async () => {
  service.__setOrthancFetchForTests(async () => {
    throw new Error("Orthanc request timed out after 10000ms.");
  });

  const result = await service.verifyBookingStudyWithOrthanc(baseBooking, baseSetting);
  assert.equal(result.status, "error");
  assert.match(result.lastError || "", /timed out/);
});
