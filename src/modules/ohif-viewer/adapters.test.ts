import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";

const { ImagingSourceError, NativeDicomWebSourceAdapter } = await import("./adapters.js");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.TEST_OHIF_USER;
  delete process.env.TEST_OHIF_PASSWORD;
});

function endpoint(authType: "none" | "basic" = "none") {
  return {
    id: 1, pacsNodeId: 2, enabled: true, dicomwebBaseUrl: "https://pacs.test/dicom-web",
    qidoRoot: "https://pacs.test/dicom-web", wadoRsRoot: "https://pacs.test/dicom-web", wadoUriRoot: null,
    stowRoot: null, authType, usernameEnvKey: authType === "basic" ? "TEST_OHIF_USER" : null,
    passwordEnvKey: authType === "basic" ? "TEST_OHIF_PASSWORD" : null, bearerTokenEnvKey: null,
    verifyTls: true, timeoutSeconds: 5, osirixVersion: null, dicomwebServerEnabled: true,
    lastTestedAt: null, lastTestStatus: null, lastTestMessage: null, qidoLastStatus: null,
    wadoMetadataLastStatus: null, wadoFrameLastStatus: null, authenticationLastStatus: null,
    tlsLastStatus: null, corsLastStatus: null,
  };
}

describe("NativeDicomWebSourceAdapter", () => {
  it("performs exact-accession QIDO and maps DICOM JSON including StudyInstanceUID", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify([{
        "00100020": { vr: "LO", Value: ["P-42"] }, "00080050": { vr: "SH", Value: ["ACC-42"] },
        "00080061": { vr: "CS", Value: ["CT"] }, "00080020": { vr: "DA", Value: ["20260712"] },
        "00081030": { vr: "LO", Value: ["CT brain"] }, "0020000D": { vr: "UI", Value: ["1.2.840.42"] },
      }]), { status: 200, headers: { "Content-Type": "application/dicom+json" } });
    };
    const studies = await new NativeDicomWebSourceAdapter(endpoint()).searchStudyByAccession("ACC-42");
    assert.match(requestedUrl, /AccessionNumber=ACC-42/);
    assert.equal(studies[0]?.patientId, "P-42");
    assert.equal(studies[0]?.studyInstanceUid, "1.2.840.42");
  });

  it("adds environment-backed Basic auth server-side and classifies authentication failure", async () => {
    process.env.TEST_OHIF_USER = "viewer";
    process.env.TEST_OHIF_PASSWORD = "secret";
    let authorization = "";
    globalThis.fetch = async (_input, init) => {
      authorization = String((init?.headers as Record<string, string>)?.Authorization || "");
      return new Response("denied", { status: 401 });
    };
    const adapter = new NativeDicomWebSourceAdapter(endpoint("basic"));
    await assert.rejects(() => adapter.testConnection(), (error: unknown) => {
      assert.ok(error instanceof ImagingSourceError);
      assert.equal(error.category, "authentication");
      return true;
    });
    assert.equal(authorization, `Basic ${Buffer.from("viewer:secret").toString("base64")}`);
  });
});

const { AuthoritativeOrthancSourceAdapter } = await import("./adapters.js");
const archive = {
  enabled: true, baseUrl: "http://authoritative.test:8042", username: "archive-reader", password: "archive-secret",
  verifyTls: true, timeoutSeconds: 5, displayName: "Primary archive", autoExportClinicalDocuments: false,
  autoRouteEnabled: false, autoRouteDestinationKey: "", autoRouteDestinationKeys: [],
};

describe("AuthoritativeOrthancSourceAdapter", () => {
  it("reads current studies, priors, metadata, and frames directly with archive credentials", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url: String(input), method: init?.method || "GET" });
      assert.equal(url.origin, archive.baseUrl);
      assert.equal(new Headers(init?.headers).get("Authorization"), `Basic ${Buffer.from("archive-reader:archive-secret").toString("base64")}`);
      if (url.pathname.endsWith("/frames/1")) return new Response(new Uint8Array([1, 2, 3]));
      if (url.pathname === "/system") return Response.json({ Version: "1.12" });
      if (url.pathname.endsWith("/metadata")) return Response.json([{ "0020000D": { Value: ["1.2.42"] } }]);
      assert.equal(url.pathname, "/dicom-web/studies");
      return Response.json([{ "00080050": { Value: ["ACC-42"] }, "00100020": { Value: ["P-42"] }, "0020000D": { Value: ["1.2.42"] } }]);
    };
    const adapter = new AuthoritativeOrthancSourceAdapter(archive);
    assert.equal(adapter.strategy, "authoritative_orthanc");
    assert.equal((await adapter.searchStudyByAccession("ACC-42"))[0]?.studyInstanceUid, "1.2.42");
    assert.equal((await adapter.searchStudiesByPatient("P-42"))[0]?.patientId, "P-42");
    assert.equal(await adapter.verifyStudyAvailable("1.2.42"), true);
    assert.equal((await adapter.getStudyMetadata("1.2.42") as unknown[]).length, 1);
    assert.equal((await adapter.testFrameRetrieval("1.2.42", "1.2.43", "1.2.44")).bytes, 3);
    assert.equal((await adapter.testConnection()).ok, true);
    assert.ok(calls.some(({ url }) => new URL(url).searchParams.get("AccessionNumber") === "ACC-42"));
    assert.ok(calls.some(({ url }) => new URL(url).searchParams.get("PatientID") === "P-42"));
    assert.ok(calls.every(({ method }) => method === "GET"));
    assert.equal("requestStudyRetrieval" in adapter, false);
    assert.equal("deleteOwnedCacheStudy" in adapter, false);
  });

  it("rejects disabled or missing archive configuration before sending requests", () => {
    globalThis.fetch = async () => { throw new Error("Unexpected source request"); };
    assert.throws(() => new AuthoritativeOrthancSourceAdapter({ ...archive, enabled: false }), /Enable and configure Authoritative Orthanc/);
    assert.throws(() => new AuthoritativeOrthancSourceAdapter({ ...archive, baseUrl: "" }), /Enable and configure Authoritative Orthanc/);
  });

  it("reports archive authentication failures without falling back to another source", async () => {
    let count = 0;
    globalThis.fetch = async (input) => {
      assert.equal(new URL(String(input)).origin, archive.baseUrl);
      count++;
      return new Response("denied", { status: 401 });
    };
    await assert.rejects(() => new AuthoritativeOrthancSourceAdapter(archive).searchStudyByAccession("ACC-42"), (error: unknown) => {
      assert.ok(error instanceof ImagingSourceError);
      assert.equal(error.category, "authentication");
      return true;
    });
    assert.equal(count, 1);
  });
});
