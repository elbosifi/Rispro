import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

const service = await import("./orthanc-pacs-service.js");

beforeEach(() => {
  service.__setOrthancPacsSettingsForTests({
    enabled: true,
    shadowMode: false,
    connectionMode: "internal",
    baseUrl: "http://orthanc:8042",
    username: "",
    password: "",
    timeoutSeconds: 10,
    verifyTls: true,
    sendOnlyWhenPatientEntersQueue: false,
    worklistTarget: "",
    strategyPreference: "put_first",
    mwlCompatibility: {},
  });
  service.__setOrthancPacsAuditLoggerForTests(async () => null);
});

afterEach(() => {
  service.__resetOrthancPacsFetchForTests();
  service.__resetOrthancPacsSettingsForTests();
  service.__resetOrthancPacsAuditLoggerForTests();
});

function orthancResponse(json: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: JSON.stringify(json),
    json,
  };
}

test("remote PACS search maps Orthanc DICOM tag JSON into study details", async () => {
  service.__setOrthancPacsFetchForTests(async (path) => {
    if (path === "/modalities/iMac/query") return orthancResponse({ ID: "query-1" });
    if (path === "/queries/query-1/answers") return orthancResponse(["2"]);
    if (path === "/queries/query-1/answers/2/content") {
      return orthancResponse({
        "0010,0010": { Name: "PatientName", Type: "String", Value: [{ Alphabetic: "DOE^JANE" }] },
        "0010,0020": { Name: "PatientID", Type: "String", Value: ["MRN-7"] },
        "0008,0050": { Name: "AccessionNumber", Type: "String", Value: ["ACC-7"] },
        "0008,0020": { Name: "StudyDate", Type: "String", Value: ["20260505"] },
        "0008,0061": { Name: "ModalitiesInStudy", Type: "String", Value: ["CT"] },
        "0008,1030": { Name: "StudyDescription", Type: "String", Value: ["Chest CT"] },
        "0020,000D": { Name: "StudyInstanceUID", Type: "String", Value: ["1.2.3.4"] },
      });
    }
    throw new Error(`Unexpected path ${path}`);
  });

  const result = await service.searchOrthancPacsStudies({
    targetKey: "iMac",
    criteria: { patientName: "Jane" },
    currentUserId: null,
  });

  assert.equal(result.studies.length, 1);
  assert.deepEqual(result.studies[0], {
    patientId: "MRN-7",
    patientName: "DOE^JANE",
    accessionNumber: "ACC-7",
    modality: "CT",
    description: "Chest CT",
    studyDescription: "Chest CT",
    studyDate: "20260505",
    studyInstanceUid: "1.2.3.4",
  });
});

test("remote PACS search preserves StudyInstanceUID and straight store sends raw DICOM", async () => {
  const calls: Array<{ path: string; options?: { body?: unknown; contentType?: string } }> = [];
  const bytes = Buffer.from([0, 1, 2, 3]);
  service.__setOrthancPacsFetchForTests(async (path, options) => {
    calls.push({ path, options });
    if (path === "/modalities/OSIRIX_IMAC/query") return orthancResponse({ ID: "query-uid" });
    if (path === "/queries/query-uid/answers") return orthancResponse([]);
    if (path === "/modalities/OSIRIX_IMAC/store-straight") return orthancResponse({});
    throw new Error(`Unexpected path ${path}`);
  });
  await service.searchOrthancPacsStudies({ targetKey: "OSIRIX_IMAC", criteria: { studyInstanceUid: "1.2.840.7" }, currentUserId: null });
  await service.storeDicomStraightToOrthancPacs({ targetKey: "OSIRIX_IMAC", dicomBytes: bytes });
  const query = calls.find((call) => call.path.endsWith("/query"));
  assert.equal((query?.options?.body as { Query: { StudyInstanceUID: string } }).Query.StudyInstanceUID, "1.2.840.7");
  const store = calls.find((call) => call.path.endsWith("/store-straight"));
  assert.equal(store?.options?.body, bytes);
  assert.equal(store?.options?.contentType, "application/dicom");
});
