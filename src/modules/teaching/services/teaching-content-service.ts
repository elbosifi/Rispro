import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import { asUnknownRecord } from "../../../utils/records.js";
import type {
  TeachingAssetInput,
  TeachingAuditIdentity,
  TeachingCaseInput,
  TeachingQuestionInput,
  TeachingReferenceInput,
  TeachingSourceInput,
} from "../domain/teaching-content.js";
import { parseTeachingQuestionInput } from "../domain/teaching-content-validation.js";
import {
  saveTeachingQuestionValidationSummary,
  type TeachingValidationClassification,
  type TeachingValidationIssue,
} from "../repositories/teaching-validation-repository.js";
import { assertTeachingAssetsAvailable } from "./teaching-asset-service.js";
import { withTeachingTransaction } from "./teaching-transaction.js";

interface QuestionBaseRow {
  id: string | number;
  external_id: string;
  created_at: Date;
  updated_at: Date;
  retired_at: Date | null;
  question_bank_code: string;
  question_bank_name: string;
  specialty_code: string;
}

interface RevisionRow {
  id: string | number;
  version: number;
  revision_number: number;
  status: string;
  question_type: string;
  stem: string;
  specialty_code: string;
  domain_code: string;
  topic_code: string | null;
  subtopic_code: string | null;
  difficulty: number;
  training_level_code: string | null;
  case_id: string | number | null;
  case_external_id: string | null;
  case_title: string | null;
  case_clinical_history: string | null;
  explanation_summary: string;
  teaching_point: string;
  further_discussion: string | null;
  authorship_kind: string;
  model_name: string | null;
  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  published_at: Date | null;
  retired_at: Date | null;
  created_by_identity_subject: string;
  reviewed_by_identity_subject: string | null;
  published_by_identity_subject: string | null;
  import_batch_id: string | null;
}

interface OptionRow {
  key: string;
  text: string;
  isCorrect: boolean;
  explanation: string | null;
}

interface NamedCatalogRow {
  code: string;
  label: string;
}

interface SourceLinkRow {
  id: string | number;
  sourceType: string;
  title: string | null;
  organization: string | null;
  authors: string[];
  edition: string | null;
  year: number | null;
  chapter: string | null;
  page: string | null;
  examName: string | null;
  examSitting: string | null;
  examPaper: string | null;
  questionNumber: string | null;
  url: string | null;
  doi: string | null;
  sourceNotes: string | null;
  metadata: Record<string, unknown>;
  relationship: string;
  notes: string | null;
}

interface ReferenceLinkRow {
  id: string | number;
  referenceType: string;
  title: string;
  organization: string | null;
  authors: string[];
  year: number | null;
  edition: string | null;
  url: string | null;
  doi: string | null;
  citationText: string | null;
  notes: string | null;
}

interface AssetLinkRow {
  id: string | number;
  mimeType: string;
  originalFilename: string;
  altText: string;
  sizeBytes: string | number;
}

interface LookupIds {
  specialtyId: number;
  bankId: number;
  domainId: number;
  topicId: number | null;
  subtopicId: number | null;
  difficultyId: number;
  trainingLevelId: number | null;
  modalityIds: number[];
  competencyIds: number[];
  tagIds: number[];
}

function toId(value: string | number): number {
  return Number(value);
}

async function requireOneId(client: PoolClient, sql: string, values: unknown[], label: string): Promise<number> {
  const result = await client.query<{ id: string | number }>(sql, values);
  if (result.rowCount !== 1) throw new HttpError(400, `${label} is unavailable or inactive.`);
  return toId(result.rows[0]!.id);
}

async function requireActiveCodes(client: PoolClient, table: string, codes: string[], label: string): Promise<number[]> {
  if (!codes.length) return [];
  const result = await client.query<{ id: string | number; code: string }>(
    `select id, code from teaching.${table} where is_active and code = any($1::text[])`,
    [codes],
  );
  const byCode = new Map(result.rows.map((row) => [row.code, toId(row.id)]));
  if (byCode.size !== codes.length) throw new HttpError(400, `One or more ${label} are unavailable or inactive.`);
  return codes.map((code) => byCode.get(code)!);
}

async function resolveLookups(client: PoolClient, input: TeachingQuestionInput): Promise<LookupIds> {
  const specialtyId = await requireOneId(client, `select id from teaching.specialties where code = $1 and is_active`, [input.specialtyCode], "Specialty");
  const bank = await client.query<{ id: string | number; specialty_id: string | number }>(
    `select id, specialty_id from teaching.question_banks where code = $1 and is_active`,
    [input.questionBankCode],
  );
  if (bank.rowCount !== 1 || toId(bank.rows[0]!.specialty_id) !== specialtyId) {
    throw new HttpError(400, "Question bank is unavailable or does not match the specialty.");
  }
  const bankId = toId(bank.rows[0]!.id);
  const domainId = await requireOneId(client, `select id from teaching.domains where specialty_id = $1 and code = $2 and is_active`, [specialtyId, input.domainCode], "Domain");
  const topicId = input.topicCode === null ? null : await requireOneId(client, `select id from teaching.topics where domain_id = $1 and code = $2 and is_active`, [domainId, input.topicCode], "Topic");
  if (input.subtopicCode !== null && topicId === null) throw new HttpError(400, "A topic is required when a subtopic is selected.");
  const subtopicId = input.subtopicCode === null ? null : await requireOneId(client, `select id from teaching.subtopics where topic_id = $1 and code = $2 and is_active`, [topicId, input.subtopicCode], "Subtopic");
  const difficultyId = await requireOneId(client, `select id from teaching.difficulties where value = $1 and is_active`, [input.difficulty], "Difficulty");
  const trainingLevelId = input.trainingLevelCode === null ? null : await requireOneId(client, `select id from teaching.training_levels where code = $1 and is_active`, [input.trainingLevelCode], "Training level");
  if (input.caseId !== null) {
    const caseResult = await client.query("select id from teaching.cases where id = $1 and specialty_id = $2", [input.caseId, specialtyId]);
    if (caseResult.rowCount !== 1) throw new HttpError(400, "Case is unavailable or does not match the specialty.");
  }
  const modalityIds = await requireActiveCodes(client, "modalities", input.modalityCodes, "modalities");
  const competencyIds = await requireActiveCodes(client, "competencies", input.competencyCodes, "competencies");
  const tagIds = await requireActiveCodes(client, "tags", input.tagCodes, "tags");
  const sourceIds = input.sources.map((item) => item.sourceId);
  if (sourceIds.length) {
    const result = await client.query("select id from teaching.sources where id = any($1::bigint[]) and is_active", [sourceIds]);
    if (result.rowCount !== sourceIds.length) throw new HttpError(400, "One or more sources are unavailable or inactive.");
  }
  const referenceIds = input.references.map((item) => item.referenceId);
  if (referenceIds.length) {
    const result = await client.query('select id from teaching."references" where id = any($1::bigint[])', [referenceIds]);
    if (result.rowCount !== referenceIds.length) throw new HttpError(400, "One or more references do not exist.");
  }
  if (input.assetIds.length) {
    const result = await client.query("select id from teaching.assets where id = any($1::bigint[])", [input.assetIds]);
    if (result.rowCount !== input.assetIds.length) throw new HttpError(400, "One or more assets do not exist.");
  }
  return { specialtyId, bankId, domainId, topicId, subtopicId, difficultyId, trainingLevelId, modalityIds, competencyIds, tagIds };
}

async function validateQuestionContentForLifecycle(client: PoolClient, input: TeachingQuestionInput): Promise<LookupIds> {
  const lookup = await resolveLookups(client, input);
  if (input.type === "image_based_sba" && input.assetIds.length === 0) {
    throw new HttpError(400, "An image-based question requires at least one image asset.");
  }
  await assertTeachingAssetsAvailable(input.assetIds);
  return lookup;
}

async function saveRevisionRelations(client: PoolClient, revisionId: number, input: TeachingQuestionInput, lookup: LookupIds): Promise<void> {
  await client.query("delete from teaching.question_options where question_revision_id = $1", [revisionId]);
  await client.query("delete from teaching.question_revision_modalities where question_revision_id = $1", [revisionId]);
  await client.query("delete from teaching.question_revision_competencies where question_revision_id = $1", [revisionId]);
  await client.query("delete from teaching.question_revision_tags where question_revision_id = $1", [revisionId]);
  await client.query("delete from teaching.question_sources where question_revision_id = $1", [revisionId]);
  await client.query("delete from teaching.question_references where question_revision_id = $1", [revisionId]);
  await client.query("delete from teaching.question_revision_assets where question_revision_id = $1", [revisionId]);
  for (let i = 0; i < input.options.length; i += 1) {
    const option = input.options[i]!;
    await client.query(
      `insert into teaching.question_options (question_revision_id, option_key, text, is_correct, explanation, sort_order)
       values ($1, $2, $3, $4, $5, $6)`,
      [revisionId, option.key, option.text, option.isCorrect, option.explanation, i + 1],
    );
  }
  const insertOrdered = async (table: string, column: string, ids: number[]) => {
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`insert into teaching.${table} (question_revision_id, ${column}, sort_order) values ($1, $2, $3)`, [revisionId, ids[i], i + 1]);
    }
  };
  await insertOrdered("question_revision_modalities", "modality_id", lookup.modalityIds);
  await insertOrdered("question_revision_competencies", "competency_id", lookup.competencyIds);
  await insertOrdered("question_revision_tags", "tag_id", lookup.tagIds);
  for (const source of input.sources) {
    await client.query(
      `insert into teaching.question_sources (question_revision_id, source_id, relationship_to_source, notes) values ($1, $2, $3, $4)`,
      [revisionId, source.sourceId, source.relationship, source.notes],
    );
  }
  for (let i = 0; i < input.references.length; i += 1) {
    const reference = input.references[i]!;
    await client.query(
      `insert into teaching.question_references (question_revision_id, reference_id, sort_order, notes) values ($1, $2, $3, $4)`,
      [revisionId, reference.referenceId, i + 1, reference.notes],
    );
  }
  for (let i = 0; i < input.assetIds.length; i += 1) {
    const assetId = input.assetIds[i]!;
    const altText = input.assetAltTexts.find((item) => item.assetId === assetId)?.altText ?? null;
    await client.query(
      `insert into teaching.question_revision_assets (question_revision_id, asset_id, sort_order, alt_text)
       values ($1, $2, $3, coalesce($4, (select alt_text from teaching.assets where id = $2)))`,
      [revisionId, assetId, i + 1, altText],
    );
  }
}

async function createRevisionRow(
  client: PoolClient,
  questionId: number,
  revisionNumber: number,
  input: TeachingQuestionInput,
  lookup: LookupIds,
  actor: TeachingAuditIdentity,
  importBatchId: string | null = null,
): Promise<number> {
  const result = await client.query<{ id: string | number }>(
    `insert into teaching.question_revisions (
       question_id, revision_number, status, question_type, stem, specialty_id, domain_id, topic_id, subtopic_id,
       difficulty_id, training_level_id, case_id, explanation_summary, teaching_point, further_discussion,
       authorship_kind, model_name, created_by_identity_issuer, created_by_identity_subject,
       updated_by_identity_issuer, updated_by_identity_subject, import_batch_id
     ) values (
       $1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $17, $18, $19
     ) returning id`,
    [questionId, revisionNumber, input.type, input.stem, lookup.specialtyId, lookup.domainId, lookup.topicId, lookup.subtopicId,
      lookup.difficultyId, lookup.trainingLevelId, input.caseId, input.explanationSummary, input.teachingPoint, input.furtherDiscussion,
      input.authorshipKind, input.modelName, actor.identityIssuer, actor.identitySubject, importBatchId],
  );
  return toId(result.rows[0]!.id);
}

export async function createTeachingQuestionInTransaction(
  client: PoolClient,
  value: unknown,
  actor: TeachingAuditIdentity,
  importBatchId: string | null = null,
): Promise<number> {
  const input = parseTeachingQuestionInput(value);
  const lookup = await resolveLookups(client, input);
  const question = await client.query<{ id: string | number }>(
    `insert into teaching.questions (question_bank_id, specialty_id, external_id, created_by_identity_issuer, created_by_identity_subject)
     values ($1, $2, $3, $4, $5) returning id`,
    [lookup.bankId, lookup.specialtyId, input.externalId, actor.identityIssuer, actor.identitySubject],
  );
  const questionId = toId(question.rows[0]!.id);
  const revisionId = await createRevisionRow(client, questionId, 1, input, lookup, actor, importBatchId);
  await saveRevisionRelations(client, revisionId, input, lookup);
  return questionId;
}

export async function createTeachingQuestion(value: unknown, actor: TeachingAuditIdentity) {
  const id = await withTeachingTransaction((client) => createTeachingQuestionInTransaction(client, value, actor));
  return getTeachingQuestion(id);
}

async function validateTeachingQuestionInput(client: PoolClient, value: unknown): Promise<{ errors: TeachingValidationIssue[]; warnings: TeachingValidationIssue[] }> {
  try {
    const input = parseTeachingQuestionInput(value);
    await validateQuestionContentForLifecycle(client, input);
    const warnings: TeachingValidationIssue[] = [];
    if (input.sources.length === 0) warnings.push({ code: "source_missing", message: "No question source is recorded." });
    if (input.references.length === 0) warnings.push({ code: "references_missing", message: "No supporting references are recorded." });
    if (input.options.some((option) => !option.explanation?.trim())) warnings.push({ code: "option_explanation_missing", message: "One or more answer options have no explanation." });
    if (!input.trainingLevelCode) warnings.push({ code: "training_level_missing", message: "Training level is not set." });
    if (!input.explanationSummary.trim()) warnings.push({ code: "explanation_summary_missing", message: "Explanation summary is empty." });
    if (!input.teachingPoint.trim()) warnings.push({ code: "teaching_point_missing", message: "Teaching point is empty." });
    return { errors: [], warnings };
  } catch (error) {
    if (error instanceof HttpError && error.statusCode < 500) return { errors: [{ code: "invalid_content", message: error.message }], warnings: [] };
    throw error;
  }
}

function teachingValidationClassification(result: { errors: TeachingValidationIssue[]; warnings: TeachingValidationIssue[] }): TeachingValidationClassification {
  return result.errors.length > 0 ? "invalid" : result.warnings.length > 0 ? "valid_with_warnings" : "valid";
}

export async function validateTeachingQuestion(value: unknown) {
  return withTeachingTransaction((client) => validateTeachingQuestionInput(client, value));
}

async function questionBase(id: number, client?: PoolClient): Promise<QuestionBaseRow> {
  const queryable = client ?? pool;
  const result = await queryable.query<QuestionBaseRow>(
    `select question.id, question.external_id, question.created_at, question.updated_at, question.retired_at,
            bank.code as question_bank_code, bank.name as question_bank_name, specialty.code as specialty_code
     from teaching.questions question
     join teaching.question_banks bank on bank.id = question.question_bank_id
     join teaching.specialties specialty on specialty.id = question.specialty_id
     where question.id = $1`,
    [id],
  );
  if (result.rowCount !== 1) throw new HttpError(404, "Teaching question not found.");
  return result.rows[0]!;
}

async function loadRevisionInput(client: PoolClient, revisionId: number, question: QuestionBaseRow): Promise<Record<string, unknown>> {
  const result = await client.query<Record<string, unknown>>(
    `select revision.*, specialty.code as specialty_code, domain.code as domain_code, topic.code as topic_code,
            subtopic.code as subtopic_code, difficulty.value as difficulty_value, level.code as training_level_code
     from teaching.question_revisions revision
     join teaching.specialties specialty on specialty.id = revision.specialty_id
     join teaching.domains domain on domain.id = revision.domain_id
     join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id
     left join teaching.topics topic on topic.id = revision.topic_id
     left join teaching.subtopics subtopic on subtopic.id = revision.subtopic_id
     left join teaching.training_levels level on level.id = revision.training_level_id
     where revision.id = $1 and revision.question_id = $2`,
    [revisionId, question.id],
  );
  if (result.rowCount !== 1) throw new HttpError(404, "Teaching question revision not found.");
  const revision = result.rows[0]!;
  const options = await client.query(`select option_key as key, text, is_correct as "isCorrect", explanation from teaching.question_options where question_revision_id = $1 order by sort_order`, [revisionId]);
  const modalities = await client.query(`select item.code from teaching.question_revision_modalities link join teaching.modalities item on item.id = link.modality_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]);
  const competencies = await client.query(`select item.code from teaching.question_revision_competencies link join teaching.competencies item on item.id = link.competency_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]);
  const tags = await client.query(`select item.code from teaching.question_revision_tags link join teaching.tags item on item.id = link.tag_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]);
  const sources = await client.query(`select source_id as "sourceId", relationship_to_source as relationship, notes from teaching.question_sources where question_revision_id = $1 order by source_id`, [revisionId]);
  const references = await client.query(`select reference_id as "referenceId", notes from teaching.question_references where question_revision_id = $1 order by sort_order`, [revisionId]);
  const assets = await client.query(`select link.asset_id as id, coalesce(link.alt_text, asset.alt_text) as "altText"
    from teaching.question_revision_assets link join teaching.assets asset on asset.id = link.asset_id
    where link.question_revision_id = $1 order by link.sort_order`, [revisionId]);
  return {
    externalId: question.external_id,
    questionBankCode: question.question_bank_code,
    type: revision.question_type,
    stem: revision.stem,
    specialtyCode: revision.specialty_code,
    domainCode: revision.domain_code,
    topicCode: revision.topic_code,
    subtopicCode: revision.subtopic_code,
    difficulty: revision.difficulty_value,
    trainingLevelCode: revision.training_level_code,
    caseId: revision.case_id,
    explanation: {
      summary: revision.explanation_summary,
      teachingPoint: revision.teaching_point,
      furtherDiscussion: revision.further_discussion,
    },
    options: options.rows,
    modalityCodes: modalities.rows.map((row) => row.code),
    competencyCodes: competencies.rows.map((row) => row.code),
    tagCodes: tags.rows.map((row) => row.code),
    sources: sources.rows,
    references: references.rows,
    assetIds: assets.rows.map((row) => toId(row.id)),
    assetAltTexts: assets.rows.map((row) => ({ assetId: toId(row.id), altText: row.altText })),
    authorship: { kind: revision.authorship_kind, modelName: revision.model_name },
  };
}

export async function validateTeachingQuestionRevisionInTransaction(
  client: PoolClient,
  questionId: number,
  revisionId: number,
  expectedVersion: number,
): Promise<{ errors: TeachingValidationIssue[]; warnings: TeachingValidationIssue[] }> {
  const question = await client.query<{ id: number }>(
    "select id from teaching.questions where id = $1 and retired_at is null for share",
    [questionId],
  );
  const current = await client.query<{ id: number; version: number; status: string }>(
    `select id, version, status from teaching.question_revisions
     where question_id = $1 order by revision_number desc, id desc limit 1 for share`,
    [questionId],
  );
  if (!question.rowCount || current.rowCount !== 1 || Number(current.rows[0]!.id) !== revisionId
    || Number(current.rows[0]!.version) !== expectedVersion || current.rows[0]!.status !== "draft") {
    throw new HttpError(409, "The current Draft changed during validation. Run Validate All again.");
  }
  const base = await questionBase(questionId, client);
  const value = await loadRevisionInput(client, revisionId, base);
  return validateTeachingQuestionInput(client, value);
}

export async function validateTeachingQuestionRevision(
  questionId: number,
  revisionId: number,
  expectedVersion: number,
  actor: TeachingAuditIdentity,
) {
  return withTeachingTransaction(async (client) => {
    const validation = await validateTeachingQuestionRevisionInTransaction(client, questionId, revisionId, expectedVersion);
    await saveTeachingQuestionValidationSummary(client, {
      revisionId,
      revisionVersion: expectedVersion,
      classification: teachingValidationClassification(validation),
      errors: validation.errors,
      warnings: validation.warnings,
    }, actor);
    return validation;
  });
}

export async function patchTeachingQuestionDraft(questionId: number, revisionId: number, patchValue: unknown, actor: TeachingAuditIdentity) {
  const patch = asUnknownRecord(patchValue);
  if (!patch) throw new HttpError(400, "Question patch must be an object.");
  const expectedVersion = patch.expectedVersion;
  const editable = new Set([
    "type", "stem", "specialtyCode", "domainCode", "topicCode", "subtopicCode", "difficulty", "trainingLevelCode",
    "caseId", "explanation", "options", "modalityCodes", "competencyCodes", "tagCodes", "sources", "references",
    "assetIds", "assetAltTexts", "authorship", "expectedVersion",
  ]);
  if (Object.keys(patch).some((field) => !editable.has(field))) throw new HttpError(400, "Only draft content fields can be edited.");
  await withTeachingTransaction(async (client) => {
    const question = await client.query("select id from teaching.questions where id = $1 for update", [questionId]);
    if (question.rowCount !== 1) throw new HttpError(404, "Teaching question not found.");
    const revision = await client.query<{ status: string; id: number; version: number }>(
      "select id, status, version from teaching.question_revisions where id = $1 and question_id = $2 for update",
      [revisionId, questionId],
    );
    if (revision.rowCount !== 1) throw new HttpError(404, "Teaching question revision not found.");
    if (revision.rows[0]!.status !== "draft") throw new HttpError(409, "Only draft revisions can be edited.");
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new HttpError(400, "expectedVersion is required for draft updates.");
    if (Number(expectedVersion) !== revision.rows[0]!.version) {
      throw new HttpError(409, "This draft changed after it was loaded. Reload it before saving.");
    }
    const base = await questionBase(questionId, client);
    const current = await loadRevisionInput(client, revisionId, base);
    const merged = { ...current, ...patch };
    const mergedExplanation = { ...(asUnknownRecord(current.explanation) ?? {}), ...(asUnknownRecord(patch.explanation) ?? {}) };
    const mergedAuthorship = { ...(asUnknownRecord(current.authorship) ?? {}), ...(asUnknownRecord(patch.authorship) ?? {}) };
    const input = parseTeachingQuestionInput({ ...merged, explanation: mergedExplanation, authorship: mergedAuthorship });
    const lookup = await resolveLookups(client, input);
    await client.query(
      `update teaching.question_revisions set question_type = $2, stem = $3, specialty_id = $4, domain_id = $5, topic_id = $6,
       subtopic_id = $7, difficulty_id = $8, training_level_id = $9, case_id = $10, explanation_summary = $11,
       teaching_point = $12, further_discussion = $13, authorship_kind = $14, model_name = $15, version = version + 1,
       updated_by_identity_issuer = $16, updated_by_identity_subject = $17, updated_at = now()
       where id = $1`,
      [revisionId, input.type, input.stem, lookup.specialtyId, lookup.domainId, lookup.topicId, lookup.subtopicId, lookup.difficultyId,
        lookup.trainingLevelId, input.caseId, input.explanationSummary, input.teachingPoint, input.furtherDiscussion,
        input.authorshipKind, input.modelName, actor.identityIssuer, actor.identitySubject],
    );
    await saveRevisionRelations(client, revisionId, input, lookup);
    await client.query("update teaching.questions set updated_at = now() where id = $1", [questionId]);
  });
  return getTeachingQuestion(questionId);
}

async function submitTeachingQuestionForReviewInTransaction(client: PoolClient, questionId: number, actor: TeachingAuditIdentity): Promise<number> {
  await client.query("select id from teaching.questions where id = $1 and retired_at is null for update", [questionId]).then((result) => {
    if (!result.rowCount) throw new HttpError(404, "Teaching question not found.");
  });
  const revision = await client.query<{ id: number; status: string }>(
    "select id, status from teaching.question_revisions where question_id = $1 and status = 'draft' for update",
    [questionId],
  );
  if (revision.rowCount !== 1) throw new HttpError(409, "A single draft revision is required to submit for review.");
  const revisionId = toId(revision.rows[0]!.id);
  const base = await questionBase(questionId, client);
  const input = parseTeachingQuestionInput(await loadRevisionInput(client, revisionId, base));
  await validateQuestionContentForLifecycle(client, input);
  await client.query(
    `update teaching.question_revisions set status = 'in_review', submitted_by_identity_issuer = $2,
     submitted_by_identity_subject = $3, submitted_at = now(), updated_by_identity_issuer = $2,
     updated_by_identity_subject = $3, updated_at = now(), version = version + 1 where id = $1`,
    [revisionId, actor.identityIssuer, actor.identitySubject],
  );
  await client.query("update teaching.questions set updated_at = now() where id = $1", [questionId]);
  return revisionId;
}

async function reviewTeachingQuestionInTransaction(client: PoolClient, questionId: number, revisionId: number, actor: TeachingAuditIdentity): Promise<void> {
  const question = await client.query("select id from teaching.questions where id = $1 for update", [questionId]);
  if (!question.rowCount) throw new HttpError(404, "Teaching question not found.");
  const revision = await client.query<{ status: string; reviewed_at: Date | null }>(
    "select status, reviewed_at from teaching.question_revisions where id = $1 and question_id = $2 for update",
    [revisionId, questionId],
  );
  if (revision.rowCount !== 1) throw new HttpError(404, "Teaching question revision not found.");
  if (revision.rows[0]!.status !== "in_review" || revision.rows[0]!.reviewed_at) throw new HttpError(409, "Only an unreviewed revision in review can be approved.");
  await client.query(
    `update teaching.question_revisions set reviewed_by_identity_issuer = $3, reviewed_by_identity_subject = $4,
     reviewed_at = now(), updated_by_identity_issuer = $3, updated_by_identity_subject = $4, updated_at = now(), version = version + 1
     where id = $1 and question_id = $2`,
    [revisionId, questionId, actor.identityIssuer, actor.identitySubject],
  );
  await client.query("update teaching.questions set updated_at = now() where id = $1", [questionId]);
}

async function publishTeachingQuestionInTransaction(client: PoolClient, questionId: number, actor: TeachingAuditIdentity): Promise<number> {
  const question = await client.query("select id, retired_at from teaching.questions where id = $1 for update", [questionId]);
  if (question.rowCount !== 1) throw new HttpError(404, "Teaching question not found.");
  if (question.rows[0]!.retired_at) throw new HttpError(409, "A retired question cannot be published.");
  const revision = await client.query<{ id: number; reviewed_at: Date | null; question_type: string }>(
    `select id, reviewed_at, question_type from teaching.question_revisions
     where question_id = $1 and status = 'in_review' order by revision_number desc limit 1 for update`,
    [questionId],
  );
  if (revision.rowCount !== 1 || !revision.rows[0]!.reviewed_at) throw new HttpError(409, "An approved revision in review is required before publishing.");
  const revisionId = toId(revision.rows[0]!.id);
  const base = await questionBase(questionId, client);
  const input = parseTeachingQuestionInput(await loadRevisionInput(client, revisionId, base));
  await validateQuestionContentForLifecycle(client, input);
  const published = await client.query(
    `update teaching.question_revisions set status = 'published', published_by_identity_issuer = $2,
     published_by_identity_subject = $3, published_at = now(), updated_by_identity_issuer = $2,
     updated_by_identity_subject = $3, updated_at = now(), version = version + 1
     where id = $1 and status = 'in_review' and reviewed_at is not null`,
    [revisionId, actor.identityIssuer, actor.identitySubject],
  );
  if (published.rowCount !== 1) throw new HttpError(409, "The approved revision changed before it could be published.");
  await client.query("update teaching.questions set updated_at = now() where id = $1", [questionId]);
  return revisionId;
}

export async function submitTeachingQuestionForReview(questionId: number, actor: TeachingAuditIdentity) {
  await withTeachingTransaction((client) => submitTeachingQuestionForReviewInTransaction(client, questionId, actor));
  return getTeachingQuestion(questionId);
}

export async function reviewTeachingQuestion(questionId: number, revisionId: number, actor: TeachingAuditIdentity) {
  await withTeachingTransaction((client) => reviewTeachingQuestionInTransaction(client, questionId, revisionId, actor));
  return getTeachingQuestion(questionId);
}

export async function returnTeachingQuestionToDraft(questionId: number, revisionId: number, actor: TeachingAuditIdentity) {
  await withTeachingTransaction(async (client) => {
    await client.query("select id from teaching.questions where id = $1 for update", [questionId]).then((result) => {
      if (!result.rowCount) throw new HttpError(404, "Teaching question not found.");
    });
    const revision = await client.query<{ status: string }>(
      "select status from teaching.question_revisions where id = $1 and question_id = $2 for update",
      [revisionId, questionId],
    );
    if (revision.rowCount !== 1) throw new HttpError(404, "Teaching question revision not found.");
    if (revision.rows[0]!.status !== "in_review") throw new HttpError(409, "Only a revision in review can be returned to Draft.");
    await client.query(
      `update teaching.question_revisions set status = 'draft', submitted_by_identity_issuer = null,
       submitted_by_identity_subject = null, submitted_at = null, reviewed_by_identity_issuer = null,
       reviewed_by_identity_subject = null, reviewed_at = null, updated_by_identity_issuer = $3,
       updated_by_identity_subject = $4, updated_at = now(), version = version + 1
       where id = $1 and question_id = $2`,
      [revisionId, questionId, actor.identityIssuer, actor.identitySubject],
    );
    await client.query("update teaching.questions set updated_at = now() where id = $1", [questionId]);
  });
  return getTeachingQuestion(questionId);
}

export async function publishTeachingQuestion(questionId: number, actor: TeachingAuditIdentity) {
  await withTeachingTransaction((client) => publishTeachingQuestionInTransaction(client, questionId, actor));
  return getTeachingQuestion(questionId);
}

export async function publishTeachingQuestionFromBulk(
  questionId: number,
  expectedRevisionId: number,
  expectedVersion: number,
  actor: TeachingAuditIdentity,
  canSubmitAndReviewDrafts: boolean,
) {
  return withTeachingTransaction(async (client) => {
    const question = await client.query<{ retired_at: Date | null }>(
      "select retired_at from teaching.questions where id = $1 for update",
      [questionId],
    );
    if (!question.rowCount) throw new HttpError(404, "Teaching question not found.");
    if (question.rows[0]!.retired_at) {
      return { status: "retired" as const, revisionId: expectedRevisionId, revisionVersion: expectedVersion, errors: [], warnings: [] };
    }
    const revision = await client.query<{ id: number; version: number; status: string; reviewed_at: Date | null }>(
      `select id, version, status, reviewed_at from teaching.question_revisions
       where question_id = $1 order by revision_number desc, id desc limit 1 for update`,
      [questionId],
    );
    if (!revision.rowCount) throw new HttpError(404, "Teaching question revision not found.");
    const current = revision.rows[0]!;
    if (Number(current.id) === expectedRevisionId && current.status === "published") {
      return { status: "already_published" as const, revisionId: expectedRevisionId, revisionVersion: Number(current.version), errors: [], warnings: [] };
    }
    if (Number(current.id) !== expectedRevisionId || Number(current.version) !== expectedVersion) {
      throw new HttpError(409, "The question changed while the batch was being published.");
    }
    if (current.status !== "draft" && current.status !== "in_review") {
      return { status: current.status === "retired" ? "retired" as const : "conflict" as const, revisionId: expectedRevisionId, revisionVersion: expectedVersion, errors: [], warnings: [] };
    }

    const base = await questionBase(questionId, client);
    const value = await loadRevisionInput(client, expectedRevisionId, base);
    const validation = await validateTeachingQuestionInput(client, value);
    if (validation.errors.length > 0) {
      await saveTeachingQuestionValidationSummary(client, {
        revisionId: expectedRevisionId,
        revisionVersion: expectedVersion,
        classification: "invalid",
        errors: validation.errors,
        warnings: validation.warnings,
      }, actor);
      return { status: "invalid" as const, revisionId: expectedRevisionId, revisionVersion: expectedVersion, ...validation };
    }

    if (current.status === "draft") {
      if (!canSubmitAndReviewDrafts) {
        await saveTeachingQuestionValidationSummary(client, {
          revisionId: expectedRevisionId,
          revisionVersion: expectedVersion,
          classification: teachingValidationClassification(validation),
          errors: validation.errors,
          warnings: validation.warnings,
        }, actor);
        return { status: "requires_review" as const, revisionId: expectedRevisionId, revisionVersion: expectedVersion, ...validation };
      }
      const submittedRevisionId = await submitTeachingQuestionForReviewInTransaction(client, questionId, actor);
      await reviewTeachingQuestionInTransaction(client, questionId, submittedRevisionId, actor);
    } else if (!current.reviewed_at) {
      await saveTeachingQuestionValidationSummary(client, {
        revisionId: expectedRevisionId,
        revisionVersion: expectedVersion,
        classification: teachingValidationClassification(validation),
        errors: validation.errors,
        warnings: validation.warnings,
      }, actor);
      return { status: "requires_review" as const, revisionId: expectedRevisionId, revisionVersion: expectedVersion, ...validation };
    }

    const publishedRevisionId = await publishTeachingQuestionInTransaction(client, questionId, actor);
    const finalRevision = await client.query<{ version: number; status: string }>(
      "select version, status from teaching.question_revisions where id = $1",
      [publishedRevisionId],
    );
    const finalVersion = Number(finalRevision.rows[0]!.version);
    await saveTeachingQuestionValidationSummary(client, {
      revisionId: publishedRevisionId,
      revisionVersion: finalVersion,
      classification: teachingValidationClassification(validation),
      errors: validation.errors,
      warnings: validation.warnings,
    }, actor);
    return { status: "published" as const, revisionId: publishedRevisionId, revisionVersion: finalVersion, ...validation };
  });
}

export async function createTeachingQuestionRevision(questionId: number, actor: TeachingAuditIdentity) {
  await withTeachingTransaction(async (client) => {
    const questionResult = await client.query<{ id: number; external_id: string; question_bank_code: string; question_bank_name: string; specialty_code: string; created_at: Date; updated_at: Date; retired_at: Date | null }>(
      `select question.id, question.external_id, bank.code as question_bank_code, bank.name as question_bank_name,
       specialty.code as specialty_code, question.created_at, question.updated_at, question.retired_at
       from teaching.questions question join teaching.question_banks bank on bank.id = question.question_bank_id
       join teaching.specialties specialty on specialty.id = question.specialty_id where question.id = $1 for update of question`,
      [questionId],
    );
    if (questionResult.rowCount !== 1) throw new HttpError(404, "Teaching question not found.");
    const question = questionResult.rows[0]!;
    if (question.retired_at) throw new HttpError(409, "A retired question cannot receive a new revision.");
    const published = await client.query<{ id: number; import_batch_id: string | null }>(
      "select id, import_batch_id from teaching.question_revisions where question_id = $1 and status = 'published' order by revision_number desc limit 1",
      [questionId],
    );
    if (!published.rowCount) throw new HttpError(409, "A published revision is required before creating a revision.");
    const revisionNumberResult = await client.query<{ next_revision_number: number }>(
      "select coalesce(max(revision_number), 0) + 1 as next_revision_number from teaching.question_revisions where question_id = $1",
      [questionId],
    );
    const base: QuestionBaseRow = {
      id: question.id, external_id: question.external_id, created_at: question.created_at, updated_at: question.updated_at,
      retired_at: question.retired_at, question_bank_code: question.question_bank_code, question_bank_name: question.question_bank_name,
      specialty_code: question.specialty_code,
    };
    const rawInput = await loadRevisionInput(client, published.rows[0]!.id, base);
    const input = parseTeachingQuestionInput(rawInput);
    const lookup = await resolveLookups(client, input);
    const newId = await createRevisionRow(
      client,
      questionId,
      revisionNumberResult.rows[0]!.next_revision_number,
      input,
      lookup,
      actor,
      published.rows[0]!.import_batch_id,
    );
    await saveRevisionRelations(client, newId, input, lookup);
    await client.query("update teaching.questions set updated_at = now() where id = $1", [questionId]);
  });
  return getTeachingQuestion(questionId);
}

export async function retireTeachingQuestion(questionId: number, actor: TeachingAuditIdentity) {
  await withTeachingTransaction(async (client) => {
    const question = await client.query<{ retired_at: Date | null }>("select retired_at from teaching.questions where id = $1 for update", [questionId]);
    if (question.rowCount !== 1) throw new HttpError(404, "Teaching question not found.");
    if (question.rows[0]!.retired_at) throw new HttpError(409, "Question is already retired.");
    const revision = await client.query<{ id: number }>(
      `select id from teaching.question_revisions where question_id = $1 and status in ('draft', 'in_review', 'published')
       order by revision_number desc limit 1 for update`,
      [questionId],
    );
    if (!revision.rowCount) throw new HttpError(409, "Question has no revision to retire.");
    await client.query(
      `update teaching.questions set retired_at = now(), retired_by_identity_issuer = $2,
       retired_by_identity_subject = $3, updated_at = now() where id = $1`,
      [questionId, actor.identityIssuer, actor.identitySubject],
    );
    await client.query(
      `update teaching.question_revisions set status = 'retired', retired_by_identity_issuer = $2,
       retired_by_identity_subject = $3, retired_at = now(), updated_at = now(), version = version + 1 where id = $1`,
      [revision.rows[0]!.id, actor.identityIssuer, actor.identitySubject],
    );
  });
  return getTeachingQuestion(questionId);
}

export interface TeachingQuestionListQuery {
  search?: string;
  status?: string;
  specialtyCode?: string;
  domainCode?: string;
  topicCode?: string;
  subtopicCode?: string;
  type?: string;
  difficulty?: number;
  trainingLevelCode?: string;
  tagCode?: string;
  sourceType?: string;
  hasImage?: boolean;
  imported?: boolean;
  importBatchId?: string;
  sort?: string;
  direction?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
  offset?: number;
}

export async function listTeachingQuestions(query: TeachingQuestionListQuery) {
  const pageSize = Math.min(Math.max(query.pageSize ?? query.limit ?? 25, 1), 100);
  const page = Math.max(query.page ?? (Math.floor((query.offset ?? 0) / pageSize) + 1), 1);
  const offset = (page - 1) * pageSize;
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const add = (condition: string, value: unknown) => conditions.push(condition.replace("?", bind(value)));
  const search = query.search?.trim().slice(0, 200) || null;
  if (search) {
    const p = bind(search);
    conditions.push(`(question.external_id ilike '%' || ${p} || '%' or revision.stem ilike '%' || ${p} || '%'
      or exists (select 1 from teaching.question_sources qsource join teaching.sources source on source.id = qsource.source_id
        where qsource.question_revision_id = revision.id and source.title ilike '%' || ${p} || '%')
      or exists (select 1 from teaching.cases case_row where case_row.id = revision.case_id and case_row.external_id ilike '%' || ${p} || '%'))`);
  }
  if (query.status) {
    if (!["draft", "in_review", "published", "retired"].includes(query.status)) throw new HttpError(400, "status is invalid.");
    add("revision.status = ?", query.status);
  }
  const addCode = (column: string, value: string | undefined, name: string) => {
    const code = value?.trim();
    if (!code) return;
    if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(code) || code.length > 100) throw new HttpError(400, `${name} is invalid.`);
    add(`${column} = ?`, code);
  };
  addCode("specialty.code", query.specialtyCode, "specialtyCode");
  addCode("domain.code", query.domainCode, "domainCode");
  addCode("topic.code", query.topicCode, "topicCode");
  addCode("subtopic.code", query.subtopicCode, "subtopicCode");
  addCode("level.code", query.trainingLevelCode, "trainingLevelCode");
  addCode("revision.question_type", query.type, "type");
  if (query.type && !["single_best_answer", "image_based_sba", "case_based_sba"].includes(query.type)) throw new HttpError(400, "type is invalid.");
  if (query.difficulty !== undefined) {
    if (!Number.isInteger(query.difficulty) || query.difficulty < 1 || query.difficulty > 5) throw new HttpError(400, "difficulty is invalid.");
    add("difficulty.value = ?", query.difficulty);
  }
  addCode("tag.code", query.tagCode, "tagCode");
  if (query.tagCode?.trim()) conditions.push("exists (select 1 from teaching.question_revision_tags tag_link where tag_link.question_revision_id = revision.id and tag_link.tag_id = tag.id)");
  if (query.sourceType) {
    if (!["original", "textbook", "journal_article", "guideline", "society_document", "exam", "question_bank", "lecture", "conference", "website", "local_teaching", "other", "unknown"].includes(query.sourceType)) throw new HttpError(400, "sourceType is invalid.");
    add("exists (select 1 from teaching.question_sources source_link join teaching.sources source_filter on source_filter.id = source_link.source_id where source_link.question_revision_id = revision.id and source_filter.source_type = ?)", query.sourceType);
  }
  if (query.hasImage !== undefined) conditions.push(`${query.hasImage ? "" : "not "}exists (select 1 from teaching.question_revision_assets asset_link where asset_link.question_revision_id = revision.id)`);
  if (query.imported !== undefined) conditions.push(`${query.imported ? "" : "not "}exists (select 1 from teaching.question_revisions imported_revision where imported_revision.question_id = question.id and imported_revision.import_batch_id is not null)`);
  if (query.importBatchId !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.importBatchId)) throw new HttpError(400, "importBatchId is invalid.");
    add("revision.import_batch_id = ?::uuid", query.importBatchId);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const sort = query.sort ?? "updated";
  const sortExpressions: Record<string, string> = {
    updated: "question_updated_at",
    externalId: "external_id",
    status: "status",
    difficulty: "difficulty",
  };
  if (!Object.hasOwn(sortExpressions, sort)) throw new HttpError(400, "sort is invalid.");
  const direction = (query.direction ?? "desc").toLowerCase();
  if (direction !== "asc" && direction !== "desc") throw new HttpError(400, "direction is invalid.");
  const directionSql = direction.toUpperCase();
  const cte = `with latest_revision as (
    select distinct on (question_id) * from teaching.question_revisions
    order by question_id, revision_number desc, id desc
  ), filtered as (
    select question.id, question.external_id, question.created_at as question_created_at, question.updated_at as question_updated_at,
      question.retired_at, bank.code as bank_code, bank.name as bank_name, revision.id as revision_id,
      revision.version as revision_version, revision.revision_number, revision.status, revision.question_type as type, revision.stem, revision.import_batch_id,
      specialty.code as specialty_code, specialty.label as specialty_label, domain.code as domain_code, domain.label as domain_label,
      topic.code as topic_code, topic.label as topic_label, difficulty.value as difficulty,
      level.code as training_level_code, level.label as training_level_label,
      summary.classification as validation_classification,
      coalesce(jsonb_array_length(summary.errors_json), 0) as validation_error_count,
      coalesce(jsonb_array_length(summary.warnings_json), 0) as validation_warning_count,
      source_summary.title as source_title,
      exists (select 1 from teaching.question_revision_assets asset_link where asset_link.question_revision_id = revision.id) as has_image,
      exists (select 1 from teaching.question_revisions imported_revision where imported_revision.question_id = question.id and imported_revision.import_batch_id is not null) as imported
    from teaching.questions question
    join teaching.question_banks bank on bank.id = question.question_bank_id
    join latest_revision revision on revision.question_id = question.id
    join teaching.specialties specialty on specialty.id = revision.specialty_id
    join teaching.domains domain on domain.id = revision.domain_id
    left join teaching.topics topic on topic.id = revision.topic_id
    left join teaching.subtopics subtopic on subtopic.id = revision.subtopic_id
    join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id
    left join teaching.training_levels level on level.id = revision.training_level_id
    left join teaching.question_validation_summaries summary
      on summary.question_revision_id = revision.id and summary.revision_version = revision.version
    left join teaching.tags tag on tag.code = ${query.tagCode?.trim() ? bind(query.tagCode.trim()) : "null::text"}
    left join lateral (
      select string_agg(coalesce(source.title, source.source_type), ', ' order by source.title nulls last, source.id) as title
      from teaching.question_sources source_link join teaching.sources source on source.id = source_link.source_id
      where source_link.question_revision_id = revision.id
    ) source_summary on true
    ${where}
  )`;
  const count = await pool.query<{ total: string }>(`${cte} select count(*)::text as total from filtered`, values);
  const total = Number(count.rows[0]?.total ?? 0);
  const rows = await pool.query<{
    id: string | number; external_id: string; question_created_at: Date; question_updated_at: Date; retired_at: Date | null;
    bank_code: string; bank_name: string; revision_id: string | number; revision_version: number; revision_number: number; status: string; type: string;
    stem: string; import_batch_id: string | null; specialty_code: string; specialty_label: string; domain_code: string; domain_label: string;
    topic_code: string | null; topic_label: string | null; difficulty: number; training_level_code: string | null;
    training_level_label: string | null; validation_classification: TeachingValidationClassification | null;
    validation_error_count: number; validation_warning_count: number; source_title: string | null; has_image: boolean; imported: boolean;
  }>(
    `${cte} select filtered.* from filtered order by ${sortExpressions[sort]} ${directionSql} nulls last, external_id asc, id asc limit ${bind(pageSize)} offset ${bind(offset)}`,
    values,
  );
  return {
    items: rows.rows.map((row) => ({
      id: toId(row.id),
      externalId: row.external_id,
      questionBank: { code: row.bank_code, name: row.bank_name },
      revision: { id: toId(row.revision_id), version: Number(row.revision_version), revisionNumber: row.revision_number, status: row.status, type: row.type, stem: row.stem, importBatchId: row.import_batch_id },
      validation: row.validation_classification === null ? null : {
        classification: row.validation_classification,
        errorCount: Number(row.validation_error_count),
        warningCount: Number(row.validation_warning_count),
      },
      sourceTitle: row.source_title,
      hasImage: row.has_image,
      imported: row.imported,
      classification: {
        specialty: { code: row.specialty_code, label: row.specialty_label },
        domain: { code: row.domain_code, label: row.domain_label },
        topic: row.topic_code === null ? null : { code: row.topic_code, label: row.topic_label },
        difficulty: row.difficulty,
        trainingLevel: row.training_level_code === null ? null : { code: row.training_level_code, label: row.training_level_label },
      },
      retiredAt: row.retired_at,
      createdAt: row.question_created_at,
      updatedAt: row.question_updated_at,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), limit: pageSize, offset },
  };
}

export async function getTeachingQuestion(id: number) {
  const question = await questionBase(id);
  const revisionsResult = await pool.query<RevisionRow>(
    `select revision.id, revision.version, revision.revision_number, revision.status, revision.question_type, revision.stem,
       specialty.code as specialty_code, domain.code as domain_code, topic.code as topic_code, subtopic.code as subtopic_code,
       difficulty.value as difficulty, level.code as training_level_code, revision.case_id, case_row.external_id as case_external_id,
       case_row.title as case_title, case_row.clinical_history as case_clinical_history, revision.explanation_summary,
       revision.teaching_point, revision.further_discussion, revision.authorship_kind, revision.model_name,
       revision.created_at, revision.updated_at, revision.submitted_at, revision.reviewed_at, revision.published_at,
       revision.retired_at, revision.created_by_identity_subject, revision.reviewed_by_identity_subject,
       revision.published_by_identity_subject, revision.import_batch_id
     from teaching.question_revisions revision
     join teaching.specialties specialty on specialty.id = revision.specialty_id
     join teaching.domains domain on domain.id = revision.domain_id
     join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id
     left join teaching.topics topic on topic.id = revision.topic_id
     left join teaching.subtopics subtopic on subtopic.id = revision.subtopic_id
     left join teaching.training_levels level on level.id = revision.training_level_id
     left join teaching.cases case_row on case_row.id = revision.case_id
     where revision.question_id = $1 order by revision.revision_number desc`,
    [id],
  );
  const revisions = await Promise.all(revisionsResult.rows.map(async (row) => {
    const revisionId = toId(row.id);
    const [options, modalities, competencies, tags, sources, references, assets, caseAssets] = await Promise.all([
      pool.query<OptionRow>(`select option_key as key, text, is_correct as "isCorrect", explanation from teaching.question_options where question_revision_id = $1 order by sort_order`, [revisionId]),
      pool.query<NamedCatalogRow>(`select item.code, item.label from teaching.question_revision_modalities link join teaching.modalities item on item.id = link.modality_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]),
      pool.query<NamedCatalogRow>(`select item.code, item.label from teaching.question_revision_competencies link join teaching.competencies item on item.id = link.competency_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]),
      pool.query<NamedCatalogRow>(`select item.code, item.label from teaching.question_revision_tags link join teaching.tags item on item.id = link.tag_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]),
      pool.query<SourceLinkRow>(`select source.id, source.source_type as "sourceType", source.title, source.organization,
        source.authors, source.edition, source.year, source.chapter, source.page, source.exam_name as "examName",
        source.exam_sitting as "examSitting", source.exam_paper as "examPaper", source.question_number as "questionNumber",
        source.url, source.doi, source.notes as "sourceNotes", source.metadata_json as metadata,
        link.relationship_to_source as relationship, link.notes from teaching.question_sources link
        join teaching.sources source on source.id = link.source_id where link.question_revision_id = $1
        order by source.title nulls last, source.id`, [revisionId]),
      pool.query<ReferenceLinkRow>(`select reference.id, reference.reference_type as "referenceType", reference.title, reference.organization, reference.authors, reference.year, reference.edition, reference.url, reference.doi, reference.citation_text as "citationText", link.notes from teaching.question_references link join teaching."references" reference on reference.id = link.reference_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]),
      pool.query<AssetLinkRow>(`select asset.id, asset.mime_type as "mimeType", asset.original_filename as "originalFilename", coalesce(link.alt_text, asset.alt_text) as "altText", asset.size_bytes as "sizeBytes" from teaching.question_revision_assets link join teaching.assets asset on asset.id = link.asset_id where link.question_revision_id = $1 order by link.sort_order`, [revisionId]),
      row.case_id === null ? Promise.resolve({ rows: [] as AssetLinkRow[] }) : pool.query<AssetLinkRow>(`select asset.id, asset.mime_type as "mimeType", asset.original_filename as "originalFilename", asset.alt_text as "altText", asset.size_bytes as "sizeBytes" from teaching.case_assets link join teaching.assets asset on asset.id = link.asset_id where link.case_id = $1 order by link.sort_order`, [row.case_id]),
    ]);
    return {
      id: revisionId,
      version: row.version,
      revisionNumber: row.revision_number,
      status: row.status,
      type: row.question_type,
      stem: row.stem,
      classification: {
        specialty: { code: row.specialty_code },
        domain: { code: row.domain_code },
        topic: row.topic_code === null ? null : { code: row.topic_code },
        subtopic: row.subtopic_code === null ? null : { code: row.subtopic_code },
      },
      difficulty: row.difficulty,
      trainingLevel: row.training_level_code,
      case: row.case_id === null ? null : {
        id: toId(row.case_id), externalId: row.case_external_id, title: row.case_title,
        clinicalHistory: row.case_clinical_history,
        assets: caseAssets.rows.map((asset) => ({
          id: toId(asset.id), mimeType: asset.mimeType,
          originalFilename: asset.originalFilename, altText: asset.altText, sizeBytes: toId(asset.sizeBytes),
        })),
      },
      explanation: { summary: row.explanation_summary, teachingPoint: row.teaching_point, furtherDiscussion: row.further_discussion },
      options: options.rows.map((option) => ({ key: option.key, text: option.text, isCorrect: option.isCorrect, explanation: option.explanation })),
      modalities: modalities.rows.map((item) => ({ code: item.code, label: item.label })),
      competencies: competencies.rows.map((item) => ({ code: item.code, label: item.label })),
      tags: tags.rows.map((item) => ({ code: item.code, label: item.label })),
      sources: sources.rows.map((source) => ({
        id: toId(source.id), sourceType: source.sourceType, title: source.title, organization: source.organization,
        authors: source.authors, edition: source.edition, year: source.year, chapter: source.chapter, page: source.page,
        examName: source.examName, examSitting: source.examSitting, examPaper: source.examPaper,
        questionNumber: source.questionNumber, url: source.url, doi: source.doi, sourceNotes: source.sourceNotes,
        metadata: source.metadata, relationship: source.relationship, notes: source.notes,
      })),
      references: references.rows.map((reference) => ({
        id: toId(reference.id), referenceType: reference.referenceType, title: reference.title,
        organization: reference.organization, authors: reference.authors, year: reference.year, edition: reference.edition,
        url: reference.url, doi: reference.doi, citationText: reference.citationText, notes: reference.notes,
      })),
      assets: assets.rows.map((asset) => ({
        id: toId(asset.id), mimeType: asset.mimeType,
        originalFilename: asset.originalFilename, altText: asset.altText, sizeBytes: toId(asset.sizeBytes),
      })),
      authorship: { kind: row.authorship_kind, modelName: row.model_name },
      audit: {
        createdBy: row.created_by_identity_subject,
        submittedAt: row.submitted_at,
        reviewedBy: row.reviewed_by_identity_subject,
        reviewedAt: row.reviewed_at,
        publishedBy: row.published_by_identity_subject,
        publishedAt: row.published_at,
        retiredAt: row.retired_at,
        importBatchId: row.import_batch_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    };
  }));
  return {
    id: toId(question.id),
    externalId: question.external_id,
    questionBank: { code: question.question_bank_code, name: question.question_bank_name },
    specialtyCode: question.specialty_code,
    createdAt: question.created_at,
    updatedAt: question.updated_at,
    retiredAt: question.retired_at,
    revisions,
  };
}

async function requireAssets(client: PoolClient, assetIds: number[]) {
  if (!assetIds.length) return;
  const result = await client.query("select id from teaching.assets where id = any($1::bigint[])", [assetIds]);
  if (result.rowCount !== assetIds.length) throw new HttpError(400, "One or more assets do not exist.");
}

export async function createTeachingSourceInTransaction(client: PoolClient, input: TeachingSourceInput, actor: TeachingAuditIdentity): Promise<number> {
  const inserted = await client.query<{ id: string | number }>(
    `insert into teaching.sources (source_type, title, organization, authors, edition, year, chapter, page, exam_name,
     exam_sitting, exam_paper, question_number, url, doi, notes, metadata_json, created_by_identity_issuer, created_by_identity_subject)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18) returning id`,
    [input.sourceType, input.title, input.organization, input.authors, input.edition, input.year, input.chapter, input.page,
      input.examName, input.examSitting, input.examPaper, input.questionNumber, input.url, input.doi, input.notes,
      JSON.stringify(input.metadata), actor.identityIssuer, actor.identitySubject],
  );
  return toId(inserted.rows[0]!.id);
}

export async function createTeachingSource(input: TeachingSourceInput, actor: TeachingAuditIdentity) {
  const result = await withTeachingTransaction((client) => createTeachingSourceInTransaction(client, input, actor));
  const row = await pool.query<{ id: string | number; source_type: string; title: string | null; organization: string | null; authors: string[]; edition: string | null; year: number | null; chapter: string | null; page: string | null; exam_name: string | null; exam_sitting: string | null; exam_paper: string | null; question_number: string | null; url: string | null; doi: string | null; notes: string | null; metadata: Record<string, unknown>; created_at: Date; updated_at: Date }>(`select id, source_type, title, organization, authors, edition, year, chapter, page,
    exam_name, exam_sitting, exam_paper, question_number,
    url, doi, notes, metadata_json as metadata, created_at, updated_at from teaching.sources where id = $1`, [result]);
  const source = row.rows[0]!;
  return {
    id: toId(source.id), sourceType: source.source_type, title: source.title, organization: source.organization,
    authors: source.authors, edition: source.edition, year: source.year, chapter: source.chapter, page: source.page,
    examName: source.exam_name, examSitting: source.exam_sitting, examPaper: source.exam_paper,
    questionNumber: source.question_number, url: source.url, doi: source.doi, notes: source.notes,
    metadata: source.metadata, createdAt: source.created_at, updatedAt: source.updated_at,
  };
}

export async function createTeachingReferenceInTransaction(client: PoolClient, input: TeachingReferenceInput, actor: TeachingAuditIdentity): Promise<number> {
  const inserted = await client.query<{ id: string | number }>(
    `insert into teaching."references" (reference_type, title, organization, authors, year, edition, url, doi, citation_text, notes,
     created_by_identity_issuer, created_by_identity_subject) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [input.referenceType, input.title, input.organization, input.authors, input.year, input.edition, input.url, input.doi,
      input.citationText, input.notes, actor.identityIssuer, actor.identitySubject],
  );
  return toId(inserted.rows[0]!.id);
}

export async function createTeachingReference(input: TeachingReferenceInput, actor: TeachingAuditIdentity) {
  const result = await withTeachingTransaction((client) => createTeachingReferenceInTransaction(client, input, actor));
  const row = await pool.query<{ id: string | number; reference_type: string; title: string; organization: string | null; authors: string[]; year: number | null; edition: string | null; url: string | null; doi: string | null; citation_text: string | null; notes: string | null; created_at: Date; updated_at: Date }>(`select id, reference_type, title, organization, authors, year, edition, url, doi,
    citation_text, notes, created_at, updated_at from teaching."references" where id = $1`, [result]);
  const reference = row.rows[0]!;
  return {
    id: toId(reference.id), referenceType: reference.reference_type, title: reference.title, organization: reference.organization,
    authors: reference.authors, year: reference.year, edition: reference.edition, url: reference.url, doi: reference.doi,
    citationText: reference.citation_text, notes: reference.notes, createdAt: reference.created_at, updatedAt: reference.updated_at,
  };
}

export async function createTeachingCaseInTransaction(client: PoolClient, input: TeachingCaseInput, actor: TeachingAuditIdentity): Promise<number> {
  const specialtyId = await requireOneId(client, "select id from teaching.specialties where code = $1 and is_active", [input.specialtyCode], "Specialty");
  await requireAssets(client, input.assetIds);
  const inserted = await client.query<{ id: string | number }>(
    `insert into teaching.cases (external_id, specialty_id, title, clinical_history, created_by_identity_issuer, created_by_identity_subject)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [input.externalId, specialtyId, input.title, input.clinicalHistory, actor.identityIssuer, actor.identitySubject],
  );
  for (let i = 0; i < input.assetIds.length; i += 1) {
    await client.query("insert into teaching.case_assets (case_id, asset_id, sort_order) values ($1,$2,$3)", [inserted.rows[0]!.id, input.assetIds[i], i + 1]);
  }
  return toId(inserted.rows[0]!.id);
}

export async function createTeachingAssetInTransaction(client: PoolClient, input: TeachingAssetInput, actor: TeachingAuditIdentity): Promise<number> {
  const inserted = await client.query<{ id: string | number }>(
    `insert into teaching.assets (asset_key, storage_key, mime_type, original_filename, alt_text, size_bytes,
       created_by_identity_issuer, created_by_identity_subject)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [input.assetKey, input.storageKey, input.mimeType, input.originalFilename, input.altText, input.sizeBytes,
      actor.identityIssuer, actor.identitySubject],
  );
  return toId(inserted.rows[0]!.id);
}

export async function createTeachingCase(input: TeachingCaseInput, actor: TeachingAuditIdentity) {
  const result = await withTeachingTransaction((client) => createTeachingCaseInTransaction(client, input, actor));
  const row = await pool.query<{ id: string | number; external_id: string; specialty_code: string; title: string | null; clinical_history: string | null; created_at: Date; updated_at: Date }>(`select case_row.id, case_row.external_id, specialty.code as specialty_code, case_row.title,
    case_row.clinical_history, case_row.created_at, case_row.updated_at
    from teaching.cases case_row join teaching.specialties specialty on specialty.id = case_row.specialty_id where case_row.id = $1`, [result]);
  const teachingCase = row.rows[0]!;
  return {
    id: toId(teachingCase.id), externalId: teachingCase.external_id, specialtyCode: teachingCase.specialty_code,
    title: teachingCase.title, clinicalHistory: teachingCase.clinical_history,
    createdAt: teachingCase.created_at, updatedAt: teachingCase.updated_at,
  };
}

export function parsePositivePathId(value: unknown): number {
  if (typeof value !== "string") throw new HttpError(400, "id must be a positive integer.");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "id must be a positive integer.");
  return id;
}
