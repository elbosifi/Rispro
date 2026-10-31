import { lookup, Resolver } from "node:dns/promises";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { HttpError } from "../../utils/http-error.js";
import { decryptRuntimeSecret } from "../../services/runtime-secret-crypto.js";
import { cnameMatches, isPublicAddress, providerUrl, requiredCname, type HttpsConfiguration } from "./https-configuration.js";

export function accountCredentials(config: HttpsConfiguration): { username: string; password: string } {
  return JSON.parse(decryptRuntimeSecret(config.credentials));
}

export function cloudflareToken(config: HttpsConfiguration): string {
  return (JSON.parse(decryptRuntimeSecret(config.credentials)) as { token: string }).token;
}

// A read-only check confirms that the token can read a zone for this hostname.
// DNS Edit permission is exercised by Caddy during the real DNS-01 challenge.
export async function checkCloudflare(config: HttpsConfiguration): Promise<void> {
  const token = cloudflareToken(config);
  const labels = config.hostname.split(".");
  for (let index = 0; index < labels.length - 1; index++) {
    const zone = labels.slice(index).join(".");
    const result = await new Promise<{ success?: boolean; result?: Array<{ name?: string; status?: string }> }>((resolve, reject) => {
      const request = https.request({ hostname: "api.cloudflare.com", port: 443, path: `/client/v4/zones?name=${encodeURIComponent(zone)}&status=active`, method: "GET", agent: false,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, rejectUnauthorized: true }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => { body += chunk.toString(); if (body.length > 65536) request.destroy(); });
        response.on("end", () => {
          try {
            const value = JSON.parse(body);
            if (response.statusCode !== 200 || value.success !== true || !Array.isArray(value.result)) throw new Error();
            resolve(value);
          } catch { reject(new HttpError(400, "Cloudflare rejected the token or zone lookup. Check the token and Zone Read permission.")); }
        });
      });
      request.setTimeout(15_000, () => request.destroy());
      request.on("error", () => reject(new HttpError(400, "Cloudflare HTTPS connection failed.")));
      request.end();
    });
    if (result.result?.some((item) => item.name?.toLowerCase() === zone && item.status === "active")) return;
  }
  throw new HttpError(400, "No active Cloudflare zone for this hostname is accessible to the token.");
}

// No redirects or ambient proxy settings. Pin the validated address in this
// connection, retaining the provider hostname for TLS verification and SNI.
export async function updateProvider(config: HttpsConfiguration, txt = randomBytes(32).toString("base64url")): Promise<void> {
  const url = new URL(providerUrl(config.serverUrl));
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true }); } catch { throw new HttpError(400, "ACME-DNS provider DNS lookup failed."); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new HttpError(400, "ACME-DNS provider must resolve exclusively to public addresses.");
  const address = addresses[0];
  const credentials = accountCredentials(config);
  await new Promise<void>((resolve, reject) => {
    const request = https.request({ hostname: url.hostname, port: 443, path: "/update", method: "POST", agent: false,
      servername: url.hostname, rejectUnauthorized: true, family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { "Content-Type": "application/json", "X-Api-User": credentials.username, "X-Api-Key": credentials.password },
    }, (response) => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else reject(new HttpError(400, "ACME-DNS rejected the account update. Verify credentials and provider access restrictions."));
    });
    request.setTimeout(15_000, () => request.destroy(new Error("timeout")));
    request.on("error", () => reject(new HttpError(400, "ACME-DNS HTTPS connection failed.")));
    request.end(JSON.stringify({ subdomain: config.subdomain, txt }));
  });
}

export async function checkCname(config: HttpsConfiguration): Promise<void> {
  // Public recursive DNS checks delegation even when hospital split DNS is used.
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  let records: string[];
  try { records = await resolver.resolveCname(requiredCname(config).name); }
  catch { throw new HttpError(400, "The required public DNS CNAME was not found. Allow for DNS propagation and check outbound DNS access."); }
  if (!cnameMatches(records, config.fullDomain)) throw new HttpError(400, "The public DNS CNAME does not match this ACME-DNS account.");
}
