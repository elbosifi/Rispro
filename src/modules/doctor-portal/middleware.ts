import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { getDoctorMe } from "./profile-service.js";
import type { DoctorModuleCapability } from "./capabilities.js";

interface DoctorPortalRequest extends Request {
  user?: AuthenticatedUserContext;
}

export function requireActiveDoctorProfile() {
  return async function activeDoctorGuard(req: DoctorPortalRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new HttpError(401, "Authentication required.");
      }
      const me = await getDoctorMe(req.user.sub, req.user.role);
      if (!me.hasActiveDoctorProfile) {
        throw new HttpError(403, "Active doctor profile is required.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireDoctorCapability(capability: DoctorModuleCapability) {
  return async function doctorCapabilityGuard(req: DoctorPortalRequest, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new HttpError(401, "Authentication required.");
      }
      const me = await getDoctorMe(req.user.sub, req.user.role);
      if (!me.moduleCapabilities.includes(capability)) {
        throw new HttpError(403, "Doctor Portal permission is required.");
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
