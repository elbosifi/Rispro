function readPositiveInteger(name: string): number | null {
  const rawValue = process.env[name];
  if (rawValue == null || rawValue.trim() === "") {
    return null;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

export function getPublicCancelTokenSecret(): string | null {
  const explicitValue = String(process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET || "").trim();
  if (explicitValue.length > 0) {
    return explicitValue;
  }

  const jwtSecretFallback = String(process.env.JWT_SECRET || "").trim();
  return jwtSecretFallback.length > 0 ? jwtSecretFallback : null;
}

export function getPublicCancelTokenTtlSeconds(): number {
  return readPositiveInteger("APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS") ?? 60 * 60 * 24 * 14;
}

export function getPublicCancelServiceUserId(): number {
  return readPositiveInteger("APPOINTMENT_PUBLIC_CANCEL_USER_ID") ?? 1;
}
