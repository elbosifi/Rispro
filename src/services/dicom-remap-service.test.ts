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
