import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { asyncRoute } from "../../../utils/async-route.js";
import { HttpError } from "../../../utils/http-error.js";
import { requireTeachingCapabilities, type TeachingRequest } from "./teaching-route-auth.js";
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
import { listTeachingAssets, listTeachingCases, listTeachingReferences, listTeachingSources } from "../repositories/teaching-editorial-repository.js";
import { readTeachingAsset } from "../services/teaching-asset-service.js";
import { createTeachingAssetFromUpload } from "../services/teaching-asset-upload-service.js";

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

export function createTeachingRouter(): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, module: "teaching" });
  });

  router.get("/assets/:id", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, []);
    const asset = await readTeachingAsset(parsePositivePathId(req.params.id));
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

  router.get("/admin/question-banks", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish", "teaching.manage_taxonomy"]);
    res.json({ items: await listTeachingQuestionBanks() });
  }));

  router.get("/admin/questions", requireAuth, asyncRoute(async (req: TeachingRequest, res: Response) => {
    await requireTeachingCapabilities(req, ["teaching.author", "teaching.review", "teaching.publish"]);
    res.json(await listTeachingQuestions({
      search: queryText(req.query.search),
      status: queryText(req.query.status),
      specialtyCode: queryText(req.query.specialtyCode),
      domainCode: queryText(req.query.domainCode),
      topicCode: queryText(req.query.topicCode),
      subtopicCode: queryText(req.query.subtopicCode),
      type: queryText(req.query.type),
      difficulty: strictQueryInteger(req.query.difficulty, "difficulty", 1),
      trainingLevelCode: queryText(req.query.trainingLevelCode),
      tagCode: queryText(req.query.tagCode),
      sourceType: queryText(req.query.sourceType),
      hasImage: queryBoolean(req.query.hasImage, "hasImage"),
      imported: queryBoolean(req.query.imported, "imported"),
      importBatchId: queryText(req.query.importBatchId),
      sort: queryText(req.query.sort),
      direction: queryText(req.query.direction),
      page: strictQueryInteger(req.query.page, "page", 1),
      pageSize: strictQueryInteger(req.query.pageSize, "pageSize", 1),
      limit: strictQueryInteger(req.query.limit, "limit", 1),
      offset: strictQueryInteger(req.query.offset, "offset", 0),
    }));
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
