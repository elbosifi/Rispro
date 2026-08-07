import { randomUUID } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

const PURPOSE = "registration-list-render";
const TTL_MS = 90_000;
const MAX_CONTEXTS = 75;
export const MAX_REGISTRATION_LIST_IDS = 500;

export interface RegistrationListRenderContext {
  id: string;
  appointmentIds: number[];
  label: string;
  expiresAt: number;
}

const contexts = new Map<string, RegistrationListRenderContext>();

function removeExpired(now = Date.now()): void {
  for (const [id, context] of contexts) if (context.expiresAt <= now) contexts.delete(id);
}

export function createRegistrationListRenderContext(appointmentIds: number[], label: string): RegistrationListRenderContext {
  removeExpired();
  if (contexts.size >= MAX_CONTEXTS) throw new HttpError(503, "Registration-list rendering is busy. Try again shortly.", { code: "REGISTRATION_LIST_RENDER_BUSY" });
  if (appointmentIds.length < 1 || appointmentIds.length > MAX_REGISTRATION_LIST_IDS) throw new HttpError(400, "Registration-list appointment identifiers are invalid.");
  if (appointmentIds.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(appointmentIds).size !== appointmentIds.length) throw new HttpError(400, "Registration-list appointment identifiers must be unique positive integers.");
  const normalizedLabel = label.trim();
  if (!normalizedLabel || normalizedLabel.length > 200 || /[\u0000-\u001f\u007f]/.test(normalizedLabel)) throw new HttpError(400, "Registration-list label is invalid.");
  const context = { id: randomUUID(), appointmentIds: [...appointmentIds], label: normalizedLabel, expiresAt: Date.now() + TTL_MS };
  contexts.set(context.id, context);
  return context;
}

export function deleteRegistrationListRenderContext(id: string): void { contexts.delete(id); }

export function assertCompleteRegistrationListRows<T extends { id: unknown }>(context: RegistrationListRenderContext, rows: T[]): T[] {
  const resolvedIds = rows.map((row) => Number(row.id));
  if (resolvedIds.length !== context.appointmentIds.length || resolvedIds.some((id, index) => id !== context.appointmentIds[index])) {
    throw new HttpError(404, "One or more registration-list appointments could not be resolved.", { code: "REGISTRATION_LIST_INCOMPLETE" });
  }
  return rows;
}

export function issueRegistrationListRenderToken(contextId: string): string {
  return jwt.sign({ purpose: PURPOSE, contextId }, env.jwtSecret, { algorithm: "HS256", expiresIn: Math.ceil(TTL_MS / 1000) });
}

export function contextFromRegistrationListRenderToken(token: unknown): RegistrationListRenderContext {
  if (typeof token !== "string" || !token) throw new HttpError(401, "Registration-list render token is required.", { code: "REGISTRATION_LIST_RENDER_TOKEN_INVALID" });
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded === "string") throw new Error("invalid token");
    const payload = decoded as JwtPayload & { purpose?: unknown; contextId?: unknown };
    if (payload.purpose !== PURPOSE || typeof payload.contextId !== "string") throw new Error("invalid token");
    removeExpired();
    const context = contexts.get(payload.contextId);
    if (!context || context.expiresAt <= Date.now()) throw new Error("expired context");
    return context;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Registration-list render token is invalid or expired.", { code: "REGISTRATION_LIST_RENDER_TOKEN_INVALID" });
  }
}

export const __registrationListRenderContextTestables = { contexts, removeExpired, ttlMs: TTL_MS, maxContexts: MAX_CONTEXTS };
