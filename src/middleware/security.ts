import type { NextFunction, Request, Response } from "express";
import { allowInsecureQzWebsocket } from "../config/env.js";
import { naps2ConnectOrigins } from "../config/naps2.js";

function buildConnectSources(): string[] {
  const qzHosts = ["localhost", "localhost.qz.io", "127.0.0.1"];
  const qzSecurePorts = [8181, 8282, 8383, 8484];
  const qzInsecurePorts = [8182, 8283, 8384, 8485];
  const sources = [
    "'self'",
    ...naps2ConnectOrigins(),
    ...qzHosts.flatMap((host) => qzSecurePorts.map((port) => `wss://${host}:${port}`)),
  ];

  if (allowInsecureQzWebsocket()) {
    sources.push(...qzHosts.flatMap((host) => qzInsecurePorts.map((port) => `ws://${host}:${port}`)));
  }

  return Array.from(new Set(sources));
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  const connectSources = buildConnectSources();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
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
