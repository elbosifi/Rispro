import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ageAtExamination, reportCalendarDate, buildAccessionLabelHtml, buildIrSpecimenLabelHtml, buildNativeReportHtml, buildPrinterTestHtml, SERVER_PRINT_FONT_FAMILY } from "./generated-print-html-service.js";
import { EMPTY_INSTITUTION_IDENTITY } from "./institution-identity-service.js";

describe("server-owned generated print HTML", () => {
  it("uses the examination calendar date for age and omits incomplete or unreliable dates", () => {
    assert.equal(ageAtExamination("20170101","20261029"),"9 y");
    assert.equal(ageAtExamination("2025-11-02","2026-11-01"),"11 mo");
    assert.equal(ageAtExamination("20261102","20261101"),"");
    assert.equal(ageAtExamination("2017","20261029"),"");
    assert.equal(reportCalendarDate("20260230"),"");
  });
  it("prints compact bilingual A4 reports with 0, 1 and 5 key images, preserving narrative whitespace", () => {
    const report = {appointmentId:1,status:"final",identity:{patientName:"Synthetic",patientIdentifier:"TEST",accession:"ACC",examination:"MRI Brain with IV Contrast",studyDate:"20261029",birthDate:"20170101",sex:"M",modality:"MR"},institution:{...EMPTY_INSTITUTION_IDENTITY,hospitalNameEn:"Synthetic Hospital",hospitalNameAr:"مستشفى تجريبي"},sections:{clinicalHistory:"",technique:"Technique",findings:"Line one\nLine two\n\nParagraph two",impression:"Impression"},author:"Author",finalizer:"Authorized Signer",finalizedAt:new Date("2026-10-29T10:47:00Z"),keyImages:[],addenda:[]};
    for (const count of [0,1,5]) {
      const html = buildNativeReportHtml({...report,keyImages:Array.from({length:count},(_,i)=>({id:`image-${i}`,caption:`Caption ${i}`,provenance:{}}))});
      assert.equal((html.match(/<figure>/g)||[]).length,count);
      assert.equal(html.includes('<section class="key-images">'),count>0);
      assert.match(html,/size:A4 portrait/);assert.match(html,/dir="rtl" lang="ar"/);assert.match(html,/9 y/);
      assert.match(html,/Line one\nLine two\n\nParagraph two/);assert.match(html,/FINAL \/ SIGNED/);
      assert.doesNotMatch(html,/<ul|<ol|Clinical Data|DRAFT \/ UNSIGNED<\/div>/);
      assert.equal((html.match(/MRI Brain with IV Contrast/g)||[]).length,1);
      assert.match(html,/counter\(page\)/);
    }
    const missing = buildNativeReportHtml({...report,institution:null,identity:{patientName:"",patientIdentifier:"",accession:"",examination:"",studyDate:""}});
    assert.doesNotMatch(missing,/<table class="metadata"/);assert.match(missing,/identity was not recorded/);
  });
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
