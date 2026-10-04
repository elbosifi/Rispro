import { api } from "@/lib/api-client";

export const TEACHING_PERMISSIONS = [
  "teaching.access",
  "teaching.learn",
  "teaching.author",
  "teaching.review",
  "teaching.publish",
  "teaching.manage_taxonomy",
  "teaching.manage_sources",
  "teaching.manage_users",
  "teaching.view_cohort_analytics",
  "teaching.admin",
] as const;

export type TeachingPermission = (typeof TEACHING_PERMISSIONS)[number];

export interface TeachingIdentity {
  identitySubject: string;
  displayName: string;
  permissions: TeachingPermission[];
}

export interface TeachingAnatomyAsset {
  file: string;
  mediaType: string;
  sourceFile?: string;
  integrity?: { sizeBytes: number; sha256: string };
}

export type TeachingAnatomyPlane = "axial" | "coronal" | "sagittal";
export type TeachingAnatomyModality = "CT" | "MRI" | "3D";

export interface TeachingAnatomyStructure {
  id: string;
  labelValue?: number;
  name: string;
  category: string;
  parentId?: string;
  synonyms: string[];
  organ?: string;
  bodyRegion?: string;
  system?: string;
  color: string;
  meshAsset?: string;
  relatedAtlasIds?: string[];
  representativePointLps?: [number, number, number];
  sourceConceptId?: string;
  note: string;
}

export interface TeachingAnatomyManifest {
  schemaVersion: "2.0";
  atlasId: string;
  title: string;
  bodyRegion: string;
  organs: string[];
  systems: string[];
  modality: TeachingAnatomyModality;
  correlatedImaging: boolean;
  supportedPlanes: TeachingAnatomyPlane[];
  initialSlice?: { plane: TeachingAnatomyPlane; index: number };
  coordinateSystem: "LPS" | "RAS";
  meshCoordinateSystem: "LPS" | "RAS";
  volumes: {
    primary?: {
      assetKey: string;
      file: string;
      modality: "CT" | "MRI";
      windowLevel?: { width: number; level: number };
      intensityRange?: { min: number; max: number };
      displayPresets?: Array<{ id: string; label: string; windowLevel?: { width: number; level: number }; intensityRange?: { min: number; max: number } }>;
    };
    segmentation?: { assetKey: string; file: string };
  };
  assets: Record<string, TeachingAnatomyAsset>;
  overviewAsset?: string;
  structures: TeachingAnatomyStructure[];
  provenance: { sourceRepository: string; project: string; attribution: string; license: string; licenseUrl: string; use: string; citation?: string };
  spatialValidation: { status: "passed" | "not-applicable"; method: string; minimumMeshLabelAgreement?: number; meshLabelAgreement?: Record<string, number> };
}

export type TeachingAnatomyManifestResult =
  | { available: true; manifest: TeachingAnatomyManifest }
  | { available: false; atlasId: string; title: string; status: string; message: string };

export interface TeachingAnatomyAtlasCatalogEntry {
  atlasId: string;
  title: string;
  bodyRegion: string;
  organs: string[];
  systems: string[];
  modality: TeachingAnatomyModality;
  crossSectionPlanes: TeachingAnatomyPlane[];
  description: string;
  correlatedImaging: boolean;
  status: "ready" | "not-installed" | "pending-source-validation" | "unavailable";
  structureCount: number | null;
  thumbnail?: string;
  provenance: { sourceRepository: string; project: string; attribution: string; license: string; licenseUrl: string; use?: string; citation?: string };
}

export interface TeachingAnatomyCatalog { items: TeachingAnatomyAtlasCatalogEntry[] }

export interface TeachingCatalogItem {
  code: string;
  label: string;
  description: string;
  parentCode?: string;
  active: boolean;
  sortOrder: number;
}

export interface TeachingCatalog {
  schemaVersion: number;
  specialties: TeachingCatalogItem[];
  domains: TeachingCatalogItem[];
  topics: TeachingCatalogItem[];
  subtopics: TeachingCatalogItem[];
  modalities: TeachingCatalogItem[];
  competencies: TeachingCatalogItem[];
  trainingLevels: TeachingCatalogItem[];
  difficulties: Array<{ value: number; code: string; label: string; description: string; active: boolean; sortOrder: number }>;
  tags: TeachingCatalogItem[];
  supportedQuestionTypes: string[];
  supportedSourceTypes: string[];
  supportedProvenanceRelationships: string[];
}

export type TeachingQuestionStatus = "draft" | "in_review" | "published" | "retired";
export type TeachingQuestionType = "single_best_answer" | "image_based_sba" | "case_based_sba";
export type TeachingEvidenceStatus = "confirmed" | "updated" | "uncertain" | "not_verified";

export interface TeachingAsset {
  id: number;
  assetKey?: string;
  mimeType: string;
  originalFilename: string;
  altText: string;
  sizeBytes: number;
}

export interface TeachingSourceLink {
  id: number;
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

export interface TeachingReferenceLink {
  id: number;
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

export interface TeachingCaseSummary {
  id: number;
  externalId: string;
  title: string | null;
  clinicalHistory: string | null;
  assets?: TeachingAsset[];
}

export interface TeachingQuestionRevision {
  id: number;
  version: number;
  revisionNumber: number;
  status: TeachingQuestionStatus;
  type: TeachingQuestionType;
  stem: string;
  classification: {
    specialty: { code: string };
    domain: { code: string };
    topic: { code: string } | null;
    subtopic: { code: string } | null;
  };
  difficulty: number;
  trainingLevel: string | null;
  case: (TeachingCaseSummary & { specialtyCode?: string }) | null;
  explanation: { summary: string; teachingPoint: string; furtherDiscussion: string | null };
  options: Array<{ key: string; text: string; isCorrect: boolean; explanation: string | null }>;
  modalities: TeachingCatalogItem[];
  competencies: TeachingCatalogItem[];
  tags: TeachingCatalogItem[];
  sources: TeachingSourceLink[];
  references: TeachingReferenceLink[];
  assets: TeachingAsset[];
  authorship: { kind: string; modelName: string | null };
  evidenceReview: { status: TeachingEvidenceStatus; checkedAt: string | null; summary: string; update: string | null };
  audit: {
    createdBy: string;
    submittedAt: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    publishedBy: string | null;
    publishedAt: string | null;
    retiredAt: string | null;
    importBatchId: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

export interface TeachingQuestionDetail {
  id: number;
  externalId: string;
  questionBank: { code: string; name: string };
  specialtyCode: string;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
  revisions: TeachingQuestionRevision[];
}

export interface TeachingQuestionListItem {
  id: number;
  externalId: string;
  questionBank: { code: string; name: string };
  revision: { id: number; version: number; revisionNumber: number; status: TeachingQuestionStatus; type: TeachingQuestionType; stem: string; importBatchId: string | null };
  validation: { classification: TeachingValidationClassification; errorCount: number; warningCount: number } | null;
  classification: {
    specialty: { code: string; label: string };
    domain: { code: string; label: string };
    topic: { code: string; label: string } | null;
    difficulty: number;
    trainingLevel: { code: string; label: string } | null;
  };
  sourceTitle: string | null;
  hasImage: boolean;
  imported: boolean;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeachingQuestionListResponse {
  items: TeachingQuestionListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number; limit: number; offset: number };
}

export interface TeachingSource {
  id: number;
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
  notes: string | null;
  metadata: Record<string, unknown>;
}

export interface TeachingReference {
  id: number;
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

export interface TeachingCase extends TeachingCaseSummary {
  specialtyCode: string;
}

export interface TeachingQuestionCommand {
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
  explanation: { summary: string; teachingPoint: string; furtherDiscussion: string | null };
  options: Array<{ key: string; text: string; isCorrect: boolean; explanation: string | null }>;
  modalityCodes: string[];
  competencyCodes: string[];
  tagCodes: string[];
  sources: Array<{ sourceId: number; relationship: string; notes: string | null }>;
  references: Array<{ referenceId: number; notes: string | null }>;
  assetIds: number[];
  assetAltTexts: Array<{ assetId: number; altText: string }>;
  authorship: { kind: string; modelName: string | null };
  evidenceReview: { status: TeachingEvidenceStatus; checkedAt: string | null; summary: string; update: string | null };
}

export interface TeachingImportIssue {
  code: string;
  message: string;
  path?: string;
  externalId?: string;
  filename?: string;
}

export interface TeachingImportPreviewQuestion {
  externalId: string;
  type: string;
  stem: string;
  correctOption: { id: string; text: string } | null;
  options: Array<{ id: string; text: string; isCorrect: boolean; explanation: string | null }>;
  explanation: { summary: string; teachingPoint: string; furtherDiscussion: string | null; optionExplanations: Record<string, string> };
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
  source: { type: string; title: string | null; year: number | null } | null;
  provenance: string | null;
  referenceCount: number;
  media: Array<{ assetKey: string; filename: string; type: "image"; altText: string }>;
  case: { externalId: string; title: string | null } | null;
  disposition: "new" | "existing_draft" | "existing_published" | "conflict";
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
  taxonomyProposals: Array<{ specialty: string; domain: string; code: string; label: string; description: string; questionCount: number; alreadyExists: boolean; warnings: TeachingImportIssue[]; errors: TeachingImportIssue[] }>;
  questions: TeachingImportPreviewQuestion[];
}

export interface TeachingImportInspectResult {
  batchId: string;
  schemaVersion: string | null;
  questions: number;
  cases: number;
  assets: number;
  structurallyValid: boolean;
  errors: TeachingImportIssue[];
  warnings: TeachingImportIssue[];
}

export async function inspectTeachingImport(file: File): Promise<TeachingImportInspectResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  return api<TeachingImportInspectResult>("/teaching/qbank/import/inspect", { method: "POST", body: form }, 120_000);
}

export async function previewTeachingImport(batchId: string): Promise<TeachingImportValidation> {
  return api<TeachingImportValidation>("/teaching/qbank/import/preview", { method: "POST", body: JSON.stringify({ batchId }) }, 120_000);
}

export async function confirmTeachingImport(batchId: string): Promise<{ batchId: string; status: string; questionCount: number }> {
  return api<{ batchId: string; status: string; questionCount: number }>("/teaching/qbank/import/confirm", { method: "POST", body: JSON.stringify({ batchId }) }, 120_000);
}

export async function downloadTeachingImportTemplate(): Promise<void> {
  const response = await fetch("/api/teaching/qbank/import/template.json", { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Could not download the current Teaching template.");
  const file = await response.blob();
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rispro-teaching-qbank-template-v1.1.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface TeachingMaintenanceExportFilters {
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
  validationStatus?: string;
  search?: string;
}

function maintenanceExportFilename(filters: TeachingMaintenanceExportFilters, hasFilters: boolean): string {
  if (!hasFilters) return "rispro-teaching-question-bank-maintenance.xlsx";
  const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const scope = [filters.status, filters.domainCode, filters.topicCode].filter((value): value is string => Boolean(value?.trim())).map(slug).filter(Boolean);
  return `rispro-teaching-maintenance-${scope.length > 0 ? scope.join("-") : "filtered"}.xlsx`;
}

export async function downloadTeachingMaintenanceWorkbook(filters: TeachingMaintenanceExportFilters = {}): Promise<void> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) params.set(key, trimmed);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      params.set(key, String(value));
    } else if (typeof value === "boolean") {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  const endpoint = `/api/teaching/admin/questions/export.xlsx${query ? `?${query}` : ""}`;
  const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Could not export the Teaching maintenance workbook.");
  const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = maintenanceExportFilename(filters, params.size > 0); anchor.click(); URL.revokeObjectURL(url);
}

export interface TeachingMaintenancePreview { workbookHash: string; summary: { total: number; unchanged: number; updateDraft: number; createDraftRevision: number; invalid: number; staleConflict: number; inReviewConflict: number; retired: number; missingQuestion: number }; topicProposals: Array<{ specialty: string; domain: string; code: string; label: string; description: string; questionCount: number; alreadyExists: boolean; warnings: TeachingImportIssue[]; errors: TeachingImportIssue[] }>; errors: TeachingImportIssue[]; warnings: TeachingImportIssue[]; rows: Array<{ externalId: string; currentStatus: string; action: string; changedFields: string[]; warnings: TeachingImportIssue[]; errors: TeachingImportIssue[] }>; }
export async function previewTeachingMaintenanceWorkbook(file: File): Promise<TeachingMaintenancePreview> { const form = new FormData(); form.append("file", file, file.name); return api("/teaching/admin/questions/maintenance/preview", { method: "POST", body: form }, 120_000); }
export async function confirmTeachingMaintenanceWorkbook(file: File, workbookHash: string): Promise<{ updatedDraft: number; newDraftRevision: number; unchanged: number; invalid: number; conflicts: number; proposedTopicsCreated: number }> { const form = new FormData(); form.append("file", file, file.name); return api("/teaching/admin/questions/maintenance/confirm", { method: "POST", body: form, headers: { "x-teaching-maintenance-preview-hash": workbookHash } }, 120_000); }

export async function fetchTeachingIdentity(): Promise<TeachingIdentity> {
  return api<TeachingIdentity>("/teaching/me");
}

export async function fetchTeachingAnatomyCatalog(): Promise<TeachingAnatomyCatalog> {
  return api<TeachingAnatomyCatalog>("/teaching/anatomy/catalog");
}

export async function fetchTeachingAnatomyManifest(atlasId = "spl-liver"): Promise<TeachingAnatomyManifestResult> {
  return api<TeachingAnatomyManifestResult>(`/teaching/anatomy/atlas/${encodeURIComponent(atlasId)}/manifest`);
}

export async function fetchTeachingAnatomyAtlasAsset(atlasId: string, assetKey: string, signal?: AbortSignal, version?: string): Promise<ArrayBuffer> {
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  const response = await fetch(`/api/teaching/anatomy/atlas/${encodeURIComponent(atlasId)}/assets/${encodeURIComponent(assetKey)}${query}`, {
    credentials: "include",
    cache: "default",
    signal,
  });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? "A declared anatomy asset is missing from the installed atlas."
      : `Teaching anatomy asset could not be loaded (${response.status}).`);
  }
  return response.arrayBuffer();
}

export async function fetchTeachingAnatomyAsset(assetKey: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  return fetchTeachingAnatomyAtlasAsset("spl-liver", assetKey, signal);
}

export async function fetchTeachingCatalog(): Promise<TeachingCatalog> {
  return api<TeachingCatalog>("/teaching/catalog");
}

export async function fetchTeachingQuestionBanks(): Promise<{ items: Array<{ code: string; name: string; specialtyCode: string }> }> {
  return api("/teaching/admin/question-banks");
}

export async function fetchTeachingQuestions(params: URLSearchParams): Promise<TeachingQuestionListResponse> {
  const query = params.toString();
  return api<TeachingQuestionListResponse>(`/teaching/admin/questions${query ? `?${query}` : ""}`);
}

export async function fetchTeachingQuestion(id: number): Promise<TeachingQuestionDetail> {
  return api<TeachingQuestionDetail>(`/teaching/admin/questions/${id}`);
}

export async function createTeachingQuestionRequest(command: TeachingQuestionCommand): Promise<TeachingQuestionDetail> {
  return api<TeachingQuestionDetail>("/teaching/admin/questions", { method: "POST", body: JSON.stringify(command) });
}

export async function updateTeachingQuestionDraft(id: number, revisionId: number, command: TeachingQuestionCommand, expectedVersion: number): Promise<TeachingQuestionDetail> {
  const { externalId, questionBankCode, ...content } = command;
  // These stable identity fields belong to the logical question, not its editable revision content.
  void externalId;
  void questionBankCode;
  return api<TeachingQuestionDetail>(`/teaching/admin/questions/${id}/revisions/${revisionId}`, {
    method: "PATCH", body: JSON.stringify({ ...content, expectedVersion }),
  });
}

export async function validateTeachingQuestionContent(command: TeachingQuestionCommand): Promise<{
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
}> {
  return api("/teaching/admin/questions/validate", { method: "POST", body: JSON.stringify(command) });
}

async function teachingQuestionAction(id: number, action: string, revisionId?: number): Promise<TeachingQuestionDetail> {
  const suffix = revisionId === undefined ? action : `revisions/${revisionId}/${action}`;
  return api<TeachingQuestionDetail>(`/teaching/admin/questions/${id}/${suffix}`, { method: "POST", body: "{}" });
}

export const submitTeachingQuestionForReview = (id: number) => teachingQuestionAction(id, "submit-review");
export const approveTeachingQuestionReview = (id: number, revisionId: number) => teachingQuestionAction(id, "review", revisionId);
export const returnTeachingQuestionToDraft = (id: number, revisionId: number) => teachingQuestionAction(id, "return-draft", revisionId);
export const publishTeachingQuestion = (id: number) => teachingQuestionAction(id, "publish");
export const createTeachingQuestionRevision = (id: number) => teachingQuestionAction(id, "new-revision");
export const retireTeachingQuestion = (id: number) => teachingQuestionAction(id, "retire");

export async function listTeachingSources(search = ""): Promise<{ items: TeachingSource[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return api(`/teaching/admin/sources${query}`);
}

export async function listTeachingReferences(search = ""): Promise<{ items: TeachingReference[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return api(`/teaching/admin/references${query}`);
}

export async function listTeachingCases(search = ""): Promise<{ items: TeachingCase[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return api(`/teaching/admin/cases${query}`);
}

export async function listTeachingAssets(search = ""): Promise<{ items: TeachingAsset[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return api(`/teaching/admin/assets${query}`);
}

export async function uploadTeachingAsset(file: File): Promise<TeachingAsset> {
  const form = new FormData();
  form.append("file", file, file.name);
  return api<TeachingAsset>("/teaching/admin/assets", { method: "POST", body: form }, 120_000);
}

export async function createTeachingSourceRequest(input: Omit<TeachingSource, "id">): Promise<TeachingSource> {
  return api("/teaching/admin/sources", { method: "POST", body: JSON.stringify(input) });
}

export async function createTeachingReferenceRequest(input: Omit<TeachingReference, "id">): Promise<TeachingReference> {
  return api("/teaching/admin/references", { method: "POST", body: JSON.stringify(input) });
}

export async function createTeachingCaseRequest(input: Omit<TeachingCase, "id">): Promise<TeachingCase> {
  return api("/teaching/admin/cases", { method: "POST", body: JSON.stringify({ ...input, assetIds: [] }) });
}

export async function fetchTeachingImportBatch(id: string): Promise<Record<string, unknown>> {
  return api(`/teaching/qbank/import/batches/${encodeURIComponent(id)}`);
}

export interface TeachingImportPublicationSummary {
  total: number;
  draft: number;
  inReview: number;
  published: number;
  retired: number;
}

export interface TeachingImportBatchListItem {
  id: string;
  originalFilename: string;
  inputType: "json" | "zip";
  schemaVersion: string | null;
  status: string;
  questionCount: number;
  caseCount: number;
  assetCount: number;
  uploader: { identityIssuer: string; identitySubject: string };
  createdAt: string;
  confirmedAt: string | null;
  publication: TeachingImportPublicationSummary | null;
}

export async function fetchTeachingImportBatches(limit = 20, offset = 0): Promise<{
  items: TeachingImportBatchListItem[];
  pagination: { limit: number; offset: number; total: number };
}> {
  return api(`/teaching/qbank/import/batches?${new URLSearchParams({ limit: String(limit), offset: String(offset) })}`);
}

export type TeachingValidationClassification = "valid" | "valid_with_warnings" | "invalid";
export interface TeachingValidationIssue {
  code: string;
  message: string;
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

export interface TeachingBulkValidationResult {
  scopeFingerprint?: string;
  total: number;
  draft: number;
  inReview: number;
  published: number;
  retired: number;
  valid: number;
  validWithWarnings: number;
  invalid: number;
  conflicts: number;
  eligibleForPublish: number;
  questions: TeachingBulkQuestionResult[];
}

export interface TeachingBulkPublishResult {
  requested: number;
  published: number;
  alreadyPublished: number;
  invalid: number;
  conflicts: number;
  requiresReview: number;
  retired: number;
  failed: number;
  warnings: number;
  results: TeachingBulkQuestionResult[];
}

export async function validateTeachingImportBatch(batchId: string): Promise<TeachingBulkValidationResult> {
  return api(`/teaching/qbank/import/batches/${encodeURIComponent(batchId)}/validate`, { method: "POST", body: "{}" });
}

export async function publishTeachingImportBatch(batchId: string, scopeFingerprint: string): Promise<TeachingBulkPublishResult> {
  return api(`/teaching/qbank/import/batches/${encodeURIComponent(batchId)}/publish`, { method: "POST", body: JSON.stringify({ scopeFingerprint }) });
}

export async function validateTeachingQuestionSelection(questionIds: number[]): Promise<TeachingBulkValidationResult> {
  return api("/teaching/admin/questions/bulk/validate", { method: "POST", body: JSON.stringify({ questionIds }) });
}

export type TeachingQuestionMatchingFilters = Record<string, string>;

export async function validateTeachingQuestionMatching(filters: TeachingQuestionMatchingFilters): Promise<TeachingBulkValidationResult> {
  return api("/teaching/admin/questions/bulk/validate-matching", { method: "POST", body: JSON.stringify({ filters }) });
}

export async function validateAndPublishTeachingQuestionMatching(filters: TeachingQuestionMatchingFilters, scopeFingerprint: string): Promise<TeachingBulkPublishResult> {
  return api("/teaching/admin/questions/bulk/validate-publish-matching", { method: "POST", body: JSON.stringify({ filters, scopeFingerprint }) });
}

export function teachingAssetUrl(id: number): string {
  return `/api/teaching/assets/${id}`;
}

export type TeachingSessionMode = "study" | "exam" | "review";
export type TeachingSessionStatus = "active" | "submitted" | "abandoned";
export type TeachingQuestionStateFilter = "all" | "unseen" | "correct" | "incorrect" | "answered" | "marked";

export interface TeachingLearnerFilters {
  questionBank?: string;
  specialty?: string;
  domain?: string;
  topics?: string[];
  subtopics?: string[];
  modalities?: string[];
  competencies?: string[];
  trainingLevels?: string[];
  difficulty?: number[];
  tags?: string[];
  questionState?: TeachingQuestionStateFilter;
}

export interface TeachingSessionProgress {
  total: number;
  answered: number;
  correct: number | null;
  incorrect: number | null;
  unanswered: number;
  scorePercent: number | null;
  answeredAccuracy: number | null;
  timeUsedSeconds?: number;
}

export interface TeachingSessionPosition {
  position: number;
  answered: boolean;
}

export interface TeachingLearnerSession {
  id: number;
  mode: TeachingSessionMode;
  status: TeachingSessionStatus;
  questionCount: number;
  timed: boolean;
  timeLimitSeconds: number | null;
  remainingSeconds: number | null;
  currentPosition: number;
  startedAt: string;
  lastActivityAt: string;
  submittedAt: string | null;
  filters: TeachingLearnerFilters;
  questions: TeachingSessionPosition[];
  progress: TeachingSessionProgress;
}

export interface TeachingLearnerDashboard {
  publishedQuestionCount: number;
  progress: {
    attemptedQuestions: number;
    unseenQuestions: number;
    correctQuestions: number;
    incorrectQuestions: number;
    markedQuestions: number;
    completionPercent?: number;
    currentCycleAccuracyPercent?: number | null;
    firstPassAccuracyPercent?: number | null;
    lifetimeUniqueAttempted?: number;
    lifetimeAttempts?: number;
    averageAnswerTimeMs?: number | null;
  };
  recentSessions: Array<{
    id: number;
    mode: TeachingSessionMode;
    status: TeachingSessionStatus;
    questionCount: number;
    timed: boolean;
    currentPosition: number;
    startedAt: string;
    submittedAt: string | null;
    progress: TeachingSessionProgress;
  }>;
  continueSession: TeachingLearnerDashboard["recentSessions"][number] | null;
}

export interface TeachingLearnerQuestion {
  session: Pick<TeachingLearnerSession, "id" | "mode" | "status" | "timed" | "timeLimitSeconds" | "remainingSeconds">;
  position: number;
  totalQuestions: number;
  questionId: number;
  externalId: string;
  type: TeachingQuestionType;
  stem: string;
  case: { title: string | null; clinicalHistory: string | null } | null;
  images: Array<{ id: number; mimeType: string; altText: string; url: string }>;
  options: Array<{ key: string; text: string; explanation?: string }>;
  selectedOptionKey: string | null;
  answered: boolean;
  bookmarked: boolean;
  note: string;
  feedback?: {
    isCorrect: boolean | null;
    selectedOptionKey: string | null;
    correctOption: { key: string; text: string } | null;
    explanation: { summary: string; teachingPoint: string; furtherDiscussion: string | null };
    optionExplanations: Array<{ key: string; explanation: string }>;
    references: Array<{
      title: string;
      organization: string | null;
      authors: string[];
      year: number | null;
      edition: string | null;
      url: string | null;
      doi: string | null;
      citationText: string | null;
    }>;
    evidenceReview?: { status: TeachingEvidenceStatus; checkedAt: string | null; summary: string; update: string | null };
  };
}

export async function fetchTeachingLearnerDashboard(): Promise<TeachingLearnerDashboard> {
  return api("/teaching/qbank/dashboard");
}

export async function fetchTeachingQuestionAvailability(filters: TeachingLearnerFilters): Promise<{ available: number; questionState: TeachingQuestionStateFilter }> {
  return api("/teaching/qbank/availability", { method: "POST", body: JSON.stringify({ filters }) });
}

export async function createTeachingLearnerSession(input: {
  mode: TeachingSessionMode;
  questionCount: number;
  timed: boolean;
  timeLimitSeconds?: number;
  filters: TeachingLearnerFilters;
}): Promise<{ sessionId: number; questionCount: number; mode: TeachingSessionMode; status: "active"; timed: boolean; timeLimitSeconds: number | null; startedAt: string; firstPosition: number }> {
  return api("/teaching/sessions", { method: "POST", body: JSON.stringify(input) });
}

export async function fetchTeachingLearnerSession(sessionId: number): Promise<TeachingLearnerSession> {
  return api(`/teaching/sessions/${sessionId}`);
}

export async function fetchTeachingLearnerQuestion(sessionId: number, position: number): Promise<TeachingLearnerQuestion> {
  return api(`/teaching/sessions/${sessionId}/questions/${position}`);
}

export async function submitTeachingLearnerAnswer(sessionId: number, position: number, selectedOptionKey: string): Promise<TeachingLearnerQuestion> {
  return api(`/teaching/sessions/${sessionId}/questions/${position}/answer`, {
    method: "POST", body: JSON.stringify({ selectedOptionKey }),
  });
}

export async function saveTeachingLearnerExamResponse(sessionId: number, position: number, selectedOptionKey: string): Promise<{ saved: boolean; submitted: boolean; session: TeachingLearnerSession }> {
  return api(`/teaching/sessions/${sessionId}/questions/${position}/response`, {
    method: "PUT", body: JSON.stringify({ selectedOptionKey }),
  });
}

export async function submitTeachingLearnerSession(sessionId: number): Promise<TeachingLearnerSession> {
  return api(`/teaching/sessions/${sessionId}/submit`, { method: "POST", body: JSON.stringify({}) });
}

export async function setTeachingQuestionBookmark(questionId: number, marked: boolean): Promise<{ questionId: number; marked: boolean }> {
  return api(`/teaching/bookmarks/${questionId}`, { method: marked ? "PUT" : "DELETE" });
}

export async function saveTeachingQuestionNote(questionId: number, note: string): Promise<{ questionId: number; note: string }> {
  return api(`/teaching/notes/${questionId}`, { method: "PUT", body: JSON.stringify({ note }) });
}

export async function clearTeachingQuestionNote(questionId: number): Promise<{ questionId: number; cleared: boolean }> {
  return api(`/teaching/notes/${questionId}`, { method: "DELETE" });
}

export type TeachingProgressDimension = "domain" | "topic" | "modality" | "competency" | "difficulty" | "tag";
export type TeachingResetScope = { type: "bank" } | { type: "domain" | "topic"; code: string; domain?: string };

export interface TeachingProgressSummary {
  questionBank: { code: string; publishedQuestions: number };
  currentCycle: {
    attempted: number;
    eligible: number;
    correct: number;
    incorrect: number;
    unseen: number;
    completionPercent: number;
    accuracyPercent: number | null;
    marked: number;
  };
  lifetime: {
    uniqueAttempted: number;
    totalAttempts: number;
    firstPassCorrect: number;
    firstPassAttempted: number;
    firstPassAccuracyPercent: number | null;
    averageAnswerTimeMs: number | null;
  };
}

export interface TeachingProgressBreakdownItem {
  code: string;
  label: string;
  eligible: number;
  attempted: number;
  correct: number;
  incorrect: number;
  unseen: number;
  completionPercent: number;
  accuracyPercent: number | null;
  firstPassAttempted: number;
  firstPassCorrect: number;
  firstPassAccuracyPercent: number | null;
  averageAnswerTimeMs: number | null;
  timedAttemptCount: number;
}

export interface TeachingProgressCycle {
  id: string;
  cycleNumber: number;
  startedAt: string;
  endedAt: string | null;
  eligible: number;
  attempted: number;
  correct: number;
  incorrect: number;
  completionPercent: number;
  accuracyPercent: number | null;
  current: boolean;
}

const progressQuery = (questionBank: string, scope?: TeachingResetScope) => {
  const params = new URLSearchParams({ questionBank });
  if (scope) {
    params.set("scopeType", scope.type);
    if (scope.type !== "bank") params.set("scopeCode", scope.code);
    if (scope.type === "topic" && scope.domain) params.set("domain", scope.domain);
  }
  return params.toString();
};

export async function fetchTeachingProgress(questionBank = "radiology-main"): Promise<TeachingProgressSummary> {
  return api(`/teaching/progress?${new URLSearchParams({ questionBank })}`);
}

export async function fetchTeachingProgressBreakdown(
  dimension: TeachingProgressDimension,
  options: { questionBank?: string; domain?: string; search?: string } = {},
): Promise<{ questionBank: string; dimension: TeachingProgressDimension; items: TeachingProgressBreakdownItem[] }> {
  const params = new URLSearchParams({ questionBank: options.questionBank ?? "radiology-main", dimension });
  if (options.domain) params.set("domain", options.domain);
  if (options.search) params.set("search", options.search);
  return api(`/teaching/progress/breakdown?${params}`);
}

export async function fetchTeachingProgressPreview(questionBank: string, scope: TeachingResetScope): Promise<{
  questionBank: string; scope: { type: string; code: string; label: string };
  eligibleQuestionCount: number; attempted: number; correct: number; incorrect: number; unseen: number;
  completionPercent: number; accuracyPercent: number | null; marked: number;
  activeSessionCount: number; activeSessionQuestionCount: number;
}> {
  return api(`/teaching/progress/preview?${progressQuery(questionBank, scope)}`);
}

export async function fetchTeachingProgressCycles(questionBank: string, scope: TeachingResetScope): Promise<{
  questionBank: string; scope: { type: string; code: string; label: string }; items: TeachingProgressCycle[];
}> {
  return api(`/teaching/progress/cycles?${progressQuery(questionBank, scope)}`);
}

export async function resetTeachingProgress(input: {
  questionBank: string; scope: TeachingResetScope; idempotencyKey: string;
}): Promise<{
  questionBank: string; scope: { type: string; code: string; label: string };
  eligibleQuestionCount: number; attempted: number; correct: number; incorrect: number; unseen: number;
  completionPercent: number; accuracyPercent: number | null; marked: number;
  cycleNumber: number; startedAt: string; alreadyApplied: boolean;
}> {
  return api("/teaching/progress/reset", { method: "POST", body: JSON.stringify(input) });
}

export async function fetchTeachingSessionHistory(page = 1, pageSize = 20): Promise<{
  items: Array<Omit<TeachingLearnerSession, "remainingSeconds" | "currentPosition" | "lastActivityAt" | "questions"> & { durationSeconds: number }>;
  pagination: { page: number; pageSize: number; total: number };
}> {
  return api(`/teaching/history?page=${page}&pageSize=${pageSize}`);
}
