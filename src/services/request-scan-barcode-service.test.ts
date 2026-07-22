import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { extractRequestScanBarcode, interpretRequestScanBarcodes } from "./request-scan-barcode-service.js";

function noSymbol(): Error & { code: number } { return Object.assign(new Error("no symbols found"), { code: 4 }); }

function pdfDependencies(pages: Array<string | Error>) {
  return {
    async execFile(command: string, args: string[]) {
      if (command === "pdftoppm") {
        const prefix = args.at(-1)!;
        await Promise.all(pages.map((_, index) => fs.writeFile(`${prefix}-${index + 1}.png`, "page")));
        return {};
      }
      const pageNumber = Number(path.basename(args.at(-1) || "").match(/page-(\d+)\.png/)?.[1]);
      const page = pages[pageNumber - 1];
      if (page instanceof Error) throw page;
      return { stdout: page };
    },
  };
}

test("accepts single-page Code 128 and Code 39 V2 accessions", () => {
  assert.deepEqual(interpretRequestScanBarcodes("CODE-128:V2-003628\n"), { ok: true, accession: "V2-003628" });
  assert.deepEqual(interpretRequestScanBarcodes("CODE-39:v2-003628\n"), { ok: true, accession: "V2-003628" });
});

test("accepts a first-page PDF barcode when later pages have no symbol", async () => {
  assert.deepEqual(await extractRequestScanBarcode("first-page.pdf", pdfDependencies(["CODE-128:V2-003628", noSymbol(), noSymbol()])), { ok: true, accession: "V2-003628" });
});

test("accepts a middle-page PDF barcode when surrounding pages have no symbol", async () => {
  assert.deepEqual(await extractRequestScanBarcode("middle-page.pdf", pdfDependencies([noSymbol(), "CODE-39:V2-003628", noSymbol()])), { ok: true, accession: "V2-003628" });
});

test("reports no barcode, invalid barcodes, duplicate accessions, and multiple accessions", async () => {
  assert.deepEqual(await extractRequestScanBarcode("empty.pdf", pdfDependencies([noSymbol(), noSymbol()])), { ok: false, reason: "no_barcode" });
  assert.deepEqual(await extractRequestScanBarcode("invalid.pdf", pdfDependencies(["CODE-128:OTHER-123"])), { ok: false, reason: "no_valid_accession" });
  assert.deepEqual(await extractRequestScanBarcode("duplicate.pdf", pdfDependencies(["CODE-39:V2-003628", "CODE-128:V2-003628"])), { ok: true, accession: "V2-003628" });
  assert.deepEqual(await extractRequestScanBarcode("multiple.pdf", pdfDependencies(["CODE-39:V2-003628", "CODE-128:V2-003629"])), { ok: false, reason: "multiple_accessions" });
});

test("ignores QR output when a supported linear barcode is present", () => {
  assert.deepEqual(interpretRequestScanBarcodes("QR-Code:ignored\nCODE-128:V2-003628"), { ok: true, accession: "V2-003628" });
});

test("reports genuine zbar failures and PDF rendering failures", async () => {
  assert.deepEqual(await extractRequestScanBarcode("request.jpg", { async execFile() { throw Object.assign(new Error("zbar crashed"), { code: 1 }); } }), { ok: false, reason: "barcode_tool_failed" });
  assert.deepEqual(await extractRequestScanBarcode("request.pdf", { async execFile() { throw new Error("pdftoppm failed"); } }), { ok: false, reason: "pdf_render_failed" });
});

test("rejects unsupported extensions before invoking tools", async () => {
  assert.deepEqual(await extractRequestScanBarcode("request.png"), { ok: false, reason: "unsupported_file" });
});
