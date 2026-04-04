import "express";
import type { AuthenticatedUserContext } from "./http.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUserContext;
    }
  }
}

export {};
