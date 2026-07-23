import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractRequestScanBarcode, interpretRequestScanBarcodes, type RequestScanBarcodeDependencies } from "./request-scan-barcode-service.js";

function noSymbol(): Error & { code: number } { return Object.assign(new Error("no symbols found"), { code: 4 }); }

type Decode = (filePath: string) => string | Error;
function dependencies(decode: Decode, options: { preprocessError?: boolean; derivativePaths?: string[]; calls?: string[] } = {}): RequestScanBarcodeDependencies {
  return {
    async execFile(command, args) {
      if (command === "pdftoppm") {
        const prefix = args.at(-1)!;
        await fs.writeFile(`${prefix}-1.png`, "page one");
        await fs.writeFile(`${prefix}-2.png`, "page two");
        return {};
      }
      const filePath = args.at(-1)!;
      options.calls?.push(filePath);
      const result = decode(filePath);
      if (result instanceof Error) throw result;
      return { stdout: result };
    },
    imageProcessor: {
      async preprocess(sourcePath, destinationPath) {
        if (options.preprocessError) throw new Error("sharp failed");
        options.derivativePaths?.push(destinationPath);
        await fs.copyFile(sourcePath, destinationPath);
      },
      async rotate(sourcePath, _angle, destinationPath) {
        options.derivativePaths?.push(destinationPath);
        await fs.copyFile(sourcePath, destinationPath);
      },
    },
  };
}

async function withImage(t: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-barcode-test-"));
  const image = path.join(dir, "request.jpg");
  await fs.writeFile(image, "original upload bytes");
  try { await t(image); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test("accepts single-page Code 128 and Code 39 V2 accessions", () => {
  assert.deepEqual(interpretRequestScanBarcodes("CODE-128:V2-003628\n"), { ok: true, accession: "V2-003628" });
  assert.deepEqual(interpretRequestScanBarcodes("CODE-39:v2-003628\n"), { ok: true, accession: "V2-003628" });
});

test("uses the unchanged upright image as the original fast path", async () => {
  await withImage(async (image) => {
    const calls: string[] = [];
    const result = await extractRequestScanBarcode(image, dependencies(() => "CODE-128:V2-003628", { calls }));
    assert.deepEqual(result, { ok: true, accession: "V2-003628" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0], image);
  });
});

test("uses preprocessing after an initial low-contrast decode miss", async () => {
  await withImage(async (image) => {
    const result = await extractRequestScanBarcode(image, dependencies((filePath) => filePath.includes("processed-1.png") ? "CODE-128:V2-003628" : noSymbol()));
    assert.deepEqual(result, { ok: true, accession: "V2-003628" });
  });
});

for (const angle of [90, 180, 270]) {
  test(`recognizes a barcode after ${angle}-degree rotation`, async () => {
    await withImage(async (image) => {
      const result = await extractRequestScanBarcode(image, dependencies((filePath) => filePath.includes(`rotated-${angle}.png`) ? "CODE-39:V2-003628" : noSymbol()));
      assert.deepEqual(result, { ok: true, accession: "V2-003628" });
    });
  });
}

test("rejects invalid barcode text and deduplicates the same valid accession across PDF pages", async () => {
  const invalid = await extractRequestScanBarcode("invalid.pdf", dependencies(() => "CODE-128:OTHER-123"));
  assert.deepEqual(invalid, { ok: false, reason: "no_valid_accession" });
  const duplicate = await extractRequestScanBarcode("duplicate.pdf", dependencies((filePath) => filePath.endsWith("page-1.png") || filePath.endsWith("page-2.png") ? "CODE-128:V2-003628" : noSymbol()));
  assert.deepEqual(duplicate, { ok: true, accession: "V2-003628" });
});

test("returns an ambiguous result for two different valid accessions", async () => {
  const result = await extractRequestScanBarcode("multiple.pdf", dependencies((filePath) => filePath.endsWith("page-1.png") ? "CODE-39:V2-003628" : filePath.endsWith("page-2.png") ? "CODE-128:V2-003629" : noSymbol()));
  assert.deepEqual(result, { ok: false, reason: "multiple_accessions" });
});

test("reports preprocessing and decoder failures cleanly", async () => {
  await withImage(async (image) => {
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => noSymbol(), { preprocessError: true })), { ok: false, reason: "image_preprocess_failed" });
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => Object.assign(new Error("zbar timed out"), { code: "ETIMEDOUT", timedOut: true }))), { ok: false, reason: "barcode_tool_failed" });
  });
});

test("cleans temporary derivatives after success and failure without changing the original upload", async () => {
  await withImage(async (image) => {
    const original = await fs.readFile(image, "utf8");
    const successDerivatives: string[] = [];
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies((filePath) => filePath.includes("processed-1.png") ? "CODE-128:V2-003628" : noSymbol(), { derivativePaths: successDerivatives })), { ok: true, accession: "V2-003628" });
    await Promise.all(successDerivatives.map((filePath) => assert.rejects(fs.access(filePath))));

    const failureDerivatives: string[] = [];
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => noSymbol(), { derivativePaths: failureDerivatives })), { ok: false, reason: "no_barcode" });
    await Promise.all(failureDerivatives.map((filePath) => assert.rejects(fs.access(filePath))));
    assert.equal(await fs.readFile(image, "utf8"), original);
  });
});

test("reports PDF rendering failures and unsupported extensions", async () => {
  assert.deepEqual(await extractRequestScanBarcode("request.pdf", { async execFile() { throw new Error("pdftoppm failed"); } }), { ok: false, reason: "pdf_render_failed" });
  assert.deepEqual(await extractRequestScanBarcode("request.png", { async execFile() { throw new Error("must not run"); } }), { ok: false, reason: "unsupported_file" });
});
