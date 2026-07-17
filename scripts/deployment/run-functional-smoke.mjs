#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_READINESS_RETRIES = 3;
const DEFAULT_READINESS_DELAY_MS = 500;
const PUBLIC_ERROR_PATH = "/api/public/appointments/cancel-preview";
const PROTECTED_READ_PATH = "/api/settings/appointment_slip";
const DEFAULT_SESSION_COOKIE_NAME = "rispro_session";

export class SmokeFailure extends Error {
  constructor(category) {
    super(category);
    this.category = category;
  }
}

function parsePositiveInteger(value, fallback, maximum) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new SmokeFailure("CONFIGURATION");
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) throw new SmokeFailure("CONFIGURATION");
  return parsed;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SmokeFailure("CONFIGURATION");
}

function isLocalTarget(url) {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isCookieName(value) {
  return /^[^\s=;,]+$/.test(value);
}

export function readSmokeConfig(environment = process.env) {
  const rawBaseUrl = String(environment.RISPRO_SMOKE_BASE_URL || "").trim();
  const expectedCommitSha = String(environment.RISPRO_EXPECTED_COMMIT_SHA || "").trim().toLowerCase();
  if (!rawBaseUrl || !expectedCommitSha) throw new SmokeFailure("CONFIGURATION");
  if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) throw new SmokeFailure("CONFIGURATION");

  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new SmokeFailure("CONFIGURATION");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol) || (baseUrl.protocol !== "https:" && !isLocalTarget(baseUrl))) {
    throw new SmokeFailure("CONFIGURATION");
  }
  if (baseUrl.username || baseUrl.password) throw new SmokeFailure("CONFIGURATION");
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "") || "/";
  baseUrl.search = "";
  baseUrl.hash = "";

  const authEnabled = parseBoolean(environment.RISPRO_SMOKE_AUTH_ENABLED, false);
  const username = String(environment.RISPRO_SMOKE_USERNAME || "");
  const password = String(environment.RISPRO_SMOKE_PASSWORD || "");
  if (authEnabled && (!username || !password)) throw new SmokeFailure("CONFIGURATION");
  const sessionCookieName = String(environment.RISPRO_SMOKE_SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME);
  if (!isCookieName(sessionCookieName)) throw new SmokeFailure("CONFIGURATION");

  return {
    baseUrl,
    expectedCommitSha,
    authEnabled,
    username,
    password,
    sessionCookieName,
    timeoutMs: parsePositiveInteger(environment.RISPRO_SMOKE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 30_000),
    readinessRetries: parsePositiveInteger(environment.RISPRO_SMOKE_READINESS_RETRIES, DEFAULT_READINESS_RETRIES, 5),
    readinessDelayMs: parsePositiveInteger(environment.RISPRO_SMOKE_READINESS_DELAY_MS, DEFAULT_READINESS_DELAY_MS, 5_000),
  };
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl);
}

async function request(config, path, options = {}) {
  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    return await fetch(endpoint(config.baseUrl, path), { ...options, signal, redirect: "manual" });
  } catch {
    return null;
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function healthIsStructured(value) {
  return isRecord(value) && value.ok === true && typeof value.environment === "string" && value.environment.length > 0 && typeof value.buildSha === "string" && value.buildSha.length > 0;
}

function readinessIsStructured(value) {
  return isRecord(value) && value.ok === true;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function firstPartyAssetUrls(baseUrl, html) {
  const assetUrls = [];
  const tags = html.matchAll(/<\s*(?:script|link)\b[^>]*>/gi);
  for (const tagMatch of tags) {
    const attributes = tagMatch[0].matchAll(/\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi);
    for (const attributeMatch of attributes) {
      const rawUrl = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? "";
      if (!/\.(?:js|css)(?:[?#].*)?$/i.test(rawUrl)) continue;
      let assetUrl;
      try {
        assetUrl = new URL(rawUrl, baseUrl);
      } catch {
        throw new SmokeFailure("FRONTEND_ASSET_MISSING");
      }
      if (assetUrl.origin === baseUrl.origin) assetUrls.push(assetUrl);
    }
  }
  return [...new Map(assetUrls.map((url) => [url.href, url])).values()];
}

function setCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  const combined = response.headers.get("set-cookie") || "";
  return combined ? combined.split(/,\s*(?=[^=;,\s]+=[^,;]*)/) : [];
}

function cookieName(cookie) {
  const firstPart = cookie.split(";", 1)[0].trim();
  const separator = firstPart.indexOf("=");
  return separator > 0 ? firstPart.slice(0, separator).trim() : "";
}

function cookieValue(cookie) {
  const firstPart = cookie.split(";", 1)[0].trim();
  const separator = firstPart.indexOf("=");
  return separator > 0 ? firstPart.slice(separator + 1) : "";
}

function cookieAttributes(cookie) {
  return cookie.split(";").slice(1).map((part) => {
    const separator = part.indexOf("=");
    return {
      name: (separator >= 0 ? part.slice(0, separator) : part).trim().toLowerCase(),
      value: separator >= 0 ? part.slice(separator + 1).trim() : "",
    };
  });
}

function sessionCookie(response, expectedName) {
  const setCookie = setCookieValues(response).find((cookie) => cookieName(cookie) === expectedName && cookieValue(cookie).length > 0);
  return setCookie ? `${expectedName}=${cookieValue(setCookie)}` : null;
}

function sessionCookieWasCleared(response, expectedName) {
  return setCookieValues(response).some((cookie) => {
    if (cookieName(cookie) !== expectedName || cookieValue(cookie) !== "") return false;
    return cookieAttributes(cookie).some(({ name, value }) => {
      if (name === "max-age") return value === "0";
      if (name !== "expires") return false;
      const expiresAt = Date.parse(value);
      return Number.isFinite(expiresAt) && expiresAt < Date.now();
    });
  });
}

async function requestFirstPartyAsset(config, assetUrl) {
  let requestedUrl = assetUrl;
  for (let redirectCount = 0; redirectCount < 3; redirectCount += 1) {
    const response = await request(config, requestedUrl.pathname + requestedUrl.search);
    if (!response) return null;
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return null;
    let redirectUrl;
    try {
      redirectUrl = new URL(location, requestedUrl);
    } catch {
      return null;
    }
    if (redirectUrl.origin !== config.baseUrl.origin) return null;
    requestedUrl = redirectUrl;
  }
  return null;
}

export async function runFunctionalSmoke(config, report = (line) => console.log(line)) {
  const healthResponse = await request(config, "/api/health");
  if (!healthResponse) throw new SmokeFailure("HEALTH_TIMEOUT");
  if (healthResponse.status !== 200) throw new SmokeFailure("HEALTH");
  const health = await readJson(healthResponse);
  if (!healthIsStructured(health)) throw new SmokeFailure("HEALTH");
  report("PASS HEALTH");

  let ready = false;
  for (let attempt = 0; attempt < config.readinessRetries; attempt += 1) {
    const response = await request(config, "/api/ready");
    const body = response && response.status === 200 ? await readJson(response) : null;
    if (readinessIsStructured(body)) {
      ready = true;
      break;
    }
    if (attempt + 1 < config.readinessRetries) await sleep(config.readinessDelayMs);
  }
  if (!ready) throw new SmokeFailure("READINESS_DATABASE");
  report("PASS READINESS");

  if (health.buildSha.trim().toLowerCase() !== config.expectedCommitSha) throw new SmokeFailure("BUILD_SHA_MISMATCH");
  report("PASS BUILD_SHA");

  const frontendResponse = await request(config, "/");
  if (!frontendResponse || frontendResponse.status !== 200) throw new SmokeFailure("FRONTEND_HTML");
  const contentType = frontendResponse.headers.get("content-type") || "";
  const html = await frontendResponse.text();
  if (!/text\/html/i.test(contentType) || !/<html\b/i.test(html)) throw new SmokeFailure("FRONTEND_HTML");
  report("PASS FRONTEND_HTML");

  let assetUrls;
  try {
    assetUrls = firstPartyAssetUrls(config.baseUrl, html);
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    throw new SmokeFailure("FRONTEND_ASSET_MISSING");
  }
  const hasJavaScript = assetUrls.some((url) => /\.js(?:[?#].*)?$/i.test(url.pathname));
  const hasCss = assetUrls.some((url) => /\.css(?:[?#].*)?$/i.test(url.pathname));
  if (!hasJavaScript || !hasCss) throw new SmokeFailure("FRONTEND_ASSET_MISSING");
  for (const assetUrl of assetUrls) {
    const response = await requestFirstPartyAsset(config, assetUrl);
    if (!response || !response.ok) throw new SmokeFailure("FRONTEND_ASSET_MISSING");
  }
  report("PASS FRONTEND_ASSETS");

  const publicResponse = await request(config, PUBLIC_ERROR_PATH);
  if (!publicResponse || publicResponse.status >= 500) throw new SmokeFailure("PUBLIC_ENDPOINT_5XX");
  if (publicResponse.status !== 400) throw new SmokeFailure("PUBLIC_ERROR_HANDLING");
  const publicContentType = publicResponse.headers.get("content-type") || "";
  const publicBody = await readJson(publicResponse);
  if (!/^application\/(?:json|problem\+json)(?:\s*;|$)/i.test(publicContentType) ||
      !isRecord(publicBody) ||
      !isRecord(publicBody.error) ||
      !isRecord(publicBody.error.details) ||
      publicBody.error.details.code !== "missing_token") {
    throw new SmokeFailure("PUBLIC_ERROR_HANDLING");
  }
  report("PASS PUBLIC_ERROR_HANDLING");

  if (!config.authEnabled) {
    report("SKIP AUTHENTICATION_NOT_CONFIGURED");
    report("SKIP PROTECTED_READ_NOT_CONFIGURED");
    return;
  }

  const loginResponse = await request(config, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  const cookie = loginResponse && loginResponse.status === 200 ? sessionCookie(loginResponse, config.sessionCookieName) : null;
  if (!cookie) throw new SmokeFailure("AUTHENTICATION");
  const loginBody = await readJson(loginResponse);
  if (!isRecord(loginBody) || !isRecord(loginBody.user)) throw new SmokeFailure("AUTHENTICATION");
  report("PASS AUTHENTICATION");

  const protectedResponse = await request(config, PROTECTED_READ_PATH, { headers: { cookie } });
  const protectedBody = protectedResponse && protectedResponse.status === 200 ? await readJson(protectedResponse) : null;
  if (!isRecord(protectedBody) || !Array.isArray(protectedBody.settings)) throw new SmokeFailure("PROTECTED_READ");
  report("PASS PROTECTED_READ");

  const logoutResponse = await request(config, "/api/auth/logout", { method: "POST", headers: { cookie } });
  if (!logoutResponse || logoutResponse.status !== 204 || !sessionCookieWasCleared(logoutResponse, config.sessionCookieName)) {
    throw new SmokeFailure("AUTHENTICATION");
  }
  const clearedSessionResponse = await request(config, "/api/auth/me", { headers: { cookie } });
  if (!clearedSessionResponse || clearedSessionResponse.status !== 401) throw new SmokeFailure("AUTHENTICATION");
}

async function main() {
  try {
    await runFunctionalSmoke(readSmokeConfig());
  } catch (error) {
    const category = error instanceof SmokeFailure ? error.category : "UNEXPECTED";
    console.error(`FAIL ${category}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
