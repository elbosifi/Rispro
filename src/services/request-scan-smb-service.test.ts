import assert from "node:assert/strict";
import test from "node:test";
import { classifyRequestScanSmbError, reconcileRequestScanMove, requestScanArchivePath } from "./request-scan-smb-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";

test("Request Scan SMB error classification distinguishes missing sources from storage failures", () => {
  assert.equal(classifyRequestScanSmbError(Object.assign(new Error("missing"), { code: "ENOENT" })), "source_missing");
  assert.equal(classifyRequestScanSmbError({ status: "NT_STATUS_NO_SUCH_FILE" }), "source_missing");
  assert.equal(classifyRequestScanSmbError(new Error("authentication failed")), "smb_storage");
});

const settings = { server: "test", share: "share", username: "user", password: "pass", domain: "" } as RequestScanSettings;
function smbState(initial: string[]) {
  const files = new Set(initial); const commands: string[] = [];
  return { files, commands, dependencies: { async execFile(_command: string, args: string[]) {
    const command = args[args.indexOf("-c") + 1] || ""; commands.push(command);
    const paths = [...command.matchAll(/"([^"]+)"/g)].map((match) => match[1].replace(/\\\\/g, "\\"));
    if (command.startsWith("allinfo")) { if (!files.has(paths[0])) throw Object.assign(new Error("NT_STATUS_OBJECT_NAME_NOT_FOUND"), { stderr: "NT_STATUS_OBJECT_NAME_NOT_FOUND" }); return {}; }
    if (command.startsWith("rename")) { files.delete(paths[0]); files.add(paths[1]); return {}; }
    return {};
  } } };
}

test("Request Scan archive paths are deterministic and job-specific", () => {
  assert.equal(requestScanArchivePath("Processed", 7, "scan.pdf"), "Processed\\7-scan.pdf");
  assert.notEqual(requestScanArchivePath("Processed", 7, "scan.pdf"), requestScanArchivePath("Processed", 8, "scan.pdf"));
});

test("Request Scan SMB reconciliation covers all source and destination states", async () => {
  const source = "Incoming\\scan.pdf"; const destination = "Processed\\7-scan.pdf";
  const movable = smbState([source]); assert.equal(await reconcileRequestScanMove(settings, source, destination, movable.dependencies), "moved"); assert.equal(movable.files.has(destination), true);
  const moved = smbState([destination]); assert.equal(await reconcileRequestScanMove(settings, source, destination, moved.dependencies), "already_moved");
  const conflict = smbState([source, destination]); assert.equal(await reconcileRequestScanMove(settings, source, destination, conflict.dependencies), "conflict"); assert.equal(conflict.commands.some((command) => command.startsWith("rename")), false);
  const missing = smbState([]); assert.equal(await reconcileRequestScanMove(settings, source, destination, missing.dependencies), "missing");
});
