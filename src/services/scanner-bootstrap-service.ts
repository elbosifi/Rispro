import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { env, parseNaps2WebscanAllowedOrigins } from "../config/env.js";
import { naps2ConnectOrigins } from "../config/naps2.js";
import { HttpError } from "../utils/http-error.js";

export function validateNaps2SetupOrigin(value: string): string {
  // Direct, canonical IPv4 HTTP origins only; never trust Host/Forwarded/query input.
  if (!/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::[1-9]\d{0,4})?\/?$/.test(value)) throw new HttpError(503, "Configure NAPS2_SETUP_RISPRO_ORIGIN as the exact RISpro HTTP IPv4 origin.");
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(503, "Invalid RISpro HTTP IPv4 origin or port."); }
  const literalHost = value.slice("http://".length).split(/[/:]/, 1)[0];
  if (isIP(literalHost) !== 4 || url.hostname === "0.0.0.0" || url.hostname.startsWith("127.") || Number(url.hostname.split(".")[0]) >= 224 || Number(url.port || 80) > 65535) throw new HttpError(503, "NAPS2 setup requires a valid hospital LAN IPv4 HTTP origin.");
  return url.origin;
}

export function renderNaps2WindowsSetup(options: { origin?: string; endpoint?: string; sources?: string } = {}): string {
  const origin = validateNaps2SetupOrigin(options.origin ?? env.naps2SetupRisproOrigin);
  const endpoint = (options.endpoint ?? env.naps2WebscanEndpoint).trim();
  if (endpoint && (parseNaps2WebscanAllowedOrigins(endpoint)[0] !== endpoint.replace(/\/$/, "") || !naps2ConnectOrigins().includes(new URL(endpoint).origin))) throw new HttpError(503, "The scanner endpoint is invalid or is not approved by server CSP. Configure NAPS2_WEBSCAN_ALLOWED_ORIGINS.");
  if (endpoint) {
    const scanner = new URL(endpoint);
    if (scanner.protocol !== "http:" || (scanner.hostname !== "localhost" && isIP(scanner.hostname) !== 4) || Number(scanner.port) < 9801 || Number(scanner.port) > 9850) throw new HttpError(503, "Workstation setup requires an HTTP scanner IP endpoint on ports 9801–9850.");
  }
  const sources = (options.sources ?? env.naps2SetupFirewallSources).split(",").map((value) => value.trim()).filter(Boolean);
  for (const source of sources) {
    const [ip, prefix, extra] = source.split("/");
    if (isIP(ip) !== 4 || ip === "0.0.0.0" || Number(ip.split(".")[0]) >= 224 || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 16 || Number(prefix) > 32))) throw new HttpError(503, "NAPS2_SETUP_FIREWALL_SOURCES must contain approved IPv4 addresses or restricted IPv4 CIDRs (/16–/32).");
  }
  // Base64 is data encoding, not an integrity or secrecy mechanism.
  const config = Buffer.from(JSON.stringify({ origin, endpoint, sources }), "utf8").toString("base64");
  return readFileSync(new URL("../../scripts/naps2/windows/RISpro-NAPS2-Setup.cmd", import.meta.url), "utf8").replace("__RISPRO_NAPS2_CONFIG_BASE64__", config).replace(/\r?\n/g, "\r\n");
}
