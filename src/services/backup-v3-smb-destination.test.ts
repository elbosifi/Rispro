import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256File } from "./backup-v3-checksums.js";
import { copyBackupV3ToSmbDestination, deleteBackupV3SmbDestinationCopy, testBackupV3SmbDestination, validateBackupV3SmbConfig, type BackupV3SmbDependencies } from "./backup-v3-smb-destination.js";

function fakeSmb(): { dependencies: BackupV3SmbDependencies; files: Map<string, Buffer>; commands: string[]; authFiles: string[] } {
  const files = new Map<string, Buffer>();
  const commands: string[] = [];
  const authFiles: string[] = [];
  const dependencies: BackupV3SmbDependencies = {
    async execFile(command, args) {
      assert.equal(command, "smbclient");
      assert.ok(args.includes("SMB3"));
      assert.ok(args.includes("--option=client min protocol=SMB2"));
      assert.ok(args.includes("--option=client max protocol=SMB3"));
      const authPath = args[args.indexOf("-A") + 1] || "";
      authFiles.push(await fs.readFile(authPath, "utf8"));
      const smbCommand = String(args[args.indexOf("-c") + 1] || "");
      commands.push(smbCommand);
      const parts = [...smbCommand.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => match[1]!.replace(/\\(.)/g, "$1"));
      if (smbCommand.startsWith("put ")) {
        files.set(parts[1]!, await fs.readFile(parts[0]!));
      } else if (smbCommand.startsWith("get ")) {
        await fs.writeFile(parts[1]!, files.get(parts[0]!) || Buffer.alloc(0));
      } else if (smbCommand.startsWith("rename ")) {
        const content = files.get(parts[0]!);
        if (!content) throw new Error("missing remote file");
        files.delete(parts[0]!);
        files.set(parts[1]!, content);
      } else if (smbCommand.startsWith("del ")) {
        files.delete(parts[0]!);
      }
    },
  };
  return { dependencies, files, commands, authFiles };
}

const config = { server: "nas.example", share: "RISpro Backups", subfolder: "daily/rispro", domain: "WORKGROUP", timeoutSeconds: 12 };

test("SMB adapter restricts protocol to SMB2/3, uses an auth file, and verifies read-back before rename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-smb-"));
  const source = path.join(root, "backup.rispro.zip");
  await fs.writeFile(source, "encrypted backup archive");
  const digest = await sha256File(source);
  const fake = fakeSmb();
  try {
    const result = await copyBackupV3ToSmbDestination({ sourcePath: source, archiveName: "backup.rispro.zip", expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config, credentials: { username: "backup-user", password: "super-secret" }, dependencies: fake.dependencies });
    assert.equal(result.sha256, digest.sha256);
    assert.equal(fake.files.size, 1);
    assert.ok([...fake.files.keys()][0]?.endsWith("backup.rispro.zip"));
    assert.ok(fake.authFiles.every((content) => content.includes("password = super-secret")));
    assert.equal(fake.commands.some((command) => command.includes("super-secret")), false);
    assert.ok(fake.commands.some((command) => command.startsWith("get ")));
    assert.ok(fake.commands.some((command) => command.startsWith("rename ")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SMB connection test writes and deletes a temporary remote file", async () => {
  const fake = fakeSmb();
  await testBackupV3SmbDestination(config, { username: "backup-user", password: "super-secret" }, fake.dependencies);
  assert.equal(fake.files.size, 0);
});

test("SMB retention deletion rejects paths outside the configured archive name", async () => {
  const fake = fakeSmb();
  fake.files.set("daily\\rispro\\backup.rispro.zip", Buffer.from("archive"));
  await deleteBackupV3SmbDestinationCopy({ remotePath: "daily\\rispro\\backup.rispro.zip", config, credentials: { username: "backup-user", password: "super-secret" }, dependencies: fake.dependencies });
  assert.equal(fake.files.size, 0);
  await assert.rejects(() => deleteBackupV3SmbDestinationCopy({ remotePath: "daily\\outside.txt", config, credentials: { username: "backup-user", password: "super-secret" }, dependencies: fake.dependencies }), /unsafe/);
});

test("SMB rejects traversal and reports authentication failures without exposing credentials", async () => {
  assert.throws(() => validateBackupV3SmbConfig({ ...config, subfolder: "daily/../outside" }), /unsafe/);
  const dependencies: BackupV3SmbDependencies = {
    async execFile() {
      const error = new Error("NT_STATUS_LOGON_FAILURE") as Error & { stderr: string };
      error.stderr = "NT_STATUS_LOGON_FAILURE";
      throw error;
    },
  };
  await assert.rejects(
    () => testBackupV3SmbDestination(config, { username: "backup-user", password: "super-secret" }, dependencies),
    (error: Error) => /authentication failed/.test(error.message) && !error.message.includes("super-secret")
  );
});
