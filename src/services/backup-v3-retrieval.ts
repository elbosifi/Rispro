import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "../utils/http-error.js";

export type BackupV3RetrievedCopy = { stagingPath: string; byteSize: number; sha256: string; cleanupStatus: "pending" | "cleaned" };

/** Streams a remote archive into a private staging directory while enforcing its byte limit. */
export async function stageBackupV3RetrievedStream(input: { source: Readable; stagingDir: string; archiveName: string; expectedByteSize: number; expectedSha256: string; maximumByteSize: number }): Promise<BackupV3RetrievedCopy> {
  if (!Number.isSafeInteger(input.maximumByteSize) || input.maximumByteSize < input.expectedByteSize) throw new HttpError(400, "Backup retrieval maximum size is invalid.");
  if (!/^[A-Za-z0-9._-]+\.rispro\.zip$/.test(input.archiveName)) throw new HttpError(400, "Backup filename is unsafe.");
  await fsp.mkdir(input.stagingDir, { recursive: true, mode: 0o700 });
  await fsp.chmod(input.stagingDir, 0o700);
  const finalPath = path.join(input.stagingDir, input.archiveName);
  const temporaryPath = path.join(input.stagingDir, `.${input.archiveName}.${crypto.randomUUID()}.partial`);
  let size = 0;
  const hash = crypto.createHash("sha256");
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    size += chunk.length;
    if (size > input.maximumByteSize) { callback(new HttpError(413, "Retrieved backup exceeds the configured maximum archive size.")); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(input.source, meter, fs.createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    const sha256 = hash.digest("hex");
    if (size !== input.expectedByteSize || sha256.toLowerCase() !== input.expectedSha256.toLowerCase()) throw new HttpError(400, "Retrieved destination copy does not match its verified checksum or size.");
    await fsp.rename(temporaryPath, finalPath);
    await fsp.chmod(finalPath, 0o600);
    return { stagingPath: finalPath, byteSize: size, sha256, cleanupStatus: "pending" };
  } catch (error) {
    input.source.destroy();
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupBackupV3RetrievedCopy(stagingDir: string): Promise<"cleaned"> {
  await fsp.rm(stagingDir, { recursive: true, force: true });
  return "cleaned";
}
