import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { listRequestScanFiles, testRequestScanSmb } from "./request-scan-smb-service.js";
import type { RequestScanSettings } from "./request-scan-settings-service.js";
import type { BackupV3SmbDependencies } from "./backup-v3-smb-destination.js";

const settings: RequestScanSettings = {
  enabled: true,
  server: "nas.example",
  share: "RISpro",
  domain: "WORKGROUP",
  username: "scan-user",
  password: "scan-password",
  incomingSubfolder: "Requests/Incoming",
  processedSubfolder: "Requests/Processed",
  failedSubfolder: "Requests/Failed",
  pollingIntervalSeconds: 15,
  fileReadyDelaySeconds: 15,
};

function quotedParts(command: string): string[] {
  return [...command.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1"));
}

function fakeSmb(existingFolders: string[] = []): { dependencies: BackupV3SmbDependencies; commands: string[]; folders: Set<string>; files: Map<string, Buffer> } {
  const folders = new Set(existingFolders);
  const files = new Map<string, Buffer>();
  const commands: string[] = [];
  const dependencies: BackupV3SmbDependencies = {
    async execFile(_command, args) {
      const command = String(args[args.indexOf("-c") + 1] || "");
      commands.push(command);
      const parts = quotedParts(command);
      if (command.startsWith("mkdir ")) {
        const folder = parts[0]!;
        const parent = folder.includes("\\") ? folder.slice(0, folder.lastIndexOf("\\")) : "";
        if (parent && !folders.has(parent)) throw new Error("NT_STATUS_OBJECT_PATH_NOT_FOUND");
        if (folders.has(folder)) throw new Error("NT_STATUS_OBJECT_NAME_COLLISION");
        folders.add(folder);
      } else if (command.startsWith("cd ")) {
        if (!folders.has(parts[0]!)) throw new Error("NT_STATUS_OBJECT_NAME_NOT_FOUND");
      } else if (command.startsWith("put ")) {
        files.set(parts[1]!, await fs.readFile(parts[0]!));
      } else if (command.startsWith("del ")) {
        if (!files.delete(parts[0]!)) throw new Error("NT_STATUS_OBJECT_NAME_NOT_FOUND");
      }
    },
  };
  return { dependencies, commands, folders, files };
}

test("Request Scan SMB test recursively creates and verifies its folders", async () => {
  const fake = fakeSmb();
  await testRequestScanSmb(settings, fake.dependencies);

  assert.deepEqual([...fake.folders].sort(), ["Requests", "Requests\\Failed", "Requests\\Incoming", "Requests\\Processed"].sort());
  const checkedFolders = fake.commands.filter((command) => command.startsWith("cd ")).map((command) => quotedParts(command)[0]);
  assert.ok(checkedFolders.includes("Requests\\Incoming"));
  assert.ok(checkedFolders.includes("Requests\\Processed"));
  assert.ok(checkedFolders.includes("Requests\\Failed"));
});

test("Request Scan SMB test accepts existing folders and removes its write probe", async () => {
  const fake = fakeSmb(["Requests", "Requests\\Incoming", "Requests\\Processed", "Requests\\Failed"]);
  await testRequestScanSmb(settings, fake.dependencies);

  assert.equal(fake.files.size, 0);
  assert.ok(fake.commands.some((command) => command.startsWith("put ")));
  assert.ok(fake.commands.some((command) => command.startsWith("del ")));
});

test("Request Scan SMB listing parses the production mixed-case smbclient file row without allinfo", async () => {
  const commands: string[] = [];
  const dependencies: BackupV3SmbDependencies = {
    async execFile(_command, args) {
      const command = String(args[args.indexOf("-c") + 1] || "");
      commands.push(command);
      if (command.startsWith("cd ")) {
        return {
          stdout: [
            "  .                                  Dc        0  Wed Jul 22 18:47:18 2026",
            "  ..                                 Dc        0  Wed Jul 22 18:47:18 2026",
            "  v2-003533.pdf                      Ac    80231  Wed Jul 22 18:19:32 2026",
          ].join("\n"),
        };
      }
      throw new Error(`Unexpected SMB command: ${command}`);
    },
  };

  const files = await listRequestScanFiles(settings, dependencies);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.filename, "v2-003533.pdf");
  assert.equal(files[0]?.relativePath, "Requests\\Incoming\\v2-003533.pdf");
  assert.ok(files[0]?.modifiedAt instanceof Date && !Number.isNaN(files[0].modifiedAt.getTime()));
  assert.equal(commands[0], 'cd "Requests/Incoming"; ls');
  assert.equal(commands.some((command) => command.startsWith("allinfo ")), false);
});

for (const [status, expected] of [
  ["NT_STATUS_LOGON_FAILURE", "SMB authentication failed."],
  ["NT_STATUS_ACCESS_DENIED", "SMB permission denied."],
  ["NT_STATUS_BAD_NETWORK_NAME", "SMB share not found."],
  ["NT_STATUS_OBJECT_PATH_NOT_FOUND", "Configured SMB folder was not found or could not be created."],
  ["ETIMEDOUT", "SMB server unavailable."],
] as const) {
  test(`Request Scan SMB test classifies ${status}`, async () => {
    const dependencies: BackupV3SmbDependencies = { async execFile() { throw new Error(status); } };
    await assert.rejects(
      () => testRequestScanSmb(settings, dependencies),
      (error: Error) => error.message === expected && !error.message.includes(settings.password)
    );
  });
}
