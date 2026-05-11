import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import {
  assignProtocolForAppointment,
  cancelProtocolForAppointment,
  getProtocolForAppointment,
  getProtocolTasks,
  requestProtocolClarification,
  saveProtocolForAppointment,
  type ProtocolFilters,
} from "./protocol-service.js";
import type { ProtocolInput, ProtocolStatus } from "./protocol-types.js";

const router = Router();

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const STATUSES = new Set<ProtocolStatus>(["draft", "assigned", "clarification_needed", "cancelled"]);

function actor(req: DoctorRequest) {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredPositiveInteger(value, field);
}

function optionalBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new HttpError(400, "Boolean value expected.");
}

function optionalStatus(value: unknown): ProtocolStatus | null {
  if (value === null || value === undefined || value === "") return null;
  const status = String(value);
  if (!STATUSES.has(status as ProtocolStatus)) throw new HttpError(400, "Unsupported protocol status.");
  return status as ProtocolStatus;
}

function filters(req: DoctorRequest): ProtocolFilters {
  return {
    dateFrom: asString(req.query.dateFrom),
    dateTo: asString(req.query.dateTo),
    modalityId: optionalPositiveInteger(req.query.modalityId, "modalityId"),
    protocolStatus: asOptionalString(req.query.protocolStatus) ?? null,
    unprotocolledOnly: req.query.unprotocolledOnly === "true",
    requiresReport: optionalBoolean(req.query.requiresReport),
    caseCategory: asOptionalString(req.query.caseCategory) ?? null,
  };
}

function protocolInput(body: Record<string, unknown>): ProtocolInput & { protocolStatus?: ProtocolStatus; reason?: string | null } {
  return {
    protocolText: asOptionalString(body.protocolText) ?? null,
    contrastRequired: optionalBoolean(body.contrastRequired),
    contrastPhaseOrProtocol: asOptionalString(body.contrastPhaseOrProtocol) ?? null,
    specialPreparation: asOptionalString(body.specialPreparation) ?? null,
    technologistNotes: asOptionalString(body.technologistNotes) ?? null,
    protocolStatus: optionalStatus(body.protocolStatus) ?? undefined,
    reason: asOptionalString(body.reason) ?? null,
  };
}

router.get(
  "/tasks",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const tasks = await getProtocolTasks(actor(req), filters(req));
    res.json({ tasks });
  })
);

router.get(
  "/:appointmentId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const result = await getProtocolForAppointment(actor(req), requiredPositiveInteger(req.params.appointmentId, "appointmentId"));
    res.json(result);
  })
);

router.post(
  "/:appointmentId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const protocol = await saveProtocolForAppointment(actor(req), requiredPositiveInteger(req.params.appointmentId, "appointmentId"), protocolInput(body));
    res.status(201).json({ protocol });
  })
);

router.patch(
  "/:appointmentId",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const protocol = await saveProtocolForAppointment(actor(req), requiredPositiveInteger(req.params.appointmentId, "appointmentId"), protocolInput(body));
    res.json({ protocol });
  })
);

router.post(
  "/:appointmentId/assign",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const protocol = await assignProtocolForAppointment(actor(req), requiredPositiveInteger(req.params.appointmentId, "appointmentId"), protocolInput(body));
    res.json({ protocol });
  })
);

router.post(
  "/:appointmentId/clarification",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const input = protocolInput(body);
    const protocol = await requestProtocolClarification(actor(req), requiredPositiveInteger(req.params.appointmentId, "appointmentId"), {
      ...input,
      reason: asString(body.reason),
    });
    res.json({ protocol });
  })
);

router.post(
  "/:appointmentId/cancel",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const input = protocolInput(body);
    const protocol = await cancelProtocolForAppointment(actor(req), requiredPositiveInteger(req.params.appointmentId, "appointmentId"), {
      ...input,
      reason: asString(body.reason),
    });
    res.json({ protocol });
  })
);

export { router as doctorProtocolsRouter };
