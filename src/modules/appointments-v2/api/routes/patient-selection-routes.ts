import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { requirePageAccess } from "../../../../middleware/page-access.js";
import { createRateLimiter } from "../../../../middleware/rate-limit.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { searchPatients } from "../../../../services/patient-service.js";
import { isPatientIdentityVerificationRequired, maskPatientIdentifier, maskPatientPhone, PATIENT_IDENTITY_RULE_VERSION, resolvePatientIdentityRisk, resolvePatientIdentityRisks, resolvePatientIdentityVerificationMode, verifyPatientIdentityEvidence } from "../../../../services/patient-selection-safety-service.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import { HttpError } from "../../../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";

interface AuthedRequest extends Request { user?: AuthenticatedUserContext; }

function verificationRateLimitKey(req: Request): string {
  const userId = Number((req as AuthedRequest).user?.sub ?? 0);
  return Number.isInteger(userId) && userId > 0 ? `user:${userId}` : `ip:${req.ip ?? "unknown"}`;
}

export const patientSelectionRouter = Router();
const verificationRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 12, message: "Too many patient identity verification attempts. Please wait before trying again.", errorCode: "patient_identity_verification_rate_limited", key: verificationRateLimitKey });
patientSelectionRouter.use(requireAuth, requirePageAccess("appointments"));

function toSelectionRow(risk: Awaited<ReturnType<typeof resolvePatientIdentityRisk>>, verificationMode: Awaited<ReturnType<typeof resolvePatientIdentityVerificationMode>>) {
  const { patient } = risk;
  return { id: patient.id, arabicFullName: patient.arabicFullName, englishFullName: patient.englishFullName, mrn: patient.mrn, category: patient.category, sex: patient.sex, ageYears: patient.ageYears, estimatedDateOfBirth: patient.estimatedDateOfBirth, demographicsEstimated: patient.demographicsEstimated, primaryIdentifierType: patient.primaryIdentifierType, primaryIdentifierTypeLabelAr: patient.primaryIdentifierTypeLabelAr, primaryIdentifierTypeLabelEn: patient.primaryIdentifierTypeLabelEn, maskedPrimaryIdentifier: maskPatientIdentifier(patient.primaryIdentifierValue), maskedPhone1: maskPatientPhone(patient.phone1), identityRisk: risk.identityRisk, identityVerificationRequired: isPatientIdentityVerificationRequired(risk, verificationMode), similarPatientCount: risk.similarPatientCount, availableVerificationMethods: risk.availableVerificationMethods, ambiguityRuleVersion: risk.ambiguityRuleVersion };
}

patientSelectionRouter.get("/search", asyncRoute(async (req: Request, res: Response) => {
  const query = String(req.query.q || "");
  const patients = await searchPatients(query);
  const [risks, verificationMode] = await Promise.all([
    resolvePatientIdentityRisks(patients.map((patient) => Number(patient.id))),
    resolvePatientIdentityVerificationMode(),
  ]);
  const items = patients.map((patient) => toSelectionRow(risks.get(Number(patient.id))!, verificationMode));
  res.json({ patients: items });
}));

patientSelectionRouter.get("/:patientId/risk", asyncRoute(async (req: Request, res: Response) => {
  const patientId = Number(req.params.patientId);
  const [risk, verificationMode] = await Promise.all([resolvePatientIdentityRisk(patientId), resolvePatientIdentityVerificationMode()]);
  res.json({ patient: toSelectionRow(risk, verificationMode) });
}));

patientSelectionRouter.post("/:patientId/verify", verificationRateLimiter, asyncRoute(async (req: AuthedRequest, res: Response) => {
  const patientId = Number(req.params.patientId);
  const userId = Number(req.user?.sub || 0);
  let result;
  try {
    result = await verifyPatientIdentityEvidence({ patientId, userId, method: req.body?.method, evidence: req.body?.evidence });
  } catch (error) {
    const details = error instanceof HttpError && error.details && typeof error.details === "object" ? error.details as { code?: string } : null;
    await logAuditEntry({
      entityType: "appointment_patient_identity",
      entityId: Number.isInteger(patientId) && patientId > 0 ? patientId : null,
      actionType: "appointment_patient_identity_verification_rejected",
      newValues: { outcome: "rejected", code: details?.code ?? "patient_identity_verification_rejected", source: "verification_endpoint", ambiguityRuleVersion: PATIENT_IDENTITY_RULE_VERSION },
      changedByUserId: userId || null,
    }).catch(() => undefined);
    throw error;
  }
  res.json({ proof: result.proof, verificationMethod: result.assertion.verificationMethod, verifiedAt: result.assertion.verifiedAt });
}));
