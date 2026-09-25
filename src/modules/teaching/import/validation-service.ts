import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import type { TeachingImportIssue, TeachingImportQuestion, ParsedTeachingImport } from "./import-schema.js";
import type { StagedTeachingAsset } from "./staging-service.js";
import { getTeachingCatalog, listTeachingQuestionBanks } from "../repositories/teaching-catalog-repository.js";
import type { TeachingQuestionType } from "../domain/teaching-content.js";

export type ImportDisposition = "new" | "existing_draft" | "existing_published" | "conflict";

export interface TeachingImportPreviewQuestion {
  externalId: string;
  type: string;
  stem: string;
  correctOption: { id: string; text: string } | null;
  options: Array<{ id: string; text: string; isCorrect: boolean; explanation: string | null }>;
  explanation: TeachingImportQuestion["explanation"];
  classification: {
    specialty: { code: string; label: string } | null;
    domain: { code: string; label: string } | null;
    topic: { code: string; label: string } | null;
    subtopic: { code: string; label: string } | null;
    modalities: Array<{ code: string; label: string }>;
    competencies: Array<{ code: string; label: string }>;
    trainingLevel: { code: string; label: string } | null;
    difficulty: { value: number; label: string } | null;
    tags: Array<{ code: string; label: string }>;
  };
  source: TeachingImportQuestion["source"];
  provenance: string | null;
  referenceCount: number;
  media: TeachingImportQuestion["media"];
  case: { externalId: string; title: string | null } | null;
  disposition: ImportDisposition;
  warnings: TeachingImportIssue[];
  errors: TeachingImportIssue[];
}

export interface TeachingImportValidation {
  schemaVersion: string | null;
  questionCount: number;
  caseCount: number;
  assetCount: number;
  errors: TeachingImportIssue[];
  warnings: TeachingImportIssue[];
  questions: TeachingImportPreviewQuestion[];
}

interface ExistingQuestionRow {
  external_id: string;
  status: string | null;
}

interface ExistingCaseRow {
  external_id: string;
  specialty_code: string;
  title: string | null;
  clinical_history: string | null;
}

const EXPECTED_GENERATION_METHODS = new Set(["human_authored", "ai_assisted", "ai_generated", "imported", "unknown"]);
const REFERENCE_TYPES = new Set(["textbook", "journal_article", "guideline", "society_document", "website", "other", "unknown"]);
const EXTERNAL_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/;
const DOI = /^(?:https?:\/\/doi\.org\/)?10\.\d{4,9}\/[\w.()/:;-]+$/i;

function issue(code: string, message: string, externalId?: string, path?: string): TeachingImportIssue {
  return { code, message, ...(externalId ? { externalId } : {}), ...(path ? { path } : {}) };
}

function labelByCode<T extends { code: string; label: string }>(items: readonly T[], code: string | null) {
  return code === null ? null : items.find((item) => item.code === code) ?? null;
}

export async function validateTeachingImport(
  parsed: ParsedTeachingImport,
  assets: readonly StagedTeachingAsset[],
  client?: PoolClient,
): Promise<TeachingImportValidation> {
  const [catalog, banks] = await Promise.all([getTeachingCatalog(client), listTeachingQuestionBanks(client)]);
  const errors = [...parsed.errors];
  const warnings: TeachingImportIssue[] = [];
  const questions = parsed.questions;
  const byExternal = new Map(questions.map((question) => [question.externalId, { errors: [] as TeachingImportIssue[], warnings: [] as TeachingImportIssue[] }]));
  const addError = (question: TeachingImportQuestion, entry: TeachingImportIssue) => {
    errors.push(entry);
    byExternal.get(question.externalId)?.errors.push(entry);
  };
  const addWarning = (question: TeachingImportQuestion, entry: TeachingImportIssue) => {
    warnings.push(entry);
    byExternal.get(question.externalId)?.warnings.push(entry);
  };

  const specialties = new Map(catalog.specialties.map((item) => [item.code, item]));
  const domains = new Map(catalog.domains.map((item) => [item.code, item]));
  const topics = new Map(catalog.topics.map((item) => [item.code, item]));
  const subtopicsByCode = new Map(catalog.subtopics.map((item) => [item.code, item]));
  const modalities = new Map(catalog.modalities.map((item) => [item.code, item]));
  const competencies = new Map(catalog.competencies.map((item) => [item.code, item]));
  const trainingLevels = new Map(catalog.trainingLevels.map((item) => [item.code, item]));
  const difficulties = new Map(catalog.difficulties.map((item) => [item.value, item]));
  const tags = new Map(catalog.tags.map((item) => [item.code, item]));
  const questionTypes = new Set<string>(catalog.supportedQuestionTypes);
  const sourceTypes = new Set<string>(catalog.supportedSourceTypes);
  const provenanceTypes = new Set<string>(catalog.supportedProvenanceRelationships);
  const stagedByFilename = new Map(assets.map((asset) => [asset.filename.toLocaleLowerCase("en-US"), asset]));
  const referencedFilenames = new Set<string>();
  const assetKeys = new Map<string, TeachingImportQuestion>();
  const caseDefinitions = new Map<string, { specialty: string; title: string | null; clinicalHistory: string | null; questions: TeachingImportQuestion[] }>();
  const bankBySpecialty = new Map<string, typeof banks>();
  for (const bank of banks) bankBySpecialty.set(bank.specialtyCode, [...(bankBySpecialty.get(bank.specialtyCode) ?? []), bank]);

  for (const question of questions) {
    const { specialty, domain, topic, subtopics: subtopicCodes, modalities: modalityCodes, competencies: competencyCodes, trainingLevel, difficulty, tags: tagCodes } = question.classification;
    const specialtyRow = specialties.get(specialty);
    const domainRow = domains.get(domain);
    if (!specialtyRow) addError(question, issue("unknown_specialty", `Unknown or inactive specialty "${specialty}".`, question.externalId, "classification.specialty"));
    if (!domainRow || domainRow.parentCode !== specialty) addError(question, issue("invalid_domain_hierarchy", `Domain "${domain}" is unknown, inactive, or does not belong to specialty "${specialty}".`, question.externalId, "classification.domain"));
    const topicRow = topic === null ? null : topics.get(topic);
    if (topic !== null && (!topicRow || topicRow.parentCode !== domain)) addError(question, issue("invalid_topic_hierarchy", `Topic "${topic}" is unknown, inactive, or does not belong to domain "${domain}".`, question.externalId, "classification.topic"));
    for (const subtopic of subtopicCodes) {
      const subtopicRow = subtopicsByCode.get(subtopic);
      if (!topicRow || !subtopicRow || subtopicRow.parentCode !== topic) addError(question, issue("invalid_subtopic_hierarchy", `Subtopic "${subtopic}" is unknown, inactive, or does not belong to topic "${topic ?? "(none)"}".`, question.externalId, "classification.subtopics"));
    }
    for (const code of modalityCodes) if (!modalities.has(code)) addError(question, issue("unknown_modality", `Unknown or inactive modality "${code}".`, question.externalId, "classification.modalities"));
    for (const code of competencyCodes) if (!competencies.has(code)) addError(question, issue("unknown_competency", `Unknown or inactive competency "${code}".`, question.externalId, "classification.competencies"));
    if (trainingLevel !== null && !trainingLevels.has(trainingLevel)) addError(question, issue("unknown_training_level", `Unknown or inactive training level "${trainingLevel}".`, question.externalId, "classification.trainingLevel"));
    if (trainingLevel === null) addWarning(question, issue("training_level_missing", "No training level supplied.", question.externalId, "classification.trainingLevel"));
    if (difficulty !== null && !difficulties.has(difficulty)) addError(question, issue("invalid_difficulty", `Difficulty "${difficulty}" is not active in the current catalog.`, question.externalId, "classification.difficulty"));
    if (difficulty === null) addWarning(question, issue("difficulty_defaulted", "No difficulty supplied; confirm will assign the catalog's moderate difficulty when available, otherwise the first active difficulty.", question.externalId, "classification.difficulty"));
    for (const code of tagCodes) if (!tags.has(code)) addError(question, issue("unknown_tag", `Unknown or inactive tag "${code}".`, question.externalId, "classification.tags"));
    if (!questionTypes.has(question.type)) addError(question, issue("unsupported_question_type", `Question type "${question.type}" is not supported by the active Teaching catalog.`, question.externalId, "type"));
    if (question.type === "image_based_sba" && question.media.length === 0) addError(question, issue("image_required", "Image-based SBA questions require at least one image asset.", question.externalId, "media"));
    if (question.type === "case_based_sba" && question.caseId === null) addError(question, issue("case_required", "Case-based SBA questions require a caseId.", question.externalId, "caseId"));
    const matchingBanks = bankBySpecialty.get(specialty) ?? [];
    if (matchingBanks.length !== 1) addError(question, issue("question_bank_unavailable", matchingBanks.length === 0 ? `No active question bank is configured for "${specialty}".` : `More than one active question bank is configured for "${specialty}"; Phase 3 requires one unambiguous bank.`, question.externalId, "classification.specialty"));
    if (!EXTERNAL_ID.test(question.externalId)) addError(question, issue("invalid_external_id", "externalId must use uppercase letters, digits, and hyphens.", question.externalId, "externalId"));

    if (question.source && !sourceTypes.has(question.source.type)) addError(question, issue("unknown_source_type", `Source type "${question.source.type}" is not supported by the active catalog.`, question.externalId, "source.type"));
    if (!question.source) {
      if (question.relationshipToSource !== null) addError(question, issue("provenance_without_source", "provenance.relationshipToSource requires a source object.", question.externalId, "provenance.relationshipToSource"));
      addWarning(question, issue("source_missing", "No source information was supplied.", question.externalId, "source"));
    } else {
      if (question.relationshipToSource !== null && !provenanceTypes.has(question.relationshipToSource)) addError(question, issue("invalid_provenance", `Provenance relationship "${question.relationshipToSource}" is not supported.`, question.externalId, "provenance.relationshipToSource"));
      if (question.relationshipToSource === null) addWarning(question, issue("provenance_unknown", "Source relationship is unknown and will be stored as unknown.", question.externalId, "provenance.relationshipToSource"));
      if (question.source.type !== "original" && question.source.type !== "unknown" && !question.source.title) addError(question, issue("source_title_required", `A title is required for source type "${question.source.type}".`, question.externalId, "source.title"));
      if (question.source.year !== null && (question.source.year < 1000 || question.source.year > 9999)) addError(question, issue("invalid_source_year", "Source year must be a four-digit year from 1000 to 9999.", question.externalId, "source.year"));
      if (question.source.doi && !DOI.test(question.source.doi)) addError(question, issue("invalid_doi", "DOI must use a valid DOI identifier format.", question.externalId, "source.doi"));
      if (question.source.type === "unknown") addWarning(question, issue("source_unknown", "Source type is unknown.", question.externalId, "source.type"));
      if (question.source.type === "exam" && !question.source.examName) addWarning(question, issue("exam_name_missing", "Exam source details are incomplete; no examination name was supplied.", question.externalId, "source.exam.name"));
    }
    for (const reference of question.references) {
      if (!REFERENCE_TYPES.has(reference.type)) addError(question, issue("unknown_reference_type", `Reference type "${reference.type}" is not supported.`, question.externalId, "references"));
      if (reference.year !== null && (reference.year < 1000 || reference.year > 9999)) addError(question, issue("invalid_reference_year", "Reference year must be a four-digit year from 1000 to 9999.", question.externalId, "references.year"));
      if (reference.doi && !DOI.test(reference.doi)) addError(question, issue("invalid_doi", "DOI must use a valid DOI identifier format.", question.externalId, "references.doi"));
    }
    if (question.references.length === 0) addWarning(question, issue("references_missing", "No independent references were supplied.", question.externalId, "references"));
    for (const option of question.options) if (!question.explanation.optionExplanations[option.id]) addWarning(question, issue("option_explanation_missing", `No option explanation was supplied for option ${option.id}.`, question.externalId, "explanation.optionExplanations"));
    if ((question.generation.method === "ai_assisted" || question.generation.method === "ai_generated") && !question.generation.model) addWarning(question, issue("model_name_missing", "AI generation was indicated without a model name.", question.externalId, "generation.model"));
    if (!EXPECTED_GENERATION_METHODS.has(question.generation.method)) addError(question, issue("invalid_generation_method", `Generation method "${question.generation.method}" is not supported.`, question.externalId, "generation.method"));

    for (const media of question.media) {
      if (assetKeys.has(media.assetKey)) addError(question, issue("duplicate_asset_key", `assetKey "${media.assetKey}" is used more than once in the file.`, question.externalId, "media.assetKey"));
      assetKeys.set(media.assetKey, question);
      referencedFilenames.add(media.filename.toLocaleLowerCase("en-US"));
      const staged = stagedByFilename.get(media.filename.toLocaleLowerCase("en-US"));
      if (!staged) addError(question, { ...issue("asset_missing", `Referenced image "${media.filename}" was not found in the ZIP assets/.`, question.externalId, "media.filename"), filename: media.filename });
      else if (!extensionMatchesMime(media.filename, staged.mimeType)) addError(question, { ...issue("asset_extension_mismatch", `File extension for "${media.filename}" does not match its detected image type.`, question.externalId, "media.filename"), filename: media.filename });
    }

    if (question.caseId !== null) {
      const previous = caseDefinitions.get(question.caseId);
      if (previous) {
        const contradictory = previous.specialty !== specialty
          || (question.case !== null && question.case.title !== null && previous.title !== null && question.case.title !== previous.title)
          || (question.case !== null && question.case.clinicalHistory !== null && previous.clinicalHistory !== null && question.case.clinicalHistory !== previous.clinicalHistory);
        if (contradictory) addError(question, issue("case_metadata_conflict", `Case "${question.caseId}" has contradictory specialty or metadata within this batch.`, question.externalId, "case"));
        previous.questions.push(question);
        if (previous.title === null && question.case?.title != null) previous.title = question.case.title;
        if (previous.clinicalHistory === null && question.case?.clinicalHistory != null) previous.clinicalHistory = question.case.clinicalHistory;
      } else {
        caseDefinitions.set(question.caseId, { specialty, title: question.case?.title ?? null, clinicalHistory: question.case?.clinicalHistory ?? null, questions: [question] });
      }
    }
  }

  const caseIds = [...caseDefinitions.keys()];
  let existingCases: ExistingCaseRow[] = [];
  let existingQuestions: ExistingQuestionRow[] = [];
  let existingAssetKeys: string[] = [];
  const query = async <T extends import("pg").QueryResultRow>(sql: string, values: unknown[]) => client
    ? client.query<T>(sql, values)
    : pool.query<T>(sql, values);
  if (questions.length) {
    existingQuestions = (await query<ExistingQuestionRow>(
      `select question.external_id, revision.status
       from teaching.questions question
       left join lateral (select status from teaching.question_revisions where question_id = question.id order by revision_number desc limit 1) revision on true
       where question.external_id = any($1::text[])`,
      [questions.map((question) => question.externalId)],
    )).rows;
    if (caseIds.length) existingCases = (await query<ExistingCaseRow>(
      `select case_row.external_id, specialty.code as specialty_code, case_row.title, case_row.clinical_history
       from teaching.cases case_row join teaching.specialties specialty on specialty.id = case_row.specialty_id
       where case_row.external_id = any($1::text[])`,
      [caseIds],
    )).rows;
    if (assetKeys.size) existingAssetKeys = (await query<{ asset_key: string }>(
      "select asset_key from teaching.assets where asset_key = any($1::text[])",
      [[...assetKeys.keys()]],
    )).rows.map((row) => row.asset_key);
  }

  const questionById = new Map(questions.map((question) => [question.externalId, question]));
  const dispositions = new Map<string, ImportDisposition>();
  for (const existing of existingQuestions) {
    const disposition: ImportDisposition = existing.status === "published" ? "existing_published" : existing.status === "draft" || existing.status === "in_review" ? "existing_draft" : "conflict";
    dispositions.set(existing.external_id, disposition);
    const question = questionById.get(existing.external_id);
    if (question) addError(question, issue("external_id_conflict", `externalId "${existing.external_id}" already exists (${disposition.replaceAll("_", " ")}).`, question.externalId, "externalId"));
  }
  const existingCaseById = new Map(existingCases.map((row) => [row.external_id, row]));
  for (const [caseId, definition] of caseDefinitions) {
    const existing = existingCaseById.get(caseId);
    if (!existing) continue;
    const contradictory = existing.specialty_code !== definition.specialty
      || (definition.title !== null && existing.title !== null && definition.title !== existing.title)
      || (definition.clinicalHistory !== null && existing.clinical_history !== null && definition.clinicalHistory !== existing.clinical_history);
    if (contradictory) for (const question of definition.questions) addError(question, issue("existing_case_conflict", `Existing case "${caseId}" has different specialty or supplied metadata.`, question.externalId, "case"));
  }
  for (const assetKey of existingAssetKeys) {
    const question = assetKeys.get(assetKey);
    if (question) addError(question, issue("asset_key_conflict", `assetKey "${assetKey}" already belongs to a Teaching asset.`, question.externalId, "media.assetKey"));
  }
  for (const asset of assets) if (!referencedFilenames.has(asset.filename.toLocaleLowerCase("en-US"))) warnings.push({ code: "asset_unused", message: `ZIP asset "${asset.filename}" is not referenced by a question.`, filename: asset.filename, path: "assets" });

  const difficultyDefault = catalog.difficulties.find((item) => item.value === 3) ?? catalog.difficulties[0] ?? null;
  const previewQuestions: TeachingImportPreviewQuestion[] = questions.map((question) => {
    const questionIssues = byExternal.get(question.externalId) ?? { errors: [], warnings: [] };
    const classification = question.classification;
    const subtopicCode = classification.subtopics[0] ?? null;
    const correctOption = question.options.find((option) => option.id === question.answerKey[0]) ?? null;
    const disposition = dispositions.get(question.externalId) ?? "new";
    return {
      externalId: question.externalId,
      type: question.type,
      stem: question.stem,
      correctOption,
      options: question.options.map((option) => ({
        id: option.id,
        text: option.text,
        isCorrect: option.id === question.answerKey[0],
        explanation: question.explanation.optionExplanations[option.id] ?? null,
      })),
      explanation: question.explanation,
      classification: {
        specialty: labelByCode(catalog.specialties, classification.specialty),
        domain: labelByCode(catalog.domains, classification.domain),
        topic: labelByCode(catalog.topics, classification.topic),
        subtopic: labelByCode(catalog.subtopics, subtopicCode),
        modalities: classification.modalities.map((code) => labelByCode(catalog.modalities, code)).filter((item): item is NonNullable<typeof item> => item !== null),
        competencies: classification.competencies.map((code) => labelByCode(catalog.competencies, code)).filter((item): item is NonNullable<typeof item> => item !== null),
        trainingLevel: labelByCode(catalog.trainingLevels, classification.trainingLevel),
        difficulty: classification.difficulty === null ? difficultyDefault : catalog.difficulties.find((item) => item.value === classification.difficulty) ?? null,
        tags: classification.tags.map((code) => labelByCode(catalog.tags, code)).filter((item): item is NonNullable<typeof item> => item !== null),
      },
      source: question.source,
      provenance: question.relationshipToSource,
      referenceCount: question.references.length,
      media: question.media,
      case: question.caseId === null ? null : { externalId: question.caseId, title: caseDefinitions.get(question.caseId)?.title ?? existingCaseById.get(question.caseId)?.title ?? null },
      disposition,
      warnings: questionIssues.warnings,
      errors: questionIssues.errors,
    };
  });

  return {
    schemaVersion: parsed.schemaVersion,
    questionCount: questions.length,
    caseCount: caseDefinitions.size,
    assetCount: assets.length,
    errors,
    warnings,
    questions: previewQuestions,
  };
}

function extensionMatchesMime(filename: string, mimeType: StagedTeachingAsset["mimeType"]): boolean {
  const extension = filename.split(".").at(-1)?.toLocaleLowerCase("en-US");
  return mimeType === "image/jpeg" ? extension === "jpg" || extension === "jpeg"
    : mimeType === "image/png" ? extension === "png"
      : extension === "webp";
}

export function toTeachingQuestionCommand(question: TeachingImportQuestion, questionBankCode: string, assetIds: readonly number[], caseId: number | null, sourceIds: readonly { id: number; relationship: string }[], referenceIds: readonly number[], moderateDifficulty: number) {
  const optionExplanations = question.explanation.optionExplanations;
  return {
    externalId: question.externalId,
    questionBankCode,
    type: question.type as TeachingQuestionType,
    stem: question.stem,
    specialtyCode: question.classification.specialty,
    domainCode: question.classification.domain,
    topicCode: question.classification.topic,
    subtopicCode: question.classification.subtopics[0] ?? null,
    difficulty: question.classification.difficulty ?? moderateDifficulty,
    trainingLevelCode: question.classification.trainingLevel,
    caseId,
    explanation: {
      summary: question.explanation.summary,
      teachingPoint: question.explanation.teachingPoint,
      furtherDiscussion: question.explanation.furtherDiscussion,
    },
    options: question.options.map((option) => ({ key: option.id, text: option.text, isCorrect: option.id === question.answerKey[0], explanation: optionExplanations[option.id] ?? null })),
    modalityCodes: question.classification.modalities,
    competencyCodes: question.classification.competencies,
    tagCodes: question.classification.tags,
    sources: sourceIds.map((source) => ({ sourceId: source.id, relationship: source.relationship, notes: null })),
    references: referenceIds.map((referenceId) => ({ referenceId, notes: null })),
    assetIds: [...assetIds],
    authorship: { kind: question.generation.method, modelName: question.generation.model },
  };
}
