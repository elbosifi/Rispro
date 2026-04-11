/**
 * Appointments V2 — Scheduling error class.
 *
 * All V2 scheduling/booking operations throw this error (or subclasses)
 * so that callers can distinguish V2 errors from generic HttpErrors.
 */
import { HttpError } from "../../../../utils/http-error.js";

export class SchedulingError extends HttpError {
  public readonly reasonCodes: string[];

  constructor(
    statusCode: number,
    message: string,
    reasonCodes: string[] = [],
    details: unknown = null
  ) {
    super(statusCode, message, details);
    this.name = "SchedulingError";
    this.reasonCodes = reasonCodes;
  }
}
