import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asOptionalBoolean, asOptionalString, asString } from "../../utils/request-coercion.js";
import { asUnknownRecord } from "../../utils/records.js";
import { HttpError } from "../../utils/http-error.js";
import { env } from "../../config/env.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import {
  createDoctorWithUserForAdmin,
  createProfileForAdmin,
  getDoctorMe,
  listProfileModalitiesForAdmin,
  listProfilesForAdmin,
  updateProfileForAdmin,
  updateProfileModalitiesForAdmin,
} from "./profile-service.js";
import type { DoctorRole } from "./profile-repository.js";
import { resetUserTemporaryPassword, setUserMustChangePassword, updateUserActiveState } from "../../services/user-service.js";
import { doctorRosterRouter } from "./roster-routes.js";
import { doctorCasesRouter } from "./cases-routes.js";
import { doctorProtocolsRouter } from "./protocol-routes.js";
import { doctorWorkloadRouter } from "./workload-routes.js";
import { doctorAvailabilityRouter, doctorLeaveRouter } from "./availability-routes.js";
import {
  confirmDoctorImport,
  doctorImportTemplateCsv,
  doctorImportTemplateXlsx,
  exportDoctorProfilesXlsx,
  exportDoctorProfilesCsv,
  inspectDoctorImport,
  previewDoctorImport,
} from "./doctor-import-export-service.js";

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
router.use("/availability", doctorAvailabilityRouter);
router.use("/leave", doctorLeaveRouter);

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

function asPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
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
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const profiles = await listProfilesForAdmin(user.sub, user.role);
    res.json({ profiles });
  })
);

router.post(
  "/profiles",
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

router.post(
  "/admin/doctors",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const body = asUnknownRecord(req.body);
    const rawPermissions = Array.isArray(body.modalityPermissions) ? body.modalityPermissions : [];
    const modalityPermissions = rawPermissions.map((item) => {
      const record = asUnknownRecord(item);
      return {
        modalityId: asPositiveInteger(record.modalityId, "modalityId"),
        canProtocol: asOptionalBoolean(record.canProtocol) ?? false,
        canReport: asOptionalBoolean(record.canReport) ?? false,
        canSupervise: asOptionalBoolean(record.canSupervise) ?? false,
        active: asOptionalBoolean(record.active) ?? true,
      };
    });

    const result = await createDoctorWithUserForAdmin(user.sub, user.role, {
      username: asString(body.username),
      fullName: asString(body.fullName),
      temporaryPassword: asString(body.temporaryPassword),
      coreRole: asString(body.coreRole),
      userActive: asOptionalBoolean(body.userActive) ?? true,
      doctorDisplayName: asString(body.doctorDisplayName),
      doctorRole: parseDoctorRole(body.doctorRole),
      doctorProfileActive: asOptionalBoolean(body.doctorProfileActive) ?? true,
      canFinalizeReports: asOptionalBoolean(body.canFinalizeReports) ?? false,
      canAssignProtocols: asOptionalBoolean(body.canAssignProtocols) ?? false,
      canSupervise: asOptionalBoolean(body.canSupervise) ?? false,
      modalityPermissions,
    });

    res.status(201).json(result);
  })
);

router.post(
  "/admin/doctors/:userId/reset-password",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const targetUserId = asPositiveInteger(req.params.userId, "user id");
    const profiles = await listProfilesForAdmin(user.sub, user.role);
    if (!profiles.some((profile) => profile.userId === targetUserId)) {
      throw new HttpError(404, "Linked doctor user not found.");
    }
    const body = asUnknownRecord(req.body);
    const updatedUser = await resetUserTemporaryPassword(targetUserId, asString(body.temporaryPassword), user.sub);
    res.json({ user: updatedUser });
  })
);

router.post(
  "/admin/doctors/:userId/force-password-change",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const targetUserId = asPositiveInteger(req.params.userId, "user id");
    const profiles = await listProfilesForAdmin(user.sub, user.role);
    if (!profiles.some((profile) => profile.userId === targetUserId)) {
      throw new HttpError(404, "Linked doctor user not found.");
    }
    const updatedUser = await setUserMustChangePassword(targetUserId, user.sub);
    res.json({ user: updatedUser });
  })
);

router.post(
  "/admin/doctors/:userId/activate",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const targetUserId = asPositiveInteger(req.params.userId, "user id");
    const profiles = await listProfilesForAdmin(user.sub, user.role);
    if (!profiles.some((profile) => profile.userId === targetUserId)) {
      throw new HttpError(404, "Linked doctor user not found.");
    }
    const updatedUser = await updateUserActiveState(targetUserId, true, { userId: user.sub, role: user.role });
    res.json({ user: updatedUser });
  })
);

router.post(
  "/admin/doctors/:userId/deactivate",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const targetUserId = asPositiveInteger(req.params.userId, "user id");
    const profiles = await listProfilesForAdmin(user.sub, user.role);
    if (!profiles.some((profile) => profile.userId === targetUserId)) {
      throw new HttpError(404, "Linked doctor user not found.");
    }
    const updatedUser = await updateUserActiveState(targetUserId, false, { userId: user.sub, role: user.role });
    res.json({ user: updatedUser });
  })
);

router.patch(
  "/profiles/:id",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const profileId = Number(req.params.id);
    if (!Number.isInteger(profileId) || profileId <= 0) {
      throw new HttpError(400, "profile id must be a positive integer.");
    }

    const body = asUnknownRecord(req.body);
    const profile = await updateProfileForAdmin(user.sub, user.role, profileId, {
      displayName: body.displayName === undefined ? undefined : asString(body.displayName),
      doctorRole: body.doctorRole === undefined ? undefined : parseDoctorRole(body.doctorRole),
      active: asOptionalBoolean(body.active),
      canFinalizeReports: asOptionalBoolean(body.canFinalizeReports),
      canAssignProtocols: asOptionalBoolean(body.canAssignProtocols),
      canSupervise: asOptionalBoolean(body.canSupervise),
    });

    res.json({ profile });
  })
);

router.get(
  "/profiles/:id/modalities",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const modalities = await listProfileModalitiesForAdmin(
      user.sub,
      user.role,
      asPositiveInteger(req.params.id, "profile id")
    );
    res.json({ modalities });
  })
);

router.put(
  "/profiles/:id/modalities",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    const body = asUnknownRecord(req.body);
    const rawPermissions = Array.isArray(body.permissions) ? body.permissions : [];
    const permissions = rawPermissions.map((item) => {
      const record = asUnknownRecord(item);
      return {
        modalityId: asPositiveInteger(record.modalityId, "modalityId"),
        canProtocol: asOptionalBoolean(record.canProtocol) ?? false,
        canReport: asOptionalBoolean(record.canReport) ?? false,
        canSupervise: asOptionalBoolean(record.canSupervise) ?? false,
        active: asOptionalBoolean(record.active) ?? true,
      };
    });
    const modalities = await updateProfileModalitiesForAdmin(
      user.sub,
      user.role,
      asPositiveInteger(req.params.id, "profile id"),
      permissions
    );
    res.json({ modalities });
  })
);

router.get(
  "/admin/doctors/export",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    await listProfilesForAdmin(user.sub, user.role);
    const format = String(req.query.format ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "xlsx") throw new HttpError(400, "format must be csv or xlsx.");
    const payload = format === "xlsx" ? await exportDoctorProfilesXlsx() : await exportDoctorProfilesCsv();
    res.setHeader("Content-Type", format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
    res.send("buffer" in payload ? payload.buffer : payload.csv);
  })
);

router.get(
  "/admin/doctors/import/template",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    await listProfilesForAdmin(user.sub, user.role);
    const format = String(req.query.format ?? "csv").toLowerCase();
    if (format !== "csv" && format !== "xlsx") throw new HttpError(400, "format must be csv or xlsx.");
    if (format === "xlsx") {
      const payload = await doctorImportTemplateXlsx();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}"`);
      res.send(payload.buffer);
      return;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="rispro-doctor-import-template.csv"`);
    res.send(doctorImportTemplateCsv());
  })
);

router.post(
  "/admin/doctors/import/inspect",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    await listProfilesForAdmin(user.sub, user.role);
    const body = asUnknownRecord(req.body);
    res.json({ workbook: await inspectDoctorImport({ fileContentBase64: asString(body.fileContentBase64), format: asOptionalString(body.format), fileName: asOptionalString(body.fileName) }) });
  })
);

router.post(
  "/admin/doctors/import/preview",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    await listProfilesForAdmin(user.sub, user.role);
    const body = asUnknownRecord(req.body);
    res.json({ preview: await previewDoctorImport({ fileContentBase64: asString(body.fileContentBase64), format: asOptionalString(body.format), fileName: asOptionalString(body.fileName) }) });
  })
);

router.post(
  "/admin/doctors/import/confirm",
  asyncRoute(async (req: DoctorRequest, res: Response) => {
    const user = currentUser(req);
    await listProfilesForAdmin(user.sub, user.role);
    const body = asUnknownRecord(req.body);
    res.json({ result: await confirmDoctorImport({ fileContentBase64: asString(body.fileContentBase64), format: asOptionalString(body.format), fileName: asOptionalString(body.fileName) }, user.sub) });
  })
);

export function createDoctorPortalRouter(): Router {
  return router;
}

export { router as doctorPortalRouter };
