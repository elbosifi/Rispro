import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyRequestScanSmbError, downloadRequestScanFile, listRequestScanFiles, moveRequestScanFile, reconcileRequestScanMove, requestScanArchivePath, testRequestScanSmb, validateRequestScanRemoteFilename } from "./request-scan-smb-service.js";
import { classifySmbError } from "./backup-v3-smb-destination.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";

function hasOperation(command: string, name: string): boolean {
  return command.split(/;\s*/).some((operation) => operation.startsWith(`${name} `));
}

test("Request Scan SMB error classification distinguishes missing sources from storage failures", () => {
  assert.equal(classifyRequestScanSmbError(Object.assign(new Error("missing"), { code: "ENOENT" })), "source_missing");
  assert.equal(classifyRequestScanSmbError({ status: "NT_STATUS_NO_SUCH_FILE" }), "source_missing");
  assert.equal(classifyRequestScanSmbError(new Error("authentication failed")), "smb_storage");
});
test("SMB metadata probes preserve machine-readable missing classification without masking operational failures", () => {
  for (const status of ["NT_STATUS_OBJECT_NAME_NOT_FOUND", "NT_STATUS_OBJECT_PATH_NOT_FOUND", "NT_STATUS_NO_SUCH_FILE"]) {
    assert.equal(classifySmbError(Object.assign(new Error(status), { stderr: status }), "metadata_probe").smbCode, "not_found");
  }
  assert.equal(classifySmbError(new Error("NT_STATUS_LOGON_FAILURE"), "metadata_probe").smbCode, "authentication");
  assert.equal(classifySmbError(new Error("NT_STATUS_ACCESS_DENIED"), "metadata_probe").smbCode, "permission");
  assert.equal(classifySmbError(Object.assign(new Error("connect failed"), { code: "EHOSTUNREACH" }), "metadata_probe").smbCode, "network");
});

const settings = { server: "test", share: "share", username: "user", password: "pass", domain: "" } as RequestScanSettings;
function smbState(initial: Record<string, string>, options: { deleteFails?: boolean; hideDestinationAfterDelete?: boolean; renameStatus?: string; renameLeavesDestination?: string; uploadedBody?: string; destinationDisappearsOnDownload?: boolean; destinationDisappearsBeforeDelete?: boolean; failReprobe?: boolean; existingDirectories?: boolean; zeroExitStatus?: string } = {}) {
  const files = new Map(Object.entries(initial).map(([name, value]) => [name, Buffer.from(value)])); const commands: string[] = []; let destinationDownloaded = false;
  const quoted = (command: string) => [...command.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1"));
  const resolve = (cwd: string, value: string) => path.win32.normalize(path.win32.join("\\", cwd, value)).replace(/^\\+/, "");
  const missing = () => Object.assign(new Error("NT_STATUS_OBJECT_NAME_NOT_FOUND"), { stderr: "NT_STATUS_OBJECT_NAME_NOT_FOUND" });
  return { files, commands, dependencies: { async execFile(_command: string, args: string[]) {
    const command = args[args.indexOf("-c") + 1] || ""; commands.push(command);
    let cwd = "";
    let result: { stdout?: string; stderr?: string } = {};
    for (const operation of command.split(/;\s*/)) {
      const paths = quoted(operation);
      if (operation.startsWith("cd ")) { cwd = resolve(cwd, paths[0]!); continue; }
      if (operation.startsWith("mkdir ")) {
        if (options.existingDirectories) throw Object.assign(new Error("NT_STATUS_OBJECT_NAME_COLLISION"), { stderr: "NT_STATUS_OBJECT_NAME_COLLISION" });
        continue;
      }
      if (operation.startsWith("allinfo ")) {
        if (options.failReprobe && commands.some((value) => value.includes("rename "))) throw Object.assign(new Error("connection failed"), { code: "EHOSTUNREACH" });
        const remote = resolve(cwd, paths[0]!);
        if (options.destinationDisappearsBeforeDelete && destinationDownloaded && remote.includes("Processed")) files.delete(remote);
        if (!files.has(remote)) throw missing();
        result = { stdout: `size: ${files.get(remote)!.length}` };
        continue;
      }
      if (operation.startsWith("rename ")) {
        const source = resolve(cwd, paths[0]!); const destination = resolve(cwd, paths[1]!);
        if (options.renameStatus) {
          if (options.renameLeavesDestination != null) files.set(destination, Buffer.from(options.renameLeavesDestination));
          throw Object.assign(new Error(options.renameStatus), { stderr: options.renameStatus });
        }
        const body = files.get(source); if (!body) throw missing();
        files.delete(source); files.set(destination, body);
        continue;
      }
      if (operation.startsWith("put ")) {
        const remote = resolve(cwd, paths[1]!);
        files.set(remote, options.uploadedBody == null ? await fs.readFile(paths[0]!) : Buffer.from(options.uploadedBody));
        continue;
      }
      if (operation.startsWith("del ")) {
        if (options.deleteFails) throw new Error("permission denied");
        files.delete(resolve(cwd, paths[0]!));
        if (options.hideDestinationAfterDelete) files.delete("Processed\\7-scan.pdf");
      }
    }
    return options.zeroExitStatus ? { ...result, stderr: options.zeroExitStatus } : result;
  }, async downloadFile(_command: string, args: string[], _options: unknown, localPath: string) {
    const command = args[args.indexOf("-c") + 1] || ""; commands.push(command);
    let cwd = ""; let remote: string | undefined;
    for (const operation of command.split(/;\s*/)) {
      const paths = quoted(operation);
      if (operation.startsWith("cd ")) cwd = resolve(cwd, paths[0]!);
      if (operation.startsWith("get ")) remote = resolve(cwd, paths[0]!);
    }
    if (options.destinationDisappearsOnDownload && remote?.includes("Processed")) { files.delete(remote); throw Object.assign(new Error("NT_STATUS_OBJECT_NAME_NOT_FOUND"), { stderr: "NT_STATUS_OBJECT_NAME_NOT_FOUND" }); }
    if (remote?.includes("Processed")) destinationDownloaded = true;
    const body = remote ? files.get(remote) : undefined; if (!body) throw missing();
    await fs.writeFile(localPath, body);
  } } };
}

test("Request Scan archive paths are deterministic and job-specific", () => {
  assert.equal(requestScanArchivePath("Processed", 7, "scan.pdf"), "Processed\\7-scan.pdf");
  assert.notEqual(requestScanArchivePath("Processed", 7, "scan.pdf"), requestScanArchivePath("Processed", 8, "scan.pdf"));
});
test("Request Scan SMB filenames accept normalized Unicode and reject unsafe names", () => {
  assert.equal(validateRequestScanRemoteFilename("تقرير أشعة.pdf"), "تقرير أشعة.pdf");
  for (const value of [".", "..", "bad/name.pdf", "bad\\name.pdf", "bad?.pdf", "bad|name.pdf", "bad.pdf ", "bad.pdf.", "bad\r\nname.pdf"]) assert.throws(() => validateRequestScanRemoteFilename(value), /unsafe/);
});
test("Request Scan SMB listing, download, and move preserve quoted Arabic filenames", async () => {
  const arabic = "تقرير أشعة.pdf"; const source = `Requests\\Incoming\\${arabic}`; const state = smbState({ [source]: "arabic bytes" });
  const listing = await listRequestScanFiles({ ...settings, incomingSubfolder: "Requests\\Incoming" }, { ...state.dependencies, async execFile(command, args, options) {
    const smbCommand = args[args.indexOf("-c") + 1] || "";
    if (smbCommand.includes("; ls")) return { stdout: `  ${arabic}  A  12  Wed Jul 24 10:00:00 2026` };
    return state.dependencies.execFile(command, args);
  } });
  assert.equal(listing[0]?.filename, arabic);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "request-scan-arabic-test-"));
  try {
    const local = path.join(temp, "copy.pdf"); await downloadRequestScanFile(settings, source, local, state.dependencies); assert.equal(await fs.readFile(local, "utf8"), "arabic bytes");
    const moved = await moveRequestScanFile(settings, source, "Requests\\Processed", arabic, state.dependencies); assert.equal(moved, `Requests\\Processed\\${arabic}`); assert.equal(state.files.has(moved), true);
    assert.equal(state.commands.some((command) => command.startsWith('cd "Requests\\\\Incoming"; get "')), true);
    assert.equal(state.commands.some((command) => command.startsWith('get "Requests\\\\Incoming')), false);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});

test("Request Scan SMB reconciliation covers all source and destination states", async () => {
  const source = "Incoming\\scan.pdf"; const destination = "Processed\\7-scan.pdf";
  const movable = smbState({ [source]: "source" }); assert.equal(await reconcileRequestScanMove(settings, source, destination, movable.dependencies), "moved"); assert.equal(movable.files.has(destination), true);
  const moved = smbState({ [destination]: "archive" }); assert.equal(await reconcileRequestScanMove(settings, source, destination, moved.dependencies), "already_moved");
  const differentSize = smbState({ [source]: "short", [destination]: "longer" }); assert.equal(await reconcileRequestScanMove(settings, source, destination, differentSize.dependencies), "conflict");
  const differentHash = smbState({ [source]: "aaaa", [destination]: "bbbb" }); assert.equal(await reconcileRequestScanMove(settings, source, destination, differentHash.dependencies), "conflict");
  const identical = smbState({ [source]: "same", [destination]: "same" }); assert.equal(await reconcileRequestScanMove(settings, source, destination, identical.dependencies), "identical_source_removed"); assert.equal(identical.files.has(source), false); assert.equal(identical.files.get(destination)?.toString(), "same");
  const missing = smbState({}); assert.equal(await reconcileRequestScanMove(settings, source, destination, missing.dependencies), "missing");
  const deleteFailure = smbState({ [source]: "same", [destination]: "same" }, { deleteFails: true }); await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, deleteFailure.dependencies));
  const verifyFailure = smbState({ [source]: "same", [destination]: "same" }, { hideDestinationAfterDelete: true }); await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, verifyFailure.dependencies), /verification failed/);
});
test("Request Scan SMB rename fallback is limited and verifies copy before deleting source", async () => {
  const source = "Incoming\\scan.pdf"; const destination = "Processed\\7-scan.pdf";
  for (const status of ["NT_STATUS_NOT_SUPPORTED", "NT_STATUS_INVALID_PARAMETER", "NT_STATUS_UNEXPECTED_IO_ERROR", "NT_STATUS_OBJECT_NAME_NOT_FOUND"]) {
    const state = smbState({ [source]: "source" }, { renameStatus: status });
    assert.equal(await reconcileRequestScanMove(settings, source, destination, state.dependencies), "moved");
    assert.equal(state.files.has(source), false); assert.equal(state.files.get(destination)?.toString(), "source");
    assert.equal(state.commands.some((command) => hasOperation(command, "put")), true);
    const destinationDownload = state.commands.findIndex((command) => hasOperation(command, "get") && command.includes("Processed"));
    const sourceDeletion = state.commands.findIndex((command) => hasOperation(command, "del") && command.includes("Incoming"));
    assert.equal(destinationDownload >= 0 && sourceDeletion > destinationDownload, true);
  }
  for (const status of ["NT_STATUS_LOGON_FAILURE", "NT_STATUS_ACCESS_DENIED", "EHOSTUNREACH", "ETIMEDOUT", "NT_STATUS_DISK_FULL"]) {
    const state = smbState({ [source]: "source" }, { renameStatus: status });
    await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, state.dependencies));
    assert.equal(state.commands.some((command) => hasOperation(command, "put")), false);
    assert.equal(state.files.has(source), true);
  }
  const uncertain = smbState({ [source]: "source" }, { renameStatus: "NT_STATUS_NOT_SUPPORTED", failReprobe: true });
  await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, uncertain.dependencies));
  assert.equal(uncertain.commands.some((command) => hasOperation(command, "put")), false);
  const unknownWithDestination = smbState({ [source]: "source" }, { renameStatus: "unclassified rename failure", renameLeavesDestination: "different" });
  await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, unknownWithDestination.dependencies));
  assert.equal(unknownWithDestination.commands.some((command) => hasOperation(command, "put")), false);
  assert.equal(unknownWithDestination.files.has(source), true);
});
test("Request Scan SMB fallback failures preserve source and any uploaded destination", async () => {
  const source = "Incoming\\scan.pdf"; const destination = "Processed\\7-scan.pdf";
  const hashMismatch = smbState({ [source]: "source" }, { renameStatus: "NT_STATUS_NOT_SUPPORTED", uploadedBody: "different" });
  await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, hashMismatch.dependencies), /verification failed/);
  assert.equal(hashMismatch.files.has(source), true); assert.equal(hashMismatch.files.has(destination), true);
  const disappeared = smbState({ [source]: "source" }, { renameStatus: "NT_STATUS_INVALID_PARAMETER", destinationDisappearsOnDownload: true });
  await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, disappeared.dependencies));
  assert.equal(disappeared.files.has(source), true);
  const disappearedBeforeDelete = smbState({ [source]: "source" }, { renameStatus: "NT_STATUS_NOT_SUPPORTED", destinationDisappearsBeforeDelete: true });
  await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, disappearedBeforeDelete.dependencies), /disappeared before source deletion/);
  assert.equal(disappearedBeforeDelete.files.has(source), true);
  const deletionFailure = smbState({ [source]: "source" }, { renameStatus: "NT_STATUS_NOT_SUPPORTED", deleteFails: true });
  await assert.rejects(() => reconcileRequestScanMove(settings, source, destination, deletionFailure.dependencies));
  assert.equal(deletionFailure.files.has(source), true); assert.equal(deletionFailure.files.get(destination)?.toString(), "source");
});
test("Request Scan SMB diagnostics retain sanitized rename status without paths and record fallback result", async () => {
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  const source = "Incoming\\patient-name.pdf"; const destination = "Processed\\7-patient-name.pdf";
  const state = smbState({ [source]: "source" }, { renameStatus: "noise NT_STATUS_NOT_SUPPORTED /secret/patient-name.pdf" });
  assert.equal(await reconcileRequestScanMove(settings, source, destination, state.dependencies, { jobId: 7, logDiagnostic(event, metadata) { diagnostics.push({ event, metadata }); } }), "moved");
  const rename = diagnostics.find((value) => value.metadata.operation === "rename");
  assert.equal(rename?.metadata.smbCode, "unknown"); assert.equal(rename?.metadata.nativeStatus, "NT_STATUS_NOT_SUPPORTED");
  assert.equal(diagnostics.filter((value) => value.event === "request_scan_smb_failure").length, 1);
  assert.deepEqual(diagnostics.at(-1)?.metadata.result, "moved"); assert.equal(diagnostics.at(-1)?.metadata.fallbackUsed, true);
  const serialized = JSON.stringify(diagnostics);
  assert.equal(serialized.includes("patient-name"), false); assert.equal(serialized.includes("/secret"), false);
  assert.equal(serialized.includes("noise"), false);
});
test("Request Scan SMB native status extraction accepts only strict NT_STATUS tokens", () => {
  assert.equal(classifySmbError(Object.assign(new Error("x"), { stderr: "prefix NT_STATUS_INVALID_PARAMETER suffix" }), "transfer").nativeStatus, "NT_STATUS_INVALID_PARAMETER");
  assert.equal(classifySmbError(Object.assign(new Error("x"), { stderr: "NT_STATUS_ACCESS-DENIED" }), "transfer").nativeStatus, undefined);
  assert.equal(classifySmbError(Object.assign(new Error("x"), { stderr: "status=INVALID_PARAMETER" }), "transfer").nativeStatus, undefined);
  assert.equal(classifySmbError(Object.assign(new Error("x"), { stdout: "NT_STATUS_DISK_FULL" }), "transfer").smbCode, "storage_full");
});
test("Request Scan full connection test archives and removes its synthetic artifact", async () => {
  const state = smbState({});
  await testRequestScanSmb({ ...settings, incomingSubfolder: "Requests\\Incoming", processedSubfolder: "Requests\\Processed", failedSubfolder: "Requests\\Failed" }, state.dependencies);
  assert.equal([...state.files.keys()].some((name) => name.includes(".rispro-request-scan-workflow-")), false);
  assert.equal(state.commands.some((command) => command.startsWith('cd "Requests\\\\Incoming"; put "') && !command.includes('put "Requests\\\\Incoming')), true);
  assert.equal(state.commands.some((command) => command.startsWith('cd "Requests\\\\Incoming"; allinfo "')), true);
  assert.equal(state.commands.some((command) => command.startsWith('cd "Requests\\\\Incoming"; rename "') && command.includes("..\\\\Processed")), true);
  assert.equal(state.commands.some((command) => command.startsWith('cd "Requests\\\\Processed') && hasOperation(command, "del")), true);
});
test("Request Scan full connection test accepts pre-existing directories", async () => {
  const state = smbState({}, { existingDirectories: true });
  await testRequestScanSmb({ ...settings, incomingSubfolder: "Requests\\Incoming", processedSubfolder: "Requests\\Processed", failedSubfolder: "Requests\\Failed" }, state.dependencies);
  assert.equal([...state.files.keys()].some((name) => name.includes(".rispro-request-scan-workflow-")), false);
  assert.equal(state.commands.some((command) => command === 'cd "Requests\\\\Incoming"'), true);
});
test("smbclient exit-zero native failures are classified and stop the workflow", async () => {
  const state = smbState({}, { zeroExitStatus: "NT_STATUS_ACCESS_DENIED" });
  await assert.rejects(
    () => testRequestScanSmb({ ...settings, incomingSubfolder: "Requests\\Incoming", processedSubfolder: "Requests\\Processed", failedSubfolder: "Requests\\Failed" }, state.dependencies),
    (error: Error & { smbCode?: string; nativeStatus?: string }) => error.smbCode === "permission" && error.nativeStatus === "NT_STATUS_ACCESS_DENIED"
  );
});
test("Request Scan full connection test reports the failing archive stage and cleans partial artifacts", async () => {
  const state = smbState({}, { renameStatus: "NT_STATUS_ACCESS_DENIED" });
  await assert.rejects(() => testRequestScanSmb({ ...settings, incomingSubfolder: "Requests\\Incoming", processedSubfolder: "Requests\\Processed", failedSubfolder: "Requests\\Failed" }, state.dependencies), (error: Error) => {
    assert.match(error.message, /archive reconciliation \(permission\)/);
    assert.equal(error.message.includes("NT_STATUS_ACCESS_DENIED"), false);
    assert.equal(error.message.includes("Requests\\"), false);
    assert.equal(error.message.includes("user"), false);
    assert.equal(error.message.includes("pass"), false);
    return true;
  });
  assert.equal([...state.files.keys()].some((name) => name.includes(".rispro-request-scan-workflow-")), false);
});
test("Request Scan SMB failures emit classified path-free diagnostics", async () => {
  const diagnostics: Array<{ event: string; metadata: Record<string, string | number | boolean> }> = [];
  await assert.rejects(() => reconcileRequestScanMove(settings, "Incoming\\patient-name.pdf", "Processed\\7-patient-name.pdf", {
    async execFile() { throw Object.assign(new Error("NT_STATUS_ACCESS_DENIED"), { stderr: "NT_STATUS_ACCESS_DENIED" }); },
  }, { jobId: 7, logDiagnostic(event, metadata) { diagnostics.push({ event, metadata }); } }));
  assert.equal(diagnostics[0]?.event, "request_scan_smb_failure");
  assert.equal(diagnostics[0]?.metadata.operation, "source_probe");
  assert.equal(diagnostics[0]?.metadata.smbCode, "permission");
  assert.equal(diagnostics[0]?.metadata.jobId, 7);
  assert.equal(JSON.stringify(diagnostics).includes("patient-name"), false);
});
