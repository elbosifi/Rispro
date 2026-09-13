import express, { type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedUserContext } from "../types/http.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import {
  attachDocumentToIrReferral, confirmIrReferralMaterials, createIrReferral, findIrReferralById,
  deleteIrReferralDocument,
  listAssignableIrDoctors, listIrReferralDocuments, listIrReferrals, uploadIrReferralDocument,
  listMyIrReferralWorklist, recordIrReferralDecision,
  createIrReferralScheduleRequest, getIrReferralScheduleBookingContext, listIrReferralScheduleRequests,
  type IrReferralActor,
} from "../services/ir-referral-service.js";

type IrRequest = Request & { user?: AuthenticatedUserContext };
const VIEW_ROLES = new Set(["receptionist", "administrative", "modality_staff", "doctor", "supervisor", "super_admin"]);
function actor(req: IrRequest): IrReferralActor { if (!req.user) throw new HttpError(401, "Authentication required."); return { userId: req.user.sub, appRole: req.user.role }; }
function requireRole(req: IrRequest) { const current = actor(req); if (!VIEW_ROLES.has(current.appRole)) throw new HttpError(403, "This role cannot access IR referrals."); return current; }
function safeDocument(document: Record<string, unknown>) { const { stored_path: _path, content_sha256: _hash, ...safe } = document; return { ...safe, stored_path: "" }; }

export const irReferralsRouter = express.Router();
irReferralsRouter.use(requireAuth);
irReferralsRouter.get("/doctors", asyncRoute(async (req: IrRequest, res: Response) => { requireRole(req); res.json({ doctors: await listAssignableIrDoctors() }); }));
irReferralsRouter.get("/my-worklist", asyncRoute(async (req: IrRequest, res: Response) => { res.json({ referrals: await listMyIrReferralWorklist(actor(req)) }); }));
irReferralsRouter.get("/schedule-requests", asyncRoute(async (req: IrRequest, res: Response) => { requireRole(req); res.json({ requests: await listIrReferralScheduleRequests() }); }));
irReferralsRouter.get("/schedule-requests/:scheduleRequestId/booking-context", asyncRoute(async (req: IrRequest, res: Response) => { requireRole(req); res.json({ request: await getIrReferralScheduleBookingContext(req.params.scheduleRequestId) }); }));
irReferralsRouter.get("/", asyncRoute(async (req: IrRequest, res: Response) => { requireRole(req); res.json({ referrals: await listIrReferrals({ status: asOptionalString(req.query.status), q: asOptionalString(req.query.q) }) }); }));
irReferralsRouter.post("/", asyncRoute(async (req: IrRequest, res: Response) => { const body = asUnknownRecord(req.body); const referral = await createIrReferral(actor(req), { patientId: body.patientId, requestedProcedure: body.requestedProcedure, clinicalIndication: body.clinicalIndication, assignedDoctorId: body.assignedDoctorId, notifyAssignedDoctor: body.notifyAssignedDoctor }); res.status(201).json({ referral }); }));
irReferralsRouter.get("/:irReferralId", asyncRoute(async (req: IrRequest, res: Response) => { requireRole(req); const referral = await findIrReferralById(req.params.irReferralId); if (!referral) throw new HttpError(404, "IR referral not found."); res.json({ referral }); }));
irReferralsRouter.get("/:irReferralId/documents", asyncRoute(async (req: IrRequest, res: Response) => { requireRole(req); res.json({ documents: (await listIrReferralDocuments(req.params.irReferralId)).map((document) => safeDocument(document as unknown as Record<string, unknown>)) }); }));
irReferralsRouter.post("/:irReferralId/documents", asyncRoute(async (req: IrRequest, res: Response) => { const body = asUnknownRecord(req.body); const document = await uploadIrReferralDocument(actor(req), req.params.irReferralId, { originalFilename: body.originalFilename as string | undefined, mimeType: body.mimeType as string | undefined, fileContentBase64: body.fileContentBase64 as string | undefined, source: asOptionalString(body.source), pageCount: body.pageCount as number | null | undefined, scannerName: asOptionalString(body.scannerName), workstationName: asOptionalString(body.workstationName), appVersion: asOptionalString(body.appVersion) }); res.status(201).json({ document: safeDocument(document as unknown as Record<string, unknown>) }); }));
irReferralsRouter.post("/:irReferralId/documents/:documentId/attach", asyncRoute(async (req: IrRequest, res: Response) => { const document = await attachDocumentToIrReferral(actor(req), req.params.irReferralId, req.params.documentId); res.json({ document: safeDocument(document as unknown as Record<string, unknown>) }); }));
irReferralsRouter.delete("/:irReferralId/documents/:documentId", asyncRoute(async (req: IrRequest, res: Response) => { res.json(await deleteIrReferralDocument(actor(req), req.params.irReferralId, req.params.documentId)); }));
irReferralsRouter.post("/:irReferralId/confirm-materials", asyncRoute(async (req: IrRequest, res: Response) => { const body = asUnknownRecord(req.body); res.json({ referral: await confirmIrReferralMaterials(actor(req), req.params.irReferralId, { documentsConfirmed: body.documentsConfirmed, imagesConfirmed: body.imagesConfirmed, note: body.note }) }); }));
irReferralsRouter.post("/:irReferralId/decision", asyncRoute(async (req: IrRequest, res: Response) => { const body = asUnknownRecord(req.body); res.json({ referral: await recordIrReferralDecision(actor(req), req.params.irReferralId, { assessmentText: body.assessmentText, decision: body.decision, decisionNote: body.decisionNote }) }); }));
irReferralsRouter.post("/:irReferralId/schedule-requests", asyncRoute(async (req: IrRequest, res: Response) => { const body = asUnknownRecord(req.body); res.status(201).json({ request: await createIrReferralScheduleRequest(actor(req), req.params.irReferralId, { modalityId: body.modalityId, examTypeId: body.examTypeId, preferredDate: body.preferredDate, urgency: body.urgency, receptionInstruction: body.receptionInstruction, technologistInstruction: body.technologistInstruction }) }); }));
