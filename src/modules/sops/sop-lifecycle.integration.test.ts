import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../../db/pool.js";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import { archiveSopForUser, createSop, createSopRevisionForUser, getSopDetailForUser, getSopVersionForUser, listSops, publishSopVersionForUser, updateSopDraftForUser } from "./sop-service.js";
import type { SopDocument } from "./types.js";

function documentWith(text: string): SopDocument {
  return {
    type: "sop", version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((section) => ({
      ...section,
      content: section.required
        ? { type: "doc", content: [{ type: "paragraph", attrs: { dir: section.key === "purpose" ? "rtl" : "ltr" }, content: [{ type: "text", text: section.key === "purpose" ? `إجراء ${text}` : text }] }] }
        : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" } }] },
    })),
  };
}

test("SOP lifecycle preserves published Unicode versions and enforces authorization", async () => {
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const code = `RAD-E2E-${marker}`;
  const user = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id", [`sop_lifecycle_${marker.toLowerCase()}`, "SOP lifecycle test"]);
  assert.equal(user.rowCount, 1);
  const actor = Number(user.rows[0]!.id);
  let sopId: number | null = null;
  try {
    await assert.rejects(() => createSop({ title: "Denied SOP", code: `RAD-DENY-${marker}`, category: "General", version: "1.0", effectiveDate: "2026-10-01", changeSummary: "Denied", contentJson: documentWith("Denied") }, actor, "receptionist"), (error: unknown) => (error as { statusCode?: number }).statusCode === 403);
    const created = await createSop({ title: "MRI Safety عربية", code: ` rad-e2e-${marker} `, category: "MRI", version: "1.0", effectiveDate: "2026-10-01", changeSummary: "Initial draft", contentJson: documentWith("MRI safety") }, actor, "supervisor");
    sopId = created.sop.id;
    assert.equal(created.sop.code, code);
    assert.equal(created.sop.status, "draft");
    await assert.rejects(() => getSopDetailForUser(sopId, "receptionist"), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
    await updateSopDraftForUser(sopId, "1.0", { title: "MRI Safety عربية", category: "MRI", effectiveDate: "2026-10-02", changeSummary: "Added bilingual guidance", contentJson: documentWith("مصطلح MRI") }, actor, "supervisor");

    const publishResults = await Promise.allSettled([
      publishSopVersionForUser(sopId, "1.0", actor, "supervisor"),
      publishSopVersionForUser(sopId, "1.0", actor, "supervisor"),
    ]);
    assert.equal(publishResults.filter((result) => result.status === "fulfilled").length, 1);
    const published = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(published.sop.currentVersion, "1.0");
    assert.equal(published.versions[0]!.status, "published");
    assert.match(JSON.stringify(published.versions[0]!.contentJson), /مصطلح MRI/);
    await assert.rejects(() => updateSopDraftForUser(sopId, "1.0", { title: "Changed", category: "MRI", effectiveDate: "2026-10-02", changeSummary: "No", contentJson: documentWith("No") }, actor, "supervisor"), (error: unknown) => (error as { statusCode?: number }).statusCode === 409);

    const revision = await createSopRevisionForUser(sopId, { version: "2.0", changeSummary: "Updated safety language", effectiveDate: "2026-11-01" }, actor, "supervisor");
    assert.equal(revision.status, "draft");
    assert.match(JSON.stringify(revision.contentJson), /مصطلح MRI/);
    const beforeRevisionPublish = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(beforeRevisionPublish.sop.currentVersion, "1.0");
    assert.equal(beforeRevisionPublish.sop.draftVersion, null);
    assert.equal(beforeRevisionPublish.sop.title, published.sop.title);
    assert.equal(beforeRevisionPublish.sop.category, published.sop.category);
    assert.equal(beforeRevisionPublish.versions.length, 1);
    assert.equal((await listSops({ search: code }, "receptionist"))[0]?.currentVersion, "1.0");
    await assert.rejects(() => updateSopDraftForUser(sopId, "2.0", { title: "Changed published title", category: "CT", effectiveDate: "2026-11-01", changeSummary: "Rejected metadata", contentJson: documentWith("Rejected metadata") }, actor, "supervisor"), (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    const supervisorRevision = await getSopDetailForUser(sopId, "supervisor");
    assert.equal(supervisorRevision.sop.draftVersion, "2.0");
    assert.equal(supervisorRevision.versions.some((item) => item.version === "2.0" && item.status === "draft"), true);
    await assert.rejects(() => getSopVersionForUser(sopId, "2.0", "receptionist"), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
    await updateSopDraftForUser(sopId, "2.0", { title: "MRI Safety عربية", category: "MRI", effectiveDate: "2026-11-01", changeSummary: "Published revision", contentJson: documentWith("Revision MRI") }, actor, "supervisor");
    await publishSopVersionForUser(sopId, "2.0", actor, "supervisor");
    const afterRevision = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(afterRevision.sop.currentVersion, "2.0");
    assert.equal(afterRevision.versions.find((item) => item.version === "1.0")?.status, "superseded");
    assert.match(JSON.stringify(afterRevision.versions.find((item) => item.version === "1.0")?.contentJson), /مصطلح MRI/);
    await archiveSopForUser(sopId, actor, "supervisor");
    assert.equal((await listSops({ search: code }, "receptionist")).length, 0);
    assert.equal((await listSops({ search: code, status: "archived" }, "supervisor")).length, 1);
    const auditRows = await pool.query<{ action_type: string; new_values: Record<string, unknown> }>("select action_type, new_values from audit_log where entity_type='sop' and entity_id=$1 order by id", [sopId]);
    assert.deepEqual(new Set(auditRows.rows.map((row) => row.action_type)), new Set(["sop_created", "sop_draft_updated", "sop_published", "sop_revision_created", "sop_archived"]));
    assert.equal(auditRows.rows.some((row) => JSON.stringify(row.new_values).includes("content_json")), false);
  } finally {
    if (sopId != null) {
      await pool.query("delete from audit_log where entity_type='sop' and entity_id=$1", [sopId]);
      await pool.query("delete from sop_versions where sop_id=$1", [sopId]);
      await pool.query("delete from sops where id=$1", [sopId]);
    }
    await pool.query("delete from users where id=$1", [actor]);
  }
});
