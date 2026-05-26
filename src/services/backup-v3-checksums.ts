import crypto from "node:crypto";
import fs from "node:fs";

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath: string): Promise<{ sha256: string; byteSize: number }> {
  const hash = crypto.createHash("sha256");
  let byteSize = 0;

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteSize += buffer.length;
      hash.update(buffer);
    });
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return { sha256: hash.digest("hex"), byteSize };
}

export function verifyBackupV3Checksum(
  actual: { sha256: string; byteSize: number },
  expected: { sha256: string; byteSize: number }
): boolean {
  return actual.byteSize === expected.byteSize && actual.sha256.toLowerCase() === expected.sha256.toLowerCase();
}
