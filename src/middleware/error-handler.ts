import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Route not found."));
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const errorRecord = asUnknownRecord(error);
  const statusCode = typeof errorRecord.statusCode === "number" ? errorRecord.statusCode : 500;
  const isExpected = error instanceof HttpError;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: {
      message:
        statusCode >= 500 && env.isProduction
          ? "Unexpected server error."
          : String(errorRecord.message ?? "Unexpected server error."),
      details: env.isProduction && !isExpected ? null : (errorRecord.details ?? null)
    }
  });
}
