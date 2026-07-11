import { __setOrthancPacsFetchForTests, __setOrthancPacsSettingsForTests } from "./orthanc-pacs-service.js";
import { __dicomRemapTestables } from "./dicom-remap-service.js";
import { runDicomRemapProcessingWorkerTick } from "./dicom-remap-processing-worker.js";

const orthancUrl = process.argv[process.argv.indexOf("--orthanc-url") + 1];
const owner = process.argv[process.argv.indexOf("--owner") + 1] || `crash-child-${process.pid}`;
if (!orthancUrl) throw new Error("--orthanc-url is required");

async function requestOrthanc(requestPath: string, options: { method?: string; body?: unknown } = {}) {
  const rawBody = options.body;
  const body = Buffer.isBuffer(rawBody) ? new Uint8Array(rawBody) : rawBody as BodyInit | null | undefined;
  const response = await fetch(`${orthancUrl.replace(/\/$/, "")}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`, {
    method: options.method || "GET",
    body,
    headers: rawBody && !Buffer.isBuffer(rawBody) ? { "Content-Type": "application/json" } : undefined,
  });
  const text = await response.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, ok: response.ok, text, json };
}

const fakeSettings = {
  enabled: false,
  shadowMode: false,
  connectionMode: "external",
  baseUrl: orthancUrl,
  username: "",
  password: "",
  timeoutSeconds: 5,
  verifyTls: false,
  sendOnlyWhenPatientEntersQueue: false,
  worklistTarget: "",
  strategyPreference: "put_first",
  mwlCompatibility: { enabledTags: [], extraTags: [] },
} as never;

__dicomRemapTestables.setOrthancFetchForTests(requestOrthanc as never);
__setOrthancPacsFetchForTests(requestOrthanc as never);
__setOrthancPacsSettingsForTests(fakeSettings);
__dicomRemapTestables.setAfterRemappedInstanceUploadForTests(async ({ fileIndex }) => {
  if (fileIndex === 1) process.kill(process.pid, "SIGKILL");
});

await runDicomRemapProcessingWorkerTick({ owner, batchSize: 1, leaseSeconds: 30 });
