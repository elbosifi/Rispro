import express, { Request, Response, Router } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { requireActionPin } from "../middleware/action-pin.js";
import { requirePageAccess } from "../middleware/page-access.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { pool } from "../db/pool.js";
import { UnknownRecord, AuthenticatedUserContext, UserId } from "../types/http.js";
import {
  listActivePatientIdentifierTypes,
  authorizePatientNoShowBooking,
  createPatient,
  deletePatient,
  getPatientById,
  getPatientDirectory,
  getPatientDirectorySummary,
  getPatientNoShowSummary,
  mergePatients,
  previewNextPatientMrn,
  searchPatients,
  updatePatient,
  type PatientPayload,
  type PatientRow
} from "../services/patient-service.js";
import {
  getPatientIdentityDocumentState,
  revokePatientIdentityDocumentVerification,
  verifyPatientIdentityDocument,
} from "../services/patient-identity-document-service.js";

type PatientsRequest = Request & {
  query: UnknownRecord;
  body: UnknownRecord;
  params: { patientId?: string };
  user: AuthenticatedUserContext;
};

export const patientsRouter: Router = express.Router();

patientsRouter.use(requireAuth);
patientsRouter.use(requirePageAccess("patients"));

function parseOptionalDirectoryEnum<T extends string>(value: unknown, fieldName: string, allowed: readonly T[]): T | undefined {
  if (value == null || value === "") return undefined;
  const stringValue = String(value);
  if ((allowed as readonly string[]).includes(stringValue)) return stringValue as T;
  throw new HttpError(400, `${fieldName} is invalid.`);
}

export function preparePatientUpdatePayload(
  payload: UnknownRecord,
  existingPatient: Pick<PatientRow, "arabic_full_name" | "english_full_name">
): PatientPayload {
  const { regenerateEnglishName, ...patientPayload } = payload;
  const existingArabicName = existingPatient.arabic_full_name.trim();
  const requestedArabicName = String(patientPayload.arabicFullName ?? "").trim();
  const arabicNameChanged =
    Object.prototype.hasOwnProperty.call(patientPayload, "arabicFullName") &&
    requestedArabicName !== existingArabicName;
  const explicitRegeneration = regenerateEnglishName === true;
  const existingEnglishName = existingPatient.english_full_name?.trim() ?? "";
  const requestedEnglishName = String(patientPayload.englishFullName ?? "").trim();

  if (
    Object.prototype.hasOwnProperty.call(patientPayload, "englishFullName") &&
    requestedEnglishName !== existingEnglishName &&
    !arabicNameChanged &&
    !explicitRegeneration
  ) {
    throw new HttpError(403, "English patient name is generated from the name dictionary and cannot be edited manually.");
  }

  if (arabicNameChanged || explicitRegeneration) {
    return { ...patientPayload, englishFullName: undefined, autoGenerateEnglish: true } as PatientPayload;
  }

  return { ...patientPayload, englishFullName: existingPatient.english_full_name ?? undefined, autoGenerateEnglish: false } as PatientPayload;
}

patientsRouter.get(
  "/identifier-types",
  asyncRoute(async (_req: Request, res: Response) => {
    const items = await listActivePatientIdentifierTypes();
    res.json({ items });
  })
);

patientsRouter.get(
  "/directory",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const query = request.query as UnknownRecord;
    const result = await getPatientDirectory({
      search: String(query.q ?? ""),
      category: parseOptionalDirectoryEnum(query.category, "category", ["oncology", "non_oncology"]),
      appointmentFilter: parseOptionalDirectoryEnum(query.appointmentFilter, "appointmentFilter", ["has_future", "today", "no_future"]),
      sex: parseOptionalDirectoryEnum(query.sex, "sex", ["male", "female"]),
      ageMin: query.ageMin ? Number(query.ageMin) : undefined,
      ageMax: query.ageMax ? Number(query.ageMax) : undefined,
      sortBy: parseOptionalDirectoryEnum(query.sortBy, "sortBy", ["name", "recent", "mrn"]),
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 25
    });
    res.json(result);
  })
);

patientsRouter.get(
  "/sex-values",
  asyncRoute(async (_req: Request, res: Response) => {
    const { rows } = await pool.query(`SELECT DISTINCT sex, count(*)::int as cnt FROM patients WHERE sex IS NOT NULL GROUP BY sex ORDER BY cnt DESC`);
    res.json({ sexValues: rows });
  })
);

patientsRouter.get(
  "/:patientId/directory-summary",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const summary = await getPatientDirectorySummary(patientId);
    res.json(summary);
  })
);

patientsRouter.post(
  "/merge",
  requireActionPin("patient_merge"),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const userId: UserId = request.user.sub;
    const patient = await mergePatients(request.body ?? {}, userId);
    res.json({ patient });
  })
);

patientsRouter.post(
  "/",
  requireActionPin("patient_create"),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const userId: UserId = request.user.sub;
    const payload = { ...(request.body ?? {}), englishFullName: undefined, autoGenerateEnglish: true };
    const patient = await createPatient(payload, userId);
    res.status(201).json({ patient });
  })
);

patientsRouter.get(
  "/mrn-preview",
  asyncRoute(async (_req: Request, res: Response) => {
    const mrn = await previewNextPatientMrn();
    res.json({ mrn });
  })
);

patientsRouter.get(
  "/:patientId/identity-document",
  requireAnyRole(["receptionist", "supervisor", "super_admin"]),
  asyncRoute(async (req: Request, res: Response) => {
    const patientId = Number(req.params.patientId);
    res.json(await getPatientIdentityDocumentState(patientId));
  })
);

patientsRouter.post(
  "/:patientId/identity-document/verify",
  requireAnyRole(["receptionist", "supervisor", "super_admin"]),
  asyncRoute(async (req: Request, res: Response) => {
    const patientId = Number(req.params.patientId);
    const documentId = Number(req.body?.documentId);
    res.json(await verifyPatientIdentityDocument(patientId, documentId, Number(req.user!.sub)));
  })
);

patientsRouter.post(
  "/:patientId/identity-document/revoke",
  requireAnyRole(["supervisor", "super_admin"]),
  asyncRoute(async (req: Request, res: Response) => {
    const patientId = Number(req.params.patientId);
    res.json(await revokePatientIdentityDocumentVerification(patientId, Number(req.user!.sub)));
  })
);

patientsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const query = request.query as UnknownRecord;
    const patients = await searchPatients(String(query.q ?? ""));
    res.json({ patients });
  })
);

patientsRouter.get(
  "/:patientId",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const patient = await getPatientById(patientId);
    res.json({ patient });
  })
);

patientsRouter.get(
  "/:patientId/no-show",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const summary = await getPatientNoShowSummary(patientId);
    res.json(summary);
  })
);

patientsRouter.post(
  "/:patientId/no-show/authorize-booking",
  requireAnyRole(["supervisor", "super_admin"]),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const summary = await authorizePatientNoShowBooking(patientId, request.body?.reason, request.user.sub, request.user.role);
    res.json(summary);
  })
);

patientsRouter.put(
  "/:patientId",
  requireActionPin("patient_update"),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const userId: UserId = request.user.sub;
    const payload = request.body ?? {};
    const existingPatient = await getPatientById(patientId);
    const patient = await updatePatient(patientId, preparePatientUpdatePayload(payload, existingPatient), userId);
    res.json({ patient });
  })
);

patientsRouter.delete(
  "/:patientId",
  requireAnyRole(["super_admin"]),
  requireActionPin("patient_delete"),
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as PatientsRequest;
    const patientId = asOptionalString(request.params?.patientId) ?? "";
    const userId: UserId = request.user.sub;
    const result = await deletePatient(patientId, userId);
    res.json(result);
  })
);
