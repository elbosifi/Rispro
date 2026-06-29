import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import {
  cancelProtocolAssignment,
  getProtocolingAppointmentDetail,
  listProtocolingAppointments,
  saveProtocolAssignment,
} from "./protocoling-repository.js";
import type { ProtocolAssignmentStatus, ProtocolingModality, ProtocolingStatusFilter } from "./protocoling-types.js";

const router = Router();

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const MODALITIES = new Set<ProtocolingModality>(["CT", "MRI"]);
const STATUS_FILTERS = new Set<ProtocolingStatusFilter>(["NOT_PROTOCOLLED", "ASSIGNED", "ALL"]);
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
    search: optionalText(req.query.search),
  };
}

function assignmentInput(body: Record<string, unknown>) {
  return {
    protocolId: positiveInteger(body.protocolId ?? body.protocol_id, "protocolId"),
    scannerId: optionalPositiveInteger(body.scannerId ?? body.scanner_id, "scannerId"),
    protocolNotes: optionalText(body.protocolNotes ?? body.protocol_notes),
    contrastNotes: optionalText(body.contrastNotes ?? body.contrast_notes),
    status: assignmentStatus(body.status),
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
