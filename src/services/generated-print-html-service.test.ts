import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAccessionLabelHtml, buildPrinterTestHtml, SERVER_PRINT_FONT_FAMILY } from "./generated-print-html-service.js";

describe("server-owned generated print HTML", () => {
  it("builds an exact-size escaped Arabic label with accession QR content", async () => {
    const html = await buildAccessionLabelHtml({ patientName: "محمد <أحمد>", accessionNumber: "ACC-0008", modality: "CT", appointmentDate: "2026-08-07", mrn: "MRN-8" }, 50, 30);
    assert.match(html, /size: 50mm 30mm/);
    assert.match(html, new RegExp(SERVER_PRINT_FONT_FAMILY));
    assert.match(html, /محمد &lt;أحمد&gt;/);
    assert.match(html, /<svg/);
    assert.match(html, /ACC-0008/);
    assert.doesNotMatch(html, /<أحمد>/);
  });

  it("builds a minimal exact-size printer test with required profile facts", () => {
    const html = buildPrinterTestHtml({ printerName: "Label Queue", documentType: "ACCESSION_LABEL", widthMm: 50, heightMm: 30, orientation: "landscape", customPaperSize: true, rasterize: true, generatedAt: "2026-08-07T12:00:00.000Z" });
    for (const expected of ["size: 50mm 30mm", "Label Queue", "ACCESSION_LABEL", "Orientation: landscape", "Custom media: yes", "Rasterize: yes", "2026-08-07T12:00:00.000Z"]) assert.match(html, new RegExp(expected));
  });
});
