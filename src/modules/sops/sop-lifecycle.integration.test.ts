import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../../db/pool.js";
import { getTripoliToday } from "../../utils/date.js";
import { addCalendarYears } from "./sop-validation.js";
import { SOP_SECTION_DEFINITIONS } from "./constants.js";
import {
  archiveSopForUser,
  createSop,
  createSopRevisionForUser,
  getSopDetailForUser,
  getSopMeta,
  getSopPrintDocumentForUser,
  getSopVersionForUser,
  listSops,
  publishSopVersionForUser,
  reviewSopNoChangesForUser,
  updateSopDraftForUser,
  updateSopOwnerForUser,
} from "./sop-service.js";
import type { SopDocument } from "./types.js";

function documentWith(text: string): SopDocument {
  return {
    type: "sop",
    version: 1,
    sections: SOP_SECTION_DEFINITIONS.map((section) => ({
      ...section,
      content: section.required
        ? { type: "doc", content: [{ type: "paragraph", attrs: { dir: section.key === "purpose" ? "rtl" : "ltr" }, content: [{ type: "text", text: section.key === "purpose" ? `إجراء ${text}` : text }] }] }
        : { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" } }] },
    })),
  };
}

test("SOP metadata endpoint returns user candidates only to management users", async () => {
  const normalMeta = await getSopMeta("receptionist");
  assert.equal(Array.isArray(normalMeta.categories), true);
  assert.equal(Array.isArray(normalMeta.sections), true);
  assert.equal(normalMeta.users, undefined);

  const anonMeta = await getSopMeta(undefined);
  assert.equal(anonMeta.users, undefined);

  const supervisorMeta = await getSopMeta("supervisor");
  assert.equal(Array.isArray(supervisorMeta.users), true);
  assert.equal(supervisorMeta.users!.length > 0, true);

  const adminMeta = await getSopMeta("super_admin");
  assert.equal(Array.isArray(adminMeta.users), true);
  assert.equal(adminMeta.users!.length > 0, true);
});

test("SOP lifecycle preserves published Unicode versions, controls owner and review cycle, and enforces authorization", async () => {
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const code = `RAD-E2E-${marker}`;
  const user = await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id",
    [`sop_lifecycle_${marker.toLowerCase()}`, "SOP lifecycle test"]
  );
  assert.equal(user.rowCount, 1);
  const actor = Number(user.rows[0]!.id);

  const ownerUser = await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','doctor',true) returning id",
    [`sop_owner_${marker.toLowerCase()}`, "Dr Owner User"]
  );
  const ownerId = Number(ownerUser.rows[0]!.id);

  let sopId: number | null = null;
  try {
    await assert.rejects(
      () => createSop({ title: "Denied SOP", code: `RAD-DENY-${marker}`, category: "General", version: "1.0", effectiveDate: "2026-10-01", changeSummary: "Denied", contentJson: documentWith("Denied") }, actor, "receptionist"),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403
    );

    const created = await createSop({
      title: "MRI Safety عربية",
      code: ` rad-e2e-${marker} `,
      category: "MRI",
      version: "1.0",
      effectiveDate: "2026-10-01",
      changeSummary: "Initial draft",
      contentJson: documentWith("MRI safety"),
    }, actor, "supervisor");

    sopId = created.sop.id;
    assert.equal(created.sop.code, code);
    assert.equal(created.sop.status, "draft");
    assert.equal(created.sop.ownerUserId, null);
    assert.equal(created.sop.ownerName, null);
    assert.equal(created.version.nextReviewDate, null);

    await assert.rejects(() => getSopDetailForUser(sopId, "receptionist"), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);

    // Publishing without owner must fail
    await assert.rejects(
      () => publishSopVersionForUser(sopId, "1.0", actor, "supervisor"),
      (error: unknown) => (error as { statusCode?: number; message?: string }).statusCode === 400 && String((error as { message?: string }).message).includes("SOP Owner is required")
    );

    // Update draft with manual nextReviewDate and owner
    await updateSopDraftForUser(sopId, "1.0", {
      title: "MRI Safety عربية",
      category: "MRI",
      effectiveDate: "2026-10-02",
      nextReviewDate: "2028-10-02",
      ownerUserId: actor,
      changeSummary: "Added bilingual guidance",
      contentJson: documentWith("مصطلح MRI"),
    }, actor, "supervisor");

    let detail = await getSopDetailForUser(sopId, "supervisor");
    assert.equal(detail.sop.ownerUserId, actor);
    assert.equal(detail.versions[0]!.nextReviewDate, "2028-10-02");

    // Edit the stored nextReviewDate to verify sop_review_date_changed audit logging
    await updateSopDraftForUser(sopId, "1.0", {
      title: "MRI Safety عربية",
      category: "MRI",
      effectiveDate: "2026-10-02",
      nextReviewDate: "2029-01-15",
      ownerUserId: actor,
      changeSummary: "Adjusted review date",
      contentJson: documentWith("مصطلح MRI"),
    }, actor, "supervisor");

    detail = await getSopDetailForUser(sopId, "supervisor");
    assert.equal(detail.versions[0]!.nextReviewDate, "2029-01-15");

    const reviewAudit = await pool.query<{ action_type: string; old_values: Record<string, unknown>; new_values: Record<string, unknown> }>(
      "select action_type, old_values, new_values from audit_log where entity_type='sop' and entity_id=$1 and action_type='sop_review_date_changed'",
      [sopId]
    );
    assert.equal(reviewAudit.rowCount, 1);
    assert.equal(reviewAudit.rows[0]!.old_values.next_review_date, "2028-10-02");
    assert.equal(reviewAudit.rows[0]!.new_values.next_review_date, "2029-01-15");

    // Update draft omitting nextReviewDate: verify it is preserved and no spurious audit log is emitted
    await updateSopDraftForUser(sopId, "1.0", {
      title: "MRI Safety عربية",
      category: "MRI",
      effectiveDate: "2026-10-02",
      ownerUserId: actor,
      changeSummary: "Draft text tweak",
      contentJson: documentWith("مصطلح MRI"),
    }, actor, "supervisor");

    detail = await getSopDetailForUser(sopId, "supervisor");
    assert.equal(detail.versions[0]!.nextReviewDate, "2029-01-15");

    const reviewAuditAfter = await pool.query<{ action_type: string }>(
      "select action_type from audit_log where entity_type='sop' and entity_id=$1 and action_type='sop_review_date_changed'",
      [sopId]
    );
    assert.equal(reviewAuditAfter.rowCount, 1);

    // Publish the draft; explicit nextReviewDate is preserved
    const publishResult = await publishSopVersionForUser(sopId, "1.0", actor, "supervisor");
    assert.equal(publishResult.version.status, "published");
    assert.equal(publishResult.version.nextReviewDate, "2029-01-15");

    const published = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(published.sop.currentVersion, "1.0");
    assert.equal(published.sop.currentEffectiveDate, "2026-10-02");
    assert.equal(published.sop.currentNextReviewDate, "2029-01-15");
    assert.equal(published.sop.ownerUserId, actor);
    assert.equal(published.versions[0]!.status, "published");

    // Management updates owner on published SOP without changing version
    await updateSopOwnerForUser(sopId, { ownerUserId: ownerId }, actor, "supervisor");
    const updatedOwnerSop = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(updatedOwnerSop.sop.ownerUserId, ownerId);
    assert.equal(updatedOwnerSop.sop.ownerName, "Dr Owner User");
    assert.equal(updatedOwnerSop.sop.currentVersion, "1.0");

    const ownerAudit = await pool.query<{ action_type: string; old_values: Record<string, unknown>; new_values: Record<string, unknown> }>(
      "select action_type, old_values, new_values from audit_log where entity_type='sop' and entity_id=$1 and action_type='sop_owner_changed'",
      [sopId]
    );
    assert.equal(ownerAudit.rowCount, 2);

    // Reviewed - No Changes action advances review date by 2 calendar years from today
    const tripoliToday = getTripoliToday();
    const expectedAdvancedReviewDate = addCalendarYears(tripoliToday, 2);
    const reviewed = await reviewSopNoChangesForUser(sopId, "1.0", actor, "supervisor");
    assert.equal(reviewed.version.version, "1.0");
    assert.equal(reviewed.version.effectiveDate, "2026-10-02");
    assert.equal(reviewed.version.nextReviewDate, expectedAdvancedReviewDate);

    const afterReviewDetail = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(afterReviewDetail.sop.currentNextReviewDate, expectedAdvancedReviewDate);

    const reviewedAudit = await pool.query<{ action_type: string; old_values: Record<string, unknown>; new_values: Record<string, unknown> }>(
      "select action_type, old_values, new_values from audit_log where entity_type='sop' and entity_id=$1 and action_type='sop_reviewed_no_changes'",
      [sopId]
    );
    assert.equal(reviewedAudit.rowCount, 1);
    assert.equal(reviewedAudit.rows[0]!.old_values.previous_review_date, "2029-01-15");
    assert.equal(reviewedAudit.rows[0]!.new_values.new_review_date, expectedAdvancedReviewDate);

    // Revision retains same owner
    const revision = await createSopRevisionForUser(sopId, { version: "2.0", changeSummary: "Updated safety language", effectiveDate: "2026-11-01" }, actor, "supervisor");
    assert.equal(revision.status, "draft");

    // Publish revision without explicit nextReviewDate -> defaults to effectiveDate + 2 years (2028-11-01)
    await publishSopVersionForUser(sopId, "2.0", actor, "supervisor");
    const afterRev2 = await getSopDetailForUser(sopId, "receptionist");
    assert.equal(afterRev2.sop.currentVersion, "2.0");
    assert.equal(afterRev2.sop.currentEffectiveDate, "2026-11-01");
    assert.equal(afterRev2.sop.currentNextReviewDate, "2028-11-01");

    await archiveSopForUser(sopId, actor, "supervisor");
    const archived = await getSopDetailForUser(sopId, "supervisor");
    assert.equal(archived.sop.status, "archived");
  } finally {
    if (sopId != null) {
      await pool.query("delete from audit_log where entity_type='sop' and entity_id=$1", [sopId]);
      await pool.query("delete from sop_versions where sop_id=$1", [sopId]);
      await pool.query("delete from sops where id=$1", [sopId]);
    }
    await pool.query("delete from users where id in ($1, $2)", [actor, ownerId]);
  }
});
