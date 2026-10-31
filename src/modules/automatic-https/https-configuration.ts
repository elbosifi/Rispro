import { randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { encryptRuntimeSecret, type RuntimeSecretBundle } from "../../services/runtime-secret-crypto.js";
import { HttpError } from "../../utils/http-error.js";

export const HTTPS_CATEGORY = "automatic_https";
export const INITIAL_HOSTNAME = "rispro.nccb.com.ly";
export const LE_PRODUCTION = "https://acme-v02.api.letsencrypt.org/directory";
export const LE_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory";

export interface HttpsConfiguration {
  id: string;
  enabled: boolean;
  redirectHttpToHttps: boolean;
  hostname: string;
  serverUrl: string;
  subdomain: string;
  fullDomain: string;
  credentials: RuntimeSecretBundle;
}

export function dnsName(value: unknown): string {
  if (typeof value !== "string" || value.length > 253) throw new HttpError(400, "A valid DNS hostname is required.");
  const name = value.toLowerCase().replace(/\.$/, "");
  if (isIP(name) || !name.includes(".") || name.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new HttpError(400, "A valid DNS hostname is required.");
  }
  if (/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(name)) throw new HttpError(400, "Use a public DNS hostname.");
  return name;
}

export function providerUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new HttpError(400, "ACME-DNS server must be an HTTPS origin.");
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(400, "ACME-DNS server must be an HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new HttpError(400, "ACME-DNS server must be an HTTPS origin on port 443, without a path or credentials.");
  }
  dnsName(url.hostname);
  return url.origin;
}

export function validateHttpsConfiguration(input: unknown, previous?: HttpsConfiguration | null): HttpsConfiguration {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "HTTPS configuration is required.");
  const body = input as Record<string, unknown>;
  const allowed = ["enabled", "redirectHttpToHttps", "hostname", "serverUrl", "username", "password", "subdomain", "fullDomain"];
  if (Object.keys(body).some((key) => !allowed.includes(key)) || typeof body.enabled !== "boolean") throw new HttpError(400, "Invalid HTTPS configuration fields.");
  if (body.redirectHttpToHttps !== undefined && typeof body.redirectHttpToHttps !== "boolean") throw new HttpError(400, "HTTP redirect must be enabled or disabled.");
  if (typeof body.username !== "string" || typeof body.password !== "string") throw new HttpError(400, "ACME-DNS credential fields must be strings.");
  const hostname = dnsName(body.hostname);
  const serverUrl = providerUrl(body.serverUrl);
  const subdomain = typeof body.subdomain === "string" ? body.subdomain.toLowerCase() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) throw new HttpError(400, "Invalid ACME-DNS subdomain.");
  const fullDomain = dnsName(body.fullDomain);
  if (!fullDomain.startsWith(`${subdomain}.`)) throw new HttpError(400, "The ACME-DNS full domain must begin with the account subdomain.");
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (username.length > 256 || password.length > 1024 || /[^\x21-\x7e]/.test(username + password)) throw new HttpError(400, "Invalid ACME-DNS credentials.");
  const sameAccount = previous && serverUrl === previous.serverUrl && subdomain === previous.subdomain && fullDomain === previous.fullDomain;
  if ((!username || !password) && (!sameAccount || username || password)) throw new HttpError(400, "Submit both ACME-DNS username and password for a new account.");
  return { id: randomUUID(), enabled: body.enabled, redirectHttpToHttps: body.redirectHttpToHttps === true, hostname, serverUrl, subdomain, fullDomain,
    credentials: username && password ? encryptRuntimeSecret(JSON.stringify({ username, password })) : previous!.credentials };
}

export function requiredCname(config: Pick<HttpsConfiguration, "hostname" | "fullDomain">) {
  return { type: "CNAME" as const, name: `_acme-challenge.${config.hostname}`, target: config.fullDomain };
}

export function cnameMatches(records: string[], target: string): boolean {
  return records.length === 1 && records[0].toLowerCase().replace(/\.$/, "") === target.toLowerCase().replace(/\.$/, "");
}

// Only ordinary globally routed IPv4 and IPv6 addresses may receive credentials.
// IPv4-mapped IPv6 is rejected together with all other non-global IPv6 ranges.
const reservedIpv6 = new BlockList();
reservedIpv6.addSubnet("2001::", 23, "ipv6");
reservedIpv6.addSubnet("2001:db8::", 32, "ipv6");
reservedIpv6.addSubnet("2002::", 16, "ipv6");
reservedIpv6.addSubnet("3fff::", 20, "ipv6");
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
      && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 0 || b === 168))
      && !(a === 192 && b === 88 && c === 99)
      && !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0);
  }
  return isIP(address) === 6 && /^[23]/i.test(address) && !reservedIpv6.check(address, "ipv6");
}

export function bootstrapCaddyConfiguration() {
  return { admin: { listen: "unix//run/rispro-https/admin.sock|0600" }, apps: {} };
}

export function caddyConfiguration(config: HttpsConfiguration, credentialsPath: string, gatewayToken: string, staging = false) {
  if (!/^[a-f0-9]{64}$/.test(gatewayToken)) throw new Error("HTTPS gateway identity is unavailable.");
  return {
    ...bootstrapCaddyConfiguration(),
    apps: {
      tls: { certificates: { automate: [config.hostname] }, automation: { policies: [{ subjects: [config.hostname], issuers: [{ module: "acme", ca: staging ? LE_STAGING : LE_PRODUCTION,
        challenges: { http: { disabled: true }, "tls-alpn": { disabled: true }, dns: { resolvers: ["1.1.1.1:53", "8.8.8.8:53"], provider: { name: "acmedns", config_file_path: credentialsPath } } } }] }] } },
      http: { servers: { rispro: { listen: [":443"], automatic_https: { disable_redirects: true },
        routes: [{ match: [{ host: [config.hostname] }], handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "gateway:8080" }],
          flush_interval: -1, headers: { request: { set: { "X-Rispro-Https-Gateway": [gatewayToken] } }, response: { set: { "X-Rispro-Https-Gateway": ["caddy"] } } },
          transport: { protocol: "http", dial_timeout: "10s", response_header_timeout: "920s" } }] }],
        tls_connection_policies: [{}] } } },
    },
  };
}
