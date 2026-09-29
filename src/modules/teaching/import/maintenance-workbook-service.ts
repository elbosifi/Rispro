import { createHash } from "node:crypto";
import Busboy from "busboy";
import type { Request } from "express";
import { pool } from "../../../db/pool.js";
import { buildWorkbookBuffer, parseWorksheet, readWorkbookFromBase64 } from "../../../services/workbook-service.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingAuditIdentity } from "../domain/teaching-content.js";
import { parseTeachingReferenceInput, parseTeachingSourceInput } from "../domain/teaching-content-validation.js";
import { createTeachingQuestionRevision, createTeachingReference, createTeachingSource, getTeachingQuestion, listTeachingQuestions, patchTeachingQuestionDraft, type TeachingQuestionListQuery } from "../services/teaching-content-service.js";
import type { TeachingImportIssue } from "./import-schema.js";
import { createProposedTopicsInTransaction } from "./import-service.js";
import type { TeachingImportTopicProposal } from "./validation-service.js";
import { getTeachingCatalog } from "../repositories/teaching-catalog-repository.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_QUESTIONS = 5000;
const QUESTION_HEADERS = ["question_bank_code", "external_id", "question_id", "revision_id", "revision_number", "revision_version", "status", "type", "specialty", "domain", "topic", "subtopic", "modalities", "competencies", "training_level", "difficulty", "tags", "stem", "explanation_summary", "teaching_point", "further_discussion", "evidence_status", "evidence_checked_at", "evidence_summary", "evidence_update", "generation_method", "generation_model", "case_external_id"] as const;
const OPTION_HEADERS = ["external_id", "option_order", "option_key", "option_text", "is_correct", "explanation"] as const;
const SOURCE_HEADERS = ["external_id", "source_order", "source_type", "title", "organization", "authors", "edition", "year", "chapter", "page", "exam_name", "exam_sitting", "exam_paper", "question_number", "url", "doi", "relationship_to_source", "notes"] as const;
const REFERENCE_HEADERS = ["external_id", "reference_order", "reference_type", "title", "organization", "authors", "year", "edition", "url", "doi", "citation_text", "notes"] as const;
const MEDIA_HEADERS = ["external_id", "media_order", "asset_id", "asset_key", "original_filename", "alt_text"] as const;
const TAXONOMY_HEADERS = ["type", "specialty", "parent_code", "code", "label", "description", "active"] as const;
const PROPOSAL_HEADERS = ["specialty", "domain", "code", "label", "description"] as const;

type Action = "unchanged" | "update_draft" | "create_draft_revision" | "conflict_in_review" | "stale_conflict" | "retired" | "missing_question" | "invalid";
interface MaintenanceRow { externalId: string; questionBankCode: string; questionId: number; revisionId: number; revisionVersion: number; action: Action; changedFields: string[]; warnings: TeachingImportIssue[]; errors: TeachingImportIssue[]; values: Record<string, string>; }
interface MaintenanceTopicProposal extends TeachingImportTopicProposal {}
interface ParsedMaintenanceWorkbook { hash: string; rows: MaintenanceRow[]; topicProposals: MaintenanceTopicProposal[]; errors: TeachingImportIssue[]; warnings: TeachingImportIssue[]; }

function value(row: Record<string, unknown>, key: string): string { return String(row[key] ?? "").trim(); }
function semicolon(value: string): string[] { return value ? value.split(";").map((item) => item.trim()).filter(Boolean) : []; }
function issue(code: string, message: string, externalId?: string): TeachingImportIssue { return { code, message, ...(externalId ? { externalId } : {}) }; }
function bool(value: string): boolean { return value.toLocaleLowerCase("en-US") === "true"; }
function number(value: string): number | null { const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : null; }
function date(value: string): string | null { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null; }
function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function rowKey(row: Record<string, string>, headers: readonly string[]) { return JSON.stringify(headers.filter((header) => header !== "external_id").map((header) => value(row, header))); }
function sourceWorkbookRow(source: Awaited<ReturnType<typeof getTeachingQuestion>>["revisions"][number]["sources"][number], index: number): Record<string, string> {
  return { external_id: "", source_order: String(index + 1), source_type: source.sourceType, title: source.title ?? "", organization: source.organization ?? "", authors: source.authors.join(";"), edition: source.edition ?? "", year: source.year === null ? "" : String(source.year), chapter: source.chapter ?? "", page: source.page ?? "", exam_name: source.examName ?? "", exam_sitting: source.examSitting ?? "", exam_paper: source.examPaper ?? "", question_number: source.questionNumber ?? "", url: source.url ?? "", doi: source.doi ?? "", relationship_to_source: source.relationship, notes: source.notes ?? "" };
}
function referenceWorkbookRow(reference: Awaited<ReturnType<typeof getTeachingQuestion>>["revisions"][number]["references"][number], index: number): Record<string, string> {
  return { external_id: "", reference_order: String(index + 1), reference_type: reference.referenceType, title: reference.title, organization: reference.organization ?? "", authors: reference.authors.join(";"), year: reference.year === null ? "" : String(reference.year), edition: reference.edition ?? "", url: reference.url ?? "", doi: reference.doi ?? "", citation_text: reference.citationText ?? "", notes: reference.notes ?? "" };
}
function mediaWorkbookRow(asset: Awaited<ReturnType<typeof getTeachingQuestion>>["revisions"][number]["assets"][number], index: number): Record<string, string> {
  return { external_id: "", media_order: String(index + 1), asset_id: String(asset.id), asset_key: asset.assetKey, original_filename: asset.originalFilename, alt_text: asset.altText };
}
function sameLinkedRows(actual: Array<Record<string, string>>, supplied: Array<Record<string, string>>, headers: readonly string[]) {
  return actual.length === supplied.length && actual.every((entry, index) => rowKey(entry, headers) === rowKey(supplied[index] ?? {}, headers));
}
function sourceInput(row: Record<string, string>) {
  return parseTeachingSourceInput({ sourceType: row.source_type, title: row.title || null, organization: row.organization || null, authors: semicolon(row.authors), edition: row.edition || null, year: row.year || null, chapter: row.chapter || null, page: row.page || null, examName: row.exam_name || null, examSitting: row.exam_sitting || null, examPaper: row.exam_paper || null, questionNumber: row.question_number || null, url: row.url || null, doi: row.doi || null, notes: row.notes || null, metadata: {} });
}
function referenceInput(row: Record<string, string>) {
  return parseTeachingReferenceInput({ referenceType: row.reference_type, title: row.title, organization: row.organization || null, authors: semicolon(row.authors), year: row.year || null, edition: row.edition || null, url: row.url || null, doi: row.doi || null, citationText: row.citation_text || null, notes: row.notes || null });
}

function normalizedLabel(value: string) { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }
function topicKey(domain: string, code: string) { return `${domain}\u0000${code}`; }

async function validateMaintenanceTopicProposals(parsed: ParsedMaintenanceWorkbook) {
  const catalog = await getTeachingCatalog();
  const specialties = new Set(catalog.specialties.map((item) => item.code));
  const domains = new Map(catalog.domains.map((item) => [item.code, item]));
  const existingByKey = new Map(catalog.topics.map((item) => [topicKey(item.parentCode ?? "", item.code), item]));
  const existingLabel = new Map(catalog.topics.map((item) => [topicKey(item.parentCode ?? "", normalizedLabel(item.label)), item]));
  const byKey = new Map<string, MaintenanceTopicProposal>(); const labels = new Map<string, MaintenanceTopicProposal>();
  const addError = (proposal: MaintenanceTopicProposal, code: string, message: string) => { const entry = issue(code, message); proposal.errors.push(entry); parsed.errors.push(entry); };
  const addWarning = (proposal: MaintenanceTopicProposal, code: string, message: string) => { const entry = issue(code, message); proposal.warnings.push(entry); parsed.warnings.push(entry); };
  for (const proposal of parsed.topicProposals) {
    proposal.questionCount = parsed.rows.filter((row) => row.values.domain === proposal.domain && row.values.topic === proposal.code).length;
    if (!specialties.has(proposal.specialty)) addError(proposal, "unknown_specialty", `Unknown or inactive specialty "${proposal.specialty}".`);
    const domain = domains.get(proposal.domain);
    if (!domain || domain.parentCode !== proposal.specialty) addError(proposal, "invalid_domain_hierarchy", `Domain "${proposal.domain}" is unknown, inactive, or does not belong to specialty "${proposal.specialty}".`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(proposal.code)) addError(proposal, "invalid_topic_code", "Topic code must use lower-case kebab-case.");
    if (!proposal.label) addError(proposal, "topic_label_required", "Topic label is required.");
    const key = topicKey(proposal.domain, proposal.code);
    if (byKey.has(key)) addError(proposal, "duplicate_topic_proposal", `Topic "${proposal.code}" is proposed more than once for domain "${proposal.domain}".`); else byKey.set(key, proposal);
    const current = existingByKey.get(key);
    if (current) {
      if (normalizedLabel(current.label) === normalizedLabel(proposal.label)) { proposal.alreadyExists = true; addWarning(proposal, "topic_already_exists", `Topic "${proposal.code}" already exists in domain "${proposal.domain}"; it will not be created.`); }
      else addError(proposal, "topic_conflict", `Topic code "${proposal.code}" already exists in domain "${proposal.domain}" with different metadata.`);
    }
    const labelKey = topicKey(proposal.domain, normalizedLabel(proposal.label));
    const currentLabel = existingLabel.get(labelKey); const proposedLabel = labels.get(labelKey);
    if (currentLabel && currentLabel.code !== proposal.code) addError(proposal, "topic_duplicate_label", `Topic label "${proposal.label}" already exists in domain "${proposal.domain}" with code "${currentLabel.code}".`);
    if (proposedLabel && proposedLabel.code !== proposal.code) addError(proposal, "topic_duplicate_label", `Topic label "${proposal.label}" is proposed more than once in domain "${proposal.domain}".`); else labels.set(labelKey, proposal);
    if (proposal.questionCount === 0) addWarning(proposal, "topic_proposal_unused", `Topic proposal "${proposal.code}" is not used by a workbook question.`);
  }
  for (const row of parsed.rows) {
    const topic = row.values.topic; if (!topic) continue;
    const existing = existingByKey.get(topicKey(row.values.domain, topic)); const proposed = byKey.get(topicKey(row.values.domain, topic));
    if (existing || (proposed && proposed.errors.length === 0)) continue;
    const elsewhere = parsed.topicProposals.find((proposal) => proposal.code === topic);
    row.action = "invalid";
    row.errors.push(issue("invalid_topic_hierarchy", elsewhere ? `Proposed Topic "${topic}" belongs to a different Domain.` : `Topic "${topic}" is unknown and has no matching proposal.`, row.externalId));
  }
}

async function receiveWorkbook(req: Request): Promise<Buffer> {
  const length = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > MAX_BYTES + 128 * 1024) throw new HttpError(413, "Maintenance workbook exceeds 25 MB.");
  return new Promise<Buffer>((resolve, reject) => {
    let result: Buffer | null = null;
    let failed = false;
    const fail = (error: Error) => { if (!failed) { failed = true; reject(error); } };
    let parser: ReturnType<typeof Busboy>;
    try { parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 0, parts: 2, fileSize: MAX_BYTES } }); }
    catch { reject(new HttpError(400, "Expected one multipart XLSX file.")); return; }
    parser.on("file", (name, stream, info) => {
      if (name !== "file" || result !== null || !/\.xlsx$/i.test(String(info.filename ?? ""))) { stream.resume(); fail(new HttpError(400, "Upload one .xlsx workbook using the file field.")); return; }
      const parts: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => parts.push(Buffer.from(chunk)));
      stream.on("limit", () => fail(new HttpError(413, "Maintenance workbook exceeds 25 MB.")));
      stream.on("end", () => { result = Buffer.concat(parts); });
    });
    parser.on("error", () => fail(new HttpError(400, "Maintenance workbook multipart data is invalid.")));
    parser.on("finish", () => { if (!failed) { if (!result?.length) fail(new HttpError(400, "A non-empty .xlsx workbook is required.")); else resolve(result); } });
    req.pipe(parser);
  });
}

function requireHeaders(actual: string[], expected: readonly string[], sheet: string, errors: TeachingImportIssue[]) {
  const missing = expected.filter((header) => !actual.includes(header));
  if (missing.length) errors.push(issue("malformed_headers", `${sheet} is missing required columns: ${missing.join(", ")}.`));
}

async function parseWorkbook(bytes: Buffer): Promise<ParsedMaintenanceWorkbook> {
  const errors: TeachingImportIssue[] = [];
  const warnings: TeachingImportIssue[] = [];
  const workbookHash = hash(bytes);
  const { XLSX, workbook } = await readWorkbookFromBase64(bytes.toString("base64"));
  if (workbook.vbaraw) errors.push(issue("macros_not_supported", "Macro-enabled workbooks are not supported."));
  const needed: Array<[string, readonly string[]]> = [["Questions", QUESTION_HEADERS], ["Options", OPTION_HEADERS], ["Sources", SOURCE_HEADERS], ["References", REFERENCE_HEADERS], ["Media", MEDIA_HEADERS], ["Taxonomy", TAXONOMY_HEADERS], ["Topic Proposals", PROPOSAL_HEADERS], ["Instructions", []]];
  const sheets = new Map<string, ReturnType<typeof parseWorksheet>>();
  for (const [name, headers] of needed) {
    const sheet = workbook.Sheets[name];
    if (!sheet) { errors.push(issue("missing_sheet", `Workbook must include the ${name} sheet.`)); continue; }
    for (const cell of Object.values(sheet)) if (typeof cell === "object" && cell !== null && "f" in cell) errors.push(issue("formula_not_supported", `Formulas are not accepted in ${name}.`));
    const parsed = parseWorksheet(XLSX, sheet, name); sheets.set(name, parsed); requireHeaders(parsed.headers, headers, name, errors);
  }
  const questions = sheets.get("Questions")?.rows ?? [];
  if (questions.length > MAX_QUESTIONS) errors.push(issue("question_limit", `Workbook may contain at most ${MAX_QUESTIONS} questions.`));
  const unique = new Set<string>();
  const rows: MaintenanceRow[] = questions.map(({ values }) => {
    const item = Object.fromEntries(QUESTION_HEADERS.map((key) => [key, value(values, key)]));
    const externalId = item.external_id;
    const questionBankCode = item.question_bank_code;
    const row: MaintenanceRow = { externalId, questionBankCode, questionId: number(item.question_id) ?? 0, revisionId: number(item.revision_id) ?? 0, revisionVersion: number(item.revision_version) ?? 0, action: "invalid", changedFields: [], warnings: [], errors: [], values: item };
    const key = `${questionBankCode}\u0000${externalId}`;
    if (!externalId || !questionBankCode || !row.questionId || !row.revisionId || !row.revisionVersion) row.errors.push(issue("invalid_identity", "Question identity and revision concurrency fields are required.", externalId));
    if (unique.has(key)) row.errors.push(issue("duplicate_external_id", "Question Bank + external ID must be unique in a maintenance workbook.", externalId));
    unique.add(key);
    return row;
  });
  const parsed: ParsedMaintenanceWorkbook = {
    hash: workbookHash,
    rows,
    topicProposals: (sheets.get("Topic Proposals")?.rows ?? []).map(({ values }) => ({
      specialty: value(values, "specialty"), domain: value(values, "domain"), code: value(values, "code"), label: value(values, "label"), description: value(values, "description"),
      questionCount: 0, alreadyExists: false, warnings: [], errors: [],
    })),
    errors,
    warnings,
  };
  await validateMaintenanceTopicProposals(parsed);
  return parsed;
}

function workbookInput(row: MaintenanceRow, options: Array<Record<string, string>>) {
  const value = row.values;
  const optionRows = options.sort((a, b) => Number(a.option_order) - Number(b.option_order));
  return {
    externalId: row.externalId, questionBankCode: row.questionBankCode, type: value.type, stem: value.stem,
    specialtyCode: value.specialty, domainCode: value.domain, topicCode: value.topic || null, subtopicCode: value.subtopic || null,
    difficulty: Number(value.difficulty), trainingLevelCode: value.training_level || null, caseId: null,
    explanation: { summary: value.explanation_summary, teachingPoint: value.teaching_point, furtherDiscussion: value.further_discussion || null },
    options: optionRows.map((option) => ({ key: option.option_key, text: option.option_text, isCorrect: bool(option.is_correct), explanation: option.explanation || null })),
    modalityCodes: semicolon(value.modalities), competencyCodes: semicolon(value.competencies), tagCodes: semicolon(value.tags),
    sources: [], references: [], assetIds: [], assetAltTexts: [], authorship: { kind: value.generation_method || "imported", modelName: value.generation_model || null },
    evidenceReview: { status: value.evidence_status || "not_verified", checkedAt: value.evidence_checked_at || null, summary: value.evidence_summary || "", update: value.evidence_update || null },
  };
}

export async function exportTeachingMaintenanceWorkbook(query: TeachingQuestionListQuery = {}): Promise<Buffer> {
  const list = await listTeachingQuestions({ ...query, page: 1, pageSize: 100 });
  const summaries = [...list.items];
  for (let page = 2; page <= list.pagination.totalPages; page += 1) summaries.push(...(await listTeachingQuestions({ ...query, page, pageSize: 100 })).items);
  if (summaries.length > MAX_QUESTIONS) throw new HttpError(422, `Export is limited to ${MAX_QUESTIONS} questions.`);
  const details = await Promise.all(summaries.map((item) => getTeachingQuestion(item.id)));
  const questions: Array<Record<string, unknown>> = []; const options: Array<Record<string, unknown>> = []; const sources: Array<Record<string, unknown>> = []; const references: Array<Record<string, unknown>> = []; const media: Array<Record<string, unknown>> = [];
  for (const item of details) {
    const revision = item.revisions[0]!;
    questions.push({ question_bank_code: item.questionBank.code, external_id: item.externalId, question_id: item.id, revision_id: revision.id, revision_number: revision.revisionNumber, revision_version: revision.version, status: revision.status, type: revision.type, specialty: revision.classification.specialty.code, domain: revision.classification.domain.code, topic: revision.classification.topic?.code ?? "", subtopic: revision.classification.subtopic?.code ?? "", modalities: revision.modalities.map((x) => x.code).join(";"), competencies: revision.competencies.map((x) => x.code).join(";"), training_level: revision.trainingLevel ?? "", difficulty: revision.difficulty, tags: revision.tags.map((x) => x.code).join(";"), stem: revision.stem, explanation_summary: revision.explanation.summary, teaching_point: revision.explanation.teachingPoint, further_discussion: revision.explanation.furtherDiscussion ?? "", evidence_status: revision.evidenceReview.status, evidence_checked_at: revision.evidenceReview.checkedAt ?? "", evidence_summary: revision.evidenceReview.summary, evidence_update: revision.evidenceReview.update ?? "", generation_method: revision.authorship.kind, generation_model: revision.authorship.modelName ?? "", case_external_id: revision.case?.externalId ?? "" });
    revision.options.forEach((option, index) => options.push({ external_id: item.externalId, option_order: index + 1, option_key: option.key, option_text: option.text, is_correct: option.isCorrect, explanation: option.explanation ?? "" }));
    revision.sources.forEach((source, index) => sources.push({ external_id: item.externalId, source_order: index + 1, source_type: source.sourceType, title: source.title ?? "", organization: source.organization ?? "", authors: source.authors.join(";"), edition: source.edition ?? "", year: source.year ?? "", chapter: source.chapter ?? "", page: source.page ?? "", exam_name: source.examName ?? "", exam_sitting: source.examSitting ?? "", exam_paper: source.examPaper ?? "", question_number: source.questionNumber ?? "", url: source.url ?? "", doi: source.doi ?? "", relationship_to_source: source.relationship, notes: source.notes ?? "" }));
    revision.references.forEach((reference, index) => references.push({ external_id: item.externalId, reference_order: index + 1, reference_type: reference.referenceType, title: reference.title, organization: reference.organization ?? "", authors: reference.authors.join(";"), year: reference.year ?? "", edition: reference.edition ?? "", url: reference.url ?? "", doi: reference.doi ?? "", citation_text: reference.citationText ?? "", notes: reference.notes ?? "" }));
    revision.assets.forEach((asset, index) => media.push({ external_id: item.externalId, media_order: index + 1, asset_id: asset.id, asset_key: asset.assetKey, original_filename: asset.originalFilename, alt_text: asset.altText }));
  }
  const catalog = await getTeachingCatalog();
  const taxonomy = [
    ...catalog.domains.map((x) => ({ type: "domain", specialty: x.parentCode ?? "", parent_code: x.parentCode ?? "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.topics.map((x) => ({ type: "topic", specialty: "", parent_code: x.parentCode ?? "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.subtopics.map((x) => ({ type: "subtopic", specialty: "", parent_code: x.parentCode ?? "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.modalities.map((x) => ({ type: "modality", specialty: "", parent_code: "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.competencies.map((x) => ({ type: "competency", specialty: "", parent_code: "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.trainingLevels.map((x) => ({ type: "training_level", specialty: "", parent_code: "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.difficulties.map((x) => ({ type: "difficulty", specialty: "", parent_code: "", code: x.code, label: x.label, description: x.description, active: x.active })),
    ...catalog.tags.map((x) => ({ type: "tag", specialty: "", parent_code: "", code: x.code, label: x.label, description: x.description, active: x.active })),
  ];
  return buildWorkbookBuffer([
    { name: "Questions", rows: questions, headers: [...QUESTION_HEADERS] }, { name: "Options", rows: options, headers: [...OPTION_HEADERS] }, { name: "Sources", rows: sources, headers: [...SOURCE_HEADERS] }, { name: "References", rows: references, headers: [...REFERENCE_HEADERS] }, { name: "Media", rows: media, headers: [...MEDIA_HEADERS] }, { name: "Taxonomy", rows: taxonomy, headers: [...TAXONOMY_HEADERS] }, { name: "Topic Proposals", rows: [], headers: [...PROPOSAL_HEADERS] }, { name: "Instructions", rows: [{ instructions: "Update-only: identity is question_bank_code + external_id. revision_version prevents overwrites. Published changes create a new Draft; Draft changes update in place. Semicolon-delimit lists. Media and Taxonomy are read-only. New Topics need taxonomy permission. Evidence statuses: confirmed, updated, uncertain, not_verified." }], headers: ["instructions"] },
  ]);
}

async function classifyMaintenance(bytes: Buffer): Promise<ParsedMaintenanceWorkbook> {
  const parsed = await parseWorkbook(bytes);
  if (parsed.errors.length) return parsed;
  const optionRows = new Map<string, Array<Record<string, string>>>();
  const sourceRows = new Map<string, Array<Record<string, string>>>();
  const referenceRows = new Map<string, Array<Record<string, string>>>();
  const mediaRows = new Map<string, Array<Record<string, string>>>();
  const { XLSX, workbook } = await readWorkbookFromBase64(bytes.toString("base64"));
  const readLinkedRows = (sheet: "Options" | "Sources" | "References" | "Media", headers: readonly string[], target: Map<string, Array<Record<string, string>>>) => {
    for (const { values } of parseWorksheet(XLSX, workbook.Sheets[sheet], sheet).rows) {
      const item = Object.fromEntries(headers.map((key) => [key, value(values, key)]));
      target.set(item.external_id, [...(target.get(item.external_id) ?? []), item]);
    }
  };
  readLinkedRows("Options", OPTION_HEADERS, optionRows); readLinkedRows("Sources", SOURCE_HEADERS, sourceRows); readLinkedRows("References", REFERENCE_HEADERS, referenceRows); readLinkedRows("Media", MEDIA_HEADERS, mediaRows);
  for (const row of parsed.rows) {
    if (row.errors.length) continue;
    const current = await pool.query<{ id: number; revision_id: number; version: number; status: string; retired_at: Date | null }>(
      `select question.id, revision.id as revision_id, revision.version, revision.status, question.retired_at
       from teaching.questions question join teaching.question_banks bank on bank.id = question.question_bank_id
       join lateral (select * from teaching.question_revisions where question_id = question.id order by revision_number desc, id desc limit 1) revision on true
       where question.external_id = $1 and bank.code = $2`, [row.externalId, row.questionBankCode]);
    if (!current.rowCount) { row.action = "missing_question"; continue; }
    const actual = current.rows[0]!;
    if (actual.retired_at) { row.action = "retired"; continue; }
    if (Number(actual.revision_id) !== row.revisionId || Number(actual.version) !== row.revisionVersion || Number(actual.id) !== row.questionId) { row.action = "stale_conflict"; continue; }
    if (actual.status === "in_review") { row.action = "conflict_in_review"; continue; }
    const detail = await getTeachingQuestion(actual.id); const revision = detail.revisions[0]!;
    const candidate = workbookInput(row, optionRows.get(row.externalId) ?? []);
    const workbookSources = sourceRows.get(row.externalId) ?? [];
    const workbookReferences = referenceRows.get(row.externalId) ?? [];
    const workbookMedia = mediaRows.get(row.externalId) ?? [];
    try { workbookSources.forEach(sourceInput); workbookReferences.forEach(referenceInput); }
    catch (error) { row.action = "invalid"; row.errors.push(issue("invalid_linked_content", error instanceof Error ? error.message : "Sources or references are invalid.", row.externalId)); continue; }
    const sourcesChanged = !sameLinkedRows(revision.sources.map(sourceWorkbookRow), workbookSources, SOURCE_HEADERS);
    const referencesChanged = !sameLinkedRows(revision.references.map(referenceWorkbookRow), workbookReferences, REFERENCE_HEADERS);
    if (!sameLinkedRows(revision.assets.map(mediaWorkbookRow), workbookMedia, MEDIA_HEADERS)) {
      row.action = "invalid"; row.errors.push(issue("media_read_only", "Media relationships are read-only in maintenance XLSX; upload, replacement, removal, reordering, and alt-text changes are not supported.", row.externalId)); continue;
    }
    const snapshot = { type: revision.type, stem: revision.stem, specialty: revision.classification.specialty.code, domain: revision.classification.domain.code, topic: revision.classification.topic?.code ?? null, subtopic: revision.classification.subtopic?.code ?? null, modalities: revision.modalities.map((item) => item.code), competencies: revision.competencies.map((item) => item.code), trainingLevel: revision.trainingLevel, difficulty: revision.difficulty, tags: revision.tags.map((item) => item.code), options: revision.options.map((option) => ({ key: option.key, text: option.text, isCorrect: option.isCorrect, explanation: option.explanation })), explanation: revision.explanation, authorship: revision.authorship, evidenceReview: revision.evidenceReview };
    const proposed = { type: candidate.type, stem: candidate.stem, specialty: candidate.specialtyCode, domain: candidate.domainCode, topic: candidate.topicCode, subtopic: candidate.subtopicCode, modalities: candidate.modalityCodes, competencies: candidate.competencyCodes, trainingLevel: candidate.trainingLevelCode, difficulty: candidate.difficulty, tags: candidate.tagCodes, options: candidate.options, explanation: candidate.explanation, authorship: candidate.authorship, evidenceReview: candidate.evidenceReview };
    row.changedFields = [...Object.keys(snapshot).filter((field) => JSON.stringify(snapshot[field as keyof typeof snapshot]) !== JSON.stringify(proposed[field as keyof typeof proposed])), ...(sourcesChanged ? ["sources"] : []), ...(referencesChanged ? ["references"] : [])];
    if (row.changedFields.length === 0) row.action = "unchanged";
    else if (actual.status === "draft") row.action = "update_draft";
    else if (actual.status === "published") row.action = "create_draft_revision";
    else row.action = "invalid";
    if (candidate.options.length < 2 || new Set(candidate.options.map((o) => o.key)).size !== candidate.options.length || candidate.options.filter((o) => o.isCorrect).length !== 1) { row.action = "invalid"; row.errors.push(issue("invalid_options", "Options must contain unique keys and exactly one correct answer.", row.externalId)); }
  }
  return parsed;
}

function summary(parsed: ParsedMaintenanceWorkbook) { const counts: Record<string, number> = { total: parsed.rows.length, unchanged: 0, updateDraft: 0, createDraftRevision: 0, invalid: 0, staleConflict: 0, inReviewConflict: 0, retired: 0, missingQuestion: 0 }; for (const row of parsed.rows) { const key: Record<Action, string> = { unchanged: "unchanged", update_draft: "updateDraft", create_draft_revision: "createDraftRevision", invalid: "invalid", stale_conflict: "staleConflict", conflict_in_review: "inReviewConflict", retired: "retired", missing_question: "missingQuestion" }; counts[key[row.action]] += 1; } return counts; }

export async function previewTeachingMaintenanceWorkbook(req: Request) {
  const bytes = await receiveWorkbook(req); const parsed = await classifyMaintenance(bytes);
  return { workbookHash: parsed.hash, summary: summary(parsed), topicProposals: parsed.topicProposals, errors: parsed.errors, warnings: parsed.warnings, rows: parsed.rows.filter((row) => row.action !== "unchanged" || row.errors.length).slice(0, 250).map((row) => ({ externalId: row.externalId, currentStatus: row.values.status, action: row.action, changedFields: row.changedFields, warnings: row.warnings, errors: row.errors })) };
}

export async function confirmTeachingMaintenanceWorkbook(req: Request, actor: TeachingAuditIdentity, canManageTaxonomy = false) {
  const previewHash = String(req.headers["x-teaching-maintenance-preview-hash"] ?? ""); const bytes = await receiveWorkbook(req); const parsed = await classifyMaintenance(bytes);
  if (!previewHash || previewHash !== parsed.hash) throw new HttpError(409, "Workbook does not match the preview hash.");
  if (parsed.errors.length) throw new HttpError(422, "Maintenance workbook has structural errors.", { errors: parsed.errors });
  const requiresTaxonomyPermission = parsed.topicProposals.some((proposal) => !proposal.alreadyExists);
  if (requiresTaxonomyPermission && !canManageTaxonomy) throw new HttpError(403, "New Topics require Teaching taxonomy management permission.");
  let proposedTopicsCreated = 0;
  if (requiresTaxonomyPermission) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      proposedTopicsCreated = await createProposedTopicsInTransaction(client, parsed.topicProposals);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined); throw error;
    } finally { client.release(); }
  }
  const { XLSX, workbook } = await readWorkbookFromBase64(bytes.toString("base64"));
  const optionRows = new Map<string, Array<Record<string, string>>>(); const sourceRows = new Map<string, Array<Record<string, string>>>(); const referenceRows = new Map<string, Array<Record<string, string>>>();
  const readLinkedRows = (sheet: "Options" | "Sources" | "References", headers: readonly string[], target: Map<string, Array<Record<string, string>>>) => {
    for (const { values } of parseWorksheet(XLSX, workbook.Sheets[sheet], sheet).rows) { const item = Object.fromEntries(headers.map((key) => [key, value(values, key)])); target.set(item.external_id, [...(target.get(item.external_id) ?? []), item]); }
  };
  readLinkedRows("Options", OPTION_HEADERS, optionRows); readLinkedRows("Sources", SOURCE_HEADERS, sourceRows); readLinkedRows("References", REFERENCE_HEADERS, referenceRows);
  const result = { updatedDraft: 0, newDraftRevision: 0, unchanged: 0, invalid: 0, conflicts: 0, proposedTopicsCreated, exceptions: [] as Array<{ externalId: string; action: Action; message?: string }> };
  for (const row of parsed.rows) {
    if (row.action === "unchanged") { result.unchanged += 1; continue; }
    if (row.action !== "update_draft" && row.action !== "create_draft_revision") { if (row.action === "invalid") result.invalid += 1; else result.conflicts += 1; result.exceptions.push({ externalId: row.externalId, action: row.action }); continue; }
    try {
      if (row.action === "create_draft_revision") await createTeachingQuestionRevision(row.questionId, actor);
      const current = await getTeachingQuestion(row.questionId); const draft = current.revisions[0]!;
      const { externalId: _externalId, questionBankCode: _questionBankCode, ...update } = workbookInput(row, optionRows.get(row.externalId) ?? []);
      const sources = row.changedFields.includes("sources")
        ? await Promise.all((sourceRows.get(row.externalId) ?? []).map(async (source) => {
          const created = await createTeachingSource(sourceInput(source), actor);
          return { sourceId: created.id, relationship: source.relationship_to_source, notes: source.notes || null };
        }))
        : draft.sources.map((source) => ({ sourceId: source.id, relationship: source.relationship, notes: source.notes }));
      const references = row.changedFields.includes("references")
        ? await Promise.all((referenceRows.get(row.externalId) ?? []).map(async (reference) => {
          const created = await createTeachingReference(referenceInput(reference), actor);
          return { referenceId: created.id, notes: reference.notes || null };
        }))
        : draft.references.map((reference) => ({ referenceId: reference.id, notes: reference.notes }));
      await patchTeachingQuestionDraft(row.questionId, draft.id, {
        ...update,
        caseId: draft.case?.id ?? null,
        sources,
        references,
        assetIds: draft.assets.map((asset) => asset.id),
        assetAltTexts: draft.assets.map((asset) => ({ assetId: asset.id, altText: asset.altText })),
        expectedVersion: draft.version,
      }, actor);
      if (row.action === "update_draft") result.updatedDraft += 1; else result.newDraftRevision += 1;
    } catch (error) { result.conflicts += 1; result.exceptions.push({ externalId: row.externalId, action: "stale_conflict", message: error instanceof Error ? error.message : "Update failed." }); }
  }
  return result;
}
