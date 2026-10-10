import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createServer } from "node:http";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";

const { ImagingSourceError, NativeDicomWebSourceAdapter, proxyNativeDicomWebRequest } = await import("./adapters.js");

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
  it("cancels an upstream request before headers while retaining the source deadline and request headers", async (t) => {
    let upstreamClosed: () => void = () => {};
    let upstreamStarted: () => void = () => {};
    const closed = new Promise<void>((resolve) => { upstreamClosed = resolve; });
    const started = new Promise<void>((resolve) => { upstreamStarted = resolve; });
    const server = createServer((req, res) => {
      assert.equal(req.headers.accept, 'multipart/related; type="application/octet-stream"; transfer-syntax=*');
      assert.equal(req.headers.range, "bytes=0-1023");
      const timer = setTimeout(() => res.end("unexpected late response"), 5000);
      res.once("close", () => { clearTimeout(timer); upstreamClosed(); });
      upstreamStarted();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const controller = new AbortController();
    const request = proxyNativeDicomWebRequest({ ...endpoint(), dicomwebBaseUrl: `http://127.0.0.1:${address.port}` }, "/studies/1.2.3/metadata", {
      accept: 'multipart/related; type="application/octet-stream"; transfer-syntax=*', range: "bytes=0-1023",
    }, controller.signal);
    await started;
    controller.abort();
    await assert.rejects(request, ImagingSourceError);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([closed, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error("Canceled upstream remained open")), 1000);
      })]);
    } finally { clearTimeout(deadline); }

    let combined: AbortSignal | null | undefined;
    globalThis.fetch = async (_url, init) => { combined = init?.signal; return new Response("ok"); };
    const caller = new AbortController();
    await proxyNativeDicomWebRequest({ ...endpoint(), timeoutSeconds: 1 }, "/studies/1.2.3/metadata", {}, caller.signal);
    // The caller signal must not replace the configured source timeout.
    assert.ok(combined);
    assert.equal(combined.aborted, false);
    let timeoutDeadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([new Promise<void>((resolve) => combined!.addEventListener("abort", () => resolve(), { once: true })), new Promise<never>((_resolve, reject) => {
        timeoutDeadline = setTimeout(() => reject(new Error("Source timeout was lost")), 2000);
      })]);
    } finally { clearTimeout(timeoutDeadline); }
    assert.equal(caller.signal.aborted, false);
  });

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
