import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("server starts and stops inbound audit through a non-fatal worker lifecycle", async () => {
  const source = await readFile(new URL("./server.ts", import.meta.url), "utf8");
  assert.match(source, /startAuthoritativeOrthancInboundAuditWorker/);
  assert.match(source, /Authoritative Orthanc inbound audit worker initialization failed\. Continuing without blocking startup\./);
  assert.match(source, /authoritativeOrthancInboundAuditWorker\.stop\(\)/);
});
