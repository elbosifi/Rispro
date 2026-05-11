import { Router, type Request, type Response } from "express";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import type { AvailabilityStatus, LeaveStatus, LeaveType } from "./availability-types.js";
import {
  createMyAvailability,
  createMyLeave,
  createTeamAvailability,
  getMyAvailability,
  getMyLeave,
  getTeamAvailability,
  getTeamLeave,
  patchLeaveStatus,
  removeAvailability,
} from "./availability-service.js";

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const AVAILABILITY_STATUSES = new Set<AvailabilityStatus>([
  "available",
  "unavailable",
  "preferred",
  "not_preferred",
  "leave",
  "conference",
  "admin",
  "teaching",
  "on_call",
]);
const LEAVE_TYPES = new Set<LeaveType>(["annual_leave", "sick_leave", "conference", "study_leave", "admin_leave", "emergency_absence"]);
const LEAVE_STATUSES = new Set<LeaveStatus>(["pending", "approved", "rejected", "cancelled"]);

function actor(req: DoctorRequest) {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

function asPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

function parseAvailabilityStatus(value: unknown): AvailabilityStatus {
  const status = String(value ?? "").trim();
  if (!AVAILABILITY_STATUSES.has(status as AvailabilityStatus)) throw new HttpError(400, "Unsupported availabilityStatus.");
  return status as AvailabilityStatus;
}

function parseLeaveType(value: unknown): LeaveType {
  const leaveType = String(value ?? "").trim();
  if (!LEAVE_TYPES.has(leaveType as LeaveType)) throw new HttpError(400, "Unsupported leaveType.");
  return leaveType as LeaveType;
}

function parseLeaveStatus(value: unknown): LeaveStatus {
  const status = String(value ?? "").trim();
  if (!LEAVE_STATUSES.has(status as LeaveStatus)) throw new HttpError(400, "Unsupported leave status.");
  return status as LeaveStatus;
}

function dateQuery(req: Request) {
  return {
    dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : null,
    dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : null,
  };
}

const availabilityRouter = Router();

availabilityRouter.get(
  "/my",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ availability: await getMyAvailability(actor(req), dateQuery(req)) });
  })
);

availabilityRouter.post(
  "/my",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const availability = await createMyAvailability(actor(req), {
      date: asString(body.date),
      startTime: asOptionalString(body.startTime) ?? null,
      endTime: asOptionalString(body.endTime) ?? null,
      availabilityStatus: parseAvailabilityStatus(body.availabilityStatus),
      note: asOptionalString(body.note) ?? null,
    });
    res.status(201).json({ availability });
  })
);

availabilityRouter.get(
  "/team",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ availability: await getTeamAvailability(actor(req), dateQuery(req)) });
  })
);

availabilityRouter.post(
  "/",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const availability = await createTeamAvailability(actor(req), {
      doctorId: asPositiveInteger(body.doctorId, "doctorId"),
      date: asString(body.date),
      startTime: asOptionalString(body.startTime) ?? null,
      endTime: asOptionalString(body.endTime) ?? null,
      availabilityStatus: parseAvailabilityStatus(body.availabilityStatus),
      note: asOptionalString(body.note) ?? null,
    });
    res.status(201).json({ availability });
  })
);

availabilityRouter.delete(
  "/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    await removeAvailability(actor(req), asPositiveInteger(req.params.id, "availabilityId"));
    res.status(204).end();
  })
);

const leaveRouter = Router();

leaveRouter.get(
  "/my",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ leave: await getMyLeave(actor(req), dateQuery(req)) });
  })
);

leaveRouter.post(
  "/my",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const leave = await createMyLeave(actor(req), {
      startDate: asString(body.startDate),
      endDate: asString(body.endDate),
      leaveType: parseLeaveType(body.leaveType),
      reason: asOptionalString(body.reason) ?? null,
    });
    res.status(201).json({ leave });
  })
);

leaveRouter.get(
  "/team",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    res.json({ leave: await getTeamLeave(actor(req), dateQuery(req)) });
  })
);

leaveRouter.patch(
  "/:id/status",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json({ leave: await patchLeaveStatus(actor(req), asPositiveInteger(req.params.id, "leaveId"), parseLeaveStatus(body.status)) });
  })
);

export { availabilityRouter as doctorAvailabilityRouter, leaveRouter as doctorLeaveRouter };

