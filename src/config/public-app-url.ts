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

function parsePublicAppBaseUrl(rawValue: string, settingName = "PUBLIC_APP_BASE_URL"): URL {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) throw new Error(`Missing required public base URL setting: ${settingName}`);

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${settingName} must be an absolute URL.`);
  }

  const isProduction = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (isProduction && parsed.protocol !== "https:") {
    throw new Error(`${settingName} must use https in production.`);
  }
  if (isProduction && isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error(`${settingName} cannot use localhost or private IP hosts in production.`);
  }
  return parsed;
}

export function normalizePublicAppBaseUrl(rawValue: string, settingName = "PUBLIC_APP_BASE_URL"): string {
  const parsed = parsePublicAppBaseUrl(rawValue, settingName);
  const normalizedPathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = normalizedPathname || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function getPublicAppBaseUrl(): string {
  return normalizePublicAppBaseUrl(String(process.env.PUBLIC_APP_BASE_URL || ""));
}

export function tryGetPublicAppBaseUrl(): string | null {
  try {
    return getPublicAppBaseUrl();
  } catch {
    return null;
  }
}

export function getPublicAppOrigin(options: { requireHttps?: boolean } = {}): string {
  const parsed = parsePublicAppBaseUrl(String(process.env.PUBLIC_APP_BASE_URL || ""));
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("PUBLIC_APP_BASE_URL must contain only an origin.");
  }
  if (parsed.protocol !== "https:" && (options.requireHttps || String(process.env.NODE_ENV || "").toLowerCase() === "production" || parsed.protocol !== "http:")) {
    throw new Error("PUBLIC_APP_BASE_URL must use HTTPS.");
  }
  return parsed.origin;
}
