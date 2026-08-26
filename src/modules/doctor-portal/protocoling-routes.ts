import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import { rescheduleBooking } from "../appointments-v2/booking/services/reschedule-booking.service.js";
import {
  cancelProtocolAssignment,
  getProtocolingAppointmentDetail,
  getProtocolingReportRedirect,
  getProtocolingSonicDicomRedirect,
  getProtocolingHistorySonicDicomRedirect,
  getProtocolingHistoricalPacsCandidates,
  getProtocolingPatientHistory,
  searchProtocolingHistoricalPacsPatientId,
  listProtocolDocumentAnnotations,
  createProtocolDocumentAnnotation,
  updateProtocolDocumentAnnotation,
  deleteProtocolDocumentAnnotation,
  listProtocolingAppointments,
  saveProtocolAssignment,
  requestProtocolingPatientIdentityReconciliation,
} from "./protocoling-repository.js";
import { requirePatientIdentityReconciliationAccess } from "../../services/patient-identity-reconciliation-service.js";
import type { ProtocolAssignmentStatus, ProtocolDocumentAnnotationType, ProtocolingAppointmentStatusFilter, ProtocolingModality, ProtocolingStatusFilter } from "./protocoling-types.js";
import { withTransaction } from "../appointments-v2/shared/utils/transactions.js";
import { cancelComplementaryRecall, createComplementaryRecall } from "../appointments-v2/recall/complementary-recall.service.js";

const router = Router();

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const MODALITIES = new Set<ProtocolingModality>(["CT", "MRI"]);
const STATUS_FILTERS = new Set<ProtocolingStatusFilter>(["NOT_PROTOCOLLED", "ASSIGNED", "ALL"]);
const APPOINTMENT_STATUS_FILTERS = new Set<ProtocolingAppointmentStatusFilter>(["scheduled", "arrived", "waiting", "completed", "no-show"]);
const ASSIGNMENT_STATUSES = new Set<ProtocolAssignmentStatus>(["ASSIGNED", "MODIFIED", "CANCELLED"]);

async function requireProtocolingAccess(req: DoctorRequest): Promise<number | null> {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  const me = await getDoctorMe(req.user.sub, req.user.role);
  if (!me.canAccessDoctorPortal) throw new HttpError(403, "Doctor Portal access is required.");
  if (!me.canAssignProtocols) throw new HttpError(403, "Doctor is not permitted to assign protocols.");
  const userId = Number(req.user.sub);
  return Number.isInteger(userId) ? userId : null;
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return positiveInteger(value, field);
}

function optionalText(value: unknown): string | null {
  const text = asOptionalString(value)?.trim();
  return text ? text : null;
}

function modality(value: unknown): ProtocolingModality | null {
  if (value === null || value === undefined || value === "" || value === "all") return null;
  const parsed = String(value).toUpperCase();
  if (!MODALITIES.has(parsed as ProtocolingModality)) throw new HttpError(400, "modality must be CT or MRI.");
  return parsed as ProtocolingModality;
}

function statusFilter(value: unknown): ProtocolingStatusFilter | null {
  if (value === null || value === undefined || value === "" || value === "ALL") return null;
  const parsed = String(value).toUpperCase();
  if (!STATUS_FILTERS.has(parsed as ProtocolingStatusFilter)) throw new HttpError(400, "protocolStatus is invalid.");
  return parsed as ProtocolingStatusFilter;
}

function appointmentStatusFilter(value: unknown): ProtocolingAppointmentStatusFilter | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = String(value).toLowerCase();
  if (parsed === "all") return null;
  if (!APPOINTMENT_STATUS_FILTERS.has(parsed as ProtocolingAppointmentStatusFilter)) throw new HttpError(400, "appointmentStatus is invalid.");
  return parsed as ProtocolingAppointmentStatusFilter;
}

function waitingFirst(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, "waitingFirst must be true or false.");
}

function assignmentStatus(value: unknown): ProtocolAssignmentStatus {
  if (value === null || value === undefined || value === "") return "ASSIGNED";
  const parsed = String(value).toUpperCase();
  if (!ASSIGNMENT_STATUSES.has(parsed as ProtocolAssignmentStatus)) throw new HttpError(400, "status is invalid.");
  return parsed as ProtocolAssignmentStatus;
}

function filters(req: DoctorRequest) {
  return {
    dateFrom: asString(req.query.dateFrom),
    dateTo: asString(req.query.dateTo),
    modality: modality(req.query.modality),
    protocolStatus: statusFilter(req.query.protocolStatus),
    appointmentStatus: appointmentStatusFilter(req.query.appointmentStatus),
    waitingFirst: waitingFirst(req.query.waitingFirst),
    search: optionalText(req.query.search),
  };
}

function assignmentInput(body: Record<string, unknown>) {
  const rawProtocolId = body.protocolId ?? body.protocol_id;
  const freeTextProtocol = optionalText(body.freeTextProtocol ?? body.free_text_protocol);
  if ((rawProtocolId === null || rawProtocolId === undefined || rawProtocolId === "") && !freeTextProtocol) {
    throw new HttpError(400, "Select a saved protocol or enter a free-text protocol.");
  }
  return {
    protocolId: rawProtocolId === null || rawProtocolId === undefined || rawProtocolId === "" ? null : positiveInteger(rawProtocolId, "protocolId"),
    scannerId: optionalPositiveInteger(body.scannerId ?? body.scanner_id, "scannerId"),
    protocolNotes: optionalText(body.protocolNotes ?? body.protocol_notes),
    contrastNotes: optionalText(body.contrastNotes ?? body.contrast_notes),
    freeTextProtocol,
    status: assignmentStatus(body.status),
  };
}

function annotationType(value: unknown): ProtocolDocumentAnnotationType {
  const parsed = String(value ?? "");
  if (parsed !== "arrow" && parsed !== "rectangle" && parsed !== "freehand" && parsed !== "text") throw new HttpError(400, "annotationType is invalid.");
  return parsed;
}

function annotationInput(body: Record<string, unknown>) {
  const geometry = body.geometry;
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) throw new HttpError(400, "geometry must be an object.");
  return {
    pageNumber: positiveInteger(body.pageNumber ?? body.page_number, "pageNumber"),
    annotationType: annotationType(body.annotationType ?? body.annotation_type),
    geometry: geometry as Record<string, unknown>,
    textContent: optionalText(body.textContent ?? body.text_content),
    style: body.style && typeof body.style === "object" && !Array.isArray(body.style) ? body.style as Record<string, unknown> : null,
  };
}

router.get(
  "/appointments",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    const appointments = await listProtocolingAppointments(filters(req));
    res.json({ appointments });
  })
);

router.get(
  "/appointments/:appointmentId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    const detail = await getProtocolingAppointmentDetail(positiveInteger(req.params.appointmentId, "appointmentId"));
    if (!detail) throw new HttpError(404, "Appointment not found.");
    res.json({ detail });
  })
);

router.post("/appointments/:appointmentId/complementary-recalls", asyncRoute(async (req: DoctorRequest, res: Response) => {
  const userId = await requireProtocolingAccess(req);
  const body = asUnknownRecord(req.body);
  const technologistInstruction = optionalText(body.technologistInstruction ?? body.technologist_instruction);
  if (!technologistInstruction) throw new HttpError(400, "Technologist instruction is required.");
  const recall = await withTransaction((client) => createComplementaryRecall(client, { originalAppointmentId: positiveInteger(req.params.appointmentId, "appointmentId"), receptionInstruction: optionalText(body.receptionInstruction ?? body.reception_instruction), technologistInstruction, requestedByUserId: userId! }));
  res.status(201).json({ recall });
}));

router.post("/complementary-recalls/:recallId/cancel", asyncRoute(async (req: DoctorRequest, res: Response) => {
  const userId = await requireProtocolingAccess(req);
  const recall = await withTransaction((client) => cancelComplementaryRecall(client, positiveInteger(req.params.recallId, "recallId"), userId!));
  res.json({ recall, linkedAppointmentStillExists: recall.recallAppointmentId != null });
}));

router.post("/appointments/:appointmentId/history/patient-identity-reconciliation",asyncRoute(async(req:DoctorRequest,res:Response)=>{const userId=await requireProtocolingAccess(req);await requirePatientIdentityReconciliationAccess(req.user!.sub,req.user!.role);const body=asUnknownRecord(req.body);const job=await requestProtocolingPatientIdentityReconciliation(positiveInteger(req.params.appointmentId,"appointmentId"),asString(body.studyInstanceUid),asOptionalString(body.accessionNumber)??null,userId!);res.status(202).json({job});}));

router.get(
  "/appointments/:appointmentId/history",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    const result=await getProtocolingPatientHistory(positiveInteger(req.params.appointmentId, "appointmentId"));
    let canReconcilePatientIdentity=true;try{await requirePatientIdentityReconciliationAccess(req.user!.sub,req.user!.role);}catch{canReconcilePatientIdentity=false;}
    res.json({...result,canReconcilePatientIdentity});
  })
);

router.get(
  "/appointments/:appointmentId/history/historical-candidates",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    res.json(await getProtocolingHistoricalPacsCandidates(positiveInteger(req.params.appointmentId, "appointmentId")));
  })
);

router.post(
  "/appointments/:appointmentId/history/old-patient-id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    res.json(await searchProtocolingHistoricalPacsPatientId(
      positiveInteger(req.params.appointmentId, "appointmentId"),
      asString(asUnknownRecord(req.body).patientId),
    ));
  })
);

router.get("/history/open-sonicdicom", asyncRoute(async (req: DoctorRequest, res: Response) => {
  await requireProtocolingAccess(req);
  res.redirect(await getProtocolingHistorySonicDicomRedirect(String(req.query.accession ?? ""), req.hostname));
}));

router.get(
  "/appointments/:appointmentId/open-sonicdicom",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    const scope = req.query.scope === "patient" ? "patient" : "study";
    res.redirect(await getProtocolingSonicDicomRedirect(positiveInteger(req.params.appointmentId, "appointmentId"), scope, req.hostname));
  })
);

router.get(
  "/appointments/:appointmentId/open-report",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    res.redirect(await getProtocolingReportRedirect(positiveInteger(req.params.appointmentId, "appointmentId"), req.hostname));
  })
);

router.patch(
  "/appointments/:appointmentId/report-requirement",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const userId = await requireProtocolingAccess(req);
    if (userId == null || !req.user) throw new HttpError(401, "Authentication required.");
    const body = asUnknownRecord(req.body);
    if (typeof body.requiresReport !== "boolean") {
      throw new HttpError(400, "requiresReport must be a boolean.");
    }
    const result = await rescheduleBooking(
      positiveInteger(req.params.appointmentId, "appointmentId"),
      null,
      undefined,
      null,
      null,
      null,
      userId,
      req.user.role,
      undefined,
      undefined,
      null,
      null,
      null,
      null,
      body.requiresReport,
      undefined,
      optionalText(body.policySetKey) ?? "default",
      undefined,
      true
    );
    res.json({ booking: result.booking });
  })
);

router.get(
  "/documents/:documentId/annotations",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    res.json({ annotations: await listProtocolDocumentAnnotations(positiveInteger(req.params.documentId, "documentId")) });
  })
);

router.post(
  "/documents/:documentId/annotations",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const userId = await requireProtocolingAccess(req);
    const annotation = await createProtocolDocumentAnnotation({ documentId: positiveInteger(req.params.documentId, "documentId"), ...annotationInput(asUnknownRecord(req.body)), createdByUserId: userId });
    res.status(201).json({ annotation });
  })
);

router.patch(
  "/documents/:documentId/annotations/:annotationId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const userId = await requireProtocolingAccess(req);
    const annotation = await updateProtocolDocumentAnnotation({ documentId: positiveInteger(req.params.documentId, "documentId"), annotationId: positiveInteger(req.params.annotationId, "annotationId"), ...annotationInput(asUnknownRecord(req.body)), updatedByUserId: userId });
    res.json({ annotation });
  })
);

router.delete(
  "/documents/:documentId/annotations/:annotationId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const userId = await requireProtocolingAccess(req);
    await deleteProtocolDocumentAnnotation(positiveInteger(req.params.documentId, "documentId"), positiveInteger(req.params.annotationId, "annotationId"), userId);
    res.json({ deleted: true });
  })
);

router.post(
  "/appointments/:appointmentId/assignment",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const userId = await requireProtocolingAccess(req);
    const detail = await saveProtocolAssignment(
      positiveInteger(req.params.appointmentId, "appointmentId"),
      assignmentInput(asUnknownRecord(req.body)),
      userId
    );
    res.status(201).json({ detail });
  })
);

router.patch(
  "/appointments/:appointmentId/assignment",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const userId = await requireProtocolingAccess(req);
    const detail = await saveProtocolAssignment(
      positiveInteger(req.params.appointmentId, "appointmentId"),
      assignmentInput(asUnknownRecord(req.body)),
      userId
    );
    res.json({ detail });
  })
);

router.delete(
  "/appointments/:appointmentId/assignment",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await requireProtocolingAccess(req);
    const detail = await cancelProtocolAssignment(positiveInteger(req.params.appointmentId, "appointmentId"));
    res.json({ detail });
  })
);

export { router as doctorProtocolingRouter };
