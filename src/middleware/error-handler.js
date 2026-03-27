import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, "Route not found."));
}

export function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || 500;
  const isExpected = error instanceof HttpError;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    error: {
      message: statusCode >= 500 && env.isProduction ? "Unexpected server error." : error.message || "Unexpected server error.",
      details: env.isProduction && !isExpected ? null : error.details || null
    }
  });
}
