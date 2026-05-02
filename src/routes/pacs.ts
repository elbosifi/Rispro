import express, { Request, Response } from "express";
import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireAuth, requireSupervisor, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { HttpError } from "../utils/http-error.js";
import {
  listPacsNodes,
  createPacsNode,
  updatePacsNode,
  deletePacsNode
} from "../services/pacs-node-service.js";
import { testPacsConnection, searchPacsStudies } from "../services/pacs-service.js";
import {
  assertDicomRemapRouteAccess,
  cancelDicomRemapJob,
  clearFailedDicomRemapOrthancStudies,
  cleanupDicomRemapUploadTempDir,
  confirmDicomRemapAndSend,
  createDicomRemapMultipartUploadJob,
  processDicomRemapMultipartJob,
  createDicomRemapUploadJob,
  type DicomRemapStagedUploadFile,
  getDicomRemapJob,
  getDicomRemapReplacementPreview,
  hardResetOrthancStudies,
  listDicomRemapDestinations,
  listMyDicomRemapJobs,
  prepareDicomRemapConfirmation,
  resendDicomRemapJobToPacs,
  resetDicomRemapJob,
  validateDicomRemapUploadFilesInput,
  validateExplicitConfirm,
} from "../services/dicom-remap-service.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";

const supervisorMiddleware = [requireAuth, requireSupervisor, requireRecentSupervisorReauth];
const supervisorNoReauthMiddleware = [requireAuth, requireSupervisor];
const authMiddleware = [requireAuth];

export const pacsRouter = express.Router();

async function stageDicomRemapMultipartFiles(req: Request): Promise<{
  files: DicomRemapStagedUploadFile[];
  tempDir: string;
  selectedStudyInstanceUID: string | null;
  risproPatientId: string | null;
  destinationPacsKey: string | null;
  confirm: string | null;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-remap-"));
  const files: DicomRemapStagedUploadFile[] = [];
  let selectedStudyInstanceUID: string | null = null;
  let risproPatientId: string | null = null;
  let destinationPacsKey: string | null = null;
  let confirm: string | null = null;
  const writes: Promise<void>[] = [];

  return new Promise((resolve, reject) => {
    let settled = false;
    let uploadFinished = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      void cleanupDicomRemapUploadTempDir(tempDir).finally(() => {
        reject(error);
      });
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 5000,
      },
    });

    const interruptUpload = () => {
      if (settled || uploadFinished) return;
      const error = new HttpError(400, "DICOM remap upload was interrupted. Please start a new upload.");
      req.unpipe(busboy);
      busboy.destroy(error);
      fail(error);
    };

    req.on("aborted", interruptUpload);
    req.on("close", () => {
      const requestComplete = Boolean((req as Request & { complete?: boolean }).complete);
      if (!requestComplete && !uploadFinished) {
        interruptUpload();
      }
    });

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "files") {
        file.resume();
        return;
      }

      const fileName = path.basename(String(info.filename || "dicom.dcm"));
      const stagedPath = path.join(tempDir, `${files.length}-${randomUUID()}.dcm`);
      const writeStream = createWriteStream(stagedPath);
      let size = 0;

      file.on("data", (chunk: Buffer) => {
        size += chunk.length;
      });
      file.on("error", fail);
      writeStream.on("error", fail);
      file.pipe(writeStream);

      writes.push(new Promise<void>((resolveWrite, rejectWrite) => {
        writeStream.on("finish", () => {
          files.push({
            fileName,
            mimeType: info.mimeType,
            path: stagedPath,
            size,
          });
          resolveWrite();
        });
        writeStream.on("error", rejectWrite);
      }));
    });
    busboy.on("field", (fieldName, value) => {
      if (fieldName === "selectedStudyInstanceUID") {
        const clean = String(value || "").trim();
        selectedStudyInstanceUID = clean || null;
        return;
      }
      if (fieldName === "risproPatientId") {
        const clean = String(value || "").trim();
        risproPatientId = clean || null;
        return;
      }
      if (fieldName === "destinationPacsKey") {
        const clean = String(value || "").trim();
        destinationPacsKey = clean || null;
        return;
      }
      if (fieldName === "confirm") {
        const clean = String(value || "").trim();
        confirm = clean || null;
      }
    });

    busboy.on("error", fail);
    busboy.on("filesLimit", () => fail(new HttpError(413, "Too many files in DICOM upload.")));
    busboy.on("finish", () => {
      uploadFinished = true;
      Promise.all(writes)
        .then(() => {
          if (settled) return;
          settled = true;
          resolve({ files, tempDir, selectedStudyInstanceUID, risproPatientId, destinationPacsKey, confirm });
        })
        .catch(fail);
    });

    req.pipe(busboy);
  });
}

export const __pacsRouteTestables = {
  stageDicomRemapMultipartFiles,
};

// ---------------------------------------------------------------------------
// PACS Node CRUD (supervisor only)
// ---------------------------------------------------------------------------

pacsRouter.get(
  "/nodes/available",
  ...authMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    const nodes = await listPacsNodes();
    res.json({
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        is_active: node.is_active,
        is_default: node.is_default
      }))
    });
  })
);

pacsRouter.get(
  "/nodes",
  ...supervisorMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    const nodes = await listPacsNodes();
    res.json({ nodes });
  })
);

pacsRouter.post(
  "/nodes",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const node = await createPacsNode(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ node });
  })
);

pacsRouter.put(
  "/nodes/:nodeId",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { nodeId?: string } };
    const nodeId = asOptionalString(request.params?.nodeId);

    if (!nodeId) {
      throw new HttpError(400, "nodeId is required.");
    }

    const node = await updatePacsNode(nodeId, asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ node });
  })
);

pacsRouter.delete(
  "/nodes/:nodeId",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { nodeId?: string } };
    const nodeId = asOptionalString(request.params?.nodeId);

    if (!nodeId) {
      throw new HttpError(400, "nodeId is required.");
    }

    const result = await deletePacsNode(nodeId, request.user.sub as UserId);
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// Test connection (supervisor only – uses node ID or ad-hoc params)
// ---------------------------------------------------------------------------

pacsRouter.post(
  "/test",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    const nodeId = asOptionalUserId(body.nodeId);

    const overrides: UnknownRecord = {};

    if (nodeId) {
      const { getPacsNode } = await import("../services/pacs-node-service.js");
      const node = await getPacsNode(nodeId);
      overrides.enabled = "enabled";
      overrides.host = node.host;
      overrides.port = node.port;
      overrides.calledAeTitle = node.called_ae_title;
      overrides.callingAeTitle = node.calling_ae_title;
      overrides.timeoutSeconds = node.timeout_seconds;
    } else if (body.host) {
      overrides.host = body.host;
      overrides.port = body.port;
      overrides.calledAeTitle = body.calledAeTitle;
      overrides.callingAeTitle = body.callingAeTitle;
      overrides.timeoutSeconds = body.timeoutSeconds;
    }

    await testPacsConnection({ currentUserId: request.user.sub as UserId, overrides });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Advanced search (any authenticated user, no supervisor re-auth)
// ---------------------------------------------------------------------------

pacsRouter.post(
  "/search",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    const nodeId = asOptionalUserId(body.nodeId);

    // Build search criteria
    const criteria: Record<string, unknown> = {};

    const patientNationalId = String(asOptionalString(body.patientNationalId) || "").replace(/\D/g, "");
    const patientName = asOptionalString(body.patientName);
    const accessionNumber = asOptionalString(body.accessionNumber);
    const studyDate = asOptionalString(body.studyDate);
    const modality = asOptionalString(body.modality);

    if (patientNationalId) {
      criteria.patientNationalId = patientNationalId;
      criteria.patientId = patientNationalId;
    }

    if (patientName) {
      criteria.patientName = patientName;
    }

    if (accessionNumber) {
      criteria.accessionNumber = accessionNumber;
    }

    if (studyDate) {
      criteria.studyDate = studyDate;
    }

    if (modality) {
      criteria.modality = modality;
    }

    // Require at least one search field
    if (Object.keys(criteria).length === 0) {
      throw new HttpError(400, "At least one search field is required (national ID, patient name, accession number, study date, or modality).");
    }

    // If nodeId provided, use that node; otherwise use default
    if (nodeId) {
      const { getPacsNode } = await import("../services/pacs-node-service.js");
      const node = await getPacsNode(nodeId);

      if (!node) {
        throw new HttpError(404, "PACS node not found.");
      }

      const { searchPacsStudiesWithNode } = await import("../services/pacs-service.js");
      const studies = await searchPacsStudiesWithNode({
        criteria,
        node,
        currentUserId: request.user.sub as UserId
      });

      res.json({ studies, node: { id: node.id, name: node.name } });
    } else {
      const { resolveDefaultPacsNodeForSearch, searchPacsStudiesWithNode } = await import("../services/pacs-service.js");
      const defaultNode = await resolveDefaultPacsNodeForSearch();
      const studies = await searchPacsStudiesWithNode({
        criteria,
        node: defaultNode,
        currentUserId: request.user.sub as UserId
      });

      res.json({ studies, node: { id: defaultNode.id, name: defaultNode.name } });
    }
  })
);

// ---------------------------------------------------------------------------
// Internal DICOM remap/send tool (authenticated users, backend-orchestrated)
// ---------------------------------------------------------------------------

pacsRouter.post(
  "/remap/jobs/process-multipart",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const staged = await stageDicomRemapMultipartFiles(req);
    const confirm = validateExplicitConfirm(staged.confirm);
    if (!confirm) {
      throw new HttpError(400, "Explicit confirmation is required.");
    }
    if (!staged.risproPatientId) {
      throw new HttpError(400, "risproPatientId is required.");
    }
    if (!staged.destinationPacsKey) {
      throw new HttpError(400, "destinationPacsKey is required.");
    }

    const result = await processDicomRemapMultipartJob({
      files: staged.files,
      tempDir: staged.tempDir,
      selectedStudyInstanceUID: staged.selectedStudyInstanceUID,
      risproPatientId: staged.risproPatientId,
      destinationPacsKey: staged.destinationPacsKey,
      currentUserId,
    });

    res.status(201).json(result);
  })
);

pacsRouter.post(
  "/remap/jobs/upload-multipart",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const staged = await stageDicomRemapMultipartFiles(req);

    const result = await createDicomRemapMultipartUploadJob({
      files: staged.files,
      tempDir: staged.tempDir,
      selectedStudyInstanceUID: staged.selectedStudyInstanceUID,
      currentUserId,
    });

    res.status(201).json(result);
  })
);

pacsRouter.post(
  "/remap/jobs/upload",
  ...authMiddleware,
  express.json({ limit: "500mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const files = validateDicomRemapUploadFilesInput(body.files);
    const selectedStudyInstanceUID = asOptionalString(body.selectedStudyInstanceUID);

    const result = await createDicomRemapUploadJob({
      files,
      selectedStudyInstanceUID,
      currentUserId,
    });

    res.status(201).json(result);
  })
);

pacsRouter.get(
  "/remap/jobs",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; query?: UnknownRecord };
    const query = asUnknownRecord(request.query ?? {});
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const limit = asOptionalString(query.limit);
    const jobs = await listMyDicomRemapJobs({
      currentUserId,
      limit: limit ? Number(limit) : 20,
    });
    res.json({ jobs });
  })
);

pacsRouter.get(
  "/remap/jobs/:jobId",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }
    const result = await getDicomRemapJob({ jobId, currentUserId });
    res.json(result);
  })
);

pacsRouter.get(
  "/remap/destinations",
  ...authMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    const destinations = await listDicomRemapDestinations();
    res.json({ destinations });
  })
);

pacsRouter.post(
  "/remap/replacement-preview",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const body = asUnknownRecord(request.body ?? {});
    const risproPatientId = asOptionalString(body.risproPatientId);
    if (!risproPatientId) {
      throw new HttpError(400, "risproPatientId is required.");
    }
    const replacement = await getDicomRemapReplacementPreview({ risproPatientId });
    res.json({ replacement });
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/prepare",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    // Legacy V1 compatibility path. The guided wizard now uses /remap/jobs/process-multipart.
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }
    const body = asUnknownRecord(request.body ?? {});
    const risproPatientId = asOptionalString(body.risproPatientId);
    const destinationPacsKey = asOptionalString(body.destinationPacsKey);

    if (!risproPatientId) {
      throw new HttpError(400, "risproPatientId is required.");
    }
    if (!destinationPacsKey) {
      throw new HttpError(400, "destinationPacsKey is required.");
    }

    const result = await prepareDicomRemapConfirmation({
      jobId,
      risproPatientId,
      destinationPacsKey,
      currentUserId,
    });

    res.json(result);
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/cancel",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }
    const body = asUnknownRecord(request.body ?? {});
    const result = await cancelDicomRemapJob({
      jobId,
      currentUserId,
      reason: body.reason,
    });
    res.json(result);
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/reset",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }

    const result = await resetDicomRemapJob({ jobId, currentUserId });
    res.json(result);
  })
);

pacsRouter.post(
  "/remap/maintenance/clear-failed-studies",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const summary = await clearFailedDicomRemapOrthancStudies(currentUserId);
    res.json({ summary });
  })
);

pacsRouter.post(
  "/remap/maintenance/hard-reset-orthanc",
  ...supervisorMiddleware,
  express.json({ limit: "1mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const body = asUnknownRecord(request.body ?? {});
    const summary = await hardResetOrthancStudies(currentUserId, body.confirmation);
    res.json({ summary });
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/resend",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }

    const result = await resendDicomRemapJobToPacs({
      jobId,
      currentUserId,
    });

    res.json(result);
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/confirm-send",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    // Legacy V1 compatibility path. The guided wizard now uses /remap/jobs/process-multipart.
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }
    const body = asUnknownRecord(request.body ?? {});
    const confirm = validateExplicitConfirm(body.confirm);
    const result = await confirmDicomRemapAndSend({
      jobId,
      confirm,
      currentUserId,
    });
    res.json(result);
  })
);
