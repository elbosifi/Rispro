/*
 * LEGACY APPOINTMENTS / SCHEDULING MODULE
 * This file belongs to the legacy scheduling system.
 * Do not add new scheduling features here.
 * New scheduling and booking work must go into Appointments V2.
 * Legacy code may only receive:
 * - critical bug containment
 * - temporary compatibility fixes explicitly requested
 * - reference-only maintenance
 */

import express, { Request, Response } from "express";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asBooleanFlag, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { getSettingsByCategory, listSettingsCatalog, upsertSettings } from "../services/settings-service.js";
import {
  createExamType,
  createModality,
  deleteExamType,
  deactivateModality,
  hardDeleteModality,
  hardDeleteExamType,
  listExamTypesForSettings,
  listModalitiesForSettings,
  updateExamType,
  updateModality
} from "../services/catalog-service.js";
import {
  createDicomDevice,
  deleteDicomDevice,
  listDicomDevices,
  updateDicomDevice
} from "../services/dicom-service.js";
import {
  deleteNameDictionaryEntry,
  listNameDictionary,
  updateNameDictionaryEntry,
  upsertNameDictionary
} from "../services/name-dictionary-service.js";
import {
  getSchedulingEngineConfiguration,
  saveSchedulingEngineConfiguration
} from "../services/scheduling-settings-service.js";
import {
  parseWorkbookBase64,
  createImportBatchFromParsedRows,
  listImportBatch,
  listImportRows,
  updateRowSelection,
  confirmBatchMigration
} from "../services/patient-import-service.js";
import {
  normalizeOrthancSettingsEntries,
  validateOrthancSettingsEntries
} from "../services/orthanc-settings-resolver.js";
import { SANTE_HL7_CATEGORY, validateSanteSettingsEntries } from "../services/sante-worklist-settings-resolver.js";
import {
  applyCatalogImport,
  exportCatalogWorkbook,
  importCatalogWorkbook,
  previewCatalogWorkbook
} from "../services/settings-catalog-import-export-service.js";
import { testSonicDicomSqlReadiness } from "../services/sonicdicom-report-service.js";
import { readPageVisibilityMatrix, savePageVisibilityMatrix } from "../services/page-visibility-settings-service.js";
import { ensurePatientWebPushConfig } from "../services/patient-web-push-service.js";
import { readPatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";

interface SettingsRequest {
  query?: { includeInactive?: string };
  user: AuthenticatedUserContext;
  body?: unknown;
  params?: {
    category?: string;
    entryId?: string;
    modalityId?: string;
    examTypeId?: string;
    deviceId?: string;
    batchId?: string;
  };
}

export const settingsRouter = express.Router();

// Name-dictionary routes: only require auth, not supervisor re-auth
settingsRouter.use(requireAuth);

settingsRouter.get(
  "/name-dictionary",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const entries = await listNameDictionary({ includeInactive });
    res.json({ entries });
  })
);

settingsRouter.post(
  "/name-dictionary",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const entry = await upsertNameDictionary(request.body ?? undefined, request.user.sub as UserId);
    res.status(201).json({ entry });
  })
);

settingsRouter.put(
  "/name-dictionary/:entryId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const entry = await updateNameDictionaryEntry(asString(request.params?.entryId), request.body ?? undefined, request.user.sub as UserId);
    res.json({ entry });
  })
);

settingsRouter.delete(
  "/name-dictionary/:entryId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const entry = await deleteNameDictionaryEntry(asString(request.params?.entryId), request.user.sub as UserId);
    res.json({ entry });
  })
);

// Printing flows must read these settings without supervisor re-auth.
// Writes remain protected by the supervisor middleware below.
settingsRouter.get(
  "/appointment_slip",
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await getSettingsByCategory("appointment_slip");
    res.json({ settings });
  })
);

settingsRouter.get(
  "/patient_qr_self_service",
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await getSettingsByCategory("patient_qr_self_service");
    res.json({ settings });
  })
);

settingsRouter.get(
  "/users-and-roles/page-visibility",
  asyncRoute(async (_req: Request, res: Response) => {
    const matrix = await readPageVisibilityMatrix();
    res.json({ matrix });
  })
);

// Supervisor-only settings
settingsRouter.use(requireAuth, requireSupervisor, requireRecentSupervisorReauth);
settingsRouter.use("/patient-import", express.json({ limit: "25mb" }));

settingsRouter.put(
  "/users-and-roles/page-visibility",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    if (request.user.role !== "super_admin") {
      res.status(403).json({ message: "Only super_admin can update page visibility." });
      return;
    }

    const body = asUnknownRecord(request.body ?? {});
    const matrix = await savePageVisibilityMatrix(body.matrix, request.user.sub as UserId);
    res.json({ matrix });
  })
);

settingsRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const settings = await listSettingsCatalog();
    res.json({ settings });
  })
);

settingsRouter.post(
  "/patient-web-push/ensure-config",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const settings = await readPatientQrSettings();
    const config = await ensurePatientWebPushConfig({
      updatedByUserId: request.user.sub as UserId,
      settings,
    });
    res.json({
      enabled: config.enabled,
      generated: config.generated,
      source: config.source,
      publicKeyConfigured: Boolean(config.publicKey),
    });
  })
);

settingsRouter.get(
  "/modalities",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const result = await listModalitiesForSettings({ includeInactive });
    res.json(result);
  })
);

settingsRouter.post(
  "/modalities",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await createModality(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ modality });
  })
);

settingsRouter.put(
  "/modalities/:modalityId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await updateModality(asString(request.params?.modalityId), asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ modality });
  })
);

settingsRouter.delete(
  "/modalities/:modalityId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await hardDeleteModality(asString(request.params?.modalityId), request.user.sub as UserId);
    res.json({ modality });
  })
);

settingsRouter.post(
  "/modalities/:modalityId/deactivate",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const modality = await deactivateModality(asString(request.params?.modalityId), request.user.sub as UserId);
    res.json({ modality });
  })
);

settingsRouter.get(
  "/exam-types",
  asyncRoute(async (_req: Request, res: Response) => {
    const request = _req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const result = await listExamTypesForSettings({ includeInactive });
    res.json(result);
  })
);

settingsRouter.post(
  "/exam-types",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await createExamType(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ examType });
  })
);

settingsRouter.put(
  "/exam-types/:examTypeId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await updateExamType(asString(request.params?.examTypeId), asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ examType });
  })
);

settingsRouter.delete(
  "/exam-types/:examTypeId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await deleteExamType(asString(request.params?.examTypeId), request.user.sub as UserId);
    res.json({ examType });
  })
);

settingsRouter.delete(
  "/exam-types/:examTypeId/hard-delete",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const examType = await hardDeleteExamType(asString(request.params?.examTypeId), request.user.sub as UserId);
    res.json({ examType });
  })
);

settingsRouter.get(
  "/catalog-import-export.xlsx",
  asyncRoute(async (_req: Request, res: Response) => {
    const { buffer, filename } = await exportCatalogWorkbook();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    res.send(buffer);
  })
);

settingsRouter.post(
  "/catalog-import-export/preview",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body ?? {});
    const fileContentBase64 = asString(body.fileContentBase64).trim();
    const preview = await previewCatalogWorkbook(fileContentBase64);
    res.json({ preview });
  })
);

settingsRouter.post(
  "/catalog-import-export/apply",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body ?? {});
    const modalities = Array.isArray(body.modalities) ? body.modalities : [];
    const examTypes = Array.isArray(body.examTypes) ? body.examTypes : [];
    const summary = await applyCatalogImport(
      {
        modalities: modalities as never,
        examTypes: examTypes as never
      },
      request.user.sub as UserId
    );
    res.json({ summary });
  })
);

settingsRouter.post(
  "/catalog-import-export",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body ?? {});
    const fileContentBase64 = asString(body.fileContentBase64).trim();
    const summary = await importCatalogWorkbook(fileContentBase64, request.user.sub as UserId);
    res.json({ summary });
  })
);

settingsRouter.get(
  "/dicom-devices",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const includeInactive = asBooleanFlag(request.query?.includeInactive);
    const devices = await listDicomDevices({ includeInactive });
    res.json({ devices });
  })
);

settingsRouter.post(
  "/dicom-devices",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const device = await createDicomDevice(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ device });
  })
);

settingsRouter.put(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const device = await updateDicomDevice(asString(request.params?.deviceId), asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ device });
  })
);

settingsRouter.delete(
  "/dicom-devices/:deviceId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const result = await deleteDicomDevice(asString(request.params?.deviceId), request.user.sub as UserId);
    res.json(result);
  })
);

settingsRouter.get(
  "/scheduling-engine-config",
  asyncRoute(async (_req: Request, res: Response) => {
    const config = await getSchedulingEngineConfiguration();
    res.json({ config });
  })
);

settingsRouter.put(
  "/scheduling-engine-config",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const config = await saveSchedulingEngineConfiguration(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ config });
  })
);

settingsRouter.post(
  "/sonicdicom_reports/test-readiness",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body ?? {});
    const mode = asString(body.mode).trim();
    const accessionNumber = asString(body.accessionNumber).trim();
    const reportNo = asString(body.reportNo).trim();
    const selectedMode =
      mode === "sql_connection" ||
      mode === "accession_to_study" ||
      mode === "report_status" ||
      mode === "full_readiness"
        ? mode
        : "full_readiness";

    const result = await testSonicDicomSqlReadiness({
      mode: selectedMode,
      accessionNumber,
      reportNo,
    });

    res.json({
      ok: true,
      foundStudy: result.foundStudy,
      foundReport: result.foundReport,
      normalizedState: result.normalizedState,
      canViewReport: result.canViewReport,
      statusCode: result.statusCode,
      diagnostic: result.diagnostic,
    });
  })
);

settingsRouter.post(
  "/patient-import/workbook",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body ?? {});
    const fileContentBase64 = asString(body.fileContentBase64).trim();
    const selectedSheetName = asString(body.sheetName || body.selectedSheetName).trim();

    const parsed = await parseWorkbookBase64(fileContentBase64, selectedSheetName || undefined);

    res.json({
      workbook: {
        sheetNames: parsed.sheetNames,
        selectedSheetName: parsed.selectedSheetName,
        headers: parsed.headers
      }
    });
  })
);

settingsRouter.post(
  "/patient-import/preview",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const body = asUnknownRecord(request.body ?? {});
    const sourceFilename = asString(body.fileName || body.sourceFilename).trim();
    const fileContentBase64 = asString(body.fileContentBase64).trim();
    const selectedSheetName = asString(body.sheetName || body.selectedSheetName).trim();
    const patientCategory = asString(body.patientCategory).trim();
    const mapping = asUnknownRecord(body.mapping ?? {});
    const mappingArabic = asString(mapping.arabic_full_name || mapping.arabicFullName).trim();
    const mappingNationalId = asString(mapping.national_id || mapping.nationalId).trim();
    const mappingPhone = asString(mapping.phone).trim();

    const parsed = await parseWorkbookBase64(fileContentBase64, selectedSheetName || undefined);

    const { batch, summary } = await createImportBatchFromParsedRows(
      {
        sourceFilename: sourceFilename || "patient-import.xlsx",
        sourceSheetName: parsed.selectedSheetName,
        patientCategory: (patientCategory || undefined) as "oncology" | "non_oncology" | undefined,
        rows: parsed.rows,
        mapping: {
          arabic_full_name: mappingArabic,
          national_id: mappingNationalId,
          phone: mappingPhone || undefined
        }
      },
      request.user.sub as UserId
    );

    res.status(201).json({
      batch,
      summary,
      workbook: {
        sheetNames: parsed.sheetNames,
        selectedSheetName: parsed.selectedSheetName,
        headers: parsed.headers
      }
    });
  })
);

settingsRouter.get(
  "/patient-import/batches/:batchId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const batchId = Number(asString(request.params?.batchId));
    const batch = await listImportBatch(batchId);
    res.json({ batch });
  })
);

settingsRouter.get(
  "/patient-import/batches/:batchId/rows",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const batchId = Number(asString(request.params?.batchId));
    const rows = await listImportRows(batchId);
    res.json({ rows });
  })
);

settingsRouter.post(
  "/patient-import/batches/:batchId/select",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const batchId = Number(asString(request.params?.batchId));
    const body = asUnknownRecord(request.body ?? {});
    const selected = String(body.selected || "").trim() !== "false";
    const rowIdsRaw = Array.isArray(body.rowIds) ? body.rowIds : [];
    const rowIds = rowIdsRaw.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    const result = await updateRowSelection(batchId, rowIds, selected, request.user.sub as UserId);
    res.json(result);
  })
);

settingsRouter.post(
  "/patient-import/batches/:batchId/confirm",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const batchId = Number(asString(request.params?.batchId));
    const result = await confirmBatchMigration(batchId, request.user.sub as UserId);
    res.json(result);
  })
);

settingsRouter.get(
  "/:category",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const settings = await getSettingsByCategory(asString(request.params?.category));
    res.json({ settings });
  })
);

settingsRouter.put(
  "/:category",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as SettingsRequest;
    const category = asString(request.params?.category);
    const body = asUnknownRecord(request.body);
    const rawEntries = body.entries;
    let entries: Array<{ key: string; value?: unknown }> = Array.isArray(rawEntries) ? rawEntries : [];

    if (category === "orthanc_mwl_sync") {
      entries = normalizeOrthancSettingsEntries(entries);
      validateOrthancSettingsEntries(entries);
    }

    if (category === SANTE_HL7_CATEGORY) {
      validateSanteSettingsEntries(entries);
    }

    const settings = await upsertSettings(category, entries, request.user.sub as UserId);
    res.json({ settings });
  })
);
