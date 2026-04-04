// @ts-check

import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";

/**
 * @param {unknown} _req
 * @param {unknown} _res
 * @param {(error?: unknown) => void} next
 * @returns {void}
 */
export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, "Route not found."));
}

/**
 * @param {unknown} error
 * @param {unknown} _req
 * @param {{ status: (code: number) => { json: (payload: unknown) => void } }} res
 * @param {unknown} _next
 * @returns {void}
 */
export function errorHandler(error, _req, res, _next) {
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
          : String(errorRecord.message || "Unexpected server error."),
      details: env.isProduction && !isExpected ? null : errorRecord.details || null
    }
  });
}
