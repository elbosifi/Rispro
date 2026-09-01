import express, { type NextFunction, Request, Response } from "express";
import Busboy from "busboy";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireAuth, requireSupervisor, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { requirePageAccess } from "../middleware/page-access.js";
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
import { synchronizeAuthoritativeOrthancCdRobots } from "../services/authoritative-orthanc-service.js";
import { readClinicalDocumentExportSettings, saveClinicalDocumentExportSettings } from "../services/clinical-document-export-settings-service.js";
import { readDicomRemapRetentionSettings, saveDicomRemapRetentionSettings } from "../services/dicom-remap-retention-settings-service.js";
import {
  listPacsAutoCompletionSettings,
  listPacsAutoCompletionTargets,
  testPacsAutoCompletionForModality,
  upsertPacsAutoCompletionSetting,
} from "../services/appointments-v2-pacs-auto-completion-worker.js";
import {
  assertDicomRemapJobComparisonAccess,
  assertDicomRemapRouteAccess,
  cancelDicomRemapJob,
  clearFailedDicomRemapOrthancStudies,
  cleanupDicomRemapUploadTempDir,
  cleanupDicomRemapStagingStorage,
  confirmDicomRemapAndSend,
  confirmStagedDicomRemapJob,
  createDicomRemapMultipartUploadJob,
  createDicomRemapStagingContext,
  createDicomRemapUploadJob,
  DICOM_REMAP_PREVIEW_HEADER_BYTES,
  DICOM_REMAP_STAGING_MAX_FILES,
  failDicomRemapStagingJob,
  finalizeDicomRemapAwaitingConfirmationStagingJob,
  finalizeDicomRemapStagingJob,
  previewDicomRemapMultipartUpload,
  type DicomRemapStagedUploadFile,
  type DicomRemapPreviewFileMetadata,
  type DicomRemapPreviewStagedFile,
  getDicomRemapJob,
  getMyActiveDicomRemapJob,
  getDicomRemapReplacementPreview,
  hardResetOrthancStudies,
  listDicomRemapDestinations,
  listDicomRemapJobs,
  prepareDicomRemapSourceRecovery,
  prepareDicomRemapConfirmation,
  startManualDicomRemapOrthancRecovery,
  resendDicomRemapJobToPacs,
  resetDicomRemapJob,
  validateDicomRemapUploadFilesInput,
  validateExplicitConfirm,
  writeDicomRemapStagedFile,
} from "../services/dicom-remap-service.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";
import { canRoleAccessPage, readPageVisibilityMatrix } from "../services/page-visibility-settings-service.js";
import { findComparisonRequestById } from "../services/comparison-request-service.js";
import { searchPatients } from "../services/patient-service.js";

const supervisorMiddleware = [requireAuth, requireSupervisor, requireRecentSupervisorReauth];
const authMiddleware = [requireAuth];

export const pacsRouter = express.Router();

const COMPARISON_REMAP_ROLES = new Set(["receptionist", "modality_staff", "doctor", "supervisor", "super_admin"]);
const REMAP_PATIENT_SEARCH_MAX_LENGTH = 200;
const REMAP_PATIENT_SEARCH_RESULT_LIMIT = 25;

type ComparisonRemapScope = { comparisonRequestId: number; patientId: number };

async function requirePacsRemapAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, "Authentication required.");
    const matrix = await readPageVisibilityMatrix();
    const hasGeneralRemapAccess = canRoleAccessPage("pacs.remap", req.user.role, matrix);
    const comparisonRequestId = asOptionalString(asUnknownRecord(req.query).comparisonRequestId);
    if (!comparisonRequestId) {
      if (hasGeneralRemapAccess) {
        next();
        return;
      }
      throw new HttpError(403, "This role cannot access this page.");
    }
    if (!COMPARISON_REMAP_ROLES.has(req.user.role)) throw new HttpError(403, "This role cannot prepare comparison images.");
    const comparisonRequest = await findComparisonRequestById(comparisonRequestId);
    if (!comparisonRequest) throw new HttpError(404, "Comparison request not found.");
    if (comparisonRequest.status !== "pending_upload_confirmation") {
      throw new HttpError(409, "Only pending comparison requests can use DICOM remap.");
    }
    res.locals.comparisonRemapScope = {
      comparisonRequestId: comparisonRequest.id,
      patientId: comparisonRequest.patientId,
    } satisfies ComparisonRemapScope;
    next();
  } catch (error) {
    next(error);
  }
}

function normalizeRemapPatientSearch(value: unknown): string {
  const search = String(value || "").trim();
  if (search.length < 2) {
    throw new HttpError(400, "q must contain at least 2 characters.");
  }
  if (search.length > REMAP_PATIENT_SEARCH_MAX_LENGTH) {
    throw new HttpError(400, `q must not exceed ${REMAP_PATIENT_SEARCH_MAX_LENGTH} characters.`);
  }
  return search;
}

function toRemapPatientSearchPatients(patients: Awaited<ReturnType<typeof searchPatients>>) {
  return patients.slice(0, REMAP_PATIENT_SEARCH_RESULT_LIMIT).map((patient) => ({
    id: patient.id,
    arabic_full_name: patient.arabic_full_name,
    english_full_name: patient.english_full_name,
    national_id: patient.national_id,
    mrn: patient.mrn,
    sex: patient.sex,
    date_of_birth: patient.estimated_date_of_birth,
  }));
}

pacsRouter.use("/remap", requireAuth, requirePacsRemapAccess);
pacsRouter.use("/remap", async function requireComparisonRemapScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = res.locals.comparisonRemapScope as ComparisonRemapScope | undefined;
    if (!scope) {
      next();
      return;
    }
    const pathname = new URL(req.originalUrl, "http://rispro.local").pathname;
    const remapIndex = pathname.indexOf("/remap");
    const scopedPath = remapIndex >= 0 ? pathname.slice(remapIndex + "/remap".length) : req.path;
    const isCreationOrPreview = req.method === "POST" && [
      "/preview-multipart",
      "/jobs/stage-multipart",
      "/jobs/process-multipart",
    ].includes(scopedPath);
    if (isCreationOrPreview || (req.method === "GET" && scopedPath === "/destinations")) {
      next();
      return;
    }
    if (req.method === "POST" && scopedPath === "/replacement-preview") {
      const patientId = Number(asOptionalString(asUnknownRecord(req.body ?? {}).risproPatientId));
      if (patientId !== scope.patientId) {
        throw new HttpError(403, "Replacement patient must match the comparison request.");
      }
      next();
      return;
    }
    const jobMatch = scopedPath.match(/^\/jobs\/(\d+)(?:\/|$)/);
    if (jobMatch?.[1] && req.user) {
      await assertDicomRemapJobComparisonAccess(
        jobMatch[1],
        req.user.sub as UserId,
        scope.comparisonRequestId
      );
      next();
      return;
    }
    throw new HttpError(403, "Comparison-linked remap access is limited to this request.");
  } catch (error) {
    next(error);
  }
});

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
        files: DICOM_REMAP_STAGING_MAX_FILES,
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
    busboy.on("filesLimit", () => fail(new HttpError(413, "Too many files in DICOM upload.", { code: "DICOM_REMAP_STAGING_FILE_LIMIT" })));
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

function dicomRemapStagingFailureCode(error: unknown): string {
  const code = String((error as { details?: { code?: unknown } } | null)?.details?.code || "");
  if ([
    "DICOM_REMAP_STAGING_INTERRUPTED",
    "DICOM_REMAP_STAGING_FILE_LIMIT",
    "DICOM_REMAP_STAGING_SIZE_LIMIT",
    "DICOM_REMAP_STAGING_MANIFEST_FAILED",
  ].includes(code)) return code;
  return "DICOM_REMAP_STAGING_WRITE_FAILED";
}

type DicomRemapStagingFailureDependencies = {
  persistFailure?: typeof failDicomRemapStagingJob;
  logPersistenceFailure?: (details: { type: string; jobId: number; databaseCode: string }) => void;
};

async function recordDicomRemapStagingFailureSafely(
  jobId: number,
  error: unknown,
  dependencies: DicomRemapStagingFailureDependencies = {}
): Promise<void> {
  try {
    await (dependencies.persistFailure ?? failDicomRemapStagingJob)(jobId, dicomRemapStagingFailureCode(error));
  } catch (persistenceError) {
    const databaseCode = String((persistenceError as { code?: unknown } | null)?.code || "unknown");
    try {
      (dependencies.logPersistenceFailure ?? ((details) => console.warn(JSON.stringify(details))))({
        type: "dicom_remap_staging_failure_persistence_failed",
        jobId,
        databaseCode,
      });
    } catch {
      // Logging a secondary persistence failure must never affect the request.
    }
  }
}

async function stageDicomRemapMultipartDurably(req: Request, context: Awaited<ReturnType<typeof createDicomRemapStagingContext>>, failureDependencies: DicomRemapStagingFailureDependencies = {}): Promise<{
  files: Awaited<ReturnType<typeof writeDicomRemapStagedFile>>[];
  selectedStudyInstanceUID: string | null;
  uploadMode: string | null;
  risproPatientId: string | null;
  destinationPacsKey: string | null;
  confirm: string | null;
  provisionalSourceIdentity: unknown;
  confirmSource: string | null;
}> {
  const files: Awaited<ReturnType<typeof writeDicomRemapStagedFile>>[] = [];
  let selectedStudyInstanceUID: string | null = null;
  let uploadMode: string | null = null;
  let risproPatientId: string | null = null;
  let destinationPacsKey: string | null = null;
  let confirm: string | null = null;
  let provisionalSourceIdentity: unknown = null;
  let confirmSource: string | null = null;
  const writes: Promise<void>[] = [];
  return new Promise((resolve, reject) => {
    let settled = false;
    let uploadFinished = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      req.unpipe(busboy);
      busboy.destroy(error instanceof Error ? error : new Error("DICOM remap staging failed."));
      void recordDicomRemapStagingFailureSafely(context.job.id, error, failureDependencies).then(() => reject(error));
    };
    const busboy = Busboy({ headers: req.headers, limits: { files: DICOM_REMAP_STAGING_MAX_FILES } });
    const interruptUpload = () => {
      if (settled || uploadFinished) return;
      fail(new HttpError(400, "DICOM remap upload was interrupted. Please start a new upload.", { code: "DICOM_REMAP_STAGING_INTERRUPTED" }));
    };
    req.on("aborted", interruptUpload);
    req.on("close", () => {
      const requestComplete = Boolean((req as Request & { complete?: boolean }).complete);
      if (!requestComplete && !uploadFinished) interruptUpload();
    });
    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "files") {
        file.resume();
        return;
      }
      const fileIndex = writes.length;
      writes.push(writeDicomRemapStagedFile({ context, fileIndex, fileName: String(info.filename || "dicom.dcm"), mimeType: info.mimeType, stream: file })
        .then((staged) => { files.push(staged); })
        .catch(fail));
    });
    busboy.on("field", (fieldName, value) => {
      const clean = String(value || "").trim() || null;
      if (fieldName === "selectedStudyInstanceUID") selectedStudyInstanceUID = clean;
      if (fieldName === "uploadMode") uploadMode = clean;
      if (fieldName === "risproPatientId") risproPatientId = clean;
      if (fieldName === "destinationPacsKey") destinationPacsKey = clean;
      if (fieldName === "confirm") confirm = clean;
      if (fieldName === "confirmSource") confirmSource = clean;
      if (fieldName === "provisionalSourceIdentity") {
        try {
          provisionalSourceIdentity = JSON.parse(String(value || "null")) as unknown;
        } catch {
          provisionalSourceIdentity = null;
        }
      }
    });
    busboy.on("error", fail);
    busboy.on("filesLimit", () => fail(new HttpError(413, "Too many files in DICOM upload.", { code: "DICOM_REMAP_STAGING_FILE_LIMIT" })));
    busboy.on("finish", () => {
      uploadFinished = true;
      Promise.all(writes).then(() => {
        if (settled) return;
        settled = true;
        resolve({
          files: files.sort((a, b) => a.id.localeCompare(b.id)),
          selectedStudyInstanceUID,
          uploadMode,
          risproPatientId,
          destinationPacsKey,
          confirm,
          provisionalSourceIdentity,
          confirmSource,
        });
      }).catch(fail);
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
  stageDicomRemapMultipartDurably,
  normalizeRemapPatientSearch,
  toRemapPatientSearchPatients,
};

// ---------------------------------------------------------------------------
// Orthanc-backed V2 PACS auto-completion settings
// ---------------------------------------------------------------------------

pacsRouter.get(
  "/clinical-document-export",
  ...supervisorMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    res.json({ settings: await readClinicalDocumentExportSettings() });
  })
);

pacsRouter.put(
  "/clinical-document-export",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean.");
    const settings = await saveClinicalDocumentExportSettings({ enabled: body.enabled, destinationKey: asOptionalString(body.destinationKey) || "" }, request.user.sub as UserId);
    res.json({ settings });
  })
);

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
  requirePageAccess("pacs"),
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
    await synchronizeAuthoritativeOrthancCdRobots();
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
    const result = await deleteOrthancRemoteModality({ key, currentUserId: request.user.sub as UserId });
    await synchronizeAuthoritativeOrthancCdRobots();
    res.json(result);
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
  requirePageAccess("pacs"),
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

pacsRouter.get(
  "/remap/patient-search",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const search = normalizeRemapPatientSearch(asUnknownRecord(req.query).q);
    const patients = await searchPatients(search);
    res.json({ patients: toRemapPatientSearchPatients(patients) });
  })
);

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
  "/remap/jobs/stage-multipart",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const context = await createDicomRemapStagingContext(
      currentUserId,
      asOptionalString(asUnknownRecord(req.query).comparisonRequestId)
    );
    try {
      const staged = await stageDicomRemapMultipartDurably(req, context);
      const result = await finalizeDicomRemapAwaitingConfirmationStagingJob({
        context,
        files: staged.files,
        selectedStudyInstanceUID: staged.selectedStudyInstanceUID,
        provisionalSourceIdentity: staged.provisionalSourceIdentity,
        confirmSource: staged.confirmSource,
      });
      res.status(202).json(result);
    } catch (error) {
      await recordDicomRemapStagingFailureSafely(context.job.id, error);
      await cleanupDicomRemapStagingStorage(context.storageKey).catch(() => undefined);
      throw error;
    }
  })
);

pacsRouter.post(
  "/remap/jobs/process-multipart",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const context = await createDicomRemapStagingContext(
      currentUserId,
      asOptionalString(asUnknownRecord(req.query).comparisonRequestId)
    );
    try {
      const staged = await stageDicomRemapMultipartDurably(req, context);
      const result = await finalizeDicomRemapStagingJob({ context, ...staged });
      res.status(202).json(result);
    } catch (error) {
      await recordDicomRemapStagingFailureSafely(context.job.id, error);
      await cleanupDicomRemapStagingStorage(context.storageKey).catch(() => undefined);
      throw error;
    }
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/confirm-staged",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) throw new HttpError(400, "jobId is required.");
    const body = asUnknownRecord(request.body ?? {});
    const result = await confirmStagedDicomRemapJob({
      jobId,
      selectedStudyInstanceUID: body.selectedStudyInstanceUID,
      risproPatientId: asOptionalString(body.risproPatientId) || "",
      destinationPacsKey: body.destinationPacsKey,
      confirm: validateExplicitConfirm(body.confirm),
      currentUserId,
    });
    res.status(202).json(result);
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
    const scope = asOptionalString(query.scope) || "mine";
    if (scope !== "mine" && scope !== "all") {
      throw new HttpError(400, "scope must be mine or all.");
    }
    const jobs = await listDicomRemapJobs({
      currentUserId,
      limit: limit ? Number(limit) : 20,
      scope,
    });
    res.json({ jobs });
  })
);

pacsRouter.get(
  "/remap/jobs/active",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    res.json(await getMyActiveDicomRemapJob({ currentUserId }));
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
    const result = await getDicomRemapJob({ jobId });
    res.json(result);
  })
);

pacsRouter.get(
  "/dicom-remap-retention",
  ...supervisorMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    res.json({ settings: await readDicomRemapRetentionSettings() });
  })
);

pacsRouter.put(
  "/dicom-remap-retention",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    const settings = await saveDicomRemapRetentionSettings({ sentSourceRetentionDays: body.sentSourceRetentionDays as number }, request.user.sub as UserId);
    res.json({ settings });
  })
);

pacsRouter.get(
  "/remap/jobs/:jobId/recover-source",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) throw new HttpError(400, "jobId is required.");

    const recovery = await prepareDicomRemapSourceRecovery({ jobId, currentUserId });
    res.status(200);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="dicom-remap-source-job-${recovery.jobId}.zip"`);
    const streaming = recovery.streamTo(res);
    void streaming.completed.catch((error) => {
      if (!res.destroyed) res.destroy(error);
    });
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
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }

    const result = await resendDicomRemapJobToPacs({
      jobId,
      currentUserId,
      confirmDestinationChecked: validateExplicitConfirm(asUnknownRecord(request.body ?? {}).confirmDestinationChecked),
    });

    res.status(202).json(result);
  })
);

pacsRouter.post(
  "/remap/jobs/:jobId/retry-with-orthanc",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { jobId?: string } };
    const currentUserId = await assertDicomRemapRouteAccess(request.user.sub as UserId);
    const jobId = asOptionalString(request.params?.jobId);
    if (!jobId) {
      throw new HttpError(400, "jobId is required.");
    }

    const result = await startManualDicomRemapOrthancRecovery({ jobId, currentUserId });
    res.status(202).json(result);
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
      confirmIncompleteStudy: validateExplicitConfirm(body.confirmIncompleteStudy),
      currentUserId,
    });
    res.json(result);
  })
);
