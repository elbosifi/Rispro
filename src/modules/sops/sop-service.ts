import { pool } from "../../db/pool.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { HttpError } from "../../utils/http-error.js";
import { asUnknownRecord } from "../../utils/records.js";
import { getTripoliToday } from "../../utils/date.js";
import { SOP_CATEGORIES, SOP_MANAGEMENT_ROLES, SOP_SECTION_DEFINITIONS, SOP_STATUSES } from "./constants.js";
import {
  archiveSop,
  findSop,
  findSopByCode,
  findSopVersion,
  getSopDetail,
  insertSop,
  insertSopRevision,
  listSopSummaries,
  listSopUserOptions,
  publishSopVersion,
  reviewSopNoChanges,
  updateSopDraft,
  updateSopOwner,
} from "./sop-repository.js";
import {
  addCalendarYears,
  normalizeSopCategory,
  normalizeSopCode,
  normalizeSopDate,
  normalizeSopVersion,
  requiredText,
  validateSopReviewDate,
  validateSopDocument,
} from "./sop-validation.js";
import { deriveSopPrintStatus } from "./sop-print-service.js";
import type { SopDocument, SopFilters, SopMeta, SopSummary, SopVersion } from "./types.js";

function managementRole(role: string): boolean {
  return (SOP_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

export function requireSopManagement(role: string | undefined): void {
  if (!role) throw new HttpError(401, "Authentication required.");
  if (!managementRole(role)) throw new HttpError(403, "SOP management access is required.");
}

function positiveId(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function parseOwnerUserId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return positiveId(value, "SOP Owner");
}

export { normalizeSopCode, normalizeSopVersion, validateSopDocument } from "./sop-validation.js";

export async function getSopMeta(role: string | undefined): Promise<SopMeta> {
  const meta: SopMeta = {
    categories: [...SOP_CATEGORIES],
    sections: SOP_SECTION_DEFINITIONS.map((section) => ({ ...section })),
  };
  if (role && managementRole(role)) {
    meta.users = await listSopUserOptions();
  }
  return meta;
}

function parseInput(body: unknown, requireContent = true) {
  const input = asUnknownRecord(body);
  const contentJson = requireContent ? validateSopDocument(input.contentJson ?? input.content_json, false) : undefined;
  const rawReviewDate = "nextReviewDate" in input ? input.nextReviewDate : input.next_review_date;
  const rawOwner = "ownerUserId" in input ? input.ownerUserId : input.owner_user_id;
  return {
    title: requiredText(input.title, "Title"),
    code: normalizeSopCode(input.code),
    category: normalizeSopCategory(input.category),
    version: normalizeSopVersion(input.version),
    effectiveDate: normalizeSopDate(input.effectiveDate ?? input.effective_date, "Effective date"),
    nextReviewDate: rawReviewDate === undefined ? undefined : normalizeSopDate(rawReviewDate, "Next review date"),
    ownerUserId: parseOwnerUserId(rawOwner),
    changeSummary: String(input.changeSummary ?? input.change_summary ?? "").trim(),
    contentJson,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}

function toDetail(sop: SopSummary, versions: SopVersion[]) {
  return { sop, versions };
}

export async function listSops(filters: SopFilters, role: string | undefined): Promise<SopSummary[]> {
  if (!role) throw new HttpError(401, "Authentication required.");
  return listSopSummaries(filters, managementRole(role));
}

export async function getSopDetailForUser(sopIdValue: unknown, role: string | undefined): Promise<{ sop: SopSummary; versions: SopVersion[] }> {
  if (!role) throw new HttpError(401, "Authentication required.");
  const sopId = positiveId(sopIdValue, "sopId");
  const detail = await getSopDetail(sopId, managementRole(role));
  if (!detail) throw new HttpError(404, "SOP not found.");
  if (!managementRole(role) && detail.sop.status !== "published") throw new HttpError(404, "SOP not found.");
  return toDetail(detail.sop, detail.versions);
}

export async function getSopVersionForUser(sopIdValue: unknown, versionValue: unknown, role: string | undefined): Promise<SopVersion> {
  if (!role) throw new HttpError(401, "Authentication required.");
  const sopId = positiveId(sopIdValue, "sopId");
  const sop = await findSop(sopId);
  if (!sop || (!managementRole(role) && sop.status !== "published")) throw new HttpError(404, "SOP version not found.");
  const version = normalizeSopVersion(versionValue);
  const result = await findSopVersion(sopId, version, managementRole(role));
  if (!result) throw new HttpError(404, "SOP version not found.");
  return result;
}

export async function getSopPrintDocumentForUser(sopIdValue: unknown, versionValue: unknown, role: string | undefined) {
  if (!role) throw new HttpError(401, "Authentication required.");
  const sopId = positiveId(sopIdValue, "sopId");
  const includeAll = managementRole(role);
  const sop = await findSop(sopId, pool, includeAll);
  if (!sop || (!includeAll && sop.status !== "published")) throw new HttpError(404, "SOP version not found.");
  const version = await findSopVersion(sopId, normalizeSopVersion(versionValue), includeAll);
  if (!version) throw new HttpError(404, "SOP version not found.");
  return { sop, version, status: deriveSopPrintStatus(sop, version) };
}

export async function createSop(body: unknown, actorUserIdValue: unknown, actorRole: string | undefined) {
  requireSopManagement(actorRole);
  const actorUserId = positiveId(actorUserIdValue, "acting user");
  const input = parseInput(body);
  validateSopReviewDate(input.effectiveDate, input.nextReviewDate);
  if (!input.contentJson) throw new HttpError(400, "SOP content is required.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const created = await insertSop({
      ...input,
      ownerUserId: input.ownerUserId ?? null,
      nextReviewDate: input.nextReviewDate ?? null,
      contentJson: input.contentJson,
      actorUserId,
    }, client);
    await logAuditEntry({
      entityType: "sop",
      entityId: created.sop.id,
      actionType: "sop_created",
      newValues: {
        sop_id: created.sop.id,
        sop_code: created.sop.code,
        version: created.version.version,
        owner_user_id: created.sop.ownerUserId,
      },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return created;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (isUniqueViolation(error)) throw new HttpError(409, "SOP code or version already exists.");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSopDraftForUser(sopIdValue: unknown, versionValue: unknown, body: unknown, actorUserIdValue: unknown, actorRole: string | undefined) {
  requireSopManagement(actorRole);
  const sopId = positiveId(sopIdValue, "sopId");
  const version = normalizeSopVersion(versionValue);
  const existing = await findSop(sopId);
  if (!existing) throw new HttpError(404, "SOP not found.");
  if (existing.status === "archived") throw new HttpError(409, "Archived SOPs cannot be edited.");
  const existingVersion = await findSopVersion(sopId, version, true);
  if (!existingVersion || existingVersion.status !== "draft") throw new HttpError(409, "Only editable draft versions can be updated.");
  const input = parseInput({ ...asUnknownRecord(body), code: existing.code, version }, true);
  if (!input.contentJson) throw new HttpError(400, "SOP content is required.");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const locked = await findSop(sopId, client);
    const lockedDraft = await findSopVersion(sopId, version, true, client);
    if (!locked || !lockedDraft || lockedDraft.status !== "draft") throw new HttpError(409, "Only editable draft versions can be updated.");
    const actorUserId = positiveId(actorUserIdValue, "acting user");
    const publishedMetadataFixed = Boolean(locked.currentVersion);
    if (publishedMetadataFixed && (input.title !== locked.title || input.category !== locked.category)) {
      throw new HttpError(409, "Title and category cannot be changed on an unpublished revision.");
    }

    const effectiveNextReviewDate = input.nextReviewDate !== undefined ? input.nextReviewDate : lockedDraft.nextReviewDate;
    validateSopReviewDate(input.effectiveDate, effectiveNextReviewDate);
    const updated = await updateSopDraft({
      sopId,
      version,
      title: publishedMetadataFixed ? locked.title : input.title,
      category: publishedMetadataFixed ? locked.category : input.category,
      contentJson: input.contentJson,
      changeSummary: input.changeSummary,
      effectiveDate: input.effectiveDate,
      nextReviewDate: effectiveNextReviewDate,
      ownerUserId: input.ownerUserId !== undefined ? input.ownerUserId : locked.ownerUserId,
      actorUserId,
    }, client);

    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_draft_updated",
      newValues: { sop_id: sopId, sop_code: existing.code, version },
      changedByUserId: actorUserId,
    }, client);

    if (lockedDraft.nextReviewDate && input.nextReviewDate !== undefined && lockedDraft.nextReviewDate !== input.nextReviewDate) {
      await logAuditEntry({
        entityType: "sop",
        entityId: sopId,
        actionType: "sop_review_date_changed",
        oldValues: {
          sop_id: sopId,
          sop_code: existing.code,
          version,
          next_review_date: lockedDraft.nextReviewDate,
        },
        newValues: {
          sop_id: sopId,
          sop_code: existing.code,
          version,
          next_review_date: input.nextReviewDate,
        },
        changedByUserId: actorUserId,
      }, client);
    }

    if (locked.ownerUserId !== input.ownerUserId && input.ownerUserId !== undefined) {
      await logAuditEntry({
        entityType: "sop",
        entityId: sopId,
        actionType: "sop_owner_changed",
        oldValues: {
          sop_id: sopId,
          sop_code: existing.code,
          owner_user_id: locked.ownerUserId,
        },
        newValues: {
          sop_id: sopId,
          sop_code: existing.code,
          owner_user_id: input.ownerUserId,
        },
        changedByUserId: actorUserId,
      }, client);
    }

    await client.query("commit");
    return updated;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSopOwnerForUser(
  sopIdValue: unknown,
  body: unknown,
  actorUserIdValue: unknown,
  actorRole: string | undefined
): Promise<SopSummary> {
  requireSopManagement(actorRole);
  const sopId = positiveId(sopIdValue, "sopId");
  const actorUserId = positiveId(actorUserIdValue, "acting user");
  const input = asUnknownRecord(body);
  const ownerUserId = parseOwnerUserId(input.ownerUserId ?? input.owner_user_id) ?? null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const existing = await findSop(sopId, client);
    if (!existing) throw new HttpError(404, "SOP not found.");
    if (existing.status === "archived") throw new HttpError(409, "Archived SOPs cannot be edited.");
    if (existing.status === "published" && !ownerUserId) {
      throw new HttpError(400, "A published SOP must have an owner.");
    }
    const oldOwnerUserId = existing.ownerUserId;
    const updated = await updateSopOwner(sopId, ownerUserId, actorUserId, client);
    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_owner_changed",
      oldValues: {
        sop_id: sopId,
        sop_code: existing.code,
        owner_user_id: oldOwnerUserId,
      },
      newValues: {
        sop_id: sopId,
        sop_code: existing.code,
        owner_user_id: ownerUserId,
      },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return updated;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createSopRevisionForUser(sopIdValue: unknown, body: unknown, actorUserIdValue: unknown, actorRole: string | undefined) {
  requireSopManagement(actorRole);
  const sopId = positiveId(sopIdValue, "sopId");
  const existing = await findSop(sopId);
  if (!existing) throw new HttpError(404, "SOP not found.");
  if (existing.status !== "published") throw new HttpError(409, "A revision can only be created from a published SOP.");
  const current = await findSopVersion(sopId, existing.currentVersion ?? "", true);
  if (!current || current.status !== "published") throw new HttpError(409, "The published SOP version is unavailable.");
  const input = asUnknownRecord(body);
  const version = normalizeSopVersion(input.version);
  const changeSummary = requiredText(input.changeSummary ?? input.change_summary, "Change summary");
  const effectiveDate = normalizeSopDate(input.effectiveDate ?? input.effective_date, "Effective date");
  const nextReviewDate = normalizeSopDate(input.nextReviewDate ?? input.next_review_date, "Next review date");
  validateSopReviewDate(effectiveDate, nextReviewDate);
  const actorUserId = positiveId(actorUserIdValue, "acting user");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const locked = await findSop(sopId, client);
    if (!locked || locked.status !== "published") throw new HttpError(409, "A revision can only be created from a published SOP.");
    const revision = await insertSopRevision({
      sopId,
      version,
      changeSummary,
      effectiveDate,
      nextReviewDate,
      actorUserId,
      contentJson: current.contentJson,
    }, client);
    await client.query("update sops set updated_by_user_id=$2, updated_at=now() where id=$1", [sopId, actorUserId]);
    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_revision_created",
      newValues: {
        sop_id: sopId,
        sop_code: existing.code,
        version,
        source_version: current.version,
      },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return revision;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (isUniqueViolation(error)) throw new HttpError(409, "That revision version already exists or a draft revision is already open.");
    throw error;
  } finally {
    client.release();
  }
}

export async function publishSopVersionForUser(sopIdValue: unknown, versionValue: unknown, actorUserIdValue: unknown, actorRole: string | undefined) {
  requireSopManagement(actorRole);
  const sopId = positiveId(sopIdValue, "sopId");
  const version = normalizeSopVersion(versionValue);
  const actorUserId = positiveId(actorUserIdValue, "acting user");
  const existing = await findSop(sopId);
  if (!existing) throw new HttpError(404, "SOP not found.");
  if (existing.status === "archived") throw new HttpError(409, "Archived SOPs cannot be published.");
  const draft = await findSopVersion(sopId, version, true);
  if (!draft || draft.status !== "draft") throw new HttpError(409, "Only a draft version can be published.");
  const input = parseInput({ title: existing.title, code: existing.code, category: existing.category, version, contentJson: draft.contentJson });
  if (!input.contentJson) throw new HttpError(400, "SOP content is required.");
  validateSopDocument(draft.contentJson, true);
  if (!existing.ownerUserId) {
    throw new HttpError(400, "SOP Owner is required before publishing.");
  }
  if (!draft.effectiveDate) {
    throw new HttpError(400, "Effective date is required before publishing.");
  }
  validateSopReviewDate(draft.effectiveDate, draft.nextReviewDate);

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const locked = await findSop(sopId, client);
    if (!locked) throw new HttpError(404, "SOP not found.");
    if (!locked.ownerUserId) {
      throw new HttpError(400, "SOP Owner is required before publishing.");
    }
    const lockedDraft = await findSopVersion(sopId, version, true, client);
    if (!lockedDraft || lockedDraft.status !== "draft") throw new HttpError(409, "This draft has already been published or changed.");
    if (!lockedDraft.effectiveDate) throw new HttpError(400, "Effective date is required before publishing.");
    const resolvedNextReviewDate = lockedDraft.nextReviewDate || addCalendarYears(lockedDraft.effectiveDate, 2);
    validateSopReviewDate(lockedDraft.effectiveDate, resolvedNextReviewDate);
    const published = await publishSopVersion(sopId, version, resolvedNextReviewDate, actorUserId, client);
    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_published",
      newValues: {
        sop_id: sopId,
        sop_code: locked.code,
        version,
        next_review_date: resolvedNextReviewDate,
        owner_user_id: locked.ownerUserId,
      },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return published;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewSopNoChangesForUser(
  sopIdValue: unknown,
  versionValue: unknown,
  actorUserIdValue: unknown,
  actorRole: string | undefined
): Promise<{ sop: SopSummary; version: SopVersion }> {
  requireSopManagement(actorRole);
  const sopId = positiveId(sopIdValue, "sopId");
  const version = normalizeSopVersion(versionValue);
  const actorUserId = positiveId(actorUserIdValue, "acting user");

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const sop = await findSop(sopId, client);
    if (!sop) throw new HttpError(404, "SOP not found.");
    if (sop.status !== "published" || sop.currentVersion !== version) {
      throw new HttpError(409, "Only the currently published version can be reviewed without changes.");
    }
    const currentVersion = await findSopVersion(sopId, version, true, client);
    if (!currentVersion || currentVersion.status !== "published") {
      throw new HttpError(409, "Only the currently published version can be reviewed without changes.");
    }
    const today = getTripoliToday();
    const newReviewDate = addCalendarYears(today, 2);
    const oldReviewDate = currentVersion.nextReviewDate;
    const result = await reviewSopNoChanges(sopId, version, newReviewDate, actorUserId, client);
    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_reviewed_no_changes",
      oldValues: {
        sop_id: sopId,
        sop_code: sop.code,
        version,
        previous_review_date: oldReviewDate,
      },
      newValues: {
        sop_id: sopId,
        sop_code: sop.code,
        version,
        new_review_date: newReviewDate,
        review_date: today,
      },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveSopForUser(sopIdValue: unknown, actorUserIdValue: unknown, actorRole: string | undefined) {
  requireSopManagement(actorRole);
  const sopId = positiveId(sopIdValue, "sopId");
  const actorUserId = positiveId(actorUserIdValue, "acting user");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from sops where id=$1 for update", [sopId]);
    const existing = await findSop(sopId, client);
    if (!existing) throw new HttpError(404, "SOP not found.");
    if (existing.status === "archived") throw new HttpError(409, "SOP is already archived.");
    const archived = await archiveSop(sopId, actorUserId, client);
    await logAuditEntry({
      entityType: "sop",
      entityId: sopId,
      actionType: "sop_archived",
      newValues: { sop_id: sopId, sop_code: archived.code, version: archived.currentVersion },
      changedByUserId: actorUserId,
    }, client);
    await client.query("commit");
    return archived;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function validateSopFilters(input: unknown): SopFilters {
  const query = asUnknownRecord(input);
  const status = String(query.status ?? "").trim();
  if (status && !(SOP_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "Status is invalid.");
  return {
    search: String(query.search ?? "").trim() || null,
    category: String(query.category ?? "").trim() || null,
    status: status || null,
  };
}
