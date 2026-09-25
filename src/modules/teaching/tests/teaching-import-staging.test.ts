import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingImportUpload } from "../import/staging-service.js";

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#245c80" } }).png().toBuffer();
}

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#245c80" } }).jpeg().toBuffer();
}

async function webp(): Promise<Buffer> {
  return sharp({ create: { width: 4, height: 4, channels: 3, background: "#245c80" } }).webp().toBuffer();
}

function zipFile(entries: Array<{ name: string; bytes: Buffer | string }>): Buffer {
  const zip = new AdmZip();
  for (const entry of entries) zip.addFile(entry.name, Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes));
  return zip.toBuffer();
}

function zipWithAbsoluteAssetPath(bytes: Buffer): Buffer {
  const result = Buffer.from(bytes);
  const entryName = Buffer.from("assets/synthetic.png");
  let offset = result.indexOf(entryName);
  let replacements = 0;
  while (offset >= 0) {
    result[offset] = 0x2f;
    replacements += 1;
    offset = result.indexOf(entryName, offset + entryName.length);
  }
  assert.equal(replacements, 2, "ZIP local and central directory names should both be rewritten");
  return result;
}

test("Teaching ZIP staging sanitizes JPEG, PNG, and WebP without writing to permanent storage", async () => {
  process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
  process.env.JWT_SECRET ||= "teaching-import-staging-test-secret";
  const { cleanupTeachingImportStaging, extractTeachingImportUpload, loadStagedTeachingAssets } = await import("../import/staging-service.js");
  const batchId = randomUUID();
  const upload: TeachingImportUpload = {
    filename: "synthetic-teaching.zip",
    inputType: "zip",
    bytes: zipFile([
      { name: "questions.json", bytes: JSON.stringify({ schemaVersion: "1.0", questions: [] }) },
      { name: "assets/synthetic.jpg", bytes: await jpeg() },
      { name: "assets/synthetic.png", bytes: await png() },
      { name: "assets/synthetic.webp", bytes: await webp() },
    ]),
  };
  try {
    const extracted = await extractTeachingImportUpload(upload, batchId);
    assert.equal(extracted.stagedAssets.length, 3);
    assert.deepEqual(extracted.stagedAssets.map((asset) => asset.mimeType).sort(), ["image/jpeg", "image/png", "image/webp"]);
    assert.equal((await loadStagedTeachingAssets(batchId)).length, 3);
    assert.match(extracted.stagedAssets[0]?.stagedPath ?? "", /rispro-teaching-imports/);
  } finally {
    await cleanupTeachingImportStaging(batchId);
  }
  assert.equal((await loadStagedTeachingAssets(batchId)).length, 0);
});

test("Teaching ZIP staging rejects path traversal, unsupported entries and MIME-extension mismatch", async () => {
  process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
  process.env.JWT_SECRET ||= "teaching-import-staging-test-secret";
  const { cleanupTeachingImportStaging, extractTeachingImportUpload, loadStagedTeachingAssets } = await import("../import/staging-service.js");
  const badUploads: TeachingImportUpload[] = [
    { filename: "unsafe.zip", inputType: "zip", bytes: zipFile([{ name: "questions.json", bytes: "{}" }, { name: "../escape.txt", bytes: "bad" }]) },
    { filename: "nested.zip", inputType: "zip", bytes: zipFile([{ name: "questions.json", bytes: "{}" }, { name: "nested.zip", bytes: "PK\\u0003\\u0004" }]) },
    { filename: "mismatch.zip", inputType: "zip", bytes: zipFile([{ name: "questions.json", bytes: "{}" }, { name: "assets/synthetic.jpg", bytes: await png() }]) },
  ];
  for (const upload of badUploads) {
    const batchId = randomUUID();
    await assert.rejects(() => extractTeachingImportUpload(upload, batchId), (error: unknown) => error instanceof HttpError);
    await cleanupTeachingImportStaging(batchId);
    assert.equal((await loadStagedTeachingAssets(batchId)).length, 0);
  }
});

test("Teaching ZIP staging enforces entry-count and per-image limits before permanent writes", async () => {
  process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
  process.env.JWT_SECRET ||= "teaching-import-staging-test-secret";
  const { cleanupTeachingImportStaging, extractTeachingImportUpload } = await import("../import/staging-service.js");
  const entries = [{ name: "questions.json", bytes: "{}" }];
  for (let index = 0; index < 256; index += 1) entries.push({ name: `unused-${index}.txt`, bytes: "x" });
  const batchId = randomUUID();
  await assert.rejects(
    () => extractTeachingImportUpload({ filename: "oversized.zip", inputType: "zip", bytes: zipFile(entries) }, batchId),
    (error: unknown) => error instanceof HttpError,
  );
  await cleanupTeachingImportStaging(batchId);

  const imageLimitBatchId = randomUUID();
  const oversizedImage = zipFile([
    { name: "questions.json", bytes: "{}" },
    { name: "assets/large.png", bytes: randomBytes(8 * 1024 * 1024 + 1) },
  ]);
  await assert.rejects(
    () => extractTeachingImportUpload({ filename: "oversized-image.zip", inputType: "zip", bytes: oversizedImage }, imageLimitBatchId),
    (error: unknown) => error instanceof HttpError && /8 MB image limit/.test(error.message),
  );
  await cleanupTeachingImportStaging(imageLimitBatchId);
});

test("Teaching ZIP staging rejects absolute paths and duplicate normalized filenames", async () => {
  process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
  process.env.JWT_SECRET ||= "teaching-import-staging-test-secret";
  const { cleanupTeachingImportStaging, extractTeachingImportUpload } = await import("../import/staging-service.js");
  const image = await png();
  const badUploads: TeachingImportUpload[] = [
    { filename: "absolute.zip", inputType: "zip", bytes: zipWithAbsoluteAssetPath(zipFile([{ name: "questions.json", bytes: "{}" }, { name: "assets/synthetic.png", bytes: image }])) },
    { filename: "duplicate.zip", inputType: "zip", bytes: zipFile([{ name: "questions.json", bytes: "{}" }, { name: "assets/Synthetic.png", bytes: image }, { name: "assets/synthetic.png", bytes: image }]) },
  ];
  for (const upload of badUploads) {
    const batchId = randomUUID();
    await assert.rejects(() => extractTeachingImportUpload(upload, batchId), (error: unknown) => error instanceof HttpError);
    await cleanupTeachingImportStaging(batchId);
  }
});
