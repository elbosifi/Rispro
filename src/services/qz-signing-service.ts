import { createHash, createPrivateKey, sign, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export const QZ_SIGNING_CALL_ALLOWLIST = ["printers.find", "printers.detail", "print"] as const;
const ALLOWED_CALLS = new Set<string>(QZ_SIGNING_CALL_ALLOWLIST);

function envPem(name: "QZ_CERTIFICATE" | "QZ_PRIVATE_KEY"): string {
  const value = String(process.env[name] || "").trim().replace(/\\n/g, "\n");
  if (!value) throw new HttpError(503, `${name} is not configured.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reject(message: string, statusCode = 403): never {
  throw new HttpError(statusCode, message);
}

function validatePrinterDiscovery(call: string, params: unknown): void {
  if (call === "printers.detail") {
    if (params !== undefined && params !== null) reject("QZ printer-details parameters are invalid.", 400);
    return;
  }
  if (!isRecord(params) || Object.keys(params).some((key) => key !== "query")) reject("QZ printer-discovery parameters are invalid.", 400);
  if (params.query != null && typeof params.query !== "string") reject("QZ printer-discovery query is invalid.", 400);
}

function validatePrint(params: unknown): void {
  if (!isRecord(params) || Object.keys(params).some((key) => !["printer", "options", "data"].includes(key))) {
    reject("QZ print parameters are invalid.", 400);
  }
  if (!isRecord(params.printer) || typeof params.printer.name !== "string" || !params.printer.name.trim() || Object.keys(params.printer).some((key) => key !== "name")) {
    reject("QZ print requests must target one named local printer.", 403);
  }
  if (!isRecord(params.options) || !Array.isArray(params.data) || params.data.length === 0) reject("QZ print parameters are incomplete.", 400);
  if (params.options.forceRaw === true) reject("Raw printer-driver bypass is not approved for RISpro printing.", 403);
  for (const item of params.data) {
    if (!isRecord(item) || item.type !== "pixel" || !["pdf", "html"].includes(String(item.format)) || typeof item.data !== "string") {
      reject("Only RISpro pixel PDF or HTML print data may be signed.", 403);
    }
    if (item.format === "pdf" && item.flavor !== "base64") reject("PDF printing must use Base64 pixel data.", 403);
    if (item.format === "html" && item.flavor !== "plain") reject("HTML printing must use plain pixel data.", 403);
  }
}

export function qzSigningRequestLimitBytes(): number {
  return env.qzSigningRequestLimitMb * 1024 * 1024;
}

export function validateQzSigningRequest(request: unknown): string {
  if (typeof request !== "string" || request.length === 0) reject("A valid QZ request is required.", 400);
  if (Buffer.byteLength(request, "utf8") > qzSigningRequestLimitBytes()) throw new HttpError(413, "QZ signing request exceeds the configured size limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(request); } catch { reject("QZ signing request must be valid JSON.", 400); }
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["call", "params", "timestamp"].includes(key))) reject("QZ signing request has an invalid structure.", 400);
  if (typeof parsed.call !== "string" || !ALLOWED_CALLS.has(parsed.call)) reject("This QZ function is not approved for RISpro printing.", 403);
  if (!Number.isSafeInteger(parsed.timestamp) || Number(parsed.timestamp) <= 0) reject("QZ signing request timestamp is invalid.", 400);
  if (parsed.call === "print") validatePrint(parsed.params); else validatePrinterDiscovery(parsed.call, parsed.params);
  return request;
}

export function getQzCertificate(): string { return envPem("QZ_CERTIFICATE"); }

export function signQzRequest(request: unknown, digest: unknown): string {
  const payload = validateQzSigningRequest(request);
  const suppliedDigest = typeof digest === "string" && /^[0-9a-f]{64}$/i.test(digest) ? digest.toLowerCase() : "";
  const expectedDigest = createHash("sha256").update(payload, "utf8").digest("hex");
  if (!suppliedDigest || !timingSafeEqual(Buffer.from(suppliedDigest, "hex"), Buffer.from(expectedDigest, "hex"))) throw new HttpError(400, "QZ signing digest does not match the validated request.");
  try {
    const key = createPrivateKey(envPem("QZ_PRIVATE_KEY"));
    return sign("RSA-SHA512", Buffer.from(suppliedDigest, "utf8"), key).toString("base64");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "QZ request signing failed.");
  }
}
