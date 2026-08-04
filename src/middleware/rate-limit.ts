import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http-error.js";

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
  errorCode?: string;
  key?: (req: Request) => string;
}

export interface FailureRateLimiter {
  check: (key: string) => void;
  recordFailure: (key: string) => void;
  reset: (key: string) => void;
}

export function createFailureRateLimiter({ windowMs, maxRequests, message, errorCode }: Omit<RateLimiterOptions, "key">): FailureRateLimiter {
  const failures = new Map<string, number[]>();
  const active = (key: string, now = Date.now()) => {
    const timestamps = (failures.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
    if (timestamps.length) failures.set(key, timestamps);
    else failures.delete(key);
    return timestamps;
  };

  setInterval(() => {
    for (const key of failures.keys()) active(key);
  }, windowMs).unref();

  return {
    check(key) {
      if (active(key).length >= maxRequests) {
        throw new HttpError(429, message, errorCode ? { code: errorCode } : null);
      }
    },
    recordFailure(key) {
      failures.set(key, [...active(key), Date.now()]);
    },
    reset(key) {
      failures.delete(key);
    }
  };
}

export function createRateLimiter({ windowMs, maxRequests, message, errorCode, key: getKey }: RateLimiterOptions) {
  const requestLog = new Map<string, number[]>();

  setInterval(() => {
    const cutoff = Date.now() - windowMs;

    for (const [key, timestamps] of requestLog.entries()) {
      const activeTimestamps = timestamps.filter((timestamp) => timestamp > cutoff);

      if (activeTimestamps.length === 0) {
        requestLog.delete(key);
        continue;
      }

      requestLog.set(key, activeTimestamps);
    }
  }, windowMs).unref();

  return function rateLimiter(req: Request, _res: Response, next: NextFunction): void {
    const key = getKey?.(req) ?? req.ip ?? "unknown";
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (requestLog.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (timestamps.length >= maxRequests) {
      return next(new HttpError(429, message, errorCode ? { code: errorCode } : null));
    }

    timestamps.push(now);
    requestLog.set(key, timestamps);
    return next();
  };
}
