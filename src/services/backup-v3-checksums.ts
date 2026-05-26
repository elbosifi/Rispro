import crypto from "node:crypto";
import fs from "node:fs";

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

export function crc32Buffer(buffer: Buffer, previous = 0xffffffff): number {
  let crc = previous;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return crc >>> 0;
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath: string): Promise<{ sha256: string; byteSize: number; crc32: number }> {
  const hash = crypto.createHash("sha256");
  let byteSize = 0;
  let crc32 = 0xffffffff;

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteSize += buffer.length;
      hash.update(buffer);
      crc32 = crc32Buffer(buffer, crc32);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return { sha256: hash.digest("hex"), byteSize, crc32: (crc32 ^ 0xffffffff) >>> 0 };
}

export function verifyBackupV3Checksum(
  actual: { sha256: string; byteSize: number },
  expected: { sha256: string; byteSize: number }
): boolean {
  return actual.byteSize === expected.byteSize && actual.sha256.toLowerCase() === expected.sha256.toLowerCase();
}
