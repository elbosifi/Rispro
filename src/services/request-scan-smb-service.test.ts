import assert from "node:assert/strict";
import test from "node:test";
import { classifyRequestScanSmbError } from "./request-scan-smb-service.js";

test("Request Scan SMB error classification distinguishes missing sources from storage failures", () => {
  assert.equal(classifyRequestScanSmbError(Object.assign(new Error("missing"), { code: "ENOENT" })), "source_missing");
  assert.equal(classifyRequestScanSmbError({ status: "NT_STATUS_NO_SUCH_FILE" }), "source_missing");
  assert.equal(classifyRequestScanSmbError(new Error("authentication failed")), "smb_storage");
});
