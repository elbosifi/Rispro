import { HttpError } from "../../../utils/http-error.js";
import { asUnknownRecord } from "../../../utils/records.js";
import {
  TEACHING_AUTHORSHIP_KINDS,
  TEACHING_PROVENANCE_RELATIONSHIPS,
  TEACHING_QUESTION_TYPES,
  TEACHING_SOURCE_TYPES,
  type TeachingCaseInput,
  type TeachingOptionInput,
  type TeachingQuestionInput,
  type TeachingQuestionReferenceInput,
  type TeachingQuestionSourceInput,
  type TeachingReferenceInput,
  type TeachingSourceInput,
} from "./teaching-content.js";

function fail(message: string): never {
  throw new HttpError(400, message);
}

function text(value: unknown, name: string, options: { required?: boolean; max?: number } = {}): string | null {
  if (value == null && !options.required) return null;
  if (typeof value !== "string") return fail(`${name} must be text.`);
  const result = value.trim();
  if (options.required && !result) return fail(`${name} is required.`);
  if (options.max && result.length > options.max) return fail(`${name} is too long.`);
  return result;
}

function code(value: unknown, name: string, required = true): string | null {
  const result = text(value, name, { required, max: 100 });
  if (result !== null && !/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$/.test(result)) {
    return fail(`${name} has an invalid format.`);
  }
  return result;
}

function positiveId(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fail(`${name} must be a positive integer.`);
  return parsed;
}

function optionalId(value: unknown, name: string): number | null {
  return value == null || value === "" ? null : positiveId(value, name);
}

function stringArray(value: unknown, name: string, maxItems = 50): string[] {
  if (!Array.isArray(value)) return fail(`${name} must be an array.`);
  if (value.length > maxItems) return fail(`${name} has too many values.`);
  const values = value.map((item, index) => text(item, `${name}[${index}]`, { required: true, max: 100 })!);
  if (new Set(values).size !== values.length) return fail(`${name} must not contain duplicates.`);
  return values;
}

function idArray(value: unknown, name: string, maxItems = 50): number[] {
  if (!Array.isArray(value)) return fail(`${name} must be an array.`);
  if (value.length > maxItems) return fail(`${name} has too many values.`);
  const values = value.map((item, index) => positiveId(item, `${name}[${index}]`));
  if (new Set(values).size !== values.length) return fail(`${name} must not contain duplicates.`);
  return values;
}

function optionList(value: unknown): TeachingOptionInput[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 26) {
    return fail("options must contain between 2 and 26 answers.");
  }
  const options = value.map((item, index) => {
    const row = asUnknownRecord(item);
    if (!row) return fail(`options[${index}] must be an object.`);
    const key = text(row.key, `options[${index}].key`, { required: true, max: 1 })!;
    if (!/^[A-Z]$/.test(key)) return fail(`options[${index}].key must be one uppercase letter.`);
    if (typeof row.isCorrect !== "boolean") return fail(`options[${index}].isCorrect must be boolean.`);
    return {
      key,
      text: text(row.text, `options[${index}].text`, { required: true, max: 10000 })!,
      isCorrect: row.isCorrect,
      explanation: text(row.explanation, `options[${index}].explanation`, { max: 5000 }),
    };
  });
  if (new Set(options.map((item) => item.key)).size !== options.length) return fail("Option keys must be unique.");
  if (options.filter((item) => item.isCorrect).length !== 1) return fail("Exactly one option must be correct.");
  return options;
}

function questionSources(value: unknown): TeachingQuestionSourceInput[] {
  if (!Array.isArray(value) || value.length > 100) return fail("sources must be an array.");
  const sources = value.map((item, index) => {
    const row = asUnknownRecord(item);
    if (!row) return fail(`sources[${index}] must be an object.`);
    const relationship = row.relationship;
    if (typeof relationship !== "string" || !TEACHING_PROVENANCE_RELATIONSHIPS.includes(relationship as never)) {
      return fail(`sources[${index}].relationship is invalid.`);
    }
    return {
      sourceId: positiveId(row.sourceId, `sources[${index}].sourceId`),
      relationship: relationship as TeachingQuestionSourceInput["relationship"],
      notes: text(row.notes, `sources[${index}].notes`, { max: 2000 }),
    };
  });
  if (new Set(sources.map((item) => item.sourceId)).size !== sources.length) return fail("A source may only be linked once per revision.");
  return sources;
}

function questionReferences(value: unknown): TeachingQuestionReferenceInput[] {
  if (!Array.isArray(value) || value.length > 100) return fail("references must be an array.");
  const references = value.map((item, index) => {
    const row = asUnknownRecord(item);
    if (!row) return fail(`references[${index}] must be an object.`);
    return {
      referenceId: positiveId(row.referenceId, `references[${index}].referenceId`),
      notes: text(row.notes, `references[${index}].notes`, { max: 2000 }),
    };
  });
  if (new Set(references.map((item) => item.referenceId)).size !== references.length) return fail("A reference may only be linked once per revision.");
  return references;
}

function nullableUrl(value: unknown, name: string): string | null {
  const url = text(value, name, { max: 2000 });
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail(`${name} must use HTTP or HTTPS.`);
  } catch {
    return fail(`${name} must be a valid URL.`);
  }
  return url;
}

function year(value: unknown, name: string): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 9999) return fail(`${name} must be a four-digit year.`);
  return parsed;
}

export function parseTeachingQuestionInput(value: unknown): TeachingQuestionInput {
  const row = asUnknownRecord(value);
  if (!row) return fail("Question content must be an object.");
  if (typeof row.type !== "string" || !TEACHING_QUESTION_TYPES.includes(row.type as never)) return fail("question type is invalid.");
  const explanation = asUnknownRecord(row.explanation);
  const authorship = asUnknownRecord(row.authorship);
  if (!explanation || !authorship) return fail("explanation and authorship must be objects.");
  const difficulty = Number(row.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return fail("difficulty must be between 1 and 5.");
  if (typeof authorship.kind !== "string" || !TEACHING_AUTHORSHIP_KINDS.includes(authorship.kind as never)) return fail("authorship.kind is invalid.");
  const externalId = text(row.externalId, "externalId", { required: true, max: 100 })!;
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(externalId)) return fail("externalId has an invalid format.");
  const questionType = row.type as TeachingQuestionInput["type"];
  const caseId = optionalId(row.caseId, "caseId");
  if (questionType === "case_based_sba" && caseId === null) return fail("caseId is required for case-based questions.");
  const assetIds = idArray(row.assetIds ?? [], "assetIds");
  const rawAssetAltTexts = row.assetAltTexts ?? [];
  if (!Array.isArray(rawAssetAltTexts) || rawAssetAltTexts.length > 250) return fail("assetAltTexts must be an array.");
  const assetAltTexts = rawAssetAltTexts.map((item, index) => {
    const asset = asUnknownRecord(item);
    if (!asset) return fail(`assetAltTexts[${index}] must be an object.`);
    return {
      assetId: positiveId(asset.assetId, `assetAltTexts[${index}].assetId`),
      altText: text(asset.altText, `assetAltTexts[${index}].altText`, { max: 2000 }) ?? "",
    };
  });
  if (new Set(assetAltTexts.map((item) => item.assetId)).size !== assetAltTexts.length) return fail("An asset alt text may only be supplied once.");
  if (assetAltTexts.some((item) => !assetIds.includes(item.assetId))) return fail("Asset alt text can only be updated for assets attached to this revision.");
  return {
    externalId,
    questionBankCode: code(row.questionBankCode ?? "radiology-main", "questionBankCode")!,
    type: questionType,
    stem: text(row.stem, "stem", { required: true, max: 50000 })!,
    specialtyCode: code(row.specialtyCode, "specialtyCode")!,
    domainCode: code(row.domainCode, "domainCode")!,
    topicCode: code(row.topicCode, "topicCode", false),
    subtopicCode: code(row.subtopicCode, "subtopicCode", false),
    difficulty,
    trainingLevelCode: code(row.trainingLevelCode, "trainingLevelCode", false),
    caseId,
    explanationSummary: text(explanation.summary ?? "", "explanation.summary", { max: 20000 })!,
    teachingPoint: text(explanation.teachingPoint ?? "", "explanation.teachingPoint", { max: 20000 })!,
    furtherDiscussion: text(explanation.furtherDiscussion, "explanation.furtherDiscussion", { max: 50000 }),
    options: optionList(row.options),
    modalityCodes: stringArray(row.modalityCodes ?? [], "modalityCodes"),
    competencyCodes: stringArray(row.competencyCodes ?? [], "competencyCodes"),
    tagCodes: stringArray(row.tagCodes ?? [], "tagCodes"),
    sources: questionSources(row.sources ?? []),
    references: questionReferences(row.references ?? []),
    assetIds,
    assetAltTexts,
    authorshipKind: authorship.kind as TeachingQuestionInput["authorshipKind"],
    modelName: text(authorship.modelName, "authorship.modelName", { max: 200 }),
  };
}

export function parseTeachingSourceInput(value: unknown): TeachingSourceInput {
  const row = asUnknownRecord(value);
  if (!row) return fail("Source must be an object.");
  if (typeof row.sourceType !== "string" || !TEACHING_SOURCE_TYPES.includes(row.sourceType as never)) return fail("sourceType is invalid.");
  const sourceType = row.sourceType as TeachingSourceInput["sourceType"];
  const metadata = row.metadata == null ? {} : asUnknownRecord(row.metadata);
  if (!metadata) return fail("metadata must be an object.");
  const authors = row.authors == null ? [] : stringArray(row.authors, "authors", 50);
  return {
    sourceType,
    title: text(row.title, "title", { required: sourceType !== "original" && sourceType !== "unknown", max: 1000 }),
    organization: text(row.organization, "organization", { max: 1000 }),
    authors,
    edition: text(row.edition, "edition", { max: 200 }),
    year: year(row.year, "year"),
    chapter: text(row.chapter, "chapter", { max: 500 }),
    page: text(row.page, "page", { max: 200 }),
    examName: text(row.examName, "examName", { max: 500 }),
    examSitting: text(row.examSitting, "examSitting", { max: 200 }),
    examPaper: text(row.examPaper, "examPaper", { max: 200 }),
    questionNumber: text(row.questionNumber, "questionNumber", { max: 100 }),
    url: nullableUrl(row.url, "url"),
    doi: text(row.doi, "doi", { max: 500 }),
    notes: text(row.notes, "notes", { max: 5000 }),
    metadata,
  };
}

export function parseTeachingReferenceInput(value: unknown): TeachingReferenceInput {
  const row = asUnknownRecord(value);
  if (!row) return fail("Reference must be an object.");
  const allowed = ["textbook", "journal_article", "guideline", "society_document", "website", "other", "unknown"];
  if (typeof row.referenceType !== "string" || !allowed.includes(row.referenceType)) return fail("referenceType is invalid.");
  return {
    referenceType: row.referenceType as TeachingReferenceInput["referenceType"],
    title: text(row.title, "title", { required: true, max: 1000 })!,
    organization: text(row.organization, "organization", { max: 1000 }),
    authors: row.authors == null ? [] : stringArray(row.authors, "authors", 50),
    year: year(row.year, "year"),
    edition: text(row.edition, "edition", { max: 200 }),
    url: nullableUrl(row.url, "url"),
    doi: text(row.doi, "doi", { max: 500 }),
    citationText: text(row.citationText, "citationText", { max: 5000 }),
    notes: text(row.notes, "notes", { max: 5000 }),
  };
}

export function parseTeachingCaseInput(value: unknown): TeachingCaseInput {
  const row = asUnknownRecord(value);
  if (!row) return fail("Case must be an object.");
  const externalId = text(row.externalId, "externalId", { required: true, max: 100 })!;
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(externalId)) return fail("externalId has an invalid format.");
  return {
    externalId,
    specialtyCode: code(row.specialtyCode, "specialtyCode")!,
    title: text(row.title, "title", { max: 1000 }),
    clinicalHistory: text(row.clinicalHistory, "clinicalHistory", { max: 20000 }),
    assetIds: idArray(row.assetIds ?? [], "assetIds"),
  };
}
