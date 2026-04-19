import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  __resetGetDefaultPacsNodeForTests,
  __setGetDefaultPacsNodeForTests,
  __resetDimseModuleForTests,
  __setDimseModuleForTests,
  normalizeDimseStudyList,
  resolveDefaultPacsNodeForSearch,
  testPacsConnection
} from "./pacs-service.js";

afterEach(() => {
  __resetDimseModuleForTests();
  __resetGetDefaultPacsNodeForTests();
});

test("testPacsConnection rejects URL-like PACS hosts with a clear error", async () => {
  await assert.rejects(
    testPacsConnection({
      currentUserId: null,
      overrides: {
        enabled: "enabled",
        host: "http://192.9.101.164:103",
        port: 103,
        calledAeTitle: "OSIRIXR",
        callingAeTitle: "RISPRO",
        timeoutSeconds: 10
      }
    }),
    /bare hostname or IP address/i
  );
});

test("testPacsConnection accepts hostnames with underscores", async () => {
  __setDimseModuleForTests({
    echoScu: (_options: unknown, callback: (result: string) => void) => {
      callback(JSON.stringify({ code: 0, status: "success" }));
    },
    findScu: () => {}
  });

  await assert.doesNotReject(
    testPacsConnection({
      currentUserId: null,
      overrides: {
        enabled: "enabled",
        host: "PACS_SERVER.local",
        port: 103,
        calledAeTitle: "OSIRIXR",
        callingAeTitle: "RISPRO",
        timeoutSeconds: 10
      }
    })
  );
});

test("testPacsConnection rejects invalid AE title format before native DIMSE call", async () => {
  await assert.rejects(
    testPacsConnection({
      currentUserId: null,
      overrides: {
        enabled: "enabled",
        host: "192.9.101.164",
        port: 103,
        calledAeTitle: "OSIRIXR!",
        callingAeTitle: "RISPRO",
        timeoutSeconds: 10
      }
    }),
    /A-Z, 0-9, or underscore/i
  );
});

test("testPacsConnection waits for the final DIMSE callback before deciding success", async () => {
  __setDimseModuleForTests({
    echoScu: (_options: unknown, callback: (result: string) => void) => {
      callback(JSON.stringify({ code: 1, status: "pending", message: "Requesting Association" }));
      callback(JSON.stringify({ code: 2, status: "failure", message: "Association Rejected: called AE title not recognized" }));
    },
    findScu: () => {}
  });

  await assert.rejects(
    testPacsConnection({
      currentUserId: null,
      overrides: {
        enabled: "enabled",
        host: "192.9.101.164",
        port: 103,
        calledAeTitle: "OSIRIXR",
        callingAeTitle: "RISPRO",
        timeoutSeconds: 10
      }
    }),
    /AE title rejected/i
  );
});

test("normalizeDimseStudyList supports a single DICOM dataset object payload", () => {
  const studies = normalizeDimseStudyList({
    PatientID: { Value: ["123456789012"] },
    PatientName: { Value: [{ Alphabetic: "TEST^PATIENT" }] },
    AccessionNumber: { Value: ["ACC-42"] },
    StudyDate: { Value: ["20260419"] },
    Modality: { Value: ["CT"] },
    StudyDescription: { Value: ["CT Abdomen"] }
  });

  assert.deepEqual(studies, [
    {
      patientId: "123456789012",
      patientName: "TEST^PATIENT",
      accessionNumber: "ACC-42",
      modality: "CT",
      studyDescription: "CT Abdomen",
      studyDate: "20260419"
    }
  ]);
});

test("resolveDefaultPacsNodeForSearch returns the active default PACS node", async () => {
  __setGetDefaultPacsNodeForTests(async () => ({
    id: 7,
    name: "Default PACS",
    host: "192.9.101.164",
    port: 103,
    called_ae_title: "OSIRIXR",
    calling_ae_title: "RISPRO",
    timeout_seconds: 10,
    is_active: true,
    is_default: true,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: "",
    updated_at: ""
  }));

  const node = await resolveDefaultPacsNodeForSearch();
  assert.equal(node.id, 7);
  assert.equal(node.name, "Default PACS");
  assert.equal(node.is_default, true);
});

test("resolveDefaultPacsNodeForSearch rejects when there is no active default PACS node", async () => {
  __setGetDefaultPacsNodeForTests(async () => null);

  await assert.rejects(
    resolveDefaultPacsNodeForSearch(),
    /No active default PACS node is configured/i
  );
});
