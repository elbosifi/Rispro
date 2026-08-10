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
  return sha256Hex(JSON.stringify(canonicalizeConfigValue(obj)));
}

function canonicalizeConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalizeConfigValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value == null || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    // Database row IDs are physical version-local identities. Stable logical
    // keys and semantic content, not insertion order, define policy equality.
    if (key === "id") continue;
    result[key] = canonicalizeConfigValue((value as Record<string, unknown>)[key]);
  }
  return result;
}
