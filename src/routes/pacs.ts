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
import { asOptionalString } from "../utils/request-coercion.js";
import { HttpError } from "../utils/http-error.js";
import {
  listPacsNodes,
  createPacsNode,
  updatePacsNode,
  deletePacsNode
} from "../services/pacs-node-service.js";
import {
  deleteOrthancRemoteModality,
  listOrthancPacsTargets,
  listOrthancRemoteModalities,
  searchOrthancPacsStudies,
  testOrthancPacsTarget,
  upsertOrthancRemoteModality,
} from "../services/orthanc-pacs-service.js";
import {
  listPacsAutoCompletionSettings,
  listPacsAutoCompletionTargets,
  testPacsAutoCompletionForModality,
  upsertPacsAutoCompletionSetting,
} from "../services/appointments-v2-pacs-auto-completion-worker.js";
import {
  assertDicomRemapRouteAccess,
  cancelDicomRemapJob,
  clearFailedDicomRemapOrthancStudies,
  cleanupDicomRemapUploadTempDir,
  confirmDicomRemapAndSend,
  createDicomRemapMultipartUploadJob,
  processDicomRemapMultipartJob,
  createDicomRemapUploadJob,
  DICOM_REMAP_PREVIEW_HEADER_BYTES,
  previewDicomRemapMultipartUpload,
  type DicomRemapStagedUploadFile,
  type DicomRemapPreviewFileMetadata,
  type DicomRemapPreviewStagedFile,
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

async function stageDicomRemapPreviewMultipartFiles(req: Request): Promise<{
  files: DicomRemapPreviewStagedFile[];
  tempDir: string;
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "rispro-dicom-preview-"));
  const files: DicomRemapPreviewStagedFile[] = [];
  let metadata: DicomRemapPreviewFileMetadata[] = [];
  const writes: Promise<void>[] = [];
  let fileIndex = 0;

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
        files: 256,
        fileSize: DICOM_REMAP_PREVIEW_HEADER_BYTES,
      },
    });

    const interruptUpload = () => {
      if (settled || uploadFinished) return;
      const error = new HttpError(400, "DICOM remap preview upload was interrupted. Please rescan.");
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

      const previewIndex = fileIndex;
      fileIndex += 1;
      const stagedPath = path.join(tempDir, `${previewIndex}-${randomUUID()}.dcm`);
      const writeStream = createWriteStream(stagedPath);
      let size = 0;
      let truncated = false;

      file.on("data", (chunk: Buffer) => {
        size += chunk.length;
      });
      file.on("limit", () => {
        truncated = true;
      });
      file.on("error", fail);
      writeStream.on("error", fail);
      file.pipe(writeStream);

      writes.push(new Promise<void>((resolveWrite, rejectWrite) => {
        writeStream.on("finish", () => {
          if (truncated) {
            rejectWrite(new HttpError(413, "DICOM preview files must contain only bounded header slices."));
            return;
          }
          const meta = metadata[previewIndex] || {};
          const originalName = path.basename(String(meta.fileName || info.filename || "dicom.dcm"));
          const originalPath = String(meta.filePath || originalName).trim() || originalName;
          const originalSize = Number(meta.fileSize || size);
          files.push({
            previewIndex,
            fileName: originalName,
            originalFileName: originalName,
            originalFilePath: originalPath,
            originalFileSize: Number.isFinite(originalSize) && originalSize > 0 ? originalSize : size,
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
      if (fieldName !== "fileMetadata") return;
      try {
        const parsed = JSON.parse(String(value || "[]")) as unknown;
        metadata = Array.isArray(parsed) ? parsed as DicomRemapPreviewFileMetadata[] : [];
      } catch {
        metadata = [];
      }
    });

    busboy.on("error", fail);
    busboy.on("filesLimit", () => fail(new HttpError(413, "Too many files in DICOM preview upload.")));
    busboy.on("finish", () => {
      uploadFinished = true;
      Promise.all(writes)
        .then(() => {
          if (settled) return;
          if (files.length === 0) {
            fail(new HttpError(400, "At least one DICOM preview file is required."));
            return;
          }
          settled = true;
          resolve({ files: files.sort((a, b) => a.previewIndex - b.previewIndex), tempDir });
        })
        .catch(fail);
    });

    req.pipe(busboy);
  });
}

export const __pacsRouteTestables = {
  stageDicomRemapMultipartFiles,
  stageDicomRemapPreviewMultipartFiles,
};

// ---------------------------------------------------------------------------
// Orthanc-backed V2 PACS auto-completion settings
// ---------------------------------------------------------------------------

pacsRouter.get(
  "/orthanc-verification-targets",
  ...authMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    res.json(await listPacsAutoCompletionTargets());
  })
);

pacsRouter.get(
  "/auto-completion-settings",
  ...supervisorMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await listPacsAutoCompletionSettings();
    res.json({ settings });
  })
);

pacsRouter.put(
  "/auto-completion-settings/:modalityId",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { modalityId?: string } };
    const modalityId = asOptionalString(request.params?.modalityId);
    if (!modalityId) {
      throw new HttpError(400, "modalityId is required.");
    }
    const setting = await upsertPacsAutoCompletionSetting(
      modalityId,
      asUnknownRecord(request.body ?? {}),
      request.user.sub as UserId
    );
    res.json({ setting });
  })
);

pacsRouter.post(
  "/auto-completion-settings/:modalityId/test",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; params?: { modalityId?: string } };
    const modalityId = asOptionalString(request.params?.modalityId);
    if (!modalityId) {
      throw new HttpError(400, "modalityId is required.");
    }
    const body = asUnknownRecord(request.body ?? {});
    const result = await testPacsAutoCompletionForModality({
      modalityId,
      bookingId: asOptionalString(body.bookingId),
    });
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// PACS Node CRUD (supervisor only)
// ---------------------------------------------------------------------------

pacsRouter.get(
  "/nodes/available",
  ...authMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    const { targets } = await listOrthancPacsTargets();
    res.json({
      deprecated: true,
      replacement: "/api/pacs/orthanc-targets",
      nodes: targets.map((target) => ({
        id: target.key,
        key: target.key,
        name: target.name,
        is_active: true,
        is_default: target.isDefault,
        orthanc_target_type: target.type
      }))
    });
  })
);

pacsRouter.get(
  "/orthanc-targets",
  ...authMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    res.json(await listOrthancPacsTargets());
  })
);

pacsRouter.get(
  "/orthanc-modalities",
  ...supervisorMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    res.json(await listOrthancRemoteModalities());
  })
);

pacsRouter.put(
  "/orthanc-modalities/:key",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { key?: string } };
    const key = asOptionalString(request.params?.key);
    if (!key) {
      throw new HttpError(400, "Orthanc modality key is required.");
    }
    const result = await upsertOrthancRemoteModality({
      key,
      payload: asUnknownRecord(request.body ?? {}),
      currentUserId: request.user.sub as UserId,
    });
    res.json(result);
  })
);

pacsRouter.delete(
  "/orthanc-modalities/:key",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { key?: string } };
    const key = asOptionalString(request.params?.key);
    if (!key) {
      throw new HttpError(400, "Orthanc modality key is required.");
    }
    res.json(await deleteOrthancRemoteModality({ key, currentUserId: request.user.sub as UserId }));
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
    const result = await testOrthancPacsTarget({
      targetKey: asOptionalString(body.targetKey) || asOptionalString(body.nodeId) || "local",
      currentUserId: request.user.sub as UserId,
    });
    res.json(result);
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
    const targetKey = asOptionalString(body.targetKey) || asOptionalString(body.nodeId) || "local";

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

    const result = await searchOrthancPacsStudies({
      criteria,
      targetKey,
      currentUserId: request.user.sub as UserId
    });

    res.json({
      studies: result.studies,
      target: result.target,
      node: { id: result.target.key, name: result.target.name }
    });
  })
);

// ---------------------------------------------------------------------------
// Internal DICOM remap/send tool (authenticated users, backend-orchestrated)
// ---------------------------------------------------------------------------

pacsRouter.post(
  "/remap/preview-multipart",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const staged = await stageDicomRemapPreviewMultipartFiles(req);
    // Preview is informational only: final /process-multipart remains authoritative
    // for study identity checks, patient replacement, Orthanc ingest, and PACS send.
    const result = await previewDicomRemapMultipartUpload({
      files: staged.files,
      tempDir: staged.tempDir,
    });

    res.json(result);
  })
);

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
