import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dcmjs from "dcmjs";
import {
  __dicomRemapTestables,
  assertDicomRemapRouteAccess,
  cancelDicomRemapJob,
  confirmDicomRemapAndSend,
  createDicomRemapMultipartUploadJob,
  createDicomRemapUploadJob,
  resendDicomRemapJobToPacs,
  validateDicomRemapUploadFilesInput,
  validateExplicitConfirm,
  type DicomRemapJobRow,
} from "./dicom-remap-service.js";
import { HttpError } from "../utils/http-error.js";
const { datasetToBuffer, DicomMessage, DicomMetaDictionary } = dcmjs.data;

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

function makeSyntheticDicomBuffer(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(datasetToBuffer({
    _meta: {
      FileMetaInformationVersion: new Uint8Array([0, 1]),
      MediaStorageSOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
      MediaStorageSOPInstanceUID: "1.2.3.4.5.6",
      TransferSyntaxUID: "1.2.840.10008.1.2.1",
      ImplementationClassUID: "2.25.12345",
    },
    SOPClassUID: "1.2.840.10008.5.1.4.1.1.2",
    SOPInstanceUID: "1.2.3.4.5.6",
    StudyInstanceUID: "1.2.840.113619.2.55.3.604688433.1234.1456789012.1",
    SeriesInstanceUID: "1.2.840.113619.2.55.3.604688433.1234.1456789012.1.1",
    PatientID: "OLDID",
    PatientName: "OLD^PATIENT",
    PatientSex: "M",
    PatientBirthDate: "19900101",
    Rows: 1,
    Columns: 1,
    SamplesPerPixel: 1,
    PhotometricInterpretation: "MONOCHROME2",
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 0,
    PixelData: new Uint16Array([1]),
    ...overrides,
  }));
}

async function makeStagedFiles(files: Array<{ fileName: string; content?: string; mimeType?: string }>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-test-"));
  const staged = [];
  for (const [index, file] of files.entries()) {
    const stagedPath = path.join(tempDir, `${index}.dcm`);
    const content = Buffer.from(file.content ?? "dicom");
    await writeFile(stagedPath, content);
    staged.push({
      fileName: file.fileName,
      mimeType: file.mimeType || "application/dicom",
      path: stagedPath,
      size: content.length,
    });
  }
  return { tempDir, staged };
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
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("DICOMDIR"), true);
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("MEDIAVIE.PRO"), true);
  assert.equal(__dicomRemapTestables.isSkippableDicomRemapFolderEntry("image.dcm"), false);
});

test("dicom helper: Orthanc invalid-DICOM upload rejection detection is narrow", () => {
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 400,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15 },
    })
  ), true);
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 400,
      ok: false,
      text: "Cannot parse an invalid DICOM file",
      json: { Message: "Cannot parse an invalid DICOM file" },
    })
  ), true);
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 500,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15 },
    })
  ), false);
  assert.equal(__dicomRemapTestables.isOrthancInvalidDicomUploadRejection(
    orthancResult({
      status: 401,
      ok: false,
      text: "Unauthorized",
      json: { HttpError: "Unauthorized" },
    })
  ), false);
});

test("dicom helper: upload failure message includes sanitized Orthanc response", () => {
  const message = __dicomRemapTestables.formatOrthancUploadFailureMessage(
    "bad.dcm",
    7,
    orthancResult({
      status: 400,
      ok: false,
      text: "Task failed: invalid string length Authorization: Basic secret-token",
      json: { HttpError: "Bad Request", Message: "Task failed: invalid string length" },
    })
  );

  assert.match(message, /bad\.dcm/);
  assert.match(message, /file 7/);
  assert.match(message, /status=400/);
  assert.match(message, /invalid string length/);
  assert.match(message, /Basic \[redacted\]/);
  assert.doesNotMatch(message, /secret-token/);
});

test("dicom helper: patient sex and birth date normalization", () => {
  assert.equal(__dicomRemapTestables.normalizePatientSex("female"), "F");
  assert.equal(__dicomRemapTestables.normalizePatientSex("M"), "M");
  assert.equal(__dicomRemapTestables.normalizePatientSex(""), "");

  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("1990-04-05"), "19900405");
  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("19900405"), "19900405");
  assert.equal(__dicomRemapTestables.normalizeDicomBirthDate("05-04-1990"), "");
});

test("dicom helper: replacement identity validation passes normal values", () => {
  const validated = __dicomRemapTestables.validateOrthancReplacementIdentity({
    patientId: "  RISPRO-123  ",
    patientName: "Jane Doe",
    patientSex: "female",
    patientBirthDate: "1990-01-02",
  });

  assert.equal(validated.patientId, "RISPRO-123");
  assert.equal(validated.patientName, "Jane^Doe");
  assert.equal(validated.patientSex, "F");
  assert.equal(validated.patientBirthDate, "19900102");
});

test("dicom helper: replacement identity rejects long PatientID", () => {
  const tooLong = "A".repeat(65);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientIdForReplace(tooLong),
    /PatientID is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects PatientID by byte length", () => {
  const tooLong = "م".repeat(33);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientIdForReplace(tooLong),
    /PatientID is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects long PatientName component group", () => {
  const tooLongGroup = "B".repeat(65);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace(`${tooLongGroup}=OK`),
    /PatientName is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects PatientName group by byte length", () => {
  const tooLongGroup = "م".repeat(33);
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace(`${tooLongGroup}=OK`),
    /PatientName is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects PatientName total byte length", () => {
  const eachGroupFitsButTotalDoesNot = `${"A".repeat(40)}=${"B".repeat(25)}`;
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace(eachGroupFitsButTotalDoesNot),
    /PatientName is too long for DICOM/
  );
});

test("dicom helper: replacement identity rejects control characters consistently", () => {
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientIdForReplace("RISPRO-\u0007-123"),
    /control characters/i
  );
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace("Jane\u0000 Doe"),
    /control characters/i
  );
  assert.throws(
    () => __dicomRemapTestables.normalizeDicomPatientNameForReplace("Jane\nDoe"),
    /control characters/i
  );
});

test("dicom helper: rewriteDicomFileForRemap preserves study identity and replaces patient identity", async () => {
  const stagedFiles = await makeStagedFiles([
    {
      fileName: "image-1.dcm",
      content: makeSyntheticDicomBuffer().toString("binary"),
      mimeType: "application/dicom",
    },
  ]);

  await writeFile(stagedFiles.staged[0].path, makeSyntheticDicomBuffer());

  const rewritten = await __dicomRemapTestables.rewriteDicomFileForRemap(stagedFiles.staged[0], {
    patientId: "NEWID",
    patientName: "NEW^PATIENT",
    patientSex: "F",
    patientBirthDate: "20000101",
  });

  assert.equal(rewritten.originalSummary.studyInstanceUid, "1.2.840.113619.2.55.3.604688433.1234.1456789012.1");
  assert.equal(rewritten.originalSummary.patientId, "OLDID");
  assert.equal(rewritten.originalSummary.patientName, "OLD^PATIENT");

  const dicom = DicomMessage.readFile(rewritten.body.buffer.slice(rewritten.body.byteOffset, rewritten.body.byteOffset + rewritten.body.byteLength));
  const dataset = DicomMetaDictionary.naturalizeDataset(dicom.dict) as Record<string, unknown>;
  const summary = __dicomRemapTestables.readNaturalizedStudySummary(dataset);
  assert.equal(summary.studyInstanceUid, "1.2.840.113619.2.55.3.604688433.1234.1456789012.1");
  assert.equal(summary.patientId, "NEWID");
  assert.equal(summary.patientName, "NEW^PATIENT");
  assert.equal(summary.patientSex, "F");
  assert.equal(summary.patientBirthDate, "20000101");
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
      orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "study-id" } }),
    ]);
    __dicomRemapTestables.setBulkModifyRouteAvailableForTests(false);

    await assert.rejects(
      () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
        patientId: "P1",
        patientName: "Test^Patient",
        patientSex: "M",
        patientBirthDate: "19900101",
      }),
      (error) => {
        assert.match((error as Error).message, /Orthanc could not modify this uploaded study/i);
        return true;
      }
    );

    assert.equal(calls[0]?.path, "/studies/study-id");
    assert.equal(calls[1]?.path, "/studies/study-id/statistics");
    assert.equal(calls[2]?.path, "/system");
    assert.equal(calls[3]?.path, "/studies/study-id/modify");
    assert.equal(calls[4]?.path, "/studies/study-id");
    assert.equal(calls.some((call) => call.path === "/tools/bulk-modify"), false);
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
      stabilityTimedOut: false,
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

test("dicom helper: createModifiedStudyCopy rejects long PatientID before Orthanc modify", async () => {
  const calls = queueOrthancResults(stableStudyResponses());

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "X".repeat(65),
      patientName: "Replacement^Patient",
      patientSex: "F",
      patientBirthDate: "19850123",
    }),
    /PatientID is too long for DICOM/
  );

  assert.equal(calls.some((call) => call.path.endsWith("/modify")), false);
});

test("dicom helper: createModifiedStudyCopy rejects long PatientName before Orthanc modify", async () => {
  const calls = queueOrthancResults(stableStudyResponses());

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "RISPRO-123",
      patientName: `${"N".repeat(65)}`,
      patientSex: "F",
      patientBirthDate: "19850123",
    }),
    /PatientName is too long for DICOM/
  );

  assert.equal(calls.some((call) => call.path.endsWith("/modify")), false);
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

test("dicom helper: createModifiedStudyCopy proceeds after stability timeout when modify succeeds", async () => {
  const originalConsoleWarn = console.warn;
  const originalDateNow = Date.now;
  console.warn = () => {};
  __dicomRemapTestables.setSleepForTests(async () => {});
  let studyReads = 0;

  try {
    const nowValues = [0, 0, 1];
    Date.now = () => nowValues.shift() ?? 1;
    const calls = queueOrthancResults([
      ...stableStudyResponses({ isStable: false, lastUpdate: "first" }),
      ...stableStudyResponses({ isStable: false, lastUpdate: "after-timeout" }),
      orthancResult({ status: 200, ok: true, text: JSON.stringify({ ID: "modified-study-id" }), json: { ID: "modified-study-id" } }),
    ]);

    const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }, {
      stabilityTimeoutMs: 0,
    });

    studyReads = calls.filter((call) => call.path === "/studies/study-id").length;
    assert.equal(modifiedStudyId, "modified-study-id");
    assert.equal(studyReads, 2);
    assert.equal(calls.filter((call) => call.path === "/studies/study-id/modify").length, 1);
  } finally {
    console.warn = originalConsoleWarn;
    Date.now = originalDateNow;
  }
});

test("dicom helper: createModifiedStudyCopy treats timeout as success when modified study is verifiable", async () => {
  const calls: string[] = [];
  __dicomRemapTestables.setOrthancFetchForTests(async (path, options = {}) => {
    calls.push(path);
    if (path === "/studies/study-id") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: {
          ID: "study-id",
          IsStable: true,
          LastUpdate: "20260501T100000",
          Series: ["series-1"],
          ParentPatient: "patient-1",
        },
      });
    }
    if (path === "/studies/study-id/statistics") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { CountInstances: 11 } });
    }
    if (path === "/system") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } });
    }
    if (path === "/patients/patient-1") {
      const firstRead = calls.filter((entry) => entry === "/patients/patient-1").length === 1;
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: { Studies: firstRead ? ["study-id"] : ["study-id", "modified-study-id"] },
      });
    }
    if (path === "/studies/study-id/modify" && options.method === "POST") {
      throw new HttpError(504, "Orthanc request timed out after 60000ms.");
    }
    if (path === "/studies/modified-study-id") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: {
          MainDicomTags: {},
          PatientMainDicomTags: {
            PatientID: "P1",
            PatientName: "Test^Patient",
            PatientSex: "M",
            PatientBirthDate: "19900101",
          },
        },
      });
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
    patientId: "P1",
    patientName: "Test^Patient",
    patientSex: "M",
    patientBirthDate: "19900101",
  });

  assert.equal(modifiedStudyId, "modified-study-id");
});

test("dicom helper: createModifiedStudyCopy keeps timeout clear when verification cannot prove success", async () => {
  __dicomRemapTestables.setOrthancFetchForTests(async (path, options = {}) => {
    if (path === "/studies/study-id") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: {
          ID: "study-id",
          IsStable: true,
          LastUpdate: "20260501T100000",
          Series: ["series-1"],
          ParentPatient: "patient-1",
        },
      });
    }
    if (path === "/studies/study-id/statistics") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { CountInstances: 11 } });
    }
    if (path === "/system") {
      return orthancResult({ status: 200, ok: true, text: "{}", json: { Version: "1.12.11" } });
    }
    if (path === "/patients/patient-1") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: { Studies: ["study-id"] },
      });
    }
    if (path === "/studies/study-id/modify" && options.method === "POST") {
      throw new HttpError(504, "Orthanc request timed out after 60000ms.");
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    /timed out and verification could not confirm modified study creation/i
  );
});

test("dicom helper: verifySendCompletionAfterTimeout finds completed job when available", async () => {
  __dicomRemapTestables.setOrthancFetchForTests(async (path) => {
    if (path === "/jobs?expand") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: [
          {
            ID: "job-1",
            State: "Success",
            Content: { StudyId: "modified-study-id", Modality: "RISPRO_NODE_7" },
          },
        ],
      });
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  const verified = await __dicomRemapTestables.verifySendCompletionAfterTimeout("modified-study-id", "RISPRO_NODE_7");
  assert.ok(verified);
});

test("dicom helper: verifySendCompletionAfterTimeout returns null when no proof exists", async () => {
  __dicomRemapTestables.setOrthancFetchForTests(async (path) => {
    if (path === "/jobs?expand" || path === "/jobs") {
      return orthancResult({
        status: 200,
        ok: true,
        text: "{}",
        json: [{ ID: "job-1", State: "Running", Content: { StudyId: "another-study" } }],
      });
    }
    throw new Error(`Unexpected Orthanc request: ${path}`);
  });

  const verified = await __dicomRemapTestables.verifySendCompletionAfterTimeout("modified-study-id", "RISPRO_NODE_7");
  assert.equal(verified, null);
});

test("dicom helper: createModifiedStudyCopy uses study-level bulk modify when study route rejects", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    __dicomRemapTestables.setSleepForTests(async () => {});
    const modify404 = orthancResult({
      status: 404,
      ok: false,
      text: "Accessing an inexistent item",
      json: { OrthancError: "Accessing an inexistent item" },
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
      orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "study-id" } }),
      orthancResult({
        status: 200,
        ok: true,
        text: JSON.stringify({ Resources: ["bulk-modified-study-id"] }),
        json: { Resources: ["bulk-modified-study-id"] },
      }),
    ]);
    __dicomRemapTestables.setBulkModifyRouteAvailableForTests(true);

    const modifiedStudyId = await __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    });

    const bulkCall = calls.at(-1);
    assert.equal(modifiedStudyId, "bulk-modified-study-id");
    assert.equal(bulkCall?.path, "/tools/bulk-modify");
    assert.equal(bulkCall?.method, "POST");
    assert.deepEqual(bulkCall?.body, {
      Replace: {
        PatientID: "P1",
        PatientName: "Test^Patient",
        PatientSex: "M",
        PatientBirthDate: "19900101",
      },
      KeepSource: true,
      Force: true,
      Level: "Study",
      Resources: ["study-id"],
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("dicom helper: createModifiedStudyCopy reports missing source study after modify 404", async () => {
  __dicomRemapTestables.setSleepForTests(async () => {});
  const calls = queueOrthancResults([
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    ...stableStudyResponses(),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
    orthancResult({ status: 404, ok: false, text: "Not Found", json: { HttpStatus: 404 } }),
  ]);
  __dicomRemapTestables.setBulkModifyRouteAvailableForTests(false);

  await assert.rejects(
    () => __dicomRemapTestables.createModifiedStudyCopy("study-id", {
      patientId: "P1",
      patientName: "Test^Patient",
      patientSex: "M",
      patientBirthDate: "19900101",
    }),
    /Source study no longer exists in Orthanc\. Please reset and upload again\./i
  );

  assert.equal(calls[4]?.path, "/studies/study-id");
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

test("resetDicomRemapJob deletes linked source and modified studies, ignores 404, and audits", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [remapJob({
      status: "failed",
      source_orthanc_study_id: "source-study",
      modified_orthanc_study_id: "modified-study",
    })] },
    { rows: [remapJob({
      status: "cancelled",
      source_orthanc_study_id: "source-study",
      modified_orthanc_study_id: "modified-study",
      cancellation_reason: "Reset by user before retry",
    })] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { Error: "missing" } }),
  ]);

  const result = await __dicomRemapTestables.resetDicomRemapJob({
    jobId: 1,
    currentUserId: 42,
  });

  assert.equal(result.job.status, "cancelled");
  assert.equal(result.job.cancellation_reason, "Reset by user before retry");
  assert.equal(result.summary.studiesAttempted, 2);
  assert.equal(result.summary.studiesDeleted, 1);
  assert.equal(result.summary.studiesAlreadyMissing, 1);
  assert.deepEqual(calls.map((call) => call.path), ["/studies/source-study", "/studies/modified-study"]);
  assert.equal(auditEvents.length, 1);
});

test("resetDicomRemapJob fails clearly on non-404 Orthanc delete errors", async () => {
  queueQueryResults([
    { rows: [remapJob({ status: "failed", source_orthanc_study_id: "source-study" })] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 500, ok: false, text: "Orthanc down", json: { Error: "down" } }),
  ]);

  await assert.rejects(
    () => __dicomRemapTestables.resetDicomRemapJob({ jobId: 1, currentUserId: 42 }),
    (error) => {
      assert.equal(error instanceof HttpError ? error.statusCode : 0, 502);
      assert.match((error as Error).message, /Failed to delete one or more linked Orthanc studies/);
      return true;
    }
  );
});

test("resetDicomRemapJob rejects sending and sent jobs before Orthanc delete", async () => {
  for (const status of ["sending", "sent"] as const) {
    queueQueryResults([
      { rows: [remapJob({ status, source_orthanc_study_id: `${status}-source` })] },
    ]);

    await assert.rejects(
      () => __dicomRemapTestables.resetDicomRemapJob({ jobId: 1, currentUserId: 42 }),
      (error) => {
        assert.equal(error instanceof HttpError ? error.statusCode : 0, 409);
        assert.match((error as Error).message, /cannot be reset after send processing has started/);
        return true;
      }
    );
  }
});

test("clearFailedDicomRemapOrthancStudies deletes only failed and cancelled job studies", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [
      remapJob({ id: 1, status: "failed", source_orthanc_study_id: "failed-source", modified_orthanc_study_id: "failed-modified" }),
      remapJob({ id: 2, status: "cancelled", source_orthanc_study_id: "cancelled-source", modified_orthanc_study_id: "failed-source" }),
    ] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 404, ok: false, text: "missing", json: {} }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
  ]);

  const summary = await __dicomRemapTestables.clearFailedDicomRemapOrthancStudies(42);

  assert.deepEqual(calls.map((call) => call.path), [
    "/studies/failed-source",
    "/studies/failed-modified",
    "/studies/cancelled-source",
  ]);
  assert.equal(summary.studiesAttempted, 3);
  assert.equal(summary.studiesDeleted, 2);
  assert.equal(summary.studiesAlreadyMissing, 1);
  assert.equal(auditEvents.length, 1);
});

test("clearFailedDicomRemapOrthancStudies discovers missing modified studies by accession/date/modality and replacement patient", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  queueQueryResults([
    {
      rows: [
        remapJob({
          id: 1,
          status: "failed",
          source_orthanc_study_id: "source-study",
          modified_orthanc_study_id: null,
          replacement_patient_id: "RISPRO-900",
        }),
      ],
    },
  ]);

  const calls = queueOrthancResults([
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: { AccessionNumber: "ACC-42", StudyDate: "20260501" },
        PatientMainDicomTags: { PatientID: "SRC-PATIENT" },
        Series: ["src-series-1"],
      },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { MainDicomTags: { Modality: "CT" } },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "[]",
      json: ["source-study", "candidate-modified", "other-study"],
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: { AccessionNumber: "ACC-42", StudyDate: "20260501" },
        PatientMainDicomTags: { PatientID: "RISPRO-900" },
        Series: ["cand-series-1"],
      },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { MainDicomTags: { Modality: "CT" } },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: { AccessionNumber: "ACC-42", StudyDate: "20260501" },
        PatientMainDicomTags: { PatientID: "OTHER-PATIENT" },
        Series: ["other-series-1"],
      },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { MainDicomTags: { Modality: "CT" } },
    }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
  ]);

  const summary = await __dicomRemapTestables.clearFailedDicomRemapOrthancStudies(42);

  const deletePaths = calls.filter((call) => call.method === "DELETE").map((call) => call.path);
  assert.deepEqual(deletePaths, ["/studies/source-study", "/studies/candidate-modified"]);
  assert.equal(summary.studiesAttempted, 2);
  assert.equal(summary.studiesDeleted, 2);
  assert.equal(summary.studiesAlreadyMissing, 0);
});

test("hardResetOrthancStudies requires typed confirmation", async () => {
  await assert.rejects(
    () => __dicomRemapTestables.hardResetOrthancStudies(42, "delete"),
    /Typed confirmation is required/
  );
});

test("hardResetOrthancStudies deletes all Orthanc studies, marks active jobs failed, and audits", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: JSON.stringify(["study-a", "study-b"]), json: ["study-a", "study-b"] }),
    orthancResult({ status: 200, ok: true, text: "{}", json: {} }),
    orthancResult({ status: 404, ok: false, text: "missing", json: {} }),
  ]);

  const summary = await __dicomRemapTestables.hardResetOrthancStudies(42, "DELETE ALL ORTHANC STUDIES");

  assert.deepEqual(calls.map((call) => call.path), ["/studies", "/studies/study-a", "/studies/study-b"]);
  assert.equal(summary.totalOrthancStudiesFound, 2);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.alreadyMissing, 1);
  assert.deepEqual(summary.failedDeletions, []);
  assert.equal(auditEvents.length, 1);
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

test("createDicomRemapUploadJob skips DICOMDIR folder index files", async () => {
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const orthancCalls = queueOrthancResults([
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: { ID: "instance-id", ParentStudy: "study-id" },
    }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapUploadJob({
    currentUserId: 42,
    files: [
      { fileName: "DICOMDIR", mimeType: "application/octet-stream", fileContentBase64: "AA==" },
      { fileName: "image.dcm", mimeType: "application/dicom", fileContentBase64: "AA==" },
    ],
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(orthancCalls.filter((call) => call.path === "/instances").length, 1);
  assert.equal(auditEvents.length, 1);
});

test("createDicomRemapMultipartUploadJob skips sidecars and uploads accepted files without Base64", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "AUTORUN.INF", mimeType: "application/octet-stream" },
    { fileName: "DICOMDIR", mimeType: "application/octet-stream" },
    { fileName: "viewer.exe", mimeType: "application/octet-stream" },
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
    { fileName: "image-2.dcm", mimeType: "application/dicom" },
  ]);
  const auditEvents: unknown[] = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEvents.push(entry);
    return {} as never;
  });
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-id" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i2", ParentStudy: "study-id" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapMultipartUploadJob({
    currentUserId: 42,
    files: staged,
    tempDir,
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(result.skippedFilesCount, 3);
  assert.equal(calls.filter((call) => call.path === "/instances").length, 2);
  assert.equal(auditEvents.length, 1);
});

test("createDicomRemapMultipartUploadJob rejects selectedStudyInstanceUID mismatch", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-id" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {
          StudyInstanceUID: "1.2.840.study.actual",
        },
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
      selectedStudyInstanceUID: "1.2.840.study.selected",
    }),
    /Uploaded study does not match selected study\. Please rescan and retry\./
  );
});

test("createDicomRemapMultipartUploadJob skips Orthanc invalid-DICOM rejections when valid instances remain", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "opaque-support-file", mimeType: "application/octet-stream" },
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const calls = queueOrthancResults([
    orthancResult({
      status: 400,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15, Message: "Bad file format" },
    }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-id" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapMultipartUploadJob({
    currentUserId: 42,
    files: staged,
    tempDir,
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(result.skippedFilesCount, 1);
  assert.equal(calls.filter((call) => call.path === "/instances").length, 2);
});

test("createDicomRemapMultipartUploadJob fails when Orthanc accepts zero valid DICOM files", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "opaque-support-file", mimeType: "application/octet-stream" },
  ]);
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({
      status: 400,
      ok: false,
      text: "Cannot parse an invalid DICOM file",
      json: { Message: "Cannot parse an invalid DICOM file" },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /No uploadable DICOM instance files were found/
  );
});

test("createDicomRemapMultipartUploadJob still fails on Orthanc 500 upload errors", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({
      status: 500,
      ok: false,
      text: "Bad file format",
      json: { OrthancStatus: 15, Message: "Bad file format" },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /status=500/
  );
});

test("createDicomRemapMultipartUploadJob still fails on Orthanc auth-style upload errors", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm", mimeType: "application/dicom" },
  ]);
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({
      status: 401,
      ok: false,
      text: "Unauthorized",
      json: { HttpError: "Unauthorized" },
    }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /status=401/
  );
});

test("createDicomRemapMultipartUploadJob rejects multiple parent studies clearly", async () => {
  const { tempDir, staged } = await makeStagedFiles([
    { fileName: "image-1.dcm" },
    { fileName: "image-2.dcm" },
  ]);
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "study-a" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i2", ParentStudy: "study-b" } }),
  ]);

  await assert.rejects(
    () => createDicomRemapMultipartUploadJob({
      currentUserId: 42,
      files: staged,
      tempDir,
    }),
    /detected 2 studies/i
  );
});

test("createDicomRemapMultipartUploadJob handles 1000+ instances for one study", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  const fileCount = 1001;
  const { tempDir, staged } = await makeStagedFiles(
    Array.from({ length: fileCount }, (_, index) => ({ fileName: `image-${index}.dcm` }))
  );
  queueQueryResults([
    { rows: [] },
    { rows: [remapJob({ status: "uploaded" })] },
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "study-id" })] },
  ]);
  const orthancResponses = Array.from({ length: fileCount }, (_, index) => (
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: `i${index}`, ParentStudy: "study-id" } })
  ));
  orthancResponses.push(orthancResult({
    status: 200,
    ok: true,
    text: "{}",
    json: {
      MainDicomTags: {},
      PatientMainDicomTags: {
        PatientID: "P1",
        PatientName: "Original^Patient",
        PatientSex: "M",
        PatientBirthDate: "19900101",
      },
    },
  }));
  const calls = queueOrthancResults(orthancResponses);

  const result = await createDicomRemapMultipartUploadJob({
    currentUserId: 42,
    files: staged,
    tempDir,
  });

  assert.equal(result.job.source_orthanc_study_id, "study-id");
  assert.equal(calls.filter((call) => call.path === "/instances").length, fileCount);
});

test("prepareDicomRemapConfirmation marks missing source study as stale", async () => {
  queueQueryResults([
    { rows: [remapJob({ status: "uploaded", source_orthanc_study_id: "stale-study" })] },
    { rows: [] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "missing", json: { Error: "missing" } }),
  ]);

  const { prepareDicomRemapConfirmation } = await import("./dicom-remap-service.js");
  await assert.rejects(
    () => prepareDicomRemapConfirmation({
      jobId: 1,
      currentUserId: 42,
      risproPatientId: 1,
      destinationPacsKey: "1",
    }),
    /Source study no longer exists in Orthanc/
  );
});

test("createDicomRemapUploadJob marks stale active job failed and creates a fresh upload", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  queueQueryResults([
    { rows: [remapJob({ id: 9, status: "uploaded", source_orthanc_study_id: "stale-study" })] },
    { rows: [] },
    { rows: [remapJob({ id: 10, status: "uploaded", source_orthanc_study_id: null })] },
    { rows: [remapJob({ id: 10, status: "uploaded", source_orthanc_study_id: "fresh-study" })] },
  ]);
  queueOrthancResults([
    orthancResult({ status: 404, ok: false, text: "missing", json: { Error: "missing" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "i1", ParentStudy: "fresh-study" } }),
    orthancResult({
      status: 200,
      ok: true,
      text: "{}",
      json: {
        MainDicomTags: {},
        PatientMainDicomTags: {
          PatientID: "P1",
          PatientName: "Original^Patient",
          PatientSex: "M",
          PatientBirthDate: "19900101",
        },
      },
    }),
  ]);

  const result = await createDicomRemapUploadJob({
    currentUserId: 42,
    files: [{ fileName: "fresh.dcm", mimeType: "application/dicom", fileContentBase64: "AA==" }],
  });

  assert.equal(result.job.id, 10);
  assert.equal(result.job.source_orthanc_study_id, "fresh-study");
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

test("resendDicomRemapJobToPacs resends an existing remapped study and marks the job sent", async () => {
  const auditEntries: Array<Record<string, unknown>> = [];
  __dicomRemapTestables.setAuditLoggerForTests(async (entry) => {
    auditEntries.push(entry as unknown as Record<string, unknown>);
    return {} as never;
  });
  __dicomRemapTestables.setPacsNodeGetterForTests(async () => ({
    id: 1,
    called_ae_title: "DEST_AE",
    host: "127.0.0.1",
    port: 104,
    is_active: true,
  } as never));

  queueQueryResults([
    { rows: [remapJob({ id: 21, status: "failed", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1" })] },
    { rows: [remapJob({ id: 21, status: "sending", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1" })] },
    { rows: [remapJob({ id: 21, status: "sent", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1", send_result: { ok: true } })] },
  ]);

  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "modified-study" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ok: true } }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { HttpStatus: 404 } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { StoredInstances: 5 } }),
  ]);

  const result = await resendDicomRemapJobToPacs({
    jobId: 21,
    currentUserId: 42,
  });

  assert.equal(result.job.status, "sent");
  assert.equal(auditEntries.some((entry) => entry.actionType === "resend_to_pacs"), true);
});

test("resendDicomRemapJobToPacs returns friendly Orthanc send errors with technical details", async () => {
  __dicomRemapTestables.setAuditLoggerForTests(async () => ({} as never));
  __dicomRemapTestables.setPacsNodeGetterForTests(async () => ({
    id: 1,
    called_ae_title: "DEST_AE",
    host: "127.0.0.1",
    port: 104,
    is_active: true,
  } as never));
  queueQueryResults([
    { rows: [remapJob({ id: 22, status: "failed", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1" })] },
    { rows: [remapJob({ id: 22, status: "sending", source_orthanc_study_id: "source-study", modified_orthanc_study_id: "modified-study", destination_pacs_key: "1" })] },
    { rows: [] },
  ]);

  queueOrthancResults([
    orthancResult({ status: 200, ok: true, text: "{}", json: { ID: "modified-study" } }),
    orthancResult({ status: 200, ok: true, text: "{}", json: { ok: true } }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { HttpStatus: 404 } }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { HttpStatus: 404 } }),
    orthancResult({ status: 404, ok: false, text: "missing", json: { HttpStatus: 404 } }),
    orthancResult({ status: 500, ok: false, text: "store failed", json: { Message: "store failed" } }),
    orthancResult({ status: 500, ok: false, text: "store failed", json: { Message: "store failed" } }),
  ]);

  await assert.rejects(
    () => resendDicomRemapJobToPacs({
      jobId: 22,
      currentUserId: 42,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.match(error.message, /could not send the remapped study to PACS/i);
      assert.equal(Array.isArray((error.details as { attempts?: unknown[] } | undefined)?.attempts), true);
      return true;
    }
  );
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
