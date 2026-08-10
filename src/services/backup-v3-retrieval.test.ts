import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { sha256File } from "./backup-v3-checksums.js";
import { stageBackupV3RetrievedStream } from "./backup-v3-retrieval.js";

async function tempRoot() { return fs.mkdtemp(path.join(os.tmpdir(), "rispro-retrieval-test-")); }

test("retrieval stages a streamed copy only after incremental checksum and size validation", async () => {
  const root = await tempRoot();
  const expected = path.join(root, "source.rispro.zip"); await fs.writeFile(expected, "small streamed fixture"); const digest = await sha256File(expected);
  try {
    const result = await stageBackupV3RetrievedStream({ source: Readable.from(["small ", "streamed ", "fixture"]), stagingDir: path.join(root, "stage"), archiveName: "copy.rispro.zip", expectedByteSize: digest.byteSize, expectedSha256: digest.sha256, maximumByteSize: digest.byteSize });
    if (process.platform !== "win32") assert.equal((await fs.stat(result.stagingPath)).mode & 0o777, 0o600);
    assert.equal(result.byteSize, digest.byteSize);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("retrieval removes partial files and never promotes a mismatched or oversized stream", async () => {
  const root = await tempRoot(); const stage = path.join(root, "stage");
  try {
    for (const input of [
      { source: Readable.from(["wrong"]), expectedByteSize: 5, expectedSha256: "0".repeat(64), maximumByteSize: 20 },
      { source: Readable.from(["0123456789", "x"]), expectedByteSize: 1, expectedSha256: "0".repeat(64), maximumByteSize: 10 },
    ]) {
      await assert.rejects(() => stageBackupV3RetrievedStream({ ...input, stagingDir: stage, archiveName: "copy.rispro.zip" }));
      assert.equal((await fs.readdir(stage).catch(() => [])).some((name) => name.endsWith(".partial") || name === "copy.rispro.zip"), false);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("retrieval cleans up interrupted streams", async () => {
  const root = await tempRoot(); const source = new PassThrough(); const promise = stageBackupV3RetrievedStream({ source, stagingDir: path.join(root, "stage"), archiveName: "copy.rispro.zip", expectedByteSize: 20, expectedSha256: "0".repeat(64), maximumByteSize: 20 });
  source.on("error", () => undefined); source.write("partial"); source.destroy(new Error("interrupted"));
  await assert.rejects(promise, /interrupted/); assert.deepEqual(await fs.readdir(path.join(root, "stage")).catch(() => []), []); await fs.rm(root, { recursive: true, force: true });
});
