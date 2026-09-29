import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import { buildDefaultSopJsonExample, buildSopJsonExample, confirmDraftSopJsonImport, confirmNewSopJsonImport, exportSopJsonExample, exportSopVersionJson, getSopJsonExampleConfig, inspectNewSopJsonImport, previewDraftSopJsonImport, previewNewSopJsonImport, resetSopJsonExampleConfig, SOP_JSON_EXAMPLE_FILENAME, updateSopJsonExampleConfig } from "./sop-json-import-export-service.js";
import { archiveSopForUser, createSopRevisionForUser, publishSopVersionForUser, updateSopDraftForUser, updateSopOwnerForUser } from "./sop-service.js";
import type { SopDocument } from "./types.js";

function documentWithRichContent(): SopDocument {
  return { type: "sop", version: 1, sections: SOP_SECTION_DEFINITIONS.map((section) => ({ ...section, content: section.key === "purpose" ? { type: "doc", content: [{ type: "heading", attrs: { level: 2, dir: "rtl" }, content: [{ type: "text", text: "سلامة MRI", marks: [{ type: "bold" }] }] }, { type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "يجب التأكد من هوية المريض." }] }] } : section.key === "procedure" ? { type: "doc", content: [{ type: "orderedList", attrs: { dir: "ltr", start: 1 }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "auto" }, content: [{ type: "text", text: "Verify identity" }] }] }] }, { type: "table", attrs: { dir: "auto" }, content: [{ type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null, dir: "auto" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Step" }] }] }] }] }] } : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" }, content: section.required ? [{ type: "text", text: `${section.title} content` }] : [] }] } })) };
}
function payload(code: string, document = documentWithRichContent(), effectiveDate = "2026-10-01") { return { fileName: `${code}-v1.0.json`, fileContentBase64: Buffer.from(JSON.stringify({ format: "rispro-sop", formatVersion: 1, sop: { code, title: "MRI JSON Safety", category: "MRI", version: "1.0", effectiveDate, changeSummary: "Initial JSON issue", document } })).toString("base64") }; }

test("SOP JSON example is canonical, validates through the import parser, and contains no internal metadata", async () => {
  const example = buildSopJsonExample();
  const exported = await exportSopJsonExample();
  const body = JSON.parse(exported.buffer.toString("utf8"));
  assert.equal(exported.filename, SOP_JSON_EXAMPLE_FILENAME);
  assert.deepEqual(body, example);
  assert.deepEqual(body.sop.document.sections.map((section: { key: string }) => section.key), SOP_SECTION_DEFINITIONS.map((section) => section.key));
  assert.equal(body.formatVersion, 1);
  assert.deepEqual(Object.keys(body), ["format", "formatVersion", "sop"]);
  assert.deepEqual(Object.keys(body.sop), ["code", "title", "category", "version", "effectiveDate", "changeSummary", "document"]);
  for (const section of body.sop.document.sections as unknown as Array<{ content: { content: Array<{ attrs?: { dir?: string }; type: string }> } }>) {
    const blocks = section.content.content;
    assert.equal(blocks[0]?.attrs?.dir, "rtl");
    assert.equal(blocks[1]?.attrs?.dir, "ltr");
    const text = JSON.stringify(blocks);
    assert.match(text, /[\u0600-\u06ff]/);
    assert.match(text, /[A-Za-z]/);
    assert.ok(text.indexOf("rtl") < text.indexOf("ltr"), "Arabic content should precede English content");
  }
  const inspected = await inspectNewSopJsonImport({ fileName: exported.filename, fileContentBase64: exported.buffer.toString("base64") }, "supervisor");
  assert.deepEqual(inspected.structuralErrors, []);
  assert.equal(JSON.stringify(body).includes("createdAt"), false);
  assert.equal(JSON.stringify(body).includes("userId"), false);
  assert.equal(JSON.stringify(body).includes("audit"), false);
});

test("editable SOP JSON example uses system settings, validates saves, exports the custom V1 example, and resets without changing SOPs", async () => {
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const username = `sop_json_example_${marker.toLowerCase()}`;
  const user = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id", [username, "SOP JSON example test"]);
  const actor = Number(user.rows[0]!.id);
  const previous = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null; updated_at: Date }>("select setting_value, updated_by_user_id, updated_at from system_settings where category='sops' and setting_key='json_example_v1'");
  const previousRow = previous.rows[0];
  const restoreSetting = async () => {
    await pool.query("delete from system_settings where category='sops' and setting_key='json_example_v1'");
    if (previousRow) {
      await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id,updated_at) values('sops','json_example_v1',$1::jsonb,$2,$3)", [JSON.stringify(previousRow.setting_value), previousRow.updated_by_user_id, previousRow.updated_at]);
    }
  };
  try {
    await pool.query("delete from system_settings where category='sops' and setting_key='json_example_v1'");
    const initial = await getSopJsonExampleConfig("supervisor");
    assert.equal(initial.source, "default");
    assert.deepEqual(initial.config, buildDefaultSopJsonExample());
    await assert.rejects(() => getSopJsonExampleConfig("receptionist"), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
    const defaultDownload = await exportSopJsonExample();
    const defaultBody = JSON.parse(defaultDownload.buffer.toString("utf8"));
    assert.equal(defaultBody.formatVersion, 1);
    const defaultInspect = await inspectNewSopJsonImport({ fileName: defaultDownload.filename, fileContentBase64: defaultDownload.buffer.toString("base64") }, "supervisor");
    assert.deepEqual(defaultInspect.structuralErrors, []);

    const custom = { ...initial.config, code: `RAD-JSON-EXAMPLE-${marker}`, title: "Custom MRI SOP JSON Example" };
    const saved = await updateSopJsonExampleConfig(custom, actor, "supervisor");
    assert.equal(saved.source, "custom");
    assert.deepEqual(saved.config, custom);
    const fetchedSaved = await getSopJsonExampleConfig("super_admin");
    assert.equal(fetchedSaved.source, "custom");
    assert.deepEqual(fetchedSaved.config, custom);
    await assert.rejects(() => updateSopJsonExampleConfig(custom, actor, "receptionist"), (error: unknown) => error instanceof HttpError && error.statusCode === 403);
    const savedSetting = await pool.query<{ setting_value: Record<string, unknown> }>("select setting_value from system_settings where category='sops' and setting_key='json_example_v1'");
    assert.deepEqual(Object.keys(savedSetting.rows[0]!.setting_value).sort(), ["category", "changeSummary", "code", "document", "effectiveDate", "title", "version"]);
    const savedDownload = await exportSopJsonExample();
    const savedBody = JSON.parse(savedDownload.buffer.toString("utf8"));
    assert.equal(savedBody.sop.code, custom.code);
    assert.equal(savedBody.formatVersion, 1);
    assert.deepEqual(Object.keys(savedBody.sop).sort(), ["category", "changeSummary", "code", "document", "effectiveDate", "title", "version"]);
    const inspected = await inspectNewSopJsonImport({ fileName: savedDownload.filename, fileContentBase64: savedDownload.buffer.toString("base64") }, "supervisor");
    assert.deepEqual(inspected.structuralErrors, []);

    const invalidCode = { ...custom, code: "invalid" };
    await assert.rejects(() => updateSopJsonExampleConfig(invalidCode, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const invalidCategory = { ...custom, category: "Unknown" };
    await assert.rejects(() => updateSopJsonExampleConfig(invalidCategory, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const invalidVersion = { ...custom, version: "1" };
    await assert.rejects(() => updateSopJsonExampleConfig(invalidVersion, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const invalidDate = { ...custom, effectiveDate: "2026-02-30" };
    await assert.rejects(() => updateSopJsonExampleConfig(invalidDate, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const emptyChangeSummary = { ...custom, changeSummary: " " };
    await assert.rejects(() => updateSopJsonExampleConfig(emptyChangeSummary, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const contractFields = { ...custom, formatVersion: 2 };
    await assert.rejects(() => updateSopJsonExampleConfig(contractFields, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const missingSection = { ...custom, document: { ...custom.document, sections: custom.document.sections.slice(1) } };
    await assert.rejects(() => updateSopJsonExampleConfig(missingSection, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const unsafeDocument = { ...custom, document: { ...custom.document, sections: custom.document.sections.map((section, index) => index === 0 ? { ...section, content: { type: "doc", content: [{ type: "script" }] } } : section) } };
    await assert.rejects(() => updateSopJsonExampleConfig(unsafeDocument, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
    const missingRequired = { ...custom, document: { ...custom.document, sections: custom.document.sections.map((section, index) => index === 0 ? { ...section, content: { type: "doc", content: [] } } : section) } };
    await assert.rejects(() => updateSopJsonExampleConfig(missingRequired, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400);

    const beforeReset = await pool.query<{ count: string }>("select count(*)::text as count from sops");
    const reset = await resetSopJsonExampleConfig(actor, "supervisor");
    assert.equal(reset.source, "default");
    assert.deepEqual(reset.config, buildDefaultSopJsonExample());
    const afterReset = await pool.query<{ count: string }>("select count(*)::text as count from sops");
    assert.equal(afterReset.rows[0]!.count, beforeReset.rows[0]!.count);
    const resetSetting = await pool.query("select 1 from system_settings where category='sops' and setting_key='json_example_v1'");
    assert.equal(resetSetting.rowCount, 0);
    const resetDownload = await exportSopJsonExample();
    assert.equal(JSON.parse(resetDownload.buffer.toString("utf8")).sop.code, buildDefaultSopJsonExample().code);
    const audit = await pool.query<{ action_type: string; old_values: Record<string, unknown>; new_values: Record<string, unknown>; changed_by_user_id: number }>("select action_type,old_values,new_values,changed_by_user_id from audit_log where entity_type='sop_json_example' and changed_by_user_id=$1 order by id", [actor]);
    assert.deepEqual(audit.rows.map((row) => row.action_type), ["sop_json_example_updated", "sop_json_example_reset"]);
    assert.ok(audit.rows.every((row) => Number(row.changed_by_user_id) === actor));
    assert.equal(audit.rows[0]!.old_values.code, buildDefaultSopJsonExample().code);
    assert.equal(audit.rows[0]!.new_values.code, custom.code);
    assert.equal(audit.rows[1]!.old_values.code, custom.code);
    assert.equal(audit.rows[1]!.new_values.code, buildDefaultSopJsonExample().code);
    assert.ok(audit.rows.every((row) => !("document" in row.old_values) && !("document" in row.new_values)));
  } finally {
    await restoreSetting();
    await pool.query("delete from audit_log where entity_type='sop_json_example' and changed_by_user_id=$1", [actor]);
    await pool.query("delete from users where id=$1", [actor]);
  }
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
    await updateSopOwnerForUser(sopId, { ownerUserId: actor }, actor, "supervisor");
    await publishSopVersionForUser(sopId, "1.0", actor, "supervisor"); const revision = await createSopRevisionForUser(sopId, { version: "1.1", changeSummary: "Revision draft", effectiveDate: "2026-11-01", nextReviewDate: "2026-11-01" }, actor, "supervisor");
    const revisedDocument = documentWithRichContent(); revisedDocument.sections[5]!.content = { type: "doc", content: [{ type: "bulletList", attrs: { dir: "rtl" }, content: [{ type: "listItem", attrs: { dir: "auto" }, content: [{ type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "تأكيد الفحص" }] }] }] }] };
    const revisedInput = payload(code, revisedDocument); const preview = await previewDraftSopJsonImport(sopId, revision.version, revisedInput, "supervisor"); assert.equal(preview.canConfirm, true); assert.equal(preview.sections.find((section) => section.sectionKey === "procedure")?.action, "changed");
    const reviewDateConflict = payload(code, revisedDocument, "2026-11-02"); const conflictPreview = await previewDraftSopJsonImport(sopId, revision.version, reviewDateConflict, "supervisor"); assert.equal(conflictPreview.canConfirm, true);
    await assert.rejects(() => confirmDraftSopJsonImport(sopId, revision.version, { ...reviewDateConflict, expectedDraftUpdatedAt: conflictPreview.targetUpdatedAt! }, actor, "supervisor"), (error: unknown) => error instanceof HttpError && error.statusCode === 400 && error.message === "Next review date cannot be before the effective date.");
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
