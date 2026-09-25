export const TEACHING_QUESTION_TYPES = [
  "single_best_answer",
  "image_based_sba",
  "case_based_sba",
] as const;
export type TeachingQuestionType = (typeof TEACHING_QUESTION_TYPES)[number];

export const TEACHING_QUESTION_STATUSES = ["draft", "in_review", "published", "retired"] as const;
export type TeachingQuestionStatus = (typeof TEACHING_QUESTION_STATUSES)[number];

export const TEACHING_SOURCE_TYPES = [
  "original", "textbook", "journal_article", "guideline", "society_document", "exam",
  "question_bank", "lecture", "conference", "website", "local_teaching", "other", "unknown",
] as const;
export type TeachingSourceType = (typeof TEACHING_SOURCE_TYPES)[number];

export const TEACHING_PROVENANCE_RELATIONSHIPS = [
  "original", "adapted", "paraphrased", "verbatim", "inspired_by", "unknown",
] as const;
export type TeachingProvenanceRelationship = (typeof TEACHING_PROVENANCE_RELATIONSHIPS)[number];

export const TEACHING_AUTHORSHIP_KINDS = [
  "human_authored", "ai_assisted", "ai_generated", "imported", "unknown",
] as const;
export type TeachingAuthorshipKind = (typeof TEACHING_AUTHORSHIP_KINDS)[number];

export interface TeachingOptionInput {
  key: string;
  text: string;
  isCorrect: boolean;
  explanation?: string | null;
}

export interface TeachingQuestionSourceInput {
  sourceId: number;
  relationship: TeachingProvenanceRelationship;
  notes?: string | null;
}

export interface TeachingQuestionReferenceInput {
  referenceId: number;
  notes?: string | null;
}

export interface TeachingQuestionInput {
  externalId: string;
  questionBankCode: string;
  type: TeachingQuestionType;
  stem: string;
  specialtyCode: string;
  domainCode: string;
  topicCode: string | null;
  subtopicCode: string | null;
  difficulty: number;
  trainingLevelCode: string | null;
  caseId: number | null;
  explanationSummary: string;
  teachingPoint: string;
  furtherDiscussion: string | null;
  options: TeachingOptionInput[];
  modalityCodes: string[];
  competencyCodes: string[];
  tagCodes: string[];
  sources: TeachingQuestionSourceInput[];
  references: TeachingQuestionReferenceInput[];
  assetIds: number[];
  assetAltTexts: Array<{ assetId: number; altText: string }>;
  authorshipKind: TeachingAuthorshipKind;
  modelName: string | null;
}

export interface TeachingAuditIdentity {
  identityIssuer: string;
  identitySubject: string;
  displayName: string;
}

export interface TeachingSourceInput {
  sourceType: TeachingSourceType;
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
  notes: string | null;
  metadata: Record<string, unknown>;
}

export interface TeachingAssetInput {
  assetKey: string;
  storageKey: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  originalFilename: string;
  altText: string;
  sizeBytes: number;
}

export interface TeachingReferenceInput {
  referenceType: "textbook" | "journal_article" | "guideline" | "society_document" | "website" | "other" | "unknown";
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

export interface TeachingCaseInput {
  externalId: string;
  specialtyCode: string;
  title: string | null;
  clinicalHistory: string | null;
  assetIds: number[];
}
