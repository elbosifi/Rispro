import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { resolveRequestScanSettingsForTest } from "./request-scan-settings-service.js";

test.after(async () => {
  await pool.end();
});

test("resolves submitted request-scan test settings without saving them", async (t) => {
  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return;
  }

  const settings = await resolveRequestScanSettingsForTest({
    enabled: true,
    server: "draft-smb-server",
    share: "draft-share",
    domain: "DRAFT",
    username: "draft-user",
    password: "draft-password",
    incomingSubfolder: "Draft/Incoming",
    processedSubfolder: "Draft/Processed",
    failedSubfolder: "Draft/Failed",
    pollingIntervalSeconds: 30,
    fileReadyDelaySeconds: 20,
  });

  assert.deepEqual(settings, {
    enabled: true,
    server: "draft-smb-server",
    share: "draft-share",
    domain: "DRAFT",
    username: "draft-user",
    password: "draft-password",
    incomingSubfolder: "Draft/Incoming",
    processedSubfolder: "Draft/Processed",
    failedSubfolder: "Draft/Failed",
    pollingIntervalSeconds: 30,
    fileReadyDelaySeconds: 20,
  });
});
