import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error.js";

export interface ConcurrencyLimiterOptions {
  maxConcurrent: number;
  message: string;
  errorCode?: string;
}

export function createConcurrencyLimiter(options: ConcurrencyLimiterOptions): RequestHandler {
  if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
    throw new Error("Concurrency limit must be a positive integer.");
  }

  let activeRequests = 0;

  return function concurrencyLimiter(req, res, next): void {
    if (activeRequests >= options.maxConcurrent) {
      next(new HttpError(503, options.message, options.errorCode ? { code: options.errorCode } : null));
      return;
    }

    activeRequests += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      res.off("finish", release);
      res.off("close", release);
      req.off("aborted", release);
      activeRequests = Math.max(0, activeRequests - 1);
    };

    res.once("finish", release);
    res.once("close", release);
    req.once("aborted", release);
    next();
  };
}
