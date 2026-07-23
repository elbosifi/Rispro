import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractRequestScanBarcode, interpretRequestScanBarcodes, type RequestScanBarcodeDependencies } from "./request-scan-barcode-service.js";

function noSymbol(): Error & { code: number } { return Object.assign(new Error("no symbols found"), { code: 4 }); }
type Decode = (filePath: string) => string | Error;
type Options = { preprocessError?: boolean; rotateError?: number; derivativePaths?: string[]; renderedPaths?: string[]; calls?: string[]; renders?: number[]; diagnostics?: Record<string, string | number | boolean>[] };
function dependencies(decode: Decode, options: Options = {}): RequestScanBarcodeDependencies {
  return {
    async execFile(command, args) {
      if (command === "pdftoppm") {
        const dpi = Number(args[args.indexOf("-r") + 1]); options.renders?.push(dpi);
        const prefix = args.at(-1)!;
        for (const page of [1, 2]) { const rendered = `${prefix}-${page}.png`; options.renderedPaths?.push(rendered); await fs.writeFile(rendered, `page ${page} at ${dpi}`); }
        return {};
      }
      const filePath = args.at(-1)!; options.calls?.push(filePath); const result = decode(filePath); if (result instanceof Error) throw result; return { stdout: result };
    },
    imageProcessor: {
      async preprocess(sourcePath, destinationPath) { if (options.preprocessError) throw new Error("sharp failed"); options.derivativePaths?.push(destinationPath); await fs.copyFile(sourcePath, destinationPath); },
      async rotate(sourcePath, angle, destinationPath) { if (options.rotateError === angle) throw new Error("rotate failed"); options.derivativePaths?.push(destinationPath); await fs.copyFile(sourcePath, destinationPath); },
    },
    logDiagnostic(_event, metadata) { options.diagnostics?.push(metadata); },
  };
}
async function withImage(t: (filePath: string) => Promise<void>): Promise<void> { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-barcode-test-")); const image = path.join(dir, "request.jpg"); await fs.writeFile(image, "original upload bytes"); try { await t(image); } finally { await fs.rm(dir, { recursive: true, force: true }); } }

test("accepts single-page Code 128 and Code 39 V2 accessions", () => { assert.deepEqual(interpretRequestScanBarcodes("CODE-128:V2-003628\n"), { ok: true, accession: "V2-003628" }); assert.deepEqual(interpretRequestScanBarcodes("CODE-39:v2-003628\n"), { ok: true, accession: "V2-003628" }); });
test("uses the unchanged upright image as the original fast path", async () => { await withImage(async (image) => { const calls: string[] = []; assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => "CODE-128:V2-003628", { calls })), { ok: true, accession: "V2-003628" }); assert.deepEqual(calls, [image]); }); });
test("uses preprocessing and each bounded rotation when needed", async () => { for (const angle of [0, 90, 180, 270]) await withImage(async (image) => { const result = await extractRequestScanBarcode(image, dependencies((filePath) => angle === 0 ? (filePath.includes("processed-1.png") && !filePath.includes("rotated") ? "CODE-128:V2-003628" : noSymbol()) : (filePath.includes(`rotated-${angle}.png`) ? "CODE-39:V2-003628" : noSymbol()))); assert.deepEqual(result, { ok: true, accession: "V2-003628" }); }); });

test("does not render 600 DPI after a 300-DPI success or ambiguity", async () => {
  const successRenders: number[] = []; assert.deepEqual(await extractRequestScanBarcode("success.pdf", dependencies((filePath) => filePath.includes("pdf-300") && filePath.endsWith("page-1.png") ? "CODE-128:V2-003628" : noSymbol(), { renders: successRenders })), { ok: true, accession: "V2-003628" }); assert.deepEqual(successRenders, [300]);
  const ambiguousRenders: number[] = []; assert.deepEqual(await extractRequestScanBarcode("ambiguous.pdf", dependencies((filePath) => filePath.endsWith("page-1.png") ? "CODE-39:V2-003628" : filePath.endsWith("page-2.png") ? "CODE-128:V2-003629" : noSymbol(), { renders: ambiguousRenders })), { ok: false, reason: "multiple_accessions" }); assert.deepEqual(ambiguousRenders, [300]);
});
test("retries a PDF once at 600 DPI and records a 600-DPI success", async () => { const renders: number[] = []; const calls: string[] = []; const diagnostics: Record<string, string | number | boolean>[] = []; const result = await extractRequestScanBarcode("fallback.pdf", dependencies((filePath) => filePath.includes("pdf-600") && filePath.includes("rotated-270") ? "CODE-128:V2-003628" : noSymbol(), { renders, calls, diagnostics })); assert.deepEqual(result, { ok: true, accession: "V2-003628" }); assert.deepEqual(renders, [300, 600]); assert.ok(calls.some((filePath) => filePath.includes("pdf-600") && filePath.includes("rotated-270"))); assert.ok(diagnostics.some((entry) => entry.code === "BARCODE_SUCCESS_PDF_600_DPI")); assert.ok(diagnostics.some((entry) => entry.successfulDpi === 600 && entry.fallbackUsed === true)); });
test("invalid values at 300 DPI permit the 600-DPI fallback, while 600 ambiguity remains manual review", async () => { const renders: number[] = []; const result = await extractRequestScanBarcode("invalid-then-ambiguous.pdf", dependencies((filePath) => filePath.includes("pdf-300") ? "CODE-128:OTHER-1" : filePath.endsWith("page-1.png") ? "CODE-128:V2-003628" : filePath.endsWith("page-2.png") ? "CODE-128:V2-003629" : noSymbol(), { renders })); assert.deepEqual(result, { ok: false, reason: "multiple_accessions" }); assert.deepEqual(renders, [300, 600]); });
test("cleans rendered files at both resolutions and never changes the original upload", async () => { await withImage(async (image) => { const original = await fs.readFile(image, "utf8"); const derivatives: string[] = []; assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => noSymbol(), { derivativePaths: derivatives })), { ok: false, reason: "no_barcode" }); await Promise.all(derivatives.map((filePath) => assert.rejects(fs.access(filePath)))); assert.equal(await fs.readFile(image, "utf8"), original); }); const rendered: string[] = []; await extractRequestScanBarcode("cleanup.pdf", dependencies(() => noSymbol(), { renderedPaths: rendered })); await Promise.all(rendered.map((filePath) => assert.rejects(fs.access(filePath)))); });

test("distinguishes no payload, invalid values, ambiguity, decoder timeout, decoder failure, preprocessing failure, and PDF render failure", async () => {
  await withImage(async (image) => {
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => noSymbol())), { ok: false, reason: "no_barcode" });
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => "CODE-128:OTHER-123")), { ok: false, reason: "no_valid_accession" });
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => "CODE-128:V2-003628\nCODE-39:V2-003629")), { ok: false, reason: "multiple_accessions" });
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => Object.assign(new Error("timed out"), { code: "ETIMEDOUT", timedOut: true }))), { ok: false, reason: "barcode_decoder_timeout" });
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => new Error("executable failed"))), { ok: false, reason: "barcode_decoder_failed" });
    assert.deepEqual(await extractRequestScanBarcode(image, dependencies(() => noSymbol(), { preprocessError: true })), { ok: false, reason: "image_preprocess_failed" });
  });
  assert.deepEqual(await extractRequestScanBarcode("render.pdf", { async execFile() { throw new Error("render failed"); } }), { ok: false, reason: "pdf_render_failed" });
});
test("a 600-DPI render failure is contained and unsupported extensions remain rejected", async () => { const renders: number[] = []; const result = await extractRequestScanBarcode("render-600-fail.pdf", { async execFile(command, args) { if (command === "pdftoppm") { const dpi = Number(args[args.indexOf("-r") + 1]); renders.push(dpi); if (dpi === 600) throw new Error("bad PDF"); await fs.writeFile(`${args.at(-1)!}-1.png`, "page"); return {}; } throw noSymbol(); }, imageProcessor: { async preprocess(source, destination) { await fs.copyFile(source, destination); }, async rotate(source, _angle, destination) { await fs.copyFile(source, destination); } } }); assert.deepEqual(result, { ok: false, reason: "pdf_render_failed" }); assert.deepEqual(renders, [300, 600]); assert.deepEqual(await extractRequestScanBarcode("request.png", { async execFile() { throw new Error("must not run"); } }), { ok: false, reason: "unsupported_file" }); });
