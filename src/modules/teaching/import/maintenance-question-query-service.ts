import { pool } from "../../../db/pool.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingQuestionListQuery } from "../services/teaching-content-service.js";

type Id = number | string;

interface TargetRow {
  question_id: Id;
  external_id: string;
  question_bank_code: string;
  question_bank_name: string;
  retired_at: Date | null;
  revision_id: Id;
  revision_number: number;
  revision_version: number | string;
  status: string;
  type: string;
  stem: string;
  specialty_code: string;
  domain_code: string;
  topic_code: string | null;
  subtopic_code: string | null;
  difficulty: number;
  training_level_code: string | null;
  case_id: Id | null;
  case_external_id: string | null;
  explanation_summary: string;
  teaching_point: string;
  further_discussion: string | null;
  evidence_status: string;
  evidence_checked_at: string | Date | null;
  evidence_summary: string;
  evidence_update: string | null;
  authorship_kind: string;
  model_name: string | null;
}

interface OptionRow { question_revision_id: Id; key: string; text: string; isCorrect: boolean; explanation: string | null; }
interface SourceRow {
  question_revision_id: Id; sourceId: Id; sourceType: string; title: string | null; organization: string | null; authors: string[];
  edition: string | null; year: number | null; chapter: string | null; page: string | null; examName: string | null;
  examSitting: string | null; examPaper: string | null; questionNumber: string | null; url: string | null; doi: string | null;
  sourceNotes: string | null; relationship: string; notes: string | null;
}
interface ReferenceRow {
  question_revision_id: Id; referenceId: Id; referenceType: string; title: string; organization: string | null; authors: string[];
  year: number | null; edition: string | null; url: string | null; doi: string | null; citationText: string | null; notes: string | null;
}
interface AssetRow { question_revision_id: Id; id: Id; assetKey: string; originalFilename: string; altText: string; }
interface ClassificationRow { question_revision_id: Id; relationType: "modality" | "competency" | "tag"; code: string; sort_order: number; }

export interface TeachingMaintenanceQuestionSnapshot {
  id: number;
  externalId: string;
  questionBank: { code: string; name: string };
  retiredAt: Date | null;
  revision: {
    id: number; revisionNumber: number; version: number; status: string; type: string; stem: string;
    classification: {
      specialty: { code: string }; domain: { code: string }; topic: { code: string } | null;
      subtopic: { code: string } | null;
    };
    difficulty: number; trainingLevel: string | null; case: { id: number; externalId: string } | null;
    explanation: { summary: string; teachingPoint: string; furtherDiscussion: string | null };
    evidenceReview: { status: string; checkedAt: string | null; summary: string; update: string | null };
    authorship: { kind: string; modelName: string | null };
    options: Array<{ key: string; text: string; isCorrect: boolean; explanation: string | null }>;
    modalities: Array<{ code: string }>; competencies: Array<{ code: string }>; tags: Array<{ code: string }>;
    sources: Array<Omit<SourceRow, "question_revision_id" | "sourceNotes">>;
    references: Array<Omit<ReferenceRow, "question_revision_id">>;
    assets: Array<{ id: number; assetKey: string; originalFilename: string; altText: string }>;
  };
}

const baseCte = [
  "with latest_revision as (",
  "  select distinct on (question_id) * from teaching.question_revisions",
  "  order by question_id, revision_number desc, id desc",
  "), filtered as (",
  "  select question.id as question_id, question.external_id, question.updated_at as question_updated_at, question.retired_at,",
  "    bank.code as question_bank_code, bank.name as question_bank_name,",
  "    revision.id as revision_id, revision.revision_number, revision.version as revision_version,",
  "    revision.status, revision.question_type as type, revision.stem,",
  "    specialty.code as specialty_code, domain.code as domain_code, topic.code as topic_code,",
  "    subtopic.code as subtopic_code, difficulty.value as difficulty, level.code as training_level_code, revision.case_id,",
  "    case_row.external_id as case_external_id, revision.explanation_summary, revision.teaching_point,",
  "    revision.further_discussion, revision.evidence_status, revision.evidence_checked_at::text as evidence_checked_at,",
  "    revision.evidence_summary, revision.evidence_update, revision.authorship_kind, revision.model_name,",
  "    revision.import_batch_id,",
  "    summary.classification as validation_classification",
  "  from teaching.questions question",
  "  join teaching.question_banks bank on bank.id = question.question_bank_id",
  "  join latest_revision revision on revision.question_id = question.id",
  "  join teaching.specialties specialty on specialty.id = revision.specialty_id",
  "  join teaching.domains domain on domain.id = revision.domain_id",
  "  left join teaching.topics topic on topic.id = revision.topic_id",
  "  left join teaching.subtopics subtopic on subtopic.id = revision.subtopic_id",
  "  join teaching.difficulties difficulty on difficulty.id = revision.difficulty_id",
  "  left join teaching.training_levels level on level.id = revision.training_level_id",
  "  left join teaching.cases case_row on case_row.id = revision.case_id",
  "  left join teaching.question_validation_summaries summary",
  "    on summary.question_revision_id = revision.id and summary.revision_version = revision.version",
].join("\n");

function buildFilters(query: TeachingQuestionListQuery) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const bind = (value: unknown) => { values.push(value); return "$" + values.length; };
  const add = (condition: string, value: unknown) => conditions.push(condition.replace("?", bind(value)));
  const search = query.search?.trim().slice(0, 200) || null;
  if (search) {
    const p = bind(search);
    conditions.push("(question.external_id ilike '%' || " + p + " || '%' or revision.stem ilike '%' || " + p + " || '%'"
      + " or exists (select 1 from teaching.question_sources qsource join teaching.sources source"
      + " on source.id = qsource.source_id where qsource.question_revision_id = revision.id and source.title ilike '%' || "
      + p + " || '%') or exists (select 1 from teaching.cases search_case"
      + " where search_case.id = revision.case_id and search_case.external_id ilike '%' || " + p + " || '%'))");
  }
  if (query.status) {
    if (!["draft", "in_review", "published", "retired"].includes(query.status)) throw new HttpError(400, "status is invalid.");
    add("revision.status = ?", query.status);
  }
  const addCode = (column: string, value: string | undefined, name: string) => {
    const code = value?.trim();
    if (!code) return;
    if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(code) || code.length > 100) throw new HttpError(400, name + " is invalid.");
    add(column + " = ?", code);
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
  const tagCode = query.tagCode?.trim();
  if (tagCode) {
    if (!/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(tagCode) || tagCode.length > 100) throw new HttpError(400, "tagCode is invalid.");
    const tag = bind(tagCode);
    conditions.push("exists (select 1 from teaching.question_revision_tags tag_link join teaching.tags tag"
      + " on tag.id = tag_link.tag_id where tag_link.question_revision_id = revision.id and tag.code = " + tag + ")");
  }
  if (query.sourceType) {
    if (!["original", "textbook", "journal_article", "guideline", "society_document", "exam", "question_bank", "lecture", "conference", "website", "local_teaching", "other", "unknown"].includes(query.sourceType)) {
      throw new HttpError(400, "sourceType is invalid.");
    }
    add("exists (select 1 from teaching.question_sources source_link join teaching.sources source_filter"
      + " on source_filter.id = source_link.source_id where source_link.question_revision_id = revision.id"
      + " and source_filter.source_type = ?)", query.sourceType);
  }
  if (query.hasImage !== undefined) conditions.push((query.hasImage ? "" : "not ")
    + "exists (select 1 from teaching.question_revision_assets asset_link where asset_link.question_revision_id = revision.id)");
  if (query.imported !== undefined) conditions.push((query.imported ? "" : "not ")
    + "exists (select 1 from teaching.question_revisions imported_revision where imported_revision.question_id = question.id and imported_revision.import_batch_id is not null)");
  if (query.validationStatus) {
    if (!["valid", "valid_with_warnings", "invalid"].includes(query.validationStatus)) throw new HttpError(400, "validationStatus is invalid.");
    add("summary.classification = ?", query.validationStatus);
  }
  if (query.importBatchId !== undefined) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.importBatchId)) throw new HttpError(400, "importBatchId is invalid.");
    add("revision.import_batch_id = ?::uuid", query.importBatchId);
  }
  const sortExpressions: Record<string, string> = {
    updated: "question_updated_at",
    externalId: "external_id",
    status: "status",
    difficulty: "difficulty",
  };
  const sort = query.sort ?? "updated";
  if (!Object.hasOwn(sortExpressions, sort)) throw new HttpError(400, "sort is invalid.");
  const direction = (query.direction ?? "desc").toLowerCase();
  if (direction !== "asc" && direction !== "desc") throw new HttpError(400, "direction is invalid.");
  return { values, where: conditions.length ? "where " + conditions.join(" and ") : "", orderBy: sortExpressions[sort] + " " + direction.toUpperCase() + " nulls last, external_id asc, question_id asc" };
}

function id(value: Id): number { return Number(value); }
function dateOnly(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}
function group<T extends { question_revision_id: Id }>(rows: T[]) {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const key = id(row.question_revision_id);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

async function loadSnapshots(targetRows: TargetRow[]): Promise<TeachingMaintenanceQuestionSnapshot[]> {
  if (targetRows.length === 0) return [];
  const revisionIds = targetRows.map((row) => row.revision_id);
  const [optionsResult, sourcesResult, referencesResult, assetsResult, classificationsResult] = await Promise.all([
    pool.query<OptionRow>("select question_revision_id, option_key as key, text, is_correct as \"isCorrect\", explanation from teaching.question_options where question_revision_id = any($1::bigint[]) order by question_revision_id, sort_order", [revisionIds]),
    pool.query<SourceRow>([
      "select link.question_revision_id, link.source_id as \"sourceId\", source.source_type as \"sourceType\", source.title, source.organization,",
      "source.authors, source.edition, source.year, source.chapter, source.page, source.exam_name as \"examName\",",
      "source.exam_sitting as \"examSitting\", source.exam_paper as \"examPaper\", source.question_number as \"questionNumber\",",
      "source.url, source.doi, source.notes as \"sourceNotes\", link.relationship_to_source as relationship, link.notes",
      "from teaching.question_sources link join teaching.sources source on source.id = link.source_id",
      "where link.question_revision_id = any($1::bigint[]) order by link.question_revision_id, source.title nulls last, source.id",
    ].join("\n"), [revisionIds]),
    pool.query<ReferenceRow>([
      "select link.question_revision_id, link.reference_id as \"referenceId\", reference.reference_type as \"referenceType\", reference.title, reference.organization,",
      "reference.authors, reference.year, reference.edition, reference.url, reference.doi,",
      "reference.citation_text as \"citationText\", link.notes from teaching.question_references link",
      "join teaching.\"references\" reference on reference.id = link.reference_id",
      "where link.question_revision_id = any($1::bigint[]) order by link.question_revision_id, link.sort_order",
    ].join("\n"), [revisionIds]),
    pool.query<AssetRow>([
      "select link.question_revision_id, asset.id, asset.asset_key as \"assetKey\", asset.original_filename as \"originalFilename\",",
      "coalesce(link.alt_text, asset.alt_text) as \"altText\" from teaching.question_revision_assets link",
      "join teaching.assets asset on asset.id = link.asset_id",
      "where link.question_revision_id = any($1::bigint[]) order by link.question_revision_id, link.sort_order",
    ].join("\n"), [revisionIds]),
    pool.query<ClassificationRow>([
      "select link.question_revision_id, 'modality'::text as \"relationType\", item.code, link.sort_order from teaching.question_revision_modalities link",
      "join teaching.modalities item on item.id = link.modality_id where link.question_revision_id = any($1::bigint[])",
      "union all",
      "select link.question_revision_id, 'competency'::text as \"relationType\", item.code, link.sort_order from teaching.question_revision_competencies link",
      "join teaching.competencies item on item.id = link.competency_id where link.question_revision_id = any($1::bigint[])",
      "union all",
      "select link.question_revision_id, 'tag'::text as \"relationType\", item.code, link.sort_order from teaching.question_revision_tags link",
      "join teaching.tags item on item.id = link.tag_id where link.question_revision_id = any($1::bigint[])",
      "order by 1, 2, 4",
    ].join("\n"), [revisionIds]),
  ]);
  const options = group(optionsResult.rows);
  const sources = group(sourcesResult.rows);
  const references = group(referencesResult.rows);
  const assets = group(assetsResult.rows);
  const classifications = group(classificationsResult.rows);
  return targetRows.map((row) => {
    const revisionId = id(row.revision_id);
    const relations = classifications.get(revisionId) ?? [];
    return {
      id: id(row.question_id),
      externalId: row.external_id,
      questionBank: { code: row.question_bank_code, name: row.question_bank_name },
      retiredAt: row.retired_at,
      revision: {
        id: revisionId, revisionNumber: row.revision_number, version: Number(row.revision_version), status: row.status,
        type: row.type, stem: row.stem,
        classification: {
          specialty: { code: row.specialty_code }, domain: { code: row.domain_code },
          topic: row.topic_code === null ? null : { code: row.topic_code },
          subtopic: row.subtopic_code === null ? null : { code: row.subtopic_code },
        },
        difficulty: row.difficulty, trainingLevel: row.training_level_code,
        case: row.case_external_id === null || row.case_id === null ? null : { id: id(row.case_id), externalId: row.case_external_id },
        explanation: { summary: row.explanation_summary, teachingPoint: row.teaching_point, furtherDiscussion: row.further_discussion },
        evidenceReview: { status: row.evidence_status, checkedAt: dateOnly(row.evidence_checked_at), summary: row.evidence_summary, update: row.evidence_update },
        authorship: { kind: row.authorship_kind, modelName: row.model_name },
        options: (options.get(revisionId) ?? []).map((item) => ({ key: item.key, text: item.text, isCorrect: item.isCorrect, explanation: item.explanation })),
        modalities: relations.filter((item) => item.relationType === "modality").map((item) => ({ code: item.code })),
        competencies: relations.filter((item) => item.relationType === "competency").map((item) => ({ code: item.code })),
        tags: relations.filter((item) => item.relationType === "tag").map((item) => ({ code: item.code })),
        sources: (sources.get(revisionId) ?? []).map(({ question_revision_id: _revisionId, sourceNotes: _sourceNotes, ...item }) => ({ ...item, sourceId: id(item.sourceId) })),
        references: (references.get(revisionId) ?? []).map(({ question_revision_id: _revisionId, ...item }) => ({ ...item, referenceId: id(item.referenceId) })),
        assets: (assets.get(revisionId) ?? []).map((item) => ({ id: id(item.id), assetKey: item.assetKey, originalFilename: item.originalFilename, altText: item.altText })),
      },
    };
  });
}

async function queryTargets(where: string, values: unknown[], orderBy: string, limit: number): Promise<TargetRow[]> {
  const sql = baseCte + "\n" + where + "\n)\nselect filtered.* from filtered order by " + orderBy + " limit $" + (values.length + 1);
  const result = await pool.query<TargetRow>(sql, [...values, limit]);
  return result.rows;
}

export async function getTeachingMaintenanceQuestionSnapshots(
  query: TeachingQuestionListQuery = {},
  maximum = 5000,
): Promise<TeachingMaintenanceQuestionSnapshot[]> {
  const filters = buildFilters(query);
  const rows = await queryTargets(filters.where, filters.values, filters.orderBy, maximum + 1);
  if (rows.length > maximum) throw new HttpError(422, "Export is limited to " + maximum + " questions. Narrow the filters and try again.");
  return loadSnapshots(rows);
}

export async function getTeachingMaintenanceQuestionSnapshotsByIdentity(
  identities: Array<{ questionBankCode: string; externalId: string }>,
): Promise<TeachingMaintenanceQuestionSnapshot[]> {
  if (identities.length === 0) return [];
  const bankCodes = identities.map((item) => item.questionBankCode);
  const externalIds = identities.map((item) => item.externalId);
  const where = "where (bank.code, question.external_id) in (select supplied.bank_code, supplied.external_id from unnest($1::text[], $2::text[]) as supplied(bank_code, external_id))";
  const rows = await queryTargets(where, [bankCodes, externalIds], "external_id asc, question_id asc", identities.length);
  return loadSnapshots(rows);
}
