import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { asyncRoute } from "../../../utils/async-route.js";
import { HttpError } from "../../../utils/http-error.js";
import { requireTeachingCapabilities, requireTeachingLearner, type TeachingRequest } from "./teaching-route-auth.js";
import { getTeachingCatalog, listTeachingQuestionBanks } from "../repositories/teaching-catalog-repository.js";
import {
  createTeachingCase,
  createTeachingQuestion,
  createTeachingQuestionRevision,
  createTeachingReference,
  createTeachingSource,
  getTeachingQuestion,
  listTeachingQuestions,
  parsePositivePathId,
  patchTeachingQuestionDraft,
  publishTeachingQuestion,
  retireTeachingQuestion,
  reviewTeachingQuestion,
  returnTeachingQuestionToDraft,
  submitTeachingQuestionForReview,
  validateTeachingQuestion,
  type TeachingQuestionListQuery,
} from "../services/teaching-content-service.js";
import {
  parseTeachingCaseInput,
  parseTeachingReferenceInput,
  parseTeachingSourceInput,
} from "../domain/teaching-content-validation.js";
import {
  confirmTeachingImport,
  getTeachingImportBatchDto,
  inspectTeachingImport,
  listTeachingImportBatchDtos,
  parseTeachingImportBatchId,
  parseTeachingImportPagination,
  previewTeachingImport,
} from "../import/import-service.js";
import { createTeachingImportTemplate } from "../import/template-service.js";
import {
  parseTeachingBulkQuestionIds,
  publishTeachingQuestionScope,
  requireTeachingMatchingScopeFingerprint,
  validateTeachingQuestionScope,
} from "../import/bulk-operations-service.js";
import { listTeachingAssets, listTeachingCases, listTeachingReferences, listTeachingSources } from "../repositories/teaching-editorial-repository.js";
import { readTeachingAsset } from "../services/teaching-asset-service.js";
import { createTeachingAssetFromUpload } from "../services/teaching-asset-upload-service.js";
import {
  clearTeachingQuestionNote,
  assertLearnerTeachingAssetAccessible,
  createTeachingSession,
  getTeachingLearnerDashboard,
  getTeachingQuestionAvailability,
  getTeachingSession,
  getTeachingSessionQuestion,
  listTeachingSessionHistory,
  parseCreateTeachingSession,
  parseTeachingHistoryPagination,
  saveTeachingExamResponse,
  saveTeachingQuestionNote,
  setTeachingQuestionBookmark,
  submitTeachingSession,
  submitTeachingStudyAnswer,
} from "../services/teaching-learner-service.js";
import {
  getTeachingProgress,
  getTeachingProgressBreakdown,
  getTeachingProgressCycles,
  getTeachingProgressPreview,
  parseTeachingProgressDimension,
  resetTeachingProgress,
} from "../services/teaching-progress-service.js";

function queryText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function strictQueryInteger(value: unknown, name: string, minimum = 0): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new HttpError(400, `${name} is invalid.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new HttpError(400, `${name} is invalid.`);
  return parsed;
}

function queryBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, `${name} must be true or false.`);
}

function bodyBatchId(value: unknown): string {
  if (typeof value !== "object" || value === null || !("batchId" in value)) throw new HttpError(400, "batchId is required.");
  return parseTeachingImportBatchId(value.batchId);
}

function positivePosition(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new HttpError(400, "Question position is invalid.");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, "Question position is invalid.");
  return parsed;
}

function privateNoStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Vary", "Cookie");
}

function teachingQuestionListQuery(source: Record<string, unknown>): TeachingQuestionListQuery {
  return {
    search: queryText(source.search),
    status: queryText(source.status),
    specialtyCode: queryText(source.specialtyCode),
    domainCode: queryText(source.domainCode),
    topicCode: queryText(source.topicCode),
    subtopicCode: queryText(source.subtopicCode),
    type: queryText(source.type),
    difficulty: strictQueryInteger(source.difficulty, "difficulty", 1),
    trainingLevelCode: queryText(source.trainingLevelCode),
    tagCode: queryText(source.tagCode),
    sourceType: queryText(source.sourceType),
    hasImage: queryBoolean(source.hasImage, "hasImage"),
    imported: queryBoolean(source.imported, "imported"),
    validationStatus: queryText(source.validationStatus),
    importBatchId: queryText(source.importBatchId),
    sort: queryText(source.sort),
    direction: queryText(source.direction),
    page: strictQueryInteger(source.page, "page", 1),
    pageSize: strictQueryInteger(source.pageSize, "pageSize", 1),
    limit: strictQueryInteger(source.limit, "limit", 1),
    offset: strictQueryInteger(source.offset, "offset", 0),
  };
}

function matchingQuestionFilters(value: unknown): TeachingQuestionListQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "Bulk question filters are required.");
  return teachingQuestionListQuery(value as Record<string, unknown>);
}

export function createTeachingRouter(): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, module: "teaching" });
  });

  router.get("/assets/:id", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingCapabilities(req, []);
    const assetId = parsePositivePathId(req.params.id);
    const hasEditorialAccess = teachingIdentity.permissions.some((permission) =>
      ["teaching.author", "teaching.review", "teaching.publish", "teaching.admin"].includes(permission),
    );
    if (!hasEditorialAccess && !teachingIdentity.permissions.includes("teaching.learn")) {
      throw new HttpError(403, "Teaching learner access is required.");
    }
    if (!hasEditorialAccess) {
      await assertLearnerTeachingAssetAccessible(teachingIdentity, assetId);
    }
    const asset = await readTeachingAsset(assetId);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${asset.filename}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.send(asset.content);
  }));

  router.get("/qbank/import/template.json", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author"]);
    const template = await createTeachingImportTemplate();
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="rispro-teaching-qbank-template-v1.json"');
    res.send(`${JSON.stringify(template, null, 2)}\n`);
  }));

  router.post("/qbank/import/inspect", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.status(201).json(await inspectTeachingImport(req, actor));
  }));

  router.post("/qbank/import/preview", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author"]);
    res.json(await previewTeachingImport(bodyBatchId(req.body)));
  }));

  router.post("/qbank/import/confirm", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    const result = await confirmTeachingImport(bodyBatchId(req.body), actor);
    if (!result) throw new HttpError(500, "Teaching import did not produce a result.");
    if (result.status === "invalid") {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  }));

  router.get("/qbank/import/batches", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author"]);
    const pagination = parseTeachingImportPagination(req.query.limit, req.query.offset);
    res.json(await listTeachingImportBatchDtos(pagination.limit, pagination.offset));
  }));

  router.get("/qbank/import/batches/:id", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json(await getTeachingImportBatchDto(parseTeachingImportBatchId(req.params.id)));
  }));

  router.post("/qbank/import/batches/:id/validate", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await validateTeachingQuestionScope({ batchId: parseTeachingImportBatchId(req.params.id) }, actor));
  }));

  router.post("/qbank/import/batches/:id/publish", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor, teachingIdentity } = await requireTeachingCapabilities(req, ["teaching.publish"]);
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await publishTeachingQuestionScope({ batchId: parseTeachingImportBatchId(req.params.id) }, actor, teachingIdentity.permissions));
  }));

  router.get("/me", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingCapabilities(req, []);

    res.setHeader("Cache-Control", "no-store, private");
    res.json({
      identitySubject: teachingIdentity.identitySubject,
      displayName: teachingIdentity.displayName,
      permissions: teachingIdentity.permissions,
    });
  }));

  router.get("/catalog", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, []);
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await getTeachingCatalog());
  }));

  router.get("/qbank/dashboard", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await getTeachingLearnerDashboard(teachingIdentity));
  }));

  router.get("/progress", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const questionBank = req.query.questionBank ?? "radiology-main";
    res.json(await getTeachingProgress(teachingIdentity, questionBank));
  }));

  router.get("/progress/breakdown", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const questionBank = req.query.questionBank ?? "radiology-main";
    const dimension = parseTeachingProgressDimension(req.query.dimension);
    res.json(await getTeachingProgressBreakdown(teachingIdentity, questionBank, dimension, {
      domain: req.query.domain,
      search: req.query.search,
    }));
  }));

  router.get("/progress/preview", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const questionBank = req.query.questionBank ?? "radiology-main";
    res.json(await getTeachingProgressPreview(teachingIdentity, questionBank, {
      type: req.query.scopeType,
      code: req.query.scopeCode,
      domain: req.query.domain,
    }));
  }));

  router.get("/progress/cycles", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const questionBank = req.query.questionBank ?? "radiology-main";
    res.json(await getTeachingProgressCycles(teachingIdentity, questionBank, {
      type: req.query.scopeType,
      code: req.query.scopeCode,
      domain: req.query.domain,
    }));
  }));

  router.post("/progress/reset", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.status(201).json(await resetTeachingProgress(teachingIdentity, req.body));
  }));

  router.post("/qbank/availability", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const filters = typeof req.body === "object" && req.body !== null && "filters" in req.body ? req.body.filters : req.body;
    res.json(await getTeachingQuestionAvailability(teachingIdentity, filters));
  }));

  router.post("/sessions", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.status(201).json(await createTeachingSession(teachingIdentity, parseCreateTeachingSession(req.body)));
  }));

  router.get("/sessions/:sessionId", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await getTeachingSession(teachingIdentity, parsePositivePathId(req.params.sessionId)));
  }));

  router.get("/sessions/:sessionId/questions/:position", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await getTeachingSessionQuestion(teachingIdentity, parsePositivePathId(req.params.sessionId), positivePosition(req.params.position)));
  }));

  router.post("/sessions/:sessionId/questions/:position/answer", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    res.json(await submitTeachingStudyAnswer(teachingIdentity, parsePositivePathId(req.params.sessionId), positivePosition(req.params.position), body.selectedOptionKey));
  }));

  router.put("/sessions/:sessionId/questions/:position/response", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    res.json(await saveTeachingExamResponse(teachingIdentity, parsePositivePathId(req.params.sessionId), positivePosition(req.params.position), body.selectedOptionKey));
  }));

  router.post("/sessions/:sessionId/submit", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await submitTeachingSession(teachingIdentity, parsePositivePathId(req.params.sessionId)));
  }));

  router.put("/bookmarks/:questionId", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await setTeachingQuestionBookmark(teachingIdentity, parsePositivePathId(req.params.questionId), true));
  }));

  router.delete("/bookmarks/:questionId", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await setTeachingQuestionBookmark(teachingIdentity, parsePositivePathId(req.params.questionId), false));
  }));

  router.put("/notes/:questionId", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const body = typeof req.body === "object" && req.body !== null ? req.body as Record<string, unknown> : {};
    res.json(await saveTeachingQuestionNote(teachingIdentity, parsePositivePathId(req.params.questionId), body.note));
  }));

  router.delete("/notes/:questionId", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    res.json(await clearTeachingQuestionNote(teachingIdentity, parsePositivePathId(req.params.questionId)));
  }));

  router.get("/history", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { teachingIdentity } = await requireTeachingLearner(req);
    privateNoStore(res);
    const pagination = parseTeachingHistoryPagination(req.query.page, req.query.pageSize);
    res.json(await listTeachingSessionHistory(teachingIdentity, pagination.page, pagination.pageSize));
  }));

  router.get("/admin/question-banks", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish", "teaching.manage_taxonomy"]);
    res.json({ items: await listTeachingQuestionBanks() });
  }));

  router.get("/admin/questions", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json(await listTeachingQuestions(teachingQuestionListQuery(req.query)));
  }));

  router.get("/admin/sources", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json({ items: await listTeachingSources(queryText(req.query.search)) });
  }));

  router.get("/admin/references", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json({ items: await listTeachingReferences(queryText(req.query.search)) });
  }));

  router.get("/admin/cases", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json({ items: await listTeachingCases(queryText(req.query.search)) });
  }));

  router.get("/admin/assets", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author"]);
    res.json({ items: await listTeachingAssets(queryText(req.query.search)) });
  }));

  router.post("/admin/assets", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.status(201).json(await createTeachingAssetFromUpload(req, actor));
  }));

  router.get("/admin/questions/:id", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json(await getTeachingQuestion(parsePositivePathId(req.params.id!)));
  }));

  router.post("/admin/questions", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    const question = await createTeachingQuestion(req.body, actor);
    res.status(201).json(question);
  }));

  router.post("/admin/questions/validate", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author"]);
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await validateTeachingQuestion(req.body));
  }));

  router.post("/admin/questions/bulk/validate", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await validateTeachingQuestionScope({ questionIds: parseTeachingBulkQuestionIds(req.body?.questionIds) }, actor));
  }));

  router.post("/admin/questions/bulk/validate-matching", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.setHeader("Cache-Control", "no-store, private");
    res.json(await validateTeachingQuestionScope({ filters: matchingQuestionFilters(req.body?.filters) }, actor));
  }));

  router.post("/admin/questions/bulk/validate-publish-matching", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor, teachingIdentity } = await requireTeachingCapabilities(req, ["teaching.publish"]);
    res.setHeader("Cache-Control", "no-store, private");
    const filters = matchingQuestionFilters(req.body?.filters);
    requireTeachingMatchingScopeFingerprint(filters, req.body?.scopeFingerprint);
    res.json(await publishTeachingQuestionScope({ filters }, actor, teachingIdentity.permissions));
  }));

  router.patch("/admin/questions/:id/revisions/:revisionId", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    const question = await patchTeachingQuestionDraft(parsePositivePathId(req.params.id!), parsePositivePathId(req.params.revisionId!), req.body, actor);
    res.json(question);
  }));

  router.post("/admin/questions/:id/submit-review", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.json(await submitTeachingQuestionForReview(parsePositivePathId(req.params.id!), actor));
  }));

  router.post("/admin/questions/:id/revisions/:revisionId/review", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.review"]);
    res.json(await reviewTeachingQuestion(parsePositivePathId(req.params.id!), parsePositivePathId(req.params.revisionId!), actor));
  }));

  router.post("/admin/questions/:id/revisions/:revisionId/return-draft", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.review"]);
    res.json(await returnTeachingQuestionToDraft(parsePositivePathId(req.params.id!), parsePositivePathId(req.params.revisionId!), actor));
  }));

  router.post("/admin/questions/:id/publish", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.publish"]);
    res.json(await publishTeachingQuestion(parsePositivePathId(req.params.id!), actor));
  }));

  router.post("/admin/questions/:id/new-revision", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.status(201).json(await createTeachingQuestionRevision(parsePositivePathId(req.params.id!), actor));
  }));

  router.post("/admin/questions/:id/retire", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.publish"]);
    res.json(await retireTeachingQuestion(parsePositivePathId(req.params.id!), actor));
  }));

  router.post("/admin/sources", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.manage_sources"]);
    res.status(201).json(await createTeachingSource(parseTeachingSourceInput(req.body), actor));
  }));

  router.post("/admin/references", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.status(201).json(await createTeachingReference(parseTeachingReferenceInput(req.body), actor));
  }));

  router.post("/admin/cases", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    const { actor } = await requireTeachingCapabilities(req, ["teaching.author"]);
    res.status(201).json(await createTeachingCase(parseTeachingCaseInput(req.body), actor));
  }));

  return router;
}
