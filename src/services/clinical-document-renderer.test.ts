import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cleanupRenderedClinicalDocument, parsePdfInfoPageSizes, projectedRenderedDimensions, readRenderedRgbPage, renderClinicalDocument } from "./clinical-document-renderer.js";

function twoPagePdf(): Buffer {
  const contents = ["0 g 0 0 612 792 re f\n", "0 g 72 72 468 648 re f\n"];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    `<< /Length ${contents[0]!.length} >>\nstream\n${contents[0]}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>",
    `<< /Length ${contents[1]!.length} >>\nstream\n${contents[1]}endstream`,
  ];
  const chunks = ["%PDF-1.4\n"]; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(chunks.join(""))); chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`); }
  const xref = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "ascii");
}

test("parses locale-stable pdfinfo Page N size lines", () => {
  assert.deepEqual(parsePdfInfoPageSizes("Page    1 size:  612 x 792 pts (letter)\nPage 2 size: 612.5 x 792.25 pts (A4)", 2), [{ widthPoints: 612, heightPoints: 792 }, { widthPoints: 612.5, heightPoints: 792.25 }]);
  assert.throws(() => parsePdfInfoPageSizes("Page 1 size: 612 x 792 pts", 2), /dimensions/);
});

test("projects aspect-preserving bounded PDF dimensions before Poppler runs", () => {
  assert.deepEqual(projectedRenderedDimensions(612, 792), { width: 1530, height: 1980, pixels: 3029400, scaled: false });
  const oversized = projectedRenderedDimensions(10000, 5000);
  assert.equal(oversized.width, 6000); assert.equal(oversized.height, 3000); assert.equal(oversized.pixels, 18_000_000); assert.equal(oversized.scaled, true);
});

test("normalizes supported source images to three sRGB bytes per pixel", async () => {
  const sources = [
    await sharp(Buffer.alloc(6, 128), { raw: { width: 3, height: 2, channels: 1 } }).jpeg().toBuffer(),
    await sharp(Buffer.alloc(6, 128), { raw: { width: 3, height: 2, channels: 1 } }).png().toBuffer(),
    await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer(),
    await sharp({ create: { width: 3, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer(),
  ];
  for (const [index, source] of sources.entries()) {
    const rendered = await renderClinicalDocument(source, index === 1 || index === 2 ? "image/png" : "image/jpeg");
    try { const page = rendered.pages[0]!; assert.equal((await readRenderedRgbPage(page.path)).length, page.rows * page.columns * 3); }
    finally { await cleanupRenderedClinicalDocument(rendered); }
  }
});

test("renders a synthetic two-page PDF in page order with distinct RGB content", async (t) => {
  let rendered: Awaited<ReturnType<typeof renderClinicalDocument>> | null = null;
  try {
    rendered = await renderClinicalDocument(twoPagePdf(), "application/pdf");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { t.skip("Poppler pdfinfo/pdftoppm is not available."); return; }
    throw error;
  }
  try {
    assert.equal(rendered.pages.length, 2);
    assert.deepEqual(rendered.pages.map((page) => page.pageNumber), [1, 2]);
    assert.ok(rendered.pages.every((page) => page.rows > 0 && page.columns > 0));
    const pages = await Promise.all(rendered.pages.map((page) => readRenderedRgbPage(page.path)));
    assert.notDeepEqual(pages[0], pages[1]);
  } finally { await cleanupRenderedClinicalDocument(rendered); }
});
