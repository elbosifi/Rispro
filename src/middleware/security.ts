import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

function buildConnectSources(): string[] {
  const sources = [
    "'self'",
    "http://127.0.0.1:9810",
    "http://localhost:9810",
    "http://127.0.0.1:9801",
    "http://localhost:9801",
  ];

  if (env.naps2WebscanEndpoint) {
    try {
      sources.push(new URL(env.naps2WebscanEndpoint).origin);
    } catch {
      // Invalid optional endpoint should not break app startup or headers.
    }
  }

  return Array.from(new Set(sources));
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const connectSources = buildConnectSources();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      `connect-src ${connectSources.join(" ")}`,
      "object-src 'none'",
      "frame-src 'self' blob: data:",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'"
    ].join("; ")
  );

  next();
}

export const __securityTestables = {
  buildConnectSources,
};
