import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { extractRequestScanBarcode, interpretRequestScanBarcodes } from "./request-scan-barcode-service.js";

test("accepts one Code 39 V2 accession", () => {
  assert.deepEqual(interpretRequestScanBarcodes("CODE-39:V2-000123\n"), { ok: true, accession: "V2-000123" });
});
test("accepts one Code 128 V2 accession", () => {
  assert.deepEqual(interpretRequestScanBarcodes("CODE-128: V2-000124\n"), { ok: true, accession: "V2-000124" });
});
test("deduplicates the same accession across PDF pages", () => {
  assert.deepEqual(interpretRequestScanBarcodes("CODE-39:V2-000123\nCODE-128:V2-000123"), { ok: true, accession: "V2-000123" });
});
test("reports missing, invalid, and multiple barcodes", () => {
  assert.deepEqual(interpretRequestScanBarcodes(""), { ok: false, reason: "no_barcode" });
  assert.deepEqual(interpretRequestScanBarcodes("CODE-39:OTHER-123"), { ok: false, reason: "no_valid_accession" });
  assert.deepEqual(interpretRequestScanBarcodes("CODE-39:V2-000123\nCODE-128:V2-000124"), { ok: false, reason: "multiple_accessions" });
});
test("rejects unsupported extensions before invoking tools", async () => {
  assert.deepEqual(await extractRequestScanBarcode("request.png"), { ok: false, reason: "unsupported_file" });
});
test("scans every rendered PDF page", async () => {
  const result = await extractRequestScanBarcode("later-page.pdf", {
    async execFile(command, args) {
      if (command === "pdftoppm") {
        await fs.writeFile(`${args[args.length - 1]}-1.png`, "first");
        await fs.writeFile(`${args[args.length - 1]}-2.png`, "second");
        return {};
      }
      return { stdout: path.basename(args.at(-1) || "").includes("-2.png") ? "CODE-128:V2-000125\n" : "" };
    },
  });
  assert.deepEqual(result, { ok: true, accession: "V2-000125" });
});
