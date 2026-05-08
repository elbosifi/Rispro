import type { NextFunction, Request, Response } from "express";
import {
  canRoleAccessPage,
  readPageVisibilityMatrix,
  type PageVisibilityRouteKey,
} from "../services/page-visibility-settings-service.js";
import { HttpError } from "../utils/http-error.js";

export function requirePageAccess(routeKey: PageVisibilityRouteKey) {
  return async function pageAccessGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new HttpError(401, "Authentication required.");
      }

      const matrix = await readPageVisibilityMatrix();
      if (!canRoleAccessPage(routeKey, req.user.role, matrix)) {
        throw new HttpError(403, "This role cannot access this page.");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
