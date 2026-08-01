import { createPrivateKey, sign } from "node:crypto";
import { HttpError } from "../utils/http-error.js";

function envPem(name: "QZ_CERTIFICATE" | "QZ_PRIVATE_KEY"): string {
  const value = String(process.env[name] || "").trim().replace(/\\n/g, "\n");
  if (!value) throw new HttpError(503, `${name} is not configured.`);
  return value;
}

export function getQzCertificate(): string {
  return envPem("QZ_CERTIFICATE");
}

export function signQzRequest(request: unknown): string {
  const payload = typeof request === "string" ? request : "";
  if (!payload || payload.length > 1_000_000) throw new HttpError(400, "A valid QZ request is required.");
  try {
    const key = createPrivateKey(envPem("QZ_PRIVATE_KEY"));
    return sign("RSA-SHA512", Buffer.from(payload, "utf8"), key).toString("base64");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "QZ request signing failed.");
  }
}

