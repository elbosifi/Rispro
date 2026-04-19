import test from "node:test";
import assert from "node:assert/strict";
import { testPacsConnection } from "./pacs-service.js";

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
