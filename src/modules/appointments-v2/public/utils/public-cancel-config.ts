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

function isPrivateOrLocalHost(hostname: string): boolean {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local")) return true;
  if (/^127\./.test(normalized)) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  return false;
}

function normalizePublicBaseUrl(rawValue: string): string {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    throw new Error("Missing required environment variable: PUBLIC_APP_BASE_URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("PUBLIC_APP_BASE_URL must be an absolute URL.");
  }

  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error("PUBLIC_APP_BASE_URL must use https in production.");
  }
  if (isProduction && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("PUBLIC_APP_BASE_URL cannot use localhost or private IP hosts in production.");
  }

  const normalizedPathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = normalizedPathname || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function getPublicCancelTokenSecret(): string | null {
  const explicitValue = String(process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET || "").trim();
  if (explicitValue.length > 0) {
    return explicitValue;
  }

  const jwtSecretFallback = String(process.env.JWT_SECRET || "").trim();
  return jwtSecretFallback.length > 0 ? jwtSecretFallback : null;
}

export function getPublicAppBaseUrl(): string {
  return normalizePublicBaseUrl(String(process.env.PUBLIC_APP_BASE_URL || ""));
}

export function getPublicCancelTokenTtlSeconds(): number {
  return readPositiveInteger("APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS") ?? 60 * 60 * 24 * 14;
}

export function getPublicCancelServiceUserId(): number {
  return readPositiveInteger("APPOINTMENT_PUBLIC_CANCEL_USER_ID") ?? 1;
}
