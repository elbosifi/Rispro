import { asUnknownRecord } from "../../../utils/records.js";

export const TEACHING_IMPORT_SCHEMA_VERSION = "1.0" as const;

export interface TeachingImportIssue {
  code: string;
  message: string;
  path?: string;
  externalId?: string;
  filename?: string;
}

export interface TeachingImportOption {
  id: string;
  text: string;
}

export interface TeachingImportMedia {
  assetKey: string;
  filename: string;
  type: "image";
  altText: string;
}

export interface TeachingImportSource {
  type: string;
  title: string | null;
  organization: string | null;
  authors: string[];
  edition: string | null;
  year: number | null;
  chapter: string | null;
  page: string | null;
  questionNumber: string | null;
  examName: string | null;
  examSitting: string | null;
  examPaper: string | null;
  url: string | null;
  doi: string | null;
  notes: string | null;
}

export interface TeachingImportReference {
  type: string;
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

export interface TeachingImportQuestion {
  externalId: string;
  classification: {
    specialty: string;
    domain: string;
    topic: string | null;
    subtopics: string[];
    modalities: string[];
    competencies: string[];
    trainingLevel: string | null;
    difficulty: number | null;
    tags: string[];
  };
  type: string;
  stem: string;
  options: TeachingImportOption[];
  answerKey: string[];
  explanation: {
    summary: string;
    teachingPoint: string;
    furtherDiscussion: string | null;
    optionExplanations: Record<string, string>;
  };
  source: TeachingImportSource | null;
  relationshipToSource: string | null;
  references: TeachingImportReference[];
  generation: { method: string; model: string | null };
  media: TeachingImportMedia[];
  caseId: string | null;
  case: { title: string | null; clinicalHistory: string | null } | null;
}

export interface ParsedTeachingImport {
  schemaVersion: string | null;
  questions: TeachingImportQuestion[];
  errors: TeachingImportIssue[];
  rawDocument: Record<string, unknown> | null;
}

const SERVER_OWNED_FIELDS = new Set([
  "id", "questionId", "revisionId", "createdBy", "createdAt", "reviewedBy", "reviewedAt",
  "publishedBy", "publishedAt", "retiredBy", "internalId", "databaseId", "identitySubject",
  "identityIssuer", "created_by_identity_subject", "created_by_identity_issuer",
]);

function record(value: unknown, path: string, errors: TeachingImportIssue[]): Record<string, unknown> {
  const result = asUnknownRecord(value);
  if (!result) {
    errors.push({ code: "invalid_type", message: "Expected an object.", path });
    return {};
  }
  return result;
}

function knownFields(row: Record<string, unknown>, allowed: readonly string[], path: string, errors: TeachingImportIssue[], allowedServerOwnedNames: readonly string[] = []): void {
  for (const field of Object.keys(row)) {
    if (SERVER_OWNED_FIELDS.has(field) && !allowedServerOwnedNames.includes(field)) {
      errors.push({ code: "server_owned_field", message: `Field "${field}" is server-owned and cannot be imported.`, path: `${path}.${field}` });
    } else if (!allowed.includes(field)) {
      errors.push({ code: "unknown_field", message: `Unknown field "${field}".`, path: `${path}.${field}` });
    }
  }
}

function stringValue(
  value: unknown,
  path: string,
  errors: TeachingImportIssue[],
  options: { required?: boolean; nullable?: boolean; max?: number; trim?: boolean } = {},
): string | null {
  if (value === undefined || value === null) {
    if (value === null && options.nullable) return null;
    if (options.required) errors.push({ code: "required", message: "A non-empty string is required.", path });
    return null;
  }
  if (typeof value !== "string") {
    errors.push({ code: "invalid_type", message: "Expected a string.", path });
    return null;
  }
  const result = options.trim === false ? value : value.trim();
  if (options.required && result.length === 0) errors.push({ code: "required", message: "A non-empty string is required.", path });
  if (options.max !== undefined && result.length > options.max) errors.push({ code: "too_long", message: `Must be at most ${options.max} characters.`, path });
  return result || (options.required ? "" : null);
}

function stringArray(value: unknown, path: string, errors: TeachingImportIssue[], maxItems = 50): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    errors.push({ code: "invalid_array", message: `Expected an array with at most ${maxItems} items.`, path });
    return [];
  }
  return value.map((item, index) => stringValue(item, `${path}[${index}]`, errors, { required: true, max: 200 }) ?? "");
}

function nullableInteger(value: unknown, path: string, errors: TeachingImportIssue[]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push({ code: "invalid_number", message: "Expected an integer or null.", path });
    return null;
  }
  return value;
}

function nullableQuestionNumber(value: unknown, path: string, errors: TeachingImportIssue[]): string | null {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    errors.push({ code: "invalid_number", message: "Question number must be a non-negative integer or text.", path });
    return null;
  }
  return stringValue(value, path, errors, { nullable: true, max: 100 });
}

function nullableUrl(value: unknown, path: string, errors: TeachingImportIssue[]): string | null {
  const url = stringValue(value, path, errors, { nullable: true, max: 2048 });
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
    return url;
  } catch {
    errors.push({ code: "invalid_url", message: "URL must be a valid HTTP or HTTPS URL.", path });
    return url;
  }
}

function parseSource(value: unknown, path: string, errors: TeachingImportIssue[]): TeachingImportSource | null {
  if (value === undefined || value === null) return null;
  const row = record(value, path, errors);
  knownFields(row, ["type", "title", "organization", "authors", "edition", "year", "chapter", "page", "questionNumber", "exam", "url", "doi", "notes"], path, errors);
  const exam = row.exam === undefined || row.exam === null ? {} : record(row.exam, `${path}.exam`, errors);
  if (row.exam !== undefined && row.exam !== null) knownFields(exam, ["name", "organization", "year", "sitting", "paper", "questionNumber"], `${path}.exam`, errors);
  const type = stringValue(row.type, `${path}.type`, errors, { required: true, max: 80 }) ?? "";
  const year = nullableInteger(row.year ?? exam.year, `${path}.year`, errors);
  return {
    type,
    title: stringValue(row.title, `${path}.title`, errors, { nullable: true, max: 1000 }),
    organization: stringValue(row.organization ?? exam.organization, `${path}.organization`, errors, { nullable: true, max: 1000 }),
    authors: stringArray(row.authors, `${path}.authors`, errors),
    edition: stringValue(row.edition, `${path}.edition`, errors, { nullable: true, max: 200 }),
    year,
    chapter: stringValue(row.chapter, `${path}.chapter`, errors, { nullable: true, max: 500 }),
    page: stringValue(row.page, `${path}.page`, errors, { nullable: true, max: 200 }),
    questionNumber: nullableQuestionNumber(row.questionNumber ?? exam.questionNumber, `${path}.questionNumber`, errors),
    examName: stringValue(exam.name, `${path}.exam.name`, errors, { nullable: true, max: 500 }),
    examSitting: stringValue(exam.sitting, `${path}.exam.sitting`, errors, { nullable: true, max: 200 }),
    examPaper: stringValue(exam.paper, `${path}.exam.paper`, errors, { nullable: true, max: 200 }),
    url: nullableUrl(row.url, `${path}.url`, errors),
    doi: stringValue(row.doi, `${path}.doi`, errors, { nullable: true, max: 500 }),
    notes: stringValue(row.notes, `${path}.notes`, errors, { nullable: true, max: 5000 }),
  };
}

function parseReferences(value: unknown, path: string, errors: TeachingImportIssue[]): TeachingImportReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    errors.push({ code: "invalid_array", message: "Expected an array with at most 100 references.", path });
    return [];
  }
  return value.map((entry, index) => {
    const itemPath = `${path}[${index}]`;
    const row = record(entry, itemPath, errors);
    knownFields(row, ["type", "title", "organization", "authors", "year", "edition", "url", "doi", "citationText", "notes"], itemPath, errors);
    return {
      type: stringValue(row.type, `${itemPath}.type`, errors, { required: true, max: 80 }) ?? "",
      title: stringValue(row.title, `${itemPath}.title`, errors, { required: true, max: 1000 }) ?? "",
      organization: stringValue(row.organization, `${itemPath}.organization`, errors, { nullable: true, max: 1000 }),
      authors: stringArray(row.authors, `${itemPath}.authors`, errors),
      year: nullableInteger(row.year, `${itemPath}.year`, errors),
      edition: stringValue(row.edition, `${itemPath}.edition`, errors, { nullable: true, max: 200 }),
      url: nullableUrl(row.url, `${itemPath}.url`, errors),
      doi: stringValue(row.doi, `${itemPath}.doi`, errors, { nullable: true, max: 500 }),
      citationText: stringValue(row.citationText, `${itemPath}.citationText`, errors, { nullable: true, max: 5000 }),
      notes: stringValue(row.notes, `${itemPath}.notes`, errors, { nullable: true, max: 5000 }),
    };
  });
}

function parseQuestion(value: unknown, index: number, errors: TeachingImportIssue[]): TeachingImportQuestion {
  const path = `questions[${index}]`;
  const row = record(value, path, errors);
  const externalId = stringValue(row.externalId, `${path}.externalId`, errors, { required: true, max: 100 }) ?? "";
  const start = errors.length;
  knownFields(row, ["externalId", "classification", "type", "stem", "options", "answerKey", "explanation", "source", "provenance", "references", "generation", "media", "caseId", "case", "status"], path, errors);
  const classification = record(row.classification, `${path}.classification`, errors);
  knownFields(classification, ["specialty", "domain", "topic", "subtopics", "modalities", "competencies", "trainingLevel", "difficulty", "tags"], `${path}.classification`, errors);
  const explanation = record(row.explanation, `${path}.explanation`, errors);
  knownFields(explanation, ["summary", "teachingPoint", "furtherDiscussion", "optionExplanations"], `${path}.explanation`, errors);
  const provenance = row.provenance === undefined || row.provenance === null ? {} : record(row.provenance, `${path}.provenance`, errors);
  if (row.provenance !== undefined && row.provenance !== null) knownFields(provenance, ["relationshipToSource"], `${path}.provenance`, errors);
  const generation = row.generation === undefined || row.generation === null ? {} : record(row.generation, `${path}.generation`, errors);
  if (row.generation !== undefined && row.generation !== null) knownFields(generation, ["method", "model"], `${path}.generation`, errors);

  const optionsValue = row.options;
  const options: TeachingImportOption[] = [];
  if (!Array.isArray(optionsValue) || optionsValue.length < 2 || optionsValue.length > 8) {
    errors.push({ code: "invalid_options", message: "A V1 SBA must have between 2 and 8 options.", path: `${path}.options` });
  } else {
    optionsValue.forEach((entry, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      const option = record(entry, optionPath, errors);
      knownFields(option, ["id", "text"], optionPath, errors, ["id"]);
      options.push({
        id: stringValue(option.id, `${optionPath}.id`, errors, { required: true, max: 16 }) ?? "",
        text: stringValue(option.text, `${optionPath}.text`, errors, { required: true, max: 10000 }) ?? "",
      });
      const optionId = options.at(-1)?.id ?? "";
      if (!/^[A-Z]$/.test(optionId)) errors.push({ code: "invalid_option_id", message: "Option IDs must be a single uppercase letter from A to Z.", path: `${optionPath}.id` });
    });
  }
  const answerKey = stringArray(row.answerKey, `${path}.answerKey`, errors, 8);
  if (answerKey.length !== 1) errors.push({ code: "invalid_answer_count", message: "V1 single-best-answer questions require exactly one answerKey value.", path: `${path}.answerKey` });
  if (new Set(options.map((option) => option.id)).size !== options.length) errors.push({ code: "duplicate_option_id", message: "Option IDs must be unique within a question.", path: `${path}.options` });
  for (const key of answerKey) if (!options.some((option) => option.id === key)) errors.push({ code: "answer_option_missing", message: `Answer key "${key}" does not match an option ID.`, path: `${path}.answerKey` });

  const optionExplanationsValue = explanation.optionExplanations;
  const optionExplanations: Record<string, string> = {};
  if (optionExplanationsValue !== undefined && optionExplanationsValue !== null) {
    const optionExplanationsRow = record(optionExplanationsValue, `${path}.explanation.optionExplanations`, errors);
    for (const [key, text] of Object.entries(optionExplanationsRow)) {
      const parsed = stringValue(text, `${path}.explanation.optionExplanations.${key}`, errors, { required: true, max: 5000 });
      if (parsed !== null) optionExplanations[key] = parsed;
      if (!options.some((option) => option.id === key)) errors.push({ code: "option_explanation_option_missing", message: `Option explanation references unknown option "${key}".`, path: `${path}.explanation.optionExplanations.${key}` });
    }
  }

  const mediaValue = row.media === undefined ? [] : row.media;
  const media: TeachingImportMedia[] = [];
  if (!Array.isArray(mediaValue) || mediaValue.length > 25) {
    errors.push({ code: "invalid_media", message: "Expected an array with at most 25 image references.", path: `${path}.media` });
  } else {
    mediaValue.forEach((entry, mediaIndex) => {
      const mediaPath = `${path}.media[${mediaIndex}]`;
      const item = record(entry, mediaPath, errors);
      knownFields(item, ["assetKey", "filename", "type", "altText"], mediaPath, errors);
      const filename = stringValue(item.filename, `${mediaPath}.filename`, errors, { required: true, max: 200 }) ?? "";
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(filename) || filename.includes("..")) {
        errors.push({ code: "unsafe_asset_filename", message: "Asset filename must be a safe image basename under assets/.", path: `${mediaPath}.filename`, filename });
      }
      const type = stringValue(item.type, `${mediaPath}.type`, errors, { required: true, max: 20 });
      if (type !== "image") errors.push({ code: "unsupported_media_type", message: "Only image media is supported in V1.", path: `${mediaPath}.type` });
      media.push({
        assetKey: stringValue(item.assetKey, `${mediaPath}.assetKey`, errors, { required: true, max: 160 }) ?? "",
        filename,
        type: "image",
        altText: stringValue(item.altText, `${mediaPath}.altText`, errors, { required: true, max: 1000 }) ?? "",
      });
    });
  }

  const caseValue = row.case === undefined || row.case === null ? null : row.case;
  let caseMetadata: TeachingImportQuestion["case"] = null;
  if (caseValue !== null) {
    const caseRow = record(caseValue, `${path}.case`, errors);
    knownFields(caseRow, ["title", "clinicalHistory"], `${path}.case`, errors);
    caseMetadata = {
      title: stringValue(caseRow.title, `${path}.case.title`, errors, { nullable: true, max: 1000 }),
      clinicalHistory: stringValue(caseRow.clinicalHistory, `${path}.case.clinicalHistory`, errors, { nullable: true, max: 20000 }),
    };
  }
  const caseId = stringValue(row.caseId, `${path}.caseId`, errors, { nullable: true, max: 100 });
  if (caseMetadata && caseId === null) errors.push({ code: "case_id_required", message: "caseId is required when case metadata is supplied.", path: `${path}.caseId` });
  if (caseId !== null && !/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(caseId)) errors.push({ code: "invalid_case_id", message: "Case ID must use uppercase letters, digits, and hyphens.", path: `${path}.caseId` });
  if (row.status !== undefined && row.status !== "draft") errors.push({ code: "import_status_must_be_draft", message: "Imported questions must have Draft status.", path: `${path}.status` });

  const question: TeachingImportQuestion = {
    externalId,
    classification: {
      specialty: stringValue(classification.specialty, `${path}.classification.specialty`, errors, { required: true, max: 100 }) ?? "",
      domain: stringValue(classification.domain, `${path}.classification.domain`, errors, { required: true, max: 100 }) ?? "",
      topic: stringValue(classification.topic, `${path}.classification.topic`, errors, { nullable: true, max: 100 }),
      subtopics: stringArray(classification.subtopics, `${path}.classification.subtopics`, errors, 1),
      modalities: stringArray(classification.modalities, `${path}.classification.modalities`, errors),
      competencies: stringArray(classification.competencies, `${path}.classification.competencies`, errors),
      trainingLevel: stringValue(classification.trainingLevel, `${path}.classification.trainingLevel`, errors, { nullable: true, max: 100 }),
      difficulty: nullableInteger(classification.difficulty, `${path}.classification.difficulty`, errors),
      tags: stringArray(classification.tags, `${path}.classification.tags`, errors),
    },
    type: stringValue(row.type, `${path}.type`, errors, { required: true, max: 80 }) ?? "",
    stem: stringValue(row.stem, `${path}.stem`, errors, { required: true, max: 50000 }) ?? "",
    options,
    answerKey,
    explanation: {
      summary: stringValue(explanation.summary, `${path}.explanation.summary`, errors, { required: true, max: 20000 }) ?? "",
      teachingPoint: stringValue(explanation.teachingPoint, `${path}.explanation.teachingPoint`, errors, { required: true, max: 20000 }) ?? "",
      furtherDiscussion: stringValue(explanation.furtherDiscussion, `${path}.explanation.furtherDiscussion`, errors, { nullable: true, max: 50000 }),
      optionExplanations,
    },
    source: parseSource(row.source, `${path}.source`, errors),
    relationshipToSource: stringValue(provenance.relationshipToSource, `${path}.provenance.relationshipToSource`, errors, { nullable: true, max: 80 }),
    references: parseReferences(row.references, `${path}.references`, errors),
    generation: {
      method: stringValue(generation.method, `${path}.generation.method`, errors, { required: true, max: 80 }) ?? "unknown",
      model: stringValue(generation.model, `${path}.generation.model`, errors, { nullable: true, max: 200 }),
    },
    media,
    caseId,
    case: caseMetadata,
  };
  for (const item of errors.slice(start)) {
    if (!item.externalId) item.externalId = externalId;
  }
  return question;
}

type VersionParser = (root: Record<string, unknown>, errors: TeachingImportIssue[]) => TeachingImportQuestion[];

function parseVersionOne(root: Record<string, unknown>, errors: TeachingImportIssue[]): TeachingImportQuestion[] {
  if (!Array.isArray(root.questions) || root.questions.length === 0 || root.questions.length > 1000) {
    errors.push({ code: "invalid_questions", message: "questions must contain between 1 and 1000 question objects.", path: "questions" });
    return [];
  }
  const questions = root.questions.map((question, index) => parseQuestion(question, index, errors));
  const seen = new Set<string>();
  for (const question of questions) {
    if (!question.externalId) continue;
    if (seen.has(question.externalId)) errors.push({ code: "duplicate_external_id", message: `Duplicate externalId "${question.externalId}" in this file.`, externalId: question.externalId, path: "questions" });
    seen.add(question.externalId);
  }
  const assetKeys = new Set<string>();
  for (const question of questions) for (const media of question.media) {
    if (assetKeys.has(media.assetKey)) errors.push({ code: "duplicate_asset_key", message: `Duplicate assetKey "${media.assetKey}" in this file.`, externalId: question.externalId, path: "media" });
    assetKeys.add(media.assetKey);
  }
  return questions;
}

const VERSION_PARSERS = new Map<string, VersionParser>([[TEACHING_IMPORT_SCHEMA_VERSION, parseVersionOne]]);

export function parseTeachingImportJson(bytes: Buffer): ParsedTeachingImport {
  const errors: TeachingImportIssue[] = [];
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { schemaVersion: null, questions: [], errors: [{ code: "invalid_encoding", message: "File must be valid UTF-8 JSON." }], rawDocument: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { schemaVersion: null, questions: [], errors: [{ code: "invalid_json", message: "File does not contain valid JSON." }], rawDocument: null };
  }
  const root = record(parsed, "$", errors);
  knownFields(root, ["schemaVersion", "_instructions", "_aiInstructions", "_catalog", "_schemaExamples", "questions"], "$", errors);
  const schemaVersion = stringValue(root.schemaVersion, "schemaVersion", errors, { required: true, max: 40 });
  const versionParser = schemaVersion === null ? undefined : VERSION_PARSERS.get(schemaVersion);
  if (!versionParser) {
    const supported = [...VERSION_PARSERS.keys()].map((version) => `"${version}"`).join(", ");
    errors.push({ code: "unsupported_schema_version", message: `Schema version "${schemaVersion ?? "(missing)"}" is not supported. Supported versions: ${supported}.`, path: "schemaVersion" });
    return { schemaVersion, questions: [], errors, rawDocument: root };
  }
  const questions = versionParser(root, errors);
  return { schemaVersion, questions, errors, rawDocument: root };
}
