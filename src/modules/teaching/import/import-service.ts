import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { createLogger } from "../../../observability/logger.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingAuditIdentity, TeachingCaseInput, TeachingQuestionType } from "../domain/teaching-content.js";
import {
  createTeachingAssetInTransaction,
  createTeachingCaseInTransaction,
  createTeachingQuestionInTransaction,
  createTeachingReferenceInTransaction,
  createTeachingSourceInTransaction,
} from "../services/teaching-content-service.js";
import { parseTeachingCaseInput, parseTeachingReferenceInput, parseTeachingSourceInput } from "../domain/teaching-content-validation.js";
import { listTeachingQuestionBanks } from "../repositories/teaching-catalog-repository.js";
import { createTeachingImportBatch, getTeachingImportBatch, listTeachingImportBatches, toTeachingImportBatchDto } from "./import-batch-repository.js";
import { parseTeachingImportJson, type ParsedTeachingImport, type TeachingImportIssue, type TeachingImportQuestion } from "./import-schema.js";
import {
  cleanupExpiredTeachingImports,
  cleanupTeachingImportStaging,
  extractTeachingImportUpload,
  loadStagedTeachingAssets,
  promoteTeachingAsset,
  receiveTeachingImportUpload,
  removePromotedTeachingAsset,
  type ExtractedTeachingUpload,
  type StagedTeachingAsset,
} from "./staging-service.js";
import type { ImportDisposition, TeachingImportValidation } from "./validation-service.js";
import { toTeachingQuestionCommand, validateTeachingImport } from "./validation-service.js";

const logger = createLogger({ domain: "teaching" });

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) if (value) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function inspectSummary(parsed: ParsedTeachingImport, upload: ExtractedTeachingUpload): Record<string, unknown> {
  const cases = new Set(parsed.questions.map((question) => question.caseId).filter((value): value is string => value !== null));
  return {
    structurallyValid: parsed.errors.length === 0,
    questionCount: parsed.questions.length,
    caseCount: cases.size,
    assetCount: upload.stagedAssets.length,
    sourceTypes: countBy(parsed.questions.map((question) => question.source?.type)),
    questionTypes: countBy(parsed.questions.map((question) => question.type)),
    specialties: countBy(parsed.questions.map((question) => question.classification.specialty)),
    duplicateExternalIds: parsed.errors.filter((item) => item.code === "duplicate_external_id").map((item) => item.externalId ?? ""),
    errors: parsed.errors,
    warnings: upload.warnings,
  };
}

function errorIssue(error: unknown): TeachingImportIssue {
  if (error instanceof HttpError) return { code: "invalid_upload", message: error.message };
  return { code: "invalid_upload", message: "Import file could not be inspected." };
}

export async function inspectTeachingImport(req: import("express").Request, actor: TeachingAuditIdentity) {
  await cleanupExpiredTeachingImports();
  const upload = await receiveTeachingImportUpload(req);
  const batchId = randomUUID();
  let extracted: ExtractedTeachingUpload | null = null;
  try {
    extracted = await extractTeachingImportUpload(upload, batchId);
    const parsed = parseTeachingImportJson(extracted.questionsJson);
    const summary = inspectSummary(parsed, extracted);
    const invalid = parsed.errors.length > 0;
    if (invalid) await cleanupTeachingImportStaging(batchId);
    await createTeachingImportBatch({
      id: batchId,
      actor,
      filename: upload.filename,
      inputType: upload.inputType,
      schemaVersion: parsed.schemaVersion,
      status: invalid ? "invalid" : "inspected",
      questionCount: parsed.questions.length,
      caseCount: new Set(parsed.questions.map((question) => question.caseId).filter(Boolean)).size,
      assetCount: extracted.stagedAssets.length,
      summary,
      payload: invalid ? null : parsed.rawDocument,
    });
    return {
      batchId,
      schemaVersion: parsed.schemaVersion,
      questions: parsed.questions.length,
      cases: new Set(parsed.questions.map((question) => question.caseId).filter(Boolean)).size,
      assets: extracted.stagedAssets.length,
      structurallyValid: !invalid,
      errors: parsed.errors,
      warnings: extracted.warnings,
    };
  } catch (error) {
    await cleanupTeachingImportStaging(batchId).catch(() => undefined);
    if (error instanceof HttpError) {
      await createTeachingImportBatch({
        id: batchId,
        actor,
        filename: upload.filename,
        inputType: upload.inputType,
        schemaVersion: null,
        status: "invalid",
        questionCount: 0,
        caseCount: 0,
        assetCount: 0,
        summary: { structurallyValid: false, errors: [errorIssue(error)], warnings: [] },
        payload: null,
      });
      return { batchId, schemaVersion: null, questions: 0, cases: 0, assets: 0, structurallyValid: false, errors: [errorIssue(error)], warnings: [] };
    }
    throw error;
  }
}

async function markExpired(batchId: string): Promise<void> {
  await pool.query("update teaching.import_batches set status = 'expired', payload_json = null where id = $1 and status <> 'confirmed'", [batchId]);
  await cleanupTeachingImportStaging(batchId).catch(() => undefined);
}

async function getLivePayload(batchId: string) {
  const batch = await getTeachingImportBatch(batchId);
  if (!batch) throw new HttpError(404, "Teaching import batch not found.");
  if (batch.status === "expired" || batch.expires_at.getTime() <= Date.now()) {
    await markExpired(batchId);
    throw new HttpError(410, "Teaching import batch has expired.");
  }
  return batch;
}

function payloadBuffer(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export async function previewTeachingImport(batchId: string): Promise<TeachingImportValidation> {
  await cleanupExpiredTeachingImports();
  const batch = await getLivePayload(batchId);
  if (batch.status === "invalid") return storedValidation(batch.validation_summary_json, batch);
  if (batch.status === "confirmed") throw new HttpError(409, "Teaching import batch was already confirmed.");
  if (batch.payload_json === null) throw new HttpError(409, "Teaching import payload is unavailable. Upload the file again.");
  const parsed = parseTeachingImportJson(payloadBuffer(batch.payload_json));
  const assets = await loadStagedTeachingAssets(batchId);
  const validation = await validateTeachingImport(parsed, assets);
  const status = validation.errors.length === 0 ? "validated" : "invalid";
  await pool.query(
    `update teaching.import_batches set status = $2, schema_version = $3, question_count = $4, case_count = $5,
       asset_count = $6, validation_summary_json = $7::jsonb, validated_at = case when $2 = 'validated' then now() else null end,
       payload_json = case when $2 = 'invalid' then null else payload_json end,
       failure_message = case when $2 = 'invalid' then 'Validation failed; inspect the stored issue summary.' else null end
     where id = $1`,
    [batchId, status, validation.schemaVersion, validation.questionCount, validation.caseCount, validation.assetCount, JSON.stringify(validation)],
  );
  if (status === "invalid") await cleanupTeachingImportStaging(batchId).catch(() => undefined);
  return validation;
}

function storedValidation(summary: Record<string, unknown>, batch: { schema_version: string | null; question_count: number; case_count: number; asset_count: number }): TeachingImportValidation {
  const errors = Array.isArray(summary.errors) ? summary.errors as TeachingImportIssue[] : [];
  const warnings = Array.isArray(summary.warnings) ? summary.warnings as TeachingImportIssue[] : [];
  const questions = Array.isArray(summary.questions) ? summary.questions as TeachingImportValidation["questions"] : [];
  return {
    schemaVersion: batch.schema_version,
    questionCount: batch.question_count,
    caseCount: batch.case_count,
    assetCount: batch.asset_count,
    errors,
    warnings,
    questions,
  };
}

function requirePayload(batch: { payload_json: unknown | null }, batchId: string): ParsedTeachingImport {
  if (batch.payload_json === null) throw new HttpError(409, "Teaching import payload is unavailable.");
  return parseTeachingImportJson(payloadBuffer(batch.payload_json));
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

async function insertBatchAuditFailure(batchId: string, issue: TeachingImportIssue) {
  await pool.query(
    `update teaching.import_batches set status = 'invalid', payload_json = null, failure_message = $3,
       validation_summary_json = jsonb_build_object('structurallyValid', false, 'errors', $2::jsonb, 'warnings', '[]'::jsonb)
     where id = $1 and status <> 'confirmed'`,
    [batchId, JSON.stringify([issue]), issue.message],
  );
}

export async function confirmTeachingImport(batchId: string, actor: TeachingAuditIdentity) {
  await cleanupExpiredTeachingImports();
  const client = await pool.connect();
  const promoted: string[] = [];
  let cleanupAfter = false;
  let response: Record<string, unknown> | null = null;
  let failure: unknown = null;
  try {
    await client.query("begin");
    const batch = await getTeachingImportBatch(batchId, client, true);
    if (!batch) throw new HttpError(404, "Teaching import batch not found.");
    if (batch.status === "confirmed") throw new HttpError(409, "Teaching import batch was already confirmed.");
    if (batch.status === "expired" || batch.expires_at.getTime() <= Date.now()) {
      await client.query("update teaching.import_batches set status = 'expired', payload_json = null where id = $1", [batchId]);
      await client.query("commit");
      cleanupAfter = true;
      throw new HttpError(410, "Teaching import batch has expired.");
    }
    if (batch.status !== "validated") throw new HttpError(409, "Preview and successfully validate this batch before confirming it.");
    const parsed = requirePayload(batch, batchId);
    const stagedAssets = await loadStagedTeachingAssets(batchId);
    const validation = await validateTeachingImport(parsed, stagedAssets, client);
    if (validation.errors.length > 0) {
      await client.query(
        `update teaching.import_batches set status = 'invalid', payload_json = null, validated_at = null,
         validation_summary_json = $2::jsonb, failure_message = 'Revalidation found changes; inspect the current validation summary.' where id = $1`,
        [batchId, JSON.stringify(validation)],
      );
      await client.query("commit");
      cleanupAfter = true;
      response = { batchId, status: "invalid", validation };
    } else {
      const questionByExternalId = new Map(parsed.questions.map((question) => [question.externalId, question]));
      const assetByFilename = new Map(stagedAssets.map((asset) => [asset.filename.toLocaleLowerCase("en-US"), asset]));
      const stagedByAssetKey = new Map<string, StagedTeachingAsset>();
      for (const question of parsed.questions) for (const media of question.media) {
        const asset = assetByFilename.get(media.filename.toLocaleLowerCase("en-US"));
        if (!asset) throw new HttpError(409, `Referenced image "${media.filename}" is no longer staged.`);
        stagedByAssetKey.set(media.assetKey, asset);
      }
      const assetIds = new Map<string, number>();
      for (const [assetKey, asset] of stagedByAssetKey) {
        const permanent = await promoteTeachingAsset(asset);
        promoted.push(permanent.absolutePath);
        const id = await createTeachingAssetInTransaction(client, {
          assetKey,
          storageKey: permanent.storageKey,
          mimeType: asset.mimeType,
          originalFilename: asset.filename,
          altText: parsed.questions.flatMap((question) => question.media).find((media) => media.assetKey === assetKey)?.altText ?? "",
          sizeBytes: asset.sizeBytes,
        }, actor);
        assetIds.set(assetKey, id);
      }

      const cases = new Map<string, number>();
      for (const question of parsed.questions) {
        if (question.caseId === null || cases.has(question.caseId)) continue;
        const existing = await client.query<{ id: string | number; specialty_code: string; title: string | null; clinical_history: string | null }>(
          `select case_row.id, specialty.code as specialty_code, case_row.title, case_row.clinical_history
           from teaching.cases case_row join teaching.specialties specialty on specialty.id = case_row.specialty_id
           where case_row.external_id = $1 for update of case_row`,
          [question.caseId],
        );
        if (existing.rowCount === 1) {
          const row = existing.rows[0]!;
          const metadata = question.case;
          if (row.specialty_code !== question.classification.specialty
            || (metadata?.title != null && row.title !== null && metadata.title !== row.title)
            || (metadata?.clinicalHistory != null && row.clinical_history !== null && metadata.clinicalHistory !== row.clinical_history)) {
            throw new HttpError(409, `Case "${question.caseId}" changed after preview.`);
          }
          cases.set(question.caseId, Number(row.id));
        } else {
          const command: TeachingCaseInput = parseTeachingCaseInput({
            externalId: question.caseId,
            specialtyCode: question.classification.specialty,
            title: question.case?.title ?? null,
            clinicalHistory: question.case?.clinicalHistory ?? null,
            assetIds: [],
          });
          cases.set(question.caseId, await createTeachingCaseInTransaction(client, command, actor));
        }
      }

      const banks = await listTeachingQuestionBanks(client);
      const sourceIdCache = new Map<string, number>();
      const referenceIdCache = new Map<string, number>();
      const created: Array<{ id: number; externalId: string }> = [];
      const moderateDifficulty = (await client.query<{ value: number }>(
        "select value from teaching.difficulties where is_active order by case when value = 3 then 0 else 1 end, sort_order, value limit 1",
      )).rows[0]?.value;
      if (moderateDifficulty === undefined) throw new HttpError(409, "Teaching has no active difficulty configured.");

      for (const question of parsed.questions) {
        const bank = banks.filter((item) => item.specialtyCode === question.classification.specialty);
        if (bank.length !== 1) throw new HttpError(409, `Question bank for "${question.classification.specialty}" changed after preview.`);
        const questionSources: Array<{ id: number; relationship: string }> = [];
        if (question.source) {
          const relationship = question.relationshipToSource ?? "unknown";
          const sourceCommand = parseTeachingSourceInput({
            sourceType: question.source.type,
            title: question.source.title,
            organization: question.source.organization,
            authors: question.source.authors,
            edition: question.source.edition,
            year: question.source.year,
            chapter: question.source.chapter,
            page: question.source.page,
            examName: question.source.examName,
            examSitting: question.source.examSitting,
            examPaper: question.source.examPaper,
            questionNumber: question.source.questionNumber,
            url: question.source.url,
            doi: question.source.doi,
            notes: question.source.notes,
            metadata: {},
          });
          const cacheKey = JSON.stringify(sourceCommand);
          let sourceId = sourceIdCache.get(cacheKey);
          if (sourceId === undefined) {
            sourceId = await createTeachingSourceInTransaction(client, sourceCommand, actor);
            sourceIdCache.set(cacheKey, sourceId);
          }
          questionSources.push({ id: sourceId, relationship });
        }
        const questionReferences: number[] = [];
        for (const reference of question.references) {
          const command = parseTeachingReferenceInput({
            referenceType: reference.type,
            title: reference.title,
            organization: reference.organization,
            authors: reference.authors,
            year: reference.year,
            edition: reference.edition,
            url: reference.url,
            doi: reference.doi,
            citationText: reference.citationText,
            notes: reference.notes,
          });
          const cacheKey = JSON.stringify(command);
          let referenceId = referenceIdCache.get(cacheKey);
          if (referenceId === undefined) {
            referenceId = await createTeachingReferenceInTransaction(client, command, actor);
            referenceIdCache.set(cacheKey, referenceId);
          }
          questionReferences.push(referenceId);
        }
        const questionAssetIds = question.media.map((media) => assetIds.get(media.assetKey)).filter((id): id is number => id !== undefined);
        const internalCommand = toTeachingQuestionCommand(
          question,
          bank[0]!.code,
          questionAssetIds,
          question.caseId === null ? null : cases.get(question.caseId) ?? null,
          questionSources,
          questionReferences,
          moderateDifficulty,
        );
        const questionId = await createTeachingQuestionInTransaction(client, internalCommand, actor, batchId);
        created.push({ id: questionId, externalId: question.externalId });
      }
      const confirmedAt = new Date().toISOString();
      const audit = {
        structurallyValid: true,
        importedCount: created.length,
        questionIds: created,
        caseCount: cases.size,
        assetCount: assetIds.size,
        warnings: validation.warnings,
      };
      await client.query(
        `update teaching.import_batches set status = 'confirmed', payload_json = null,
         validation_summary_json = $2::jsonb, confirmed_at = now(), confirmed_by_identity_issuer = $3,
         confirmed_by_identity_subject = $4, failure_message = null where id = $1`,
        [batchId, JSON.stringify(audit), actor.identityIssuer, actor.identitySubject],
      );
      await client.query("commit");
      cleanupAfter = true;
      response = { batchId, status: "confirmed", questionCount: created.length, questions: created, confirmedAt };
    }
  } catch (error) {
    failure = error;
    await client.query("rollback").catch(() => undefined);
  } finally {
    client.release();
  }
  if (failure !== null) {
    await Promise.all(promoted.map((filename) => removePromotedTeachingAsset(filename)));
    if (errorCode(failure) === "23505") {
      const issue: TeachingImportIssue = { code: "unique_identifier_conflict", message: "A unique Teaching identifier or asset key was claimed by another request. Upload and validate the file again." };
      await insertBatchAuditFailure(batchId, issue);
      cleanupAfter = true;
      failure = new HttpError(409, issue.message);
    } else {
      const safeMessage = failure instanceof HttpError && failure.statusCode < 500
        ? failure.message
        : "Import confirmation failed and all database changes were rolled back.";
      if (!(failure instanceof HttpError) || failure.statusCode >= 500) {
        logger.error("teaching_import_confirmation_failed", { batchId, errorCode: errorCode(failure) ?? "unknown" });
      }
      const issue: TeachingImportIssue = {
        code: failure instanceof HttpError ? "confirmation_conflict" : "confirmation_failed",
        message: safeMessage,
      };
      const status = failure instanceof HttpError && failure.statusCode < 500 ? "invalid" : "failed";
      const audit = { structurallyValid: false, errors: [issue], warnings: [] };
      await pool.query(
        `update teaching.import_batches set status = $2, payload_json = null, validated_at = null,
         failure_message = $3, validation_summary_json = $4::jsonb where id = $1 and status = 'validated'`,
        [batchId, status, safeMessage, JSON.stringify(audit)],
      ).catch(() => undefined);
      cleanupAfter = true;
    }
    if (cleanupAfter) await cleanupTeachingImportStaging(batchId).catch(() => undefined);
    if (failure instanceof HttpError && failure.statusCode < 500) throw failure;
    throw new HttpError(500, "Import confirmation failed and all database changes were rolled back.");
  }
  if (cleanupAfter) await cleanupTeachingImportStaging(batchId).catch(() => undefined);
  if (response?.status === "invalid") return response;
  return response;
}

export async function getTeachingImportBatchDto(batchId: string) {
  await cleanupExpiredTeachingImports();
  const batch = await getTeachingImportBatch(batchId);
  if (!batch) throw new HttpError(404, "Teaching import batch not found.");
  return toTeachingImportBatchDto(batch);
}

export async function listTeachingImportBatchDtos(limit = 25, offset = 0) {
  await cleanupExpiredTeachingImports();
  return listTeachingImportBatches(limit, offset);
}

export function parseTeachingImportBatchId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, "Import batch ID is invalid.");
  }
  return value;
}

export function parseTeachingImportPagination(limitValue: unknown, offsetValue: unknown) {
  const parse = (value: unknown, defaultValue: number, maxValue: number): number => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return defaultValue;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? Math.min(parsed, maxValue) : defaultValue;
  };
  return { limit: parse(limitValue, 25, 100), offset: parse(offsetValue, 0, 100_000) };
}

export function importDisposition(validation: TeachingImportValidation, externalId: string): ImportDisposition | null {
  return validation.questions.find((question) => question.externalId === externalId)?.disposition ?? null;
}

export function getTeachingImportQuestion(parsed: ParsedTeachingImport, externalId: string): TeachingImportQuestion | undefined {
  return parsed.questions.find((question) => question.externalId === externalId);
}
