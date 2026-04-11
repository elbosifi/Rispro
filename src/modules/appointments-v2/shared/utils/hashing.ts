/**
 * Appointments V2 — Shared hashing utility.
 *
 * Used for policy version config hashing and audit integrity.
 */

import { createHash } from "crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashConfigSnapshot(obj: unknown): string {
  return sha256Hex(JSON.stringify(obj));
}
