import { createHmac, randomBytes } from "node:crypto";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingAuditIdentity } from "../domain/teaching-content.js";
import type { TeachingValidationClassification, TeachingValidationIssue } from "../repositories/teaching-validation-repository.js";
import { getTeachingImportBatch } from "./import-batch-repository.js";
import {
  listAllTeachingQuestionBulkTargets,
  publishTeachingQuestionFromBulk,
  type TeachingQuestionListQuery,
  validateTeachingQuestionRevision,
} from "../services/teaching-content-service.js";

const MAX_SELECTED_QUESTIONS = 100;
const BULK_CONCURRENCY = 8;
const matchingScopeSecret = randomBytes(32);
type TeachingBulkScope = { batchId: string } | { questionIds: number[] } | { filters: TeachingQuestionListQuery };

const MATCHING_SCOPE_FIELDS = [
  "search", "status", "specialtyCode", "domainCode", "topicCode", "subtopicCode", "type", "difficulty",
  "trainingLevelCode", "tagCode", "sourceType", "hasImage", "imported", "validationStatus", "importBatchId",
] as const satisfies ReadonlyArray<keyof TeachingQuestionListQuery>;

/** A server-signed scope covering only fields that change matching questions. */
export function teachingMatchingScopeFingerprint(filters: TeachingQuestionListQuery): string {
  const canonical = Object.fromEntries(MATCHING_SCOPE_FIELDS.flatMap((field) => {
    const value = filters[field];
    return value === undefined || value === "" ? [] : [[field, value]];
  }));
  return createHmac("sha256", matchingScopeSecret).update(JSON.stringify(canonical)).digest("base64url");
}

export function requireTeachingMatchingScopeFingerprint(filters: TeachingQuestionListQuery, fingerprint: unknown): void {
  if (typeof fingerprint !== "string" || fingerprint.length < 1) {
    throw new HttpError(409, "Validate the current matching question scope before publishing.");
  }
  if (fingerprint !== teachingMatchingScopeFingerprint(filters)) {
    throw new HttpError(409, "The matching question scope changed. Validate the current filters before publishing.");
  }
}

interface BatchQuestionRow {
  id: string | number;
  external_id: string;
  retired_at: Date | null;
  revision_id: string | number;
  revision_version: number;
  revision_status: string;
  reviewed_at: Date | null;
  stem: string;
  classification: TeachingValidationClassification | null;
  errors_json: TeachingValidationIssue[];
  warnings_json: TeachingValidationIssue[];
  selection_conflict: boolean;
}

export interface TeachingBulkQuestionResult {
  questionId: number;
  externalId: string;
  stemPreview: string;
  revisionId: number;
  revisionVersion: number;
  revisionStatus: string;
  validationStatus: TeachingValidationClassification | null;
  eligibleForPublish: boolean;
  errors: TeachingValidationIssue[];
  warnings: TeachingValidationIssue[];
  publishStatus?: "published" | "already_published" | "invalid" | "conflict" | "requires_review" | "retired" | "failed";
}

function safeNumber(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(500, "Teaching question data is invalid.");
  return parsed;
}

export function parseTeachingBulkQuestionIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SELECTED_QUESTIONS) {
    throw new HttpError(400, `Select between 1 and ${MAX_SELECTED_QUESTIONS} questions.`);
  }
  const ids = value.map((item) => {
    const id = typeof item === "number" ? item : Number(item);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "Question selection contains an invalid ID.");
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "Question selection contains duplicate IDs.");
  return ids;
}

async function listCurrentQuestions(scope: TeachingBulkScope): Promise<BatchQuestionRow[]> {
  const byBatch = "batchId" in scope;
  let matchingTargets: Awaited<ReturnType<typeof listAllTeachingQuestionBulkTargets>> | null = null;
  let ids: [string] | [number[]];
  if (byBatch) ids = [scope.batchId];
  else if ("filters" in scope) {
    matchingTargets = await listAllTeachingQuestionBulkTargets(scope.filters);
    ids = [matchingTargets.map((item) => item.questionId)];
  }
  else ids = [scope.questionIds];
  const result = await pool.query<BatchQuestionRow>(
    `with linked_questions as (
       ${byBatch
         ? "select distinct question_id from teaching.question_revisions where import_batch_id = $1::uuid"
         : "select unnest($1::bigint[]) as question_id"}
     ), latest_revision as (
       select distinct on (revision.question_id) revision.question_id, revision.id, revision.version, revision.status,
         revision.reviewed_at, revision.stem
       from teaching.question_revisions revision
       join linked_questions linked on linked.question_id = revision.question_id
       order by revision.question_id, revision.revision_number desc, revision.id desc
     )
     select question.id, question.external_id, question.retired_at, revision.id as revision_id,
       revision.version as revision_version, revision.status as revision_status, revision.reviewed_at,
       revision.stem, summary.classification, coalesce(summary.errors_json, '[]'::jsonb) as errors_json,
       coalesce(summary.warnings_json, '[]'::jsonb) as warnings_json
     from linked_questions linked
     join teaching.questions question on question.id = linked.question_id
     join latest_revision revision on revision.question_id = question.id
     left join teaching.question_validation_summaries summary
       on summary.question_revision_id = revision.id and summary.revision_version = revision.version
     order by question.external_id, question.id`,
    ids,
  );
  if (!matchingTargets) return result.rows.map((row) => ({ ...row, selection_conflict: false }));
  const expectedByQuestionId = new Map(matchingTargets.map((target) => [target.questionId, target]));
  return result.rows.map((row) => {
    const expected = expectedByQuestionId.get(safeNumber(row.id));
    return {
      ...row,
      selection_conflict: !expected
        || expected.revisionId !== safeNumber(row.revision_id)
        || expected.revisionVersion !== Number(row.revision_version),
    };
  });
}

function shortPreview(stem: string): string {
  const normalized = stem.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function toQuestionResult(row: BatchQuestionRow): TeachingBulkQuestionResult {
  const errors = row.errors_json ?? [];
  const warnings = row.warnings_json ?? [];
  return {
    questionId: safeNumber(row.id),
    externalId: row.external_id,
    stemPreview: shortPreview(row.stem),
    revisionId: safeNumber(row.revision_id),
    revisionVersion: Number(row.revision_version),
    revisionStatus: row.revision_status,
    validationStatus: row.classification,
    eligibleForPublish: row.revision_status === "draft" && row.classification !== "invalid",
    errors,
    warnings,
  };
}

async function mapConcurrent<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      output[index] = await work(items[index]!);
    }
  }));
  return output;
}

function errorResult(row: BatchQuestionRow, error: unknown): TeachingBulkQuestionResult {
  const result = toQuestionResult(row);
  if (error instanceof HttpError && error.statusCode === 409) {
    return { ...result, validationStatus: null, eligibleForPublish: false, errors: [{ code: "concurrent_change", message: error.message }], warnings: [], publishStatus: "conflict" };
  }
  if (error instanceof HttpError && error.statusCode < 500) {
    return { ...result, validationStatus: "invalid", eligibleForPublish: false, errors: [{ code: "invalid_content", message: error.message }], warnings: [], publishStatus: "invalid" };
  }
  return { ...result, validationStatus: null, eligibleForPublish: false, errors: [{ code: "operation_failed", message: "This question could not be processed. Retry the operation." }], warnings: [], publishStatus: "failed" };
}

async function scopeQuestions(scope: TeachingBulkScope): Promise<BatchQuestionRow[]> {
  if ("batchId" in scope) {
    const batch = await getTeachingImportBatch(scope.batchId);
    if (!batch) throw new HttpError(404, "Teaching import batch not found.");
    if (batch.status !== "confirmed") throw new HttpError(409, "Confirm the import batch before running bulk question actions.");
  }
  const rows = await listCurrentQuestions(scope);
  if ("questionIds" in scope && rows.length !== scope.questionIds.length) {
    throw new HttpError(404, "One or more selected Teaching questions are unavailable.");
  }
  return rows;
}

function validationCounts(questions: TeachingBulkQuestionResult[]) {
  return {
    total: questions.length,
    draft: questions.filter((item) => item.revisionStatus === "draft").length,
    inReview: questions.filter((item) => item.revisionStatus === "in_review").length,
    published: questions.filter((item) => item.revisionStatus === "published").length,
    retired: questions.filter((item) => item.revisionStatus === "retired").length,
    valid: questions.filter((item) => item.validationStatus === "valid").length,
    validWithWarnings: questions.filter((item) => item.validationStatus === "valid_with_warnings").length,
    invalid: questions.filter((item) => item.validationStatus === "invalid").length,
    conflicts: questions.filter((item) => item.publishStatus === "conflict").length,
  };
}

export async function validateTeachingQuestionScope(scope: TeachingBulkScope, actor: TeachingAuditIdentity) {
  const rows = await scopeQuestions(scope);
  const results = await mapConcurrent(rows, async (row) => {
    const item = toQuestionResult(row);
    if (row.selection_conflict) return errorResult(row, new HttpError(409, "The question changed after the matching set was selected."));
    if (row.revision_status !== "draft" || row.retired_at) return item;
    try {
      const validation = await validateTeachingQuestionRevision(item.questionId, item.revisionId, item.revisionVersion, actor);
      const validationStatus: TeachingValidationClassification = validation.errors.length > 0
        ? "invalid"
        : validation.warnings.length > 0 ? "valid_with_warnings" : "valid";
      return { ...item, validationStatus, eligibleForPublish: validation.errors.length === 0, errors: validation.errors, warnings: validation.warnings };
    } catch (error) {
      return errorResult(row, error);
    }
  });
  return {
    ...("filters" in scope ? { scopeFingerprint: teachingMatchingScopeFingerprint(scope.filters) } : {}),
    ...validationCounts(results),
    eligibleForPublish: results.filter((item) => item.revisionStatus === "draft" && item.eligibleForPublish).length,
    questions: results,
  };
}

export async function publishTeachingQuestionScope(
  scope: TeachingBulkScope,
  actor: TeachingAuditIdentity,
  permissions: readonly string[],
) {
  const rows = await scopeQuestions(scope);
  const canSubmitAndReviewDrafts = permissions.includes("teaching.admin")
    || (permissions.includes("teaching.author") && permissions.includes("teaching.review"));
  const results = await mapConcurrent(rows, async (row) => {
    const item = toQuestionResult(row);
    if (row.selection_conflict) return errorResult(row, new HttpError(409, "The question changed after the matching set was selected."));
    try {
      const outcome = await publishTeachingQuestionFromBulk(
        item.questionId,
        item.revisionId,
        item.revisionVersion,
        actor,
        canSubmitAndReviewDrafts,
      );
      const validationStatus: TeachingValidationClassification | null = outcome.status === "already_published" || outcome.status === "retired"
        ? item.validationStatus
        : outcome.status === "conflict" ? null
          : outcome.errors.length > 0 ? "invalid" : outcome.warnings.length > 0 ? "valid_with_warnings" : "valid";
      const errors = outcome.status === "conflict"
        ? [{ code: "concurrent_change", message: "The question changed while the batch was being published." }]
        : outcome.errors;
      return {
        ...item,
        revisionVersion: outcome.revisionVersion,
        revisionStatus: outcome.status === "published" || outcome.status === "already_published" ? "published" : item.revisionStatus,
        validationStatus,
        eligibleForPublish: outcome.status === "published" || outcome.status === "already_published",
        errors,
        warnings: outcome.warnings,
        publishStatus: outcome.status === "conflict" ? "conflict" : outcome.status,
      } as TeachingBulkQuestionResult;
    } catch (error) {
      return errorResult(row, error);
    }
  });
  const count = (status: string) => results.filter((item) => item.publishStatus === status).length;
  return {
    requested: rows.length,
    published: count("published"),
    alreadyPublished: count("already_published"),
    invalid: count("invalid"),
    conflicts: count("conflict"),
    requiresReview: count("requires_review"),
    retired: count("retired"),
    failed: count("failed"),
    warnings: results.filter((item) => item.publishStatus === "published" && item.warnings.length > 0).length,
    results,
  };
}

export async function getTeachingImportBatchQuestionSummary(batchId: string) {
  const rows = await listCurrentQuestions({ batchId });
  return {
    total: rows.length,
    draft: rows.filter((row) => row.revision_status === "draft").length,
    inReview: rows.filter((row) => row.revision_status === "in_review").length,
    published: rows.filter((row) => row.revision_status === "published").length,
    retired: rows.filter((row) => row.revision_status === "retired" || row.retired_at !== null).length,
  };
}
