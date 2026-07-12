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
