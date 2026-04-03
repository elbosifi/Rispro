// @ts-check

import { HttpError } from "../utils/http-error.js";

/**
 * @param {{ windowMs: number, maxRequests: number, message: string }} options
 */
export function createRateLimiter({ windowMs, maxRequests, message }) {
  /** @type {Map<string, number[]>} */
  const requestLog = new Map();

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

  /**
   * @param {{ ip?: string }} req
   * @param {unknown} _res
   * @param {(error?: unknown) => void} next
   */
  return function rateLimiter(req, _res, next) {
    const key = req.ip || "unknown";
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (requestLog.get(key) || []).filter((timestamp) => timestamp > cutoff);

    if (timestamps.length >= maxRequests) {
      return next(new HttpError(429, message));
    }

    timestamps.push(now);
    requestLog.set(key, timestamps);
    return next();
  };
}
