import test from "node:test";
import assert from "node:assert/strict";
import {
  __dicomRemapTestables,
  assertDicomRemapRouteAccess,
  validateDicomRemapUploadFilesInput,
  validateExplicitConfirm,
} from "./dicom-remap-service.js";

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

test("dicom helper: status transition guard throws on unexpected status", () => {
  assert.throws(
    () => __dicomRemapTestables.assertJobStatus("uploaded", "awaiting_confirmation", "bad"),
    /bad/i
  );

  assert.doesNotThrow(() => {
    __dicomRemapTestables.assertJobStatus("uploaded", "uploaded", "ok");
  });
});
