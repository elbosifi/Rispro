import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { BackupV3ArchiveEntry, BackupV3ArchiveLimits } from "./backup-v3-types.js";
import { validateBackupV3ArchiveEntries } from "./backup-v3-validators.js";
import { HttpError } from "../utils/http-error.js";

interface StoredZipEntry extends BackupV3ArchiveEntry {
  dataOffset: number;
}

function readZip64UncompressedSize(extra: Buffer): number {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    const dataStart = offset + 4;
    if (dataStart + size > extra.length) break;
    if (headerId === 0x0001 && size >= 8) {
      const value = extra.readBigUInt64LE(dataStart);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(400, "ZIP64 entry is too large for this runtime.");
      return Number(value);
    }
    offset = dataStart + size;
  }
  throw new HttpError(400, "ZIP64 entry is missing its uncompressed-size metadata.");
}

async function readExact(handle: fs.FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new HttpError(400, "Invalid or truncated ZIP archive.");
  }
  return buffer;
}

function stagingPathForEntry(stagingDir: string, archivePath: string): string {
  const absolutePath = path.resolve(stagingDir, archivePath);
  const relative = path.relative(stagingDir, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, `Unsafe archive path: ${archivePath}`);
  }
  return absolutePath;
}

export async function extractStoredBackupV3ZipToStaging(
  archivePath: string,
  stagingDir: string,
  limits: BackupV3ArchiveLimits
): Promise<BackupV3ArchiveEntry[]> {
  const handle = await fs.open(archivePath, "r");
  const stat = await handle.stat();
  const entries: StoredZipEntry[] = [];
  let offset = 0;

  try {
    while (offset + 4 <= stat.size) {
      const signature = (await readExact(handle, offset, 4)).readUInt32LE(0);
      if (signature === 0x02014b50 || signature === 0x06054b50) {
        break;
      }
      if (signature !== 0x04034b50) {
        throw new HttpError(400, "Invalid ZIP archive structure.");
      }

      const header = await readExact(handle, offset, 30);
      const flags = header.readUInt16LE(6);
      const method = header.readUInt16LE(8);
      let uncompressedSize = header.readUInt32LE(22);
      const nameLength = header.readUInt16LE(26);
      const extraLength = header.readUInt16LE(28);
      if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0) {
        throw new HttpError(400, "Encrypted ZIP entries and data descriptors are not supported.");
      }
      if (method !== 0) {
        throw new HttpError(400, "Only stored ZIP entries are supported for RISpro backups.");
      }
      const nameBuffer = await readExact(handle, offset + 30, nameLength);
      const entryPath = nameBuffer.toString("utf8");
      if (uncompressedSize === 0xffffffff) {
        uncompressedSize = readZip64UncompressedSize(await readExact(handle, offset + 30 + nameLength, extraLength));
      }
      const dataOffset = offset + 30 + nameLength + extraLength;
      entries.push({
        path: entryPath,
        type: entryPath.endsWith("/") ? "directory" : "file",
        uncompressedSize,
        dataOffset,
      });
      offset = dataOffset + uncompressedSize;
    }
  } finally {
    await handle.close();
  }

  const errors = validateBackupV3ArchiveEntries(entries, limits);
  if (errors.length) {
    throw new HttpError(400, errors.join("\n"));
  }

  for (const entry of entries) {
    if (entry.type !== "file") {
      continue;
    }
    const outputPath = stagingPathForEntry(stagingDir, entry.path);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    if (entry.uncompressedSize === 0) {
      await fs.writeFile(outputPath, "");
      continue;
    }
    const content = await fs.open(archivePath, "r");
    try {
      const input = content.createReadStream({
        start: entry.dataOffset,
        end: entry.dataOffset + entry.uncompressedSize - 1,
      });
      const output = createWriteStream(outputPath, { flags: "wx" });
      await new Promise<void>((resolve, reject) => {
        input.on("error", reject);
        output.on("error", reject);
        output.on("finish", resolve);
        input.pipe(output);
      });
    } finally {
      await content.close();
    }
  }

  return entries;
}
