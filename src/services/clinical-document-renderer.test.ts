import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { cleanupRenderedClinicalDocument, readRenderedRgbPage, renderClinicalDocument } from "./clinical-document-renderer.js";

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
