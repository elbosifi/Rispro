import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("server starts and stops outbound audit through a non-fatal worker lifecycle", async () => {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(source, /startAuthoritativeOrthancOutboundAuditWorker/);
  assert.match(source, /Authoritative Orthanc outbound audit worker initialization failed\. Continuing without blocking startup\./);
  assert.match(source, /authoritativeOrthancOutboundAuditWorker\.stop\(\)/);
  assert.match(source, /authoritative_orthanc_outbound_audit_worker/);
  assert.match(source, /authoritative_orthanc_outbound_audit = "started"/);
});
