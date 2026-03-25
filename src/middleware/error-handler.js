import { HttpError } from "../utils/http-error.js";

export function notFoundHandler(_req, _res, next) {
  next(new HttpError(404, "Route not found."));
}

export function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || 500;

  res.status(statusCode).json({
    error: {
      message: error.message || "Unexpected server error.",
      details: error.details || null
    }
  });
}
