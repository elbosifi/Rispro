import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { renderChromiumPdf } from "./chromium-pdf-service.js";
import { buildPrinterTestHtml } from "./generated-print-html-service.js";
import { buildReportCenterHtml } from "./report-center-pdf-service.js";

const executable = process.env.CHROMIUM_EXECUTABLE_PATH || [
  "/usr/bin/chromium",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find(existsSync);

function mediaBox(pdf: Buffer): { width: number; height: number } {
  const match = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
  assert.ok(match, "generated PDF must contain a readable MediaBox");
  return { width: Number(match[1]), height: Number(match[2]) };
}

describe("generated Chromium PDF physical page geometry", { skip: !executable }, () => {
  it("generates a wide 297 x 210 mm A4 landscape printer-test PDF", async () => {
    process.env.CHROMIUM_EXECUTABLE_PATH = executable;
    const html = buildPrinterTestHtml({ documentType: "A4_LANDSCAPE_DOCUMENT", printerName: "Test", widthMm: 297, heightMm: 210, orientation: "landscape", customPaperSize: false, rasterize: false, generatedAt: "2026-08-07T00:00:00.000Z" });
    const box = mediaBox(await renderChromiumPdf({ source: { kind: "html", html }, documentKind: "geometry-test-landscape" }));
    assert.ok(box.width > box.height);
    assert.ok(Math.abs(box.width - 297 * 72 / 25.4) < 2 && Math.abs(box.height - 210 * 72 / 25.4) < 2);
  });

  it("generates landscape and portrait Report Center MediaBoxes from the same renderer", async () => {
    process.env.CHROMIUM_EXECUTABLE_PATH = executable;
    const base = { templateId: "daily-appointments", source: "appointments" as const, title: "Daily", dateLabel: "2026-08-07", columns: [{ key: "patient", label: "Patient" }], rows: [{ patient: "One" }], summaryRows: [] };
    const landscape = mediaBox(await renderChromiumPdf({ source: { kind: "html", html: buildReportCenterHtml({ ...base, orientation: "landscape" }) }, documentKind: "geometry-test-report-landscape", pdfOptions: { margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" } } }));
    const portrait = mediaBox(await renderChromiumPdf({ source: { kind: "html", html: buildReportCenterHtml({ ...base, orientation: "portrait" }) }, documentKind: "geometry-test-report-portrait", pdfOptions: { margin: { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" } } }));
    assert.ok(landscape.width > landscape.height);
    assert.ok(portrait.height > portrait.width);
  });
});
