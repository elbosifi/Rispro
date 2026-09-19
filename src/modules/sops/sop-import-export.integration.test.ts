import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../../db/pool.js";
import { buildWorkbookBuffer, readWorkbookFromBase64 } from "../../services/workbook-service.js";
import { HttpError } from "../../utils/http-error.js";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import {
  confirmSopXlsxImport,
  exportSopVersionXlsx,
  inspectSopXlsxImport,
  previewSopXlsxImport,
  sopPlainTextToContent,
  sopSectionContentToPlainText,
} from "./sop-import-export-service.js";
import { createSop, createSopRevisionForUser, getSopDetailForUser, publishSopVersionForUser, updateSopDraftForUser } from "./sop-service.js";
import type { SopDocument } from "./types.js";

function documentWithRichContent(): SopDocument {
  return {
    type: "sop",
    version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((section) => {
      if (section.key === "purpose") return { ...section, content: { type: "doc", content: [{ type: "heading", attrs: { level: 2, dir: "rtl" }, content: [{ type: "text", text: "سلامة MRI" }] }, { type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "يجب التأكد من هوية المريض قبل بدء الفحص." }] }] } };
      if (section.key === "scope") return { ...section, content: { type: "doc", content: [{ type: "paragraph", attrs: { dir: "ltr" }, content: [{ type: "text", text: "Applies to MRI staff", marks: [{ type: "bold" }] }] }] } };
      if (section.key === "safety") return { ...section, content: { type: "doc", content: [{ type: "bulletList", attrs: { dir: "auto" }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Remove metal objects" }] }] }, { type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Confirm MRI safety screening" }] }] }] }] } };
      if (section.key === "procedure") return { ...section, content: { type: "doc", content: [{ type: "orderedList", attrs: { dir: "auto", start: 1 }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Verify identity" }] }] }, { type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Complete screening" }] }] }] }] } };
      return { ...section, content: section.required ? { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Content" }] }] } : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" } }] } };
    }),
  };
}

async function workbookWithChanges(base64: string, changes: Record<string, unknown>, sectionChanges: Record<string, string> = {}): Promise<string> {
  const { XLSX, workbook } = await readWorkbookFromBase64(base64);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.SOP, { defval: "", raw: false });
  const changedRows = rows.map((row, index) => index === 0 ? { ...row, ...changes } : sectionChanges[String(row.section_key)] === undefined ? row : { ...row, content: sectionChanges[String(row.section_key)] });
  return (await buildWorkbookBuffer([{ name: "SOP", headers: Object.keys(rows[0] ?? {}), rows: changedRows }])).toString("base64");
}

test("SOP XLSX round trip preserves unchanged rich JSON and imports Arabic/list edits into a draft", async () => {
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const code = `RAD-XLSX-${marker}`;
  const user = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id", [`sop_xlsx_${marker.toLowerCase()}`, "SOP XLSX test"]);
  const actor = Number(user.rows[0]!.id);
  let sopId: number | null = null;
  try {
    const created = await createSop({ title: "MRI Safety XLSX", code, category: "MRI", version: "1.0", effectiveDate: "2026-10-01", changeSummary: "Initial bilingual SOP", contentJson: documentWithRichContent() }, actor, "supervisor");
    sopId = created.sop.id;
    const draftExport = await exportSopVersionXlsx(sopId, "1.0", "supervisor");
    assert.match(draftExport.filename, new RegExp(`^${code}-v1\\.0\\.xlsx$`));
    const workbook = await readWorkbookFromBase64(draftExport.buffer.toString("base64"));
    assert.deepEqual(workbook.sheetNames, ["SOP"]);
    const rows = workbook.XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.workbook.Sheets.SOP, { defval: "", raw: false });
    assert.equal(rows.length, 8);
    assert.equal(rows[0]!.format_version, "1");
    assert.equal(rows[0]!.sop_code, code);
    assert.equal(rows[0]!.source_version, "1.0");
    assert.match(String(rows[0]!.content), /سلامة MRI/);
    assert.match(String(rows[5]!.content), /1\. Verify identity\n2\. Complete screening/);
    assert.match(String(rows[4]!.content), /- Remove metal objects\n- Confirm MRI safety screening/);
    await assert.rejects(() => exportSopVersionXlsx(sopId, "1.0", "receptionist"), (error: unknown) => error instanceof HttpError && error.statusCode === 404);

    const inspect = await inspectSopXlsxImport(sopId, "1.0", { fileContentBase64: draftExport.buffer.toString("base64"), fileName: draftExport.filename }, "supervisor");
    assert.deepEqual(inspect.structuralErrors, []);
    assert.equal(inspect.sectionCount, 8);
    const unchanged = await previewSopXlsxImport(sopId, "1.0", { fileContentBase64: draftExport.buffer.toString("base64"), fileName: draftExport.filename }, "supervisor");
    assert.equal(unchanged.canConfirm, true);
    assert.equal(unchanged.sections.filter((section) => section.action === "changed").length, 0);
    const originalScopeJson = JSON.stringify(created.version.contentJson.sections.find((section) => section.key === "scope")?.content);

    await updateSopDraftForUser(sopId, "1.0", {
      title: "MRI Safety XLSX",
      category: "MRI",
      effectiveDate: "2026-10-01",
      changeSummary: "Touched after preview",
      contentJson: created.version.contentJson,
    }, actor, "supervisor");
    await assert.rejects(
      () => confirmSopXlsxImport(sopId, "1.0", { fileContentBase64: draftExport.buffer.toString("base64"), fileName: draftExport.filename, expectedDraftUpdatedAt: unchanged.targetUpdatedAt }, actor, "supervisor"),
      (error: unknown) => error instanceof HttpError && error.statusCode === 409 && error.message.includes("Preview the workbook again"),
    );

    await publishSopVersionForUser(sopId, "1.0", actor, "supervisor");
    const revision = await createSopRevisionForUser(sopId, { version: "1.1", changeSummary: "XLSX revision", effectiveDate: "2026-11-01" }, actor, "supervisor");
    const revisionExport = await exportSopVersionXlsx(sopId, revision.version, "supervisor");
    const modifiedBase64 = await workbookWithChanges(draftExport.buffer.toString("base64"), {
      content: "Purpose updated: يجب التأكد من هوية المريض قبل بدء الفحص.\nMRI safety screening يجب إكماله قبل دخول المريض.",
      change_summary: "Imported Arabic XLSX revision",
    }, { procedure: "1. Verify identity\n2. Complete updated safety screening" });
    const preview = await previewSopXlsxImport(sopId, revision.version, { fileContentBase64: modifiedBase64, fileName: revisionExport.filename }, "supervisor");
    assert.equal(preview.sourceVersion, "1.0");
    assert.equal(preview.targetVersion, "1.1");
    assert.equal(preview.sections.find((section) => section.sectionKey === "purpose")?.action, "changed");
    assert.equal(preview.sections.find((section) => section.sectionKey === "scope")?.action, "unchanged");
    assert.equal(preview.sections.find((section) => section.sectionKey === "procedure")?.action, "changed");
    assert.equal(preview.changeSummary.changed, true);
    assert.equal(preview.canConfirm, true);
    const confirmed = await confirmSopXlsxImport(sopId, revision.version, { fileContentBase64: modifiedBase64, fileName: revisionExport.filename, expectedDraftUpdatedAt: preview.targetUpdatedAt }, actor, "supervisor");
    assert.deepEqual(confirmed.summary.changedSectionKeys, ["purpose", "procedure"]);
    assert.equal(confirmed.version.status, "draft");
    assert.equal(confirmed.version.version, "1.1");
    assert.equal(confirmed.version.changeSummary, "Imported Arabic XLSX revision");
    const loaded = await getSopDetailForUser(sopId, "supervisor");
    const loadedPurpose = loaded.versions.find((version) => version.version === "1.1")!.contentJson.sections.find((section) => section.key === "purpose")!.content;
    const loadedScope = loaded.versions.find((version) => version.version === "1.1")!.contentJson.sections.find((section) => section.key === "scope")!.content;
    assert.match(JSON.stringify(loadedPurpose), /يجب التأكد من هوية المريض/);
    const loadedProcedure = loaded.versions.find((version) => version.version === "1.1")!.contentJson.sections.find((section) => section.key === "procedure")!.content;
    assert.match(JSON.stringify(loadedProcedure), /updated safety screening/);
    assert.deepEqual(JSON.stringify(loadedScope), originalScopeJson);
    assert.equal(loaded.sop.currentVersion, "1.0");
    assert.equal((await getSopDetailForUser(sopId, "receptionist")).sop.currentVersion, "1.0");
    const audit = await pool.query<{ new_values: Record<string, unknown> }>("select new_values from audit_log where entity_type='sop' and entity_id=$1 and action_type='sop_xlsx_imported'", [sopId]);
    assert.equal(audit.rowCount, 1);
    assert.equal(JSON.stringify(audit.rows[0]!.new_values).includes("يجب التأكد"), false);
  } finally {
    if (sopId != null) {
      await pool.query("delete from audit_log where entity_type='sop' and entity_id=$1", [sopId]);
      await pool.query("delete from sop_versions where sop_id=$1", [sopId]);
      await pool.query("delete from sops where id=$1", [sopId]);
    }
    await pool.query("delete from users where id=$1", [actor]);
  }
});

test("SOP XLSX text conversion preserves Arabic and normalizes changed lists", () => {
  const text = "\r\n- سلامة MRI  \r\n- Check identity\n\n1. First\n2. Second\n";
  const content = sopPlainTextToContent(text);
  assert.equal(sopSectionContentToPlainText(content), "- سلامة MRI\n- Check identity\n1. First\n2. Second");
  assert.equal(JSON.stringify(content).includes('"dir":"auto"'), true);
});
