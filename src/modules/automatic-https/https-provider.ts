import { lookup, Resolver } from "node:dns/promises";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { HttpError } from "../../utils/http-error.js";
import { decryptRuntimeSecret } from "../../services/runtime-secret-crypto.js";
import { cnameMatches, isPublicAddress, providerUrl, requiredCname, type HttpsConfiguration } from "./https-configuration.js";

export function accountCredentials(config: HttpsConfiguration): { username: string; password: string } {
  return JSON.parse(decryptRuntimeSecret(config.credentials));
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
