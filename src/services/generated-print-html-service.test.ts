import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAccessionLabelHtml, buildIrSpecimenLabelHtml, buildNativeReportHtml, buildPrinterTestHtml, SERVER_PRINT_FONT_FAMILY } from "./generated-print-html-service.js";

describe("server-owned generated print HTML", () => {
  it("prints saved narrative text, ordered protected images and signed addenda with escaped content",()=>{
    const report={appointmentId:42,status:"draft",identity:{patientName:"SYNTHETIC <patient>",patientIdentifier:"TEST-42",accession:"V2-000042",examination:"Synthetic CT",studyDate:"2026-10-26"},sections:{findings:"<script>not markup</script>",impression:"Synthetic impression"},author:"Synthetic author",finalizer:null,finalizedAt:null,keyImages:[{id:"image-b",caption:"Second & chosen first",provenance:{sourceStudyDate:"20261001",prior:true}},{id:"image-a",caption:"Current",provenance:{sourceStudyDate:"20261026"}}],addenda:[{text:"Append only",author:"Signer",signedAt:"2026-10-26T10:00:00Z"}]};
    const html=buildNativeReportHtml(report);
    assert.match(html,/DRAFT/);assert.match(html,/&lt;script&gt;not markup&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
    assert.ok(html.indexOf('/images/image-b')<html.indexOf('/images/image-a'));assert.match(html,/prior study/);assert.match(html,/Append only/);assert.match(html,/object-fit:contain/);
    assert.doesNotMatch(buildNativeReportHtml({...report,status:"final"}),/<div class="draft">/);
  });
  it("builds an exact-size escaped Arabic label with accession QR content", async () => {
    const html = await buildAccessionLabelHtml({ patientName: "محمد <أحمد>", accessionNumber: "ACC-0008", modality: "CT", appointmentDate: "2026-08-07", mrn: "MRN-8" }, 50, 30);
    assert.match(html, /size: 50mm 30mm/);
    assert.match(html, new RegExp(SERVER_PRINT_FONT_FAMILY));
    assert.match(html, /محمد &lt;أحمد&gt;/);
    assert.match(html, /<svg/);
    assert.match(html, /ACC-0008/);
    assert.doesNotMatch(html, /<أحمد>/);
  });

  it("builds an exact-size escaped IR specimen label without QR or extra clinical fields", () => {
    const html = buildIrSpecimenLabelHtml({ patientName: "Patient <unsafe>", accessionNumber: "V2-000123", printedAt: new Date("2026-08-14T21:24:00.000Z"), specimenText: "Liver <lesion> biopsy" }, 50, 30);
    for (const expected of ["size: 50mm 30mm", SERVER_PRINT_FONT_FAMILY, "Patient &lt;unsafe&gt;", "V2-000123", "14/08/2026 23:24", "Liver &lt;lesion&gt; biopsy"]) assert.match(html, new RegExp(expected));
    for (const absent of ["<svg", "QR", "MRN", "Procedure date", "Collection time"]) assert.doesNotMatch(html, new RegExp(absent));
  });

  it("wraps a long Arabic IR patient name over at most two prominent lines", () => {
    const html = buildIrSpecimenLabelHtml({ patientName: "المريض محمد عبد الرحمن أحمد الساعدي الطويل جداً", accessionNumber: "V2-000123", printedAt: "14/08/2026 23:24", specimenText: "Liver lesion biopsy" }, 50, 30);
    assert.match(html, /المريض محمد عبد الرحمن أحمد الساعدي الطويل جداً/);
    assert.match(html, /strong \{[^}]*max-height: 2\.3em[^}]*overflow-wrap: anywhere/);
    assert.doesNotMatch(html, /strong \{[^}]*white-space: nowrap/);
    assert.doesNotMatch(html, /strong \{[^}]*text-overflow: ellipsis/);
  });

  it("builds a minimal exact-size printer test with required profile facts", () => {
    const html = buildPrinterTestHtml({ printerName: "Label Queue", documentType: "ACCESSION_LABEL", widthMm: 50, heightMm: 30, orientation: "landscape", customPaperSize: true, rasterize: true, generatedAt: "2026-08-07T12:00:00.000Z" });
    for (const expected of ["size: 50mm 30mm", "Label Queue", "ACCESSION_LABEL", "Orientation: landscape", "Custom media: yes", "Rasterize: yes", "2026-08-07T12:00:00.000Z"]) assert.match(html, new RegExp(expected));
  });
});
