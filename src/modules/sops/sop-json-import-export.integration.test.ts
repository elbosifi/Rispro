import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import { buildSopJsonExample, confirmDraftSopJsonImport, confirmNewSopJsonImport, exportSopJsonExample, exportSopVersionJson, inspectNewSopJsonImport, previewDraftSopJsonImport, previewNewSopJsonImport, SOP_JSON_EXAMPLE_FILENAME } from "./sop-json-import-export-service.js";
import { archiveSopForUser, createSopRevisionForUser, publishSopVersionForUser, updateSopDraftForUser } from "./sop-service.js";
import type { SopDocument } from "./types.js";

function documentWithRichContent(): SopDocument {
  return { type: "sop", version: 1, sections: SOP_SECTION_DEFINITIONS.map((section) => ({ ...section, content: section.key === "purpose" ? { type: "doc", content: [{ type: "heading", attrs: { level: 2, dir: "rtl" }, content: [{ type: "text", text: "سلامة MRI", marks: [{ type: "bold" }] }] }, { type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "يجب التأكد من هوية المريض." }] }] } : section.key === "procedure" ? { type: "doc", content: [{ type: "orderedList", attrs: { dir: "ltr", start: 1 }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Verify identity" }] }] }] }, { type: "table", attrs: { dir: "auto" }, content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null, dir: "auto" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Step" }] }] }] }] }] } : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" }, content: section.required ? [{ type: "text", text: `${section.title} content` }] : [] }] } })) };
}
function payload(code: string, document = documentWithRichContent()) { return { fileName: `${code}-v1.0.json`, fileContentBase64: Buffer.from(JSON.stringify({ format: "rispro-sop", formatVersion: 1, sop: { code, title: "MRI JSON Safety", category: "MRI", version: "1.0", effectiveDate: "2026-10-01", changeSummary: "Initial JSON issue", document } })).toString("base64") }; }

test("SOP JSON example is canonical, validates through the import parser, and contains no internal metadata", async () => {
  const example = buildSopJsonExample();
  const exported = exportSopJsonExample();
  const body = JSON.parse(exported.buffer.toString("utf8"));
  assert.equal(exported.filename, SOP_JSON_EXAMPLE_FILENAME);
  assert.deepEqual(body, example);
  assert.deepEqual(body.sop.document.sections.map((section: { key: string }) => section.key), SOP_SECTION_DEFINITIONS.map((section) => section.key));
  const inspected = await inspectNewSopJsonImport({ fileName: exported.filename, fileContentBase64: exported.buffer.toString("base64") }, "supervisor");
  assert.deepEqual(inspected.structuralErrors, []);
  assert.equal(JSON.stringify(body).includes("createdAt"), false);
  assert.equal(JSON.stringify(body).includes("userId"), false);
  assert.equal(JSON.stringify(body).includes("audit"), false);
});

test("SOP JSON import creates a draft, preserves rich content, exports canonically, and safely updates a revision draft", async () => {
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase(); const code = `RAD-JSON-${marker}`;
  const user = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id", [`sop_json_${marker.toLowerCase()}`, "SOP JSON test"]); const actor = Number(user.rows[0]!.id); let sopId: number | null = null;
  try {
    const input = payload(code); const inspected = await inspectNewSopJsonImport(input, "supervisor"); assert.deepEqual(inspected.structuralErrors, []);
    await assert.rejects(() => confirmNewSopJsonImport(input, actor, "receptionist"), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
    const created = await confirmNewSopJsonImport(input, actor, "supervisor"); sopId = created.sop.id; assert.equal(created.sop.status, "draft"); assert.match(JSON.stringify(created.version.contentJson), /سلامة MRI/); assert.match(JSON.stringify(created.version.contentJson), /tableHeader/);
    const exported = await exportSopVersionJson(sopId, "1.0", "supervisor"); assert.equal(exported.filename, `${code}-v1.0.json`); const exportedBody = JSON.parse(exported.buffer.toString("utf8")); assert.deepEqual(Object.keys(exportedBody), ["format", "formatVersion", "sop"]); assert.equal(JSON.stringify(exportedBody).includes("createdAt"), false); assert.deepEqual(exportedBody.sop.document, created.version.contentJson);
    const duplicate = await previewNewSopJsonImport(input, "supervisor"); assert.equal(duplicate.canConfirm, false); await assert.rejects(() => confirmNewSopJsonImport(input, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 409);
    await publishSopVersionForUser(sopId, "1.0", actor, "supervisor"); const revision = await createSopRevisionForUser(sopId, { version: "1.1", changeSummary: "Revision draft", effectiveDate: "2026-11-01" }, actor, "supervisor");
    const revisedDocument = documentWithRichContent(); revisedDocument.sections[5]!.content = { type: "doc", content: [{ type: "bulletList", attrs: { dir: "rtl" }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "تأكيد الفحص" }] }] }] }] };
    const revisedInput = payload(code, revisedDocument); const preview = await previewDraftSopJsonImport(sopId, revision.version, revisedInput, "supervisor"); assert.equal(preview.canConfirm, true); assert.equal(preview.sections.find((section) => section.sectionKey === "procedure")?.action, "changed");
    await updateSopDraftForUser(sopId, revision.version, { title: created.sop.title, category: created.sop.category, effectiveDate: "2026-11-01", changeSummary: "Touched", contentJson: revision.contentJson }, actor, "supervisor");
    await assert.rejects(() => confirmDraftSopJsonImport(sopId, revision.version, { ...revisedInput, expectedDraftUpdatedAt: preview.targetUpdatedAt! }, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 409);
    const refreshed = await previewDraftSopJsonImport(sopId, revision.version, revisedInput, "supervisor"); const updated = await confirmDraftSopJsonImport(sopId, revision.version, { ...revisedInput, expectedDraftUpdatedAt: refreshed.targetUpdatedAt! }, actor, "supervisor"); assert.equal(updated.version.status, "draft"); assert.match(JSON.stringify(updated.version.contentJson), /تأكيد الفحص/);
    const audit = await pool.query<{ new_values: Record<string, unknown> }>("select new_values from audit_log where entity_type='sop' and entity_id=$1 and action_type='sop_json_imported'", [sopId]); assert.equal(audit.rowCount, 2); assert.equal(JSON.stringify(audit.rows).includes("تأكيد الفحص"), false);
    await archiveSopForUser(sopId, actor, "supervisor"); await assert.rejects(() => previewDraftSopJsonImport(sopId, revision.version, revisedInput, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 409);
  } finally { if (sopId != null) { await pool.query("delete from audit_log where entity_type='sop' and entity_id=$1", [sopId]); await pool.query("delete from sop_versions where sop_id=$1", [sopId]); await pool.query("delete from sops where id=$1", [sopId]); } await pool.query("delete from users where id=$1", [actor]); }
});

test("SOP JSON parser rejects malformed wrappers, invalid metadata, missing sections, and unsafe nodes", async () => {
  const code = "RAD-JSON-INVALID"; const base = payload(code); const parse = (mutate: (value: any) => void) => { const value = JSON.parse(Buffer.from(base.fileContentBase64, "base64").toString("utf8")); mutate(value); return { ...base, fileContentBase64: Buffer.from(JSON.stringify(value)).toString("base64") }; };
  await assert.rejects(() => inspectNewSopJsonImport({ ...base, fileContentBase64: Buffer.from("{").toString("base64") }, "supervisor"), /not valid JSON/);
  await assert.rejects(() => inspectNewSopJsonImport(parse((value) => { value.format = "other"; }), "supervisor"), /not a RISpro SOP/);
  await assert.rejects(() => inspectNewSopJsonImport(parse((value) => { value.formatVersion = 2; }), "supervisor"), /Unsupported RISpro SOP JSON format version/);
  assert.ok((await inspectNewSopJsonImport(parse((value) => { value.sop.code = "bad"; }), "supervisor")).structuralErrors.length);
  assert.ok((await inspectNewSopJsonImport(parse((value) => { value.sop.document.sections.pop(); }), "supervisor")).structuralErrors.length);
  assert.ok((await inspectNewSopJsonImport(parse((value) => { value.sop.document.sections[0].content = { type: "html", html: "<script>alert(1)</script>" }; }), "supervisor")).structuralErrors.length);
});
