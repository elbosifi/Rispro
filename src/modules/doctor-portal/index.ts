import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalBoolean, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import { env } from "../../config/env.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { createProfileForAdmin, getDoctorMe, listProfilesForAdmin } from "./profile-service.js";
import type { DoctorRole } from "./profile-repository.js";
import { requireDoctorCapability } from "./middleware.js";
import { doctorRosterRouter } from "./roster-routes.js";
import { doctorCasesRouter } from "./cases-routes.js";
import { doctorProtocolsRouter } from "./protocol-routes.js";
import { doctorWorkloadRouter } from "./workload-routes.js";

const router = Router();

router.use(requireAuth);
router.use((_req, _res, next) => {
  if (!env.doctorPortalEnabled) {
    next(new HttpError(404, "Doctor Portal is disabled."));
    return;
  }
  next();
});
router.use("/roster", doctorRosterRouter);
router.use("/cases", doctorCasesRouter);
router.use("/protocols", doctorProtocolsRouter);
router.use("/workload", doctorWorkloadRouter);

interface DoctorRequest extends Request {
  user?: AuthenticatedUserContext;
}

const DOCTOR_ROLES = new Set<DoctorRole>([
  "consultant",
  "specialist",
  "senior_house_officer",
  "resident",
]);

function currentUser(req: DoctorRequest): AuthenticatedUserContext {
  if (!req.user) {
    throw new HttpError(401, "Authentication required.");
  }
  return req.user;
}

function parseDoctorRole(value: unknown): DoctorRole {
  const role = String(value ?? "").trim();
  if (!DOCTOR_ROLES.has(role as DoctorRole)) {
    throw new HttpError(400, "doctorRole must be consultant, specialist, senior_house_officer, or resident.");
  }
  return role as DoctorRole;
}

router.get(
  "/me",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const doctorMe = await getDoctorMe(user.sub, user.role);
    res.json(doctorMe);
  })
);

router.get(
  "/profiles",
  requireDoctorCapability("doctor_admin"),
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const profiles = await listProfilesForAdmin(user.sub, user.role);
    res.json({ profiles });
  })
);

router.post(
  "/profiles",
  requireDoctorCapability("doctor_admin"),
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const body = asUnknownRecord(req.body);
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new HttpError(400, "userId must be a positive integer.");
    }

    const profile = await createProfileForAdmin(user.sub, user.role, {
      userId,
      displayName: asString(body.displayName),
      doctorRole: parseDoctorRole(body.doctorRole),
      active: asOptionalBoolean(body.active) ?? true,
      canFinalizeReports: asOptionalBoolean(body.canFinalizeReports) ?? false,
      canAssignProtocols: asOptionalBoolean(body.canAssignProtocols) ?? false,
      canSupervise: asOptionalBoolean(body.canSupervise) ?? false,
    });

    res.status(201).json({ profile });
  })
);

export function createDoctorPortalRouter(): Router {
  return router;
}

export { router as doctorPortalRouter };
