import test from "node:test";
import assert from "node:assert/strict";
import {
  dismissPatientDuplicateCandidate,
  getPatientDuplicateDetail,
  mergePatientDuplicateGroup,
  safeDeleteDuplicatePatient,
} from "./patient-duplicate-service.js";

const targetPatientId = 101;
const sourcePatientId = 202;

test("mergePatientDuplicateGroup rejects an invalid target patient id", async () => {
  await assert.rejects(
    () => mergePatientDuplicateGroup(0, [sourcePatientId], "MERGE", null),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "targetPatientId is required.");
      return true;
    }
  );
});

test("mergePatientDuplicateGroup rejects source lists without another valid patient", async () => {
  await assert.rejects(
    () => mergePatientDuplicateGroup(targetPatientId, [targetPatientId, 0, "invalid"], "MERGE", null),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "Choose at least one source patient to merge.");
      return true;
    }
  );
});

test("mergePatientDuplicateGroup requires explicit MERGE confirmation", async () => {
  await assert.rejects(
    () => mergePatientDuplicateGroup(targetPatientId, [sourcePatientId], "merge patients", null),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "confirmationText must be MERGE.");
      return true;
    }
  );
});

test("safeDeleteDuplicatePatient rejects an invalid patient id", async () => {
  await assert.rejects(
    () => safeDeleteDuplicatePatient(0, "DELETE", null),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "patientId is required.");
      return true;
    }
  );
});

test("safeDeleteDuplicatePatient requires explicit DELETE confirmation", async () => {
  await assert.rejects(
    () => safeDeleteDuplicatePatient(targetPatientId, "delete patient", null),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "confirmationText must be DELETE.");
      return true;
    }
  );
});

test("getPatientDuplicateDetail rejects an invalid patient pair before querying the database", async () => {
  await assert.rejects(
    () => getPatientDuplicateDetail(0, sourcePatientId),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "Both patient ids are required.");
      return true;
    }
  );
});

test("getPatientDuplicateDetail rejects the same patient record twice before querying the database", async () => {
  await assert.rejects(
    () => getPatientDuplicateDetail(targetPatientId, targetPatientId),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "Choose two different patient records.");
      return true;
    }
  );
});

test("dismissPatientDuplicateCandidate rejects a non-positive second patient id before querying the database", async () => {
  await assert.rejects(
    () => dismissPatientDuplicateCandidate(targetPatientId, 0, null, null),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 400);
      assert.equal((error as Error).message, "Both patient ids are required.");
      return true;
    }
  );
});
