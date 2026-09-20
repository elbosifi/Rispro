import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import { __sopPrintTestables, buildSopPdfFooterTemplate, buildSopPrintHtml, deriveSopPrintStatus } from "./sop-print-service.js";
import type { SopDocument, SopSummary, SopVersion } from "./types.js";

const content = (value: unknown) => ({ type: "doc", content: value ? [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: value }] }] : [{ type: "paragraph", attrs: { dir: "auto" } }] });

function fixtureContent(): SopDocument {
  return {
    type: "sop",
    version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((definition) => ({
      ...definition,
      content: content(definition.key === "purpose" ? "يجب إكمال MRI safety screening قبل دخول المريض إلى غرفة الفحص." : definition.key === "scope" ? "English scope with <script>alert(1)</script> and <img src=x onerror=alert(1)>" : definition.key === "responsibilities" ? "Radiology team" : definition.key === "procedure" ? {
        ignored: "only text fixture",
      } : undefined),
    })).map((section) => section.key === "procedure" ? {
      ...section,
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2, dir: "ltr", textAlign: "center" }, content: [{ type: "text", text: "Procedure" }] },
          { type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "راجع " }, { type: "text", text: "MRI protocol", marks: [{ type: "bold" }] }, { type: "text", text: " قبل البدء.", marks: [{ type: "italic" }] }, { type: "hardBreak" }, { type: "text", text: "Underlined", marks: [{ type: "underline" }] }] },
          { type: "orderedList", attrs: { dir: "rtl" }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Verify identity" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Complete screening" }] }] }] },
          { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { dir: "rtl" }, content: [{ type: "paragraph", content: [{ type: "text", text: "الفحص" }] }] }, { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "English" }] }] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "MRI" }] }] }, { type: "tableCell", attrs: { dir: "rtl" }, content: [{ type: "paragraph", content: [{ type: "text", text: "معلومات" }] }] }] }] },
        ],
      },
    } : section),
  };
}

const sop = { id: 7, code: "RAD-MRI-001", title: "MRI Safety Screening", category: "MRI", status: "published", currentVersion: "1.0", draftVersion: null, currentEffectiveDate: "2026-09-19", createdByUserId: 1, createdByName: "Supervisor", createdAt: "2026-09-19T08:00:00.000Z", updatedByUserId: 1, updatedByName: "Supervisor", updatedAt: "2026-09-19T08:00:00.000Z" } as SopSummary;
const version = { id: 9, sopId: 7, version: "1.0", status: "published", contentJson: fixtureContent(), changeSummary: "Initial bilingual SOP", effectiveDate: "2026-09-19", createdByUserId: 1, createdByName: "Supervisor", createdByUsername: "supervisor", createdAt: "2026-09-19T08:00:00.000Z", updatedByUserId: 1, updatedByName: "Supervisor", updatedAt: "2026-09-19T08:00:00.000Z", publishedByUserId: 1, publishedByName: "Supervisor", publishedByUsername: "supervisor", publishedAt: "2026-09-19T08:05:00.000Z" } as SopVersion;

describe("SOP print renderer", () => {
  it("renders the official bilingual A4 document and rich structured content", () => {
    const html = buildSopPrintHtml({ sop, version, status: "CURRENT", generatedAt: new Date("2026-09-19T09:00:00Z") });

    assert.match(html, /@page \{ size: A4 portrait;/);
    assert.match(html, /National Cancer Center Benghazi/);
    assert.match(html, /Diagnostic & Interventional Radiology Department/);
    assert.match(html, /المركز الوطني للأورام بنغازي/);
    assert.match(html, /قسم الأشعة التشخيصية والتداخلية/);
    assert.match(html, /إجراء تشغيلي قياسي/);
    assert.match(html, /STANDARD OPERATING PROCEDURE/);
    assert.match(html, /MRI Safety Screening/);
    assert.match(html, /RAD-MRI-001/);
    assert.match(html, /19 September 2026/);
    for (const label of ["Purpose", "Scope", "Responsibilities", "Procedure"]) assert.match(html, new RegExp(label));
    assert.match(html, /الغرض/);
    assert.match(html, /<strong>MRI protocol<\/strong>/);
    assert.match(html, /<em> قبل البدء\.<\/em>/);
    assert.match(html, /<u>Underlined<\/u>/);
    assert.match(html, /<ol dir="rtl">/);
    assert.match(html, /<thead><tr/);
    assert.match(html, /<th dir="rtl">/);
    assert.match(html, /text-align:center/);
    assert.match(html, /data:image\/png;base64,/);
    const fontFaces = html.match(/@font-face\{[^}]*\}/g) ?? [];
    assert.equal(fontFaces.length, 2);
    assert.deepEqual(
      fontFaces.map((fontFace) => fontFace.match(/font-weight:(\d+)/)?.[1]).sort(),
      ["400", "700"],
    );
    for (const fontFace of fontFaces) {
      assert.match(fontFace, /font-family:"Noto Naskh Arabic"/);
      assert.match(fontFace, /src:url\(data:font\/ttf;base64,[A-Za-z0-9+/=]+\)/);
    }
    assert.doesNotMatch(html, /status-watermark[^<]*CURRENT/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/i);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img src=x/i);
    assert.doesNotMatch(html, /<script/i);
    assert.match(html, /Revision information/);
    assert.match(html, /Initial bilingual SOP/);
    assert.match(html, /overflow-wrap: anywhere/);
    assert.match(html, /break-after: avoid-page/);
  });

  it("omits empty optional sections but keeps required sections", () => {
    const html = buildSopPrintHtml({ sop, version, status: "CURRENT", generatedAt: new Date() });
    assert.equal((html.match(/Definitions \/ Abbreviations/g) ?? []).length, 0);
    assert.doesNotMatch(html, /Documentation \/ Records/);
    assert.doesNotMatch(html, /References/);
  });

  it("marks draft, superseded, and archived documents without marking current documents", () => {
    for (const status of ["DRAFT", "SUPERSEDED", "ARCHIVED"] as const) {
      const html = buildSopPrintHtml({ sop, version: { ...version, status: status === "DRAFT" ? "draft" : "superseded" }, status, generatedAt: new Date() });
      assert.match(html, new RegExp(`status-watermark[\\s\\S]*${status}`));
      assert.match(html, new RegExp(`status-pill ${status.toLowerCase()}`));
    }
    assert.equal(deriveSopPrintStatus(sop, version), "CURRENT");
    assert.equal(deriveSopPrintStatus({ ...sop, currentVersion: "1.1" }, version), "SUPERSEDED");
    assert.equal(deriveSopPrintStatus(sop, { ...version, status: "draft" }), "DRAFT");
    assert.equal(deriveSopPrintStatus({ ...sop, status: "archived" }, version), "ARCHIVED");
  });

  it("uses native PDF page counters and a safe footer filename contract", () => {
    const footer = buildSopPdfFooterTemplate("RAD-MRI-001", "1.0");
    assert.match(footer, /RAD-MRI-001 · Version 1\.0/);
    assert.match(footer, /class="pageNumber"/);
    assert.match(footer, /class="totalPages"/);
    assert.equal(__sopPrintTestables.escapeHtml("<img onerror='x'>"), "&lt;img onerror=&#39;x&#39;&gt;");
  });
});
