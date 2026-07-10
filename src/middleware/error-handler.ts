import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";
import { recordDiagnosticEvent, redactDiagnosticText } from "../services/system-diagnostics-service.js";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, "Route not found."));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const errorRecord = asUnknownRecord(error);
  const statusCode = typeof errorRecord.statusCode === "number" ? errorRecord.statusCode : 500;
  const isExpected = error instanceof HttpError;
  const reasonCodes = Array.isArray(errorRecord.reasonCodes)
    ? errorRecord.reasonCodes.filter((code): code is string => typeof code === "string")
    : undefined;

  if (statusCode >= 500) {
    console.error(error);
    // Fire-and-forget by design: diagnostics must never delay, recurse into, or replace the original failure response.
    recordDiagnosticEvent({
      severity: "error",
      source: "http",
      component: "express_error_handler",
      operation: "request",
      requestId: req.requestId,
      route: req.path,
      httpMethod: req.method,
      statusCode,
      userId: req.user?.sub,
      errorName: typeof errorRecord.name === "string" ? errorRecord.name : "Error",
      errorCode: typeof errorRecord.code === "string" ? errorRecord.code : null,
      message: env.isProduction && !isExpected ? "Unexpected server error." : redactDiagnosticText(errorRecord.message),
      technicalDetails: error instanceof Error ? error.stack : undefined,
      metadata: { requestBody: "[REDACTED]", cookies: "[REDACTED]" }
    });
  }

  res.status(statusCode).json({
    error: {
      message:
        statusCode >= 500 && env.isProduction && !isExpected
          ? "Unexpected server error."
          : String(errorRecord.message ?? "Unexpected server error."),
      details: env.isProduction && !isExpected ? null : (errorRecord.details ?? null),
      ...(statusCode >= 500 && !isExpected && req.requestId ? { requestId: req.requestId } : {}),
      ...(reasonCodes && reasonCodes.length > 0 ? { reasonCodes } : {})
    }
  });
}
