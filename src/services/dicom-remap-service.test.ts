import test from "node:test";
import assert from "node:assert/strict";
import {
  __dicomRemapTestables,
  assertDicomRemapRouteAccess,
  cancelDicomRemapJob,
  confirmDicomRemapAndSend,
  createDicomRemapUploadJob,
  validateDicomRemapUploadFilesInput,
  validateExplicitConfirm,
  type DicomRemapJobRow,
} from "./dicom-remap-service.js";
import { HttpError } from "../utils/http-error.js";

function remapJob(overrides: Partial<DicomRemapJobRow> = {}): DicomRemapJobRow {
  return {
    id: 1,
    created_by_user_id: 42,
    status: "uploaded",
    source_orthanc_study_id: "source-study-id",
    modified_orthanc_study_id: null,
    rispro_patient_id: null,
    destination_pacs_key: null,
    original_patient_id: null,
    original_patient_name: null,
    original_patient_sex: null,
    original_patient_birth_date: null,
    replacement_patient_id: null,
    replacement_patient_name: null,
    replacement_patient_sex: null,
    replacement_patient_birth_date: null,
    send_result: null,
    error_message: null,
    cancellation_reason: null,
    created_at: "2026-04-30T00:00:00.000Z",
    updated_at: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function queueQueryResults(items: Array<{ rows: unknown[] } | Error>) {
  const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const query = async (sql: unknown, params?: unknown[]) => {
    calls.push({ sql: String(sql), params });
    const item = items.shift();
    if (!item) {
      throw new Error(`Unexpected query: ${String(sql)}`);
    }
    if (item instanceof Error) {
      throw item;
    }
    return item;
  };
  __dicomRemapTestables.setQueryForTests(query as never);
  return calls;
}

function orthancResult(overrides: Partial<{ status: number; ok: boolean; text: string; json: unknown }> = {}) {
  return {
    status: overrides.status ?? 200,
    ok: overrides.ok ?? true,
    text: overrides.text ?? "",
    json: overrides.json ?? {},
  };
}

function queueOrthancResults(items: Array<ReturnType<typeof orthancResult>>) {
  const calls: Array<{ path: string; method: string | undefined; body: unknown }> = [];
  __dicomRemapTestables.setOrthancFetchForTests(async (path, options = {}) => {
    calls.push({ path, method: options.method, body: options.body });
    const item = items.shift();
    if (!item) {
      throw new Error(`Unexpected Orthanc request: ${path}`);
    }
    return item;
  });
  return calls;
}

function stableStudyResponses(overrides: { isStable?: boolean; lastUpdate?: string; series?: string[]; count?: number } = {}) {
  return [
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        ID: "study-id",
        IsStable: overrides.isStable ?? true,
        LastUpdate: overrides.lastUpdate ?? "20260430T120000",
        Series: overrides.series ?? ["series-1"],
      },
    }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { CountInstances: overrides.count ?? 465 } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { Version: "1.12.11", DatabaseServerIdentifier: "dbid" },
    }),
  ];
}

test.afterEach(() => {
  __dicomRemapTestables.resetTestOverrides();
});

test("validateDicomRemapUploadFilesInput rejects empty payloads", () => {
  assert.throws(
    () => validateDicomRemapUploadFilesInput([]),
    /non-empty array/i
  );
});

test("validateDicomRemapUploadFilesInput accepts file arrays", () => {
  const files = validateDicomRemapUploadFilesInput([{ fileName: "study.dcm", fileContentBase64: "AA==" }]);
  assert.equal(files.length, 1);
});

test("validateExplicitConfirm only accepts explicit true values", () => {
  assert.equal(validateExplicitConfirm(true), true);
  assert.equal(validateExplicitConfirm("true"), true);
  assert.equal(validateExplicitConfirm("TRUE"), true);
  assert.equal(validateExplicitConfirm("false"), false);
  assert.equal(validateExplicitConfirm(undefined), false);
});

test("assertDicomRemapRouteAccess enforces authenticated user id", async () => {
  await assert.rejects(
    () => assertDicomRemapRouteAccess(null),
    /currentUserId/i
  );

  const userId = await assertDicomRemapRouteAccess(42);
  assert.equal(userId, 42);
});

test("dicom helper: DICOM file checks are strict but predictable", () => {
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.dcm", "application/octet-stream"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.bin", "application/dicom"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.ima", "application/octet-stream"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.bin", "application/octet-stream"), true);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("image.jpg", "image/jpeg"), false);
  assert.equal(__dicomRemapTestables.isLikelyDicomFile("notes.txt", "text/plain"), false);
});

test("dicom helper: patient sex and birth date normalization", () => {
  assert.equal(__dicomRemapTestables.normalizePatientSex("female"), "F");
  assert.equal(__dicomRemapTestables.normalizePatientSex("M"), "M");
  assert.equal(__dicomRemapTestables.normalizePatientSex(""), "");

  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("1990-04-05"), "19900405");
  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("19900405"), "19900405");
  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("05-04-1990"), "");
});

test("dicom helper: Orthanc resource id parser supports common response shapes", () => {
  assert.equal(__dicomRemapTestables.parseOrthancResourceId({ ParentStudy: "abc-study" }), "abc-study");
  assert.equal(__dicomRemapTestables.parseOrthancResourceId({ ID: "new-id" }), "new-id");
  assert.equal(__dicomRemapTestables.parseOrthancResourceId({}), "");
});

test("dicom helper: Orthanc upload parser prefers explicit ParentStudy", async () => {
  const uploadResponse = {
    status: 200,
    ok: true,
    text: "",
    json: {
      ID: "instance-id",
      ParentStudy: "study-id",
      Path: "/instances/instance-id",
    },
  };

  const parsed = __dicomRemapTestables.parseOrthancUploadResponse(uploadResponse.json);
  assert.deepEqual(parsed.parentStudyIds, ["study-id"]);
  assert.deepEqual(parsed.instanceIds, ["instance-id"]);

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    uploadResponse,
    async () => {
      throw new Error("instance lookup should not be used when ParentStudy is present");
    }
  );
  assert.equal(resolved, "study-id");
});

test("dicom helper: Orthanc upload resolver treats ID-only response as instance ID", async () => {
  const seenInstanceIds: string[] = [];

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    {
      status: 200,
      ok: true,
      text: "",
      json: { ID: "instance-only-id" },
    },
    async (instanceId) => {
      seenInstanceIds.push(instanceId);
      return "resolved-study-id";
    }
  );

  assert.equal(resolved, "resolved-study-id");
  assert.deepEqual(seenInstanceIds, ["instance-only-id"]);
});

test("dicom helper: Orthanc upload resolver extracts instance ID from Path", async () => {
  const seenInstanceIds: string[] = [];

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    {
      status: 200,
      ok: true,
      text: "",
      json: { Path: "/instances/path-instance-id" },
    },
    async (instanceId) => {
      seenInstanceIds.push(instanceId);
      return "path-study-id";
    }
  );

  assert.equal(resolved, "path-study-id");
  assert.deepEqual(seenInstanceIds, ["path-instance-id"]);
});

test("dicom helper: Orthanc upload parser handles array and nested shapes", async () => {
  const uploadResponse = {
    status: 200,
    ok: true,
    text: "",
    json: [
      {
        Status: "Success",
        Instance: {
          ID: "nested-instance-id",
          Path: "/instances/nested-instance-id",
        },
      },
      {
        Result: {
          ParentStudy: "nested-study-id",
        },
      },
    ],
  };

  const parsed = __dicomRemapTestables.parseOrthancUploadResponse(uploadResponse.json);
  assert.deepEqual(parsed.parentStudyIds, ["nested-study-id"]);
  assert.deepEqual(parsed.instanceIds, ["nested-instance-id"]);

  const resolved = await __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
    uploadResponse,
    async () => {
      throw new Error("instance lookup should not be used when nested ParentStudy is present");
    }
  );
  assert.equal(resolved, "nested-study-id");
});

test("dicom helper: Orthanc upload resolver reports sanitized shape when no ID can be resolved", async () => {
  await assert.rejects(
    () => __dicomRemapTestables.resolveStudyIdFromOrthancUploadResponse(
      {
        status: 201,
        ok: true,
        text: JSON.stringify({ Sensitive: "not included in error" }),
        json: { Status: "Success", Details: { Imported: true } },
      },
      async () => {
        throw new Error("instance lookup should not be used without an instance ID");
      }
    ),
    (error) => {
      assert.match((error as Error).message, /status=201/);
      assert.match((error as Error).message, /shape=object\(keys=Status,Details\)/);
      assert.doesNotMatch((error as Error).message, /Sensitive|not included/);
      return true;
    }
  );
});

test("dicom helper: createModifiedStudyCopy preflights source study and reports missing study clearly", async () => {
  const calls = queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "Unknown resource", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 404, ok: false, text: "No statistics", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } }),
    orthancResult({ status: 404, ok: false, text: "Unknown instance", json: { Error: "Unknown resource" } }),
  ]);

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("missing-study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    (error) => {
      assert.match((error as Error).message, /source study no longer exists/i);
      assert.match((error as Error).message, /sourceStudyId=missing-study-id/);
      assert.match((error as Error).message, /status=404/);
      return true;
    }
  );

  assert.equal(calls[0]?.path, "/studies/missing-study-id");
  assert.equal(calls.some((call) => call.path.includes("/modify")), false);
});

test("dicom helper: createModifiedStudyCopy reports source IDs that are instances", async () => {
  queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "Unknown study", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 404, ok: false, text: "No statistics", json: { Error: "Unknown resource" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ParentStudy: "real-study-id" } }),
  ]);

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("instance-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    /source ID is an Orthanc instance ID, not a study ID/i
  );
});

test("dicom helper: createModifiedStudyCopy logs and reports modify 404 diagnostics", async () => {
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    __dicomRemapTestables.setSleepForTests(async () => {});
    const modify404 = orthancResult({
      status: 404,
      ok: false,
      text: "Cannot modify study. Authorization: Basic secret-token",
      json: { Error: "Unknown resource" },
    });
    const calls = queueOrthancResults([
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
      ...stableStudyResponses(),
      modify404,
    ]);

    await assert.rejects(
      () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
        patientId: "P1",
        patientName: "Test^Patient",
        patientSex: "M",
        patientBirthDate: "19900101",
      }),
      (error) => {
        assert.match((error as Error).message, /modify endpoint rejected/i);
        assert.match((error as Error).message, /retry exhaustion/i);
        assert.match((error as Error).message, /sourceStudyId=study-id/);
        assert.match((error as Error).message, /instances=465/);
        assert.match((error as Error).message, /isStable=true/);
        assert.match((error as Error).message, /lastUpdate=20260430T120000/);
        assert.match((error as Error).message, /series=1/);
        assert.match((error as Error).message, /orthancVersion=1.12.11/);
        assert.match((error as Error).message, /databaseServerIdentifier=dbid/);
        assert.match((error as Error).message, /status=404/);
        assert.match((error as Error).message, /Basic \[redacted\]/);
        assert.doesNotMatch((error as Error).message, /secret-token/);
        assert.match((error as Error).message, /shape=object\(keys=Error\)/);
        return true;
      }
    );

    assert.equal(calls[0]?.path, "/studies/study-id");
    assert.equal(calls[1]?.path, "/studies/study-id/statistics");
    assert.equal(calls[2]?.path, "/system");
    assert.equal(calls[3]?.path, "/studies/study-id/modify");
    assert.equal(calls.filter((call) => call.path === "/studies/study-id/modify").length, 5);
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.[0], "Orthanc study modify failed.");
    assert.deepEqual(logged[0]?.[1], {
      sourceStudyId: "study-id",
      studyPreflightStatus: 200,
      instanceCount: 465,
      isStable: true,
      lastUpdate: "20260430T120000",
      seriesCount: 1,
      orthancVersion: "1.12.11",
      databaseServerIdentifier: "dbid",
      modifyStatus: 404,
      modifyResponseBody: "Cannot modify study. Authorization: Basic [redacted]",
      modifyResponseShape: "object(keys=Error)",
      modifyPayloadShape: "object(keys=Replace,KeepSource,Force)",
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("dicom helper: createModifiedStudyCopy sends Force true with patient identity replacement", async () => {
  const calls = queueOrthancResults([
    ...stableStudyResponses(),
    orthancResult({ status: 200, ok: true, text: JSON.stringify({ ID: "modified-study-id" }), json: { ID: "modified-study-id" } }),
  ]);

  const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
    patientId: "RISPRO-123",
    patientName: "Replacement^Patient",
    patientSex: "F",
    patientBirthDate: "19850123",
  });

  assert.equal(modifiedStudyId, "modified-study-id");
  assert.equal(calls[3]?.path, "/studies/study-id/modify");
  assert.equal(calls[3]?.method, "POST");
  assert.deepEqual(calls[3]?.body, {
    Replace: {
      PatientID: "RISPRO-123",
      PatientName: "Replacement^Patient",
      PatientSex: "F",
      PatientBirthDate: "19850123",
    },
    KeepSource: true,
    Force: true,
  });
});

test("dicom helper: waitForOrthancStudyStable proceeds immediately for stable studies", async () => {
  const calls = queueOrthancResults(stableStudyResponses({ count: 3, series: ["a", "b"] }));

  const preflight = await __dicomRemapTestables.waitForOrthancStudyStable("study-id");

  assert.equal(preflight.isStable, true);
  assert.equal(preflight.instanceCount, 3);
  assert.equal(preflight.seriesCount, 2);
  assert.equal(calls.length, 3);
});

test("dicom helper: waitForOrthancStudyStable polls until Orthanc reports stable", async () => {
  const sleeps: number[] = [];
  __dicomRemapTestables.setSleepForTests(async (ms) => {
    sleeps.push(ms);
  });
  const calls = queueOrthancResults([
    ...stableStudyResponses({ isStable: false, lastUpdate: "first" }),
    ...stableStudyResponses({ isStable: true, lastUpdate: "second" }),
  ]);

  const preflight = await __dicomRemapTestables.waitForOrthancStudyStable("study-id");

  assert.equal(preflight.isStable, true);
  assert.equal(preflight.lastUpdate, "second");
  assert.deepEqual(sleeps, [1000]);
  assert.equal(calls.filter((call) => call.path === "/studies/study-id").length, 2);
});

test("dicom helper: createModifiedStudyCopy retries transient modify 404 while study still exists", async () => {
  const sleeps: number[] = [];
  __dicomRemapTestables.setSleepForTests(async (ms) => {
    sleeps.push(ms);
  });
  const calls = queueOrthancResults([
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not ready", json: { Error: "Unknown resource" } }),
    ...stableStudyResponses(),
    orthancResult({ status: 200, ok: true, text: JSON.stringify({ ID: "modified-study-id" }), json: { ID: "modified-study-id" } }),
  ]);

  const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
    patientId: "P1",
    patientName: "Test^Patient",
    patientSex: "M",
    patientBirthDate: "19900101",
  });

  assert.equal(modifiedStudyId, "modified-study-id");
  assert.deepEqual(sleeps, [500]);
  assert.equal(calls.filter((call) => call.path === "/studies/study-id/modify").length, 2);
});

test("dicom helper: cancelled status is terminal and not active", () => {
  assert.equal(__dicomRemapTestables.isDicomRemapTerminalStatus("cancelled"), true);
  assert.equal(__dicomRemapTestables.isDicomRemapActiveStatus("cancelled"), false);
  assert.deepEqual(__dicomRemapTestables.TERMINAL_JOB_STATUSES, ["sent", "failed", "cancelled"]);
  assert.deepEqual(__dicomRemapTestables.ACTIVE_JOB_STATUSES, ["uploaded", "awaiting_confirmation", "remapped", "sending"]);
});

test("cancelDicomRemapJob cancels an active owner job and audits it", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [remapJob({ status: "cancelled", cancellation_reason: "User reset" })] },
  ]);

  const result = await cancelDicomRemapJob({
    jobId: 1,
    currentUserId: 42,
    reason: "User reset",
  });

  assert.equal(result.job.status, "cancelled");
  assert.equal(result.job.cancellation_reason, "User reset");
  assert.equal(auditEvents.length, 1);
});

test("cancelDicomRemapJob returns an already-cancelled job safely", async () => {
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "cancelled", cancellation_reason: "Already done" })] },
  ]);

  const result = await cancelDicomRemapJob({
    jobId: 1,
    currentUserId: 42,
    reason: "again",
  });

  assert.equal(result.job.status, "cancelled");
  assert.equal(result.job.cancellation_reason, "Already done");
});

test("cancelDicomRemapJob rejects sent and failed terminal jobs", async () => {
  for (const status of ["sent", "failed"] as const) {
    queueQueryResults([
      { rows: [] },
      { rows: [remapJob({ status })] },
    ]);

    await assert.rejects(
      () => cancelDicomRemapJob({ jobId: 1, currentUserId: 42, reason: "too late" }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
        assert.match((error as Error).message, /cannot be cancelled/i);
        return true;
      }
    );
    __dicomRemapTestables.resetTestOverrides();
  }
});

test("cancelled jobs do not count as active upload blockers", () => {
  assert.equal(__dicomRemapTestables.isDicomRemapActiveStatus("cancelled"), false);
  assert.equal(__dicomRemapTestables.ACTIVE_JOB_STATUSES.includes("cancelled"), false);
});

test("createDicomRemapUploadJob maps upload insert races to activeJobId conflicts", async () => {
  const uniqueError = Object.assign(new Error("duplicate key"), { code: "23505" });
  queueQueryResults([
    { rows: [] },
    uniqueError,
    { rows: [{ id: 77 }] },
  ]);

  await assert.rejects(
    () => createDicomRemapUploadJob({
      files: [{ fileName: "study.dcm", fileContentBase64: "AA==" }],
      currentUserId: 42,
    }),
    (error) => {
      assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
      assert.deepEqual(error instanceof HttpError ? error.details : null, { activeJobId: 77 });
      return true;
    }
  );
});

test("confirmDicomRemapAndSend claim failure returns already-sent job without Orthanc calls", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Orthanc should not be called when confirm claim fails");
  }) as typeof fetch;
  try {
    queueQueryResults([
      { rows: [] },
      { rows: [remapJob({ status: "sent" })] },
    ]);

    const result = await confirmDicomRemapAndSend({
      jobId: 1,
      currentUserId: 42,
      confirm: true,
    });

    assert.equal(result.job.status, "sent");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("confirmDicomRemapAndSend claim failure rejects non-sent jobs before Orthanc calls", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("Orthanc should not be called when confirm claim fails");
  }) as typeof fetch;
  try {
    queueQueryResults([
      { rows: [] },
      { rows: [remapJob({ status: "awaiting_confirmation" })] },
    ]);

    await assert.rejects(
      () => confirmDicomRemapAndSend({
        jobId: 1,
        currentUserId: 42,
        confirm: true,
      }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
        assert.match((error as Error).message, /not awaiting confirmation/i);
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dicom helper: status transition guard throws on unexpected status", () => {
  assert.throws(
    () => __dicomRemapTestables.assertJobStatus("uploaded", "awaiting_confirmation", "bad"),
    /bad/i
  );

  assert.doesNotThrow(() => {
    __dicomRemapTestables.assertJobStatus("uploaded", "uploaded", "ok");
  });
});
