import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { checkServerIdentity, type TLSSocket } from "node:tls";
import { setTimeout as delay } from "node:timers/promises";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { logSecurityAuditEntry } from "../../services/audit-service.js";
import { isRuntimeSecretEncryptionConfigured } from "../../services/runtime-secret-crypto.js";
import { HttpError } from "../../utils/http-error.js";
import type { UserId } from "../../types/http.js";
import { bootstrapCaddyConfiguration, caddyConfiguration, temporaryBootstrapConfiguration, HTTPS_CATEGORY, INITIAL_HOSTNAME, requiredCname, validateHttpsConfiguration, type HttpsConfiguration } from "./https-configuration.js";
import { accountCredentials, checkCname, checkCloudflare, cloudflareToken, updateProvider } from "./https-provider.js";
import { bootstrapIp, equalSecret, gatewayIdentity, httpsRuntimeDirectory } from "./https-transport.js";

interface CertificateStatus { issuer: string; expiresAt: string }
interface HttpsState {
  draft: HttpsConfiguration | null;
  active: HttpsConfiguration | null;
  phase: "idle" | "pending" | "error";
  lastError: string | null;
  certificate: CertificateStatus | null;
  providers?: Partial<Record<"acmedns" | "cloudflare", HttpsConfiguration>>;
}
const emptyState = (): HttpsState => ({ draft: null, active: null, phase: "idle", lastError: null, certificate: null });
const LOCK = 719821993;
let activation: Promise<void> | null = null;
let bootstrapListenerActive = false;
let bootstrapMonitorStarted = false;

async function readState(db: Pick<PoolClient, "query"> = pool): Promise<HttpsState> {
  const result = await db.query<{ setting_value: HttpsState }>("select setting_value from system_settings where category=$1 and setting_key='configuration'", [HTTPS_CATEGORY]);
  return result.rows[0]?.setting_value || emptyState();
}

function display(state: HttpsState) {
  const value = state.draft;
  const provider = value?.provider || "acmedns";
  const acmedns = provider === "acmedns" ? value : state.providers?.acmedns;
  const cloudflare = provider === "cloudflare" ? value : state.providers?.cloudflare;
  return { provider, providerConfigurations: {
      acmedns: acmedns ? { serverUrl: acmedns.serverUrl, subdomain: acmedns.subdomain, fullDomain: acmedns.fullDomain, credentialsConfigured: true } : null,
      cloudflare: cloudflare ? { credentialsConfigured: true } : null },
    enabled: value?.enabled ?? true, redirectHttpToHttps: value?.redirectHttpToHttps ?? false, httpRedirectActive: Boolean(state.active?.redirectHttpToHttps), hostname: value?.hostname || INITIAL_HOSTNAME, serverUrl: value?.serverUrl || "",
    subdomain: value?.subdomain || "", fullDomain: value?.fullDomain || "", credentialsConfigured: Boolean(value?.credentials),
    encryptionReady: isRuntimeSecretEncryptionConfigured(), provisioned: process.env.RISPRO_HTTPS_PROVISIONED === "true",
    cname: value && provider === "acmedns" ? requiredCname(value) : null, status: state.phase === "error" ? "Error" : state.active && state.phase !== "pending" ? "Active" : "Pending",
    activeHostname: state.active?.hostname || null, activeProvider: state.active ? state.active.provider || "acmedns" : null, issuer: state.certificate?.issuer || null, expiresAt: state.certificate?.expiresAt || null,
    bootstrapUrl: (!state.active || state.phase === "error") && bootstrapIp() ? `https://${bootstrapIp()}:3443/settings?section=deployment_identity` : null,
    renewal: state.active ? "Managed automatically by Caddy; provider access and DNS delegation must remain valid." : "Pending activation",
    lastError: state.lastError, activationPending: state.phase === "pending" };
}

async function persist(state: HttpsState, userId: UserId | null, action: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into system_settings(category,setting_key,setting_value,updated_by_user_id)
      values($1,'configuration',$2::jsonb,$3) on conflict(category,setting_key) do update
      set setting_value=excluded.setting_value,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`, [HTTPS_CATEGORY, JSON.stringify(state), userId]);
    // Audit only public configuration/status. Neither ciphertext nor credentials
    // belong in audit records, errors, HTTP responses or Caddy JSON.
    await logSecurityAuditEntry({ entityType: "https_configuration", actionType: action, changedByUserId: userId,
      newValues: display(state) }, client);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

async function lock(): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [LOCK]);
    if (!result.rows[0].locked) throw new HttpError(409, "Another HTTPS configuration operation is running.");
    return client;
  } catch (error) { client.release(); throw error; }
}
async function unlock(client: PoolClient) { try { await client.query("select pg_advisory_unlock($1)", [LOCK]); } finally { client.release(); } }

async function atomicFile(filename: string, value: string) {
  const directory = httpsRuntimeDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, filename);
  const temporary = `${target}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  await rename(temporary, target);
}
async function atomicJson(filename: string, value: unknown) { await atomicFile(filename, JSON.stringify(value)); }

async function applyHttpRedirect(config: HttpsConfiguration | null) {
  if (process.env.RISPRO_HTTPS_PROVISIONED !== "true") return;
  if (config?.redirectHttpToHttps) await atomicJson("active-origin.json", { origin: `https://${config.hostname}` });
  else await rm(path.join(httpsRuntimeDirectory(), "active-origin.json"), { force: true });
}

function staging(): boolean { return process.env.NODE_ENV !== "production"; }

async function runtimeConfiguration(config: HttpsConfiguration | null, includeBootstrap = !config) {
  const ip = process.env.RISPRO_HTTPS_PROVISIONED === "true" && includeBootstrap ? bootstrapIp() : null;
  const temporary = ip ? temporaryBootstrapConfiguration(ip, gatewayIdentity()) : null;
  if (!config) return temporary || bootstrapCaddyConfiguration();
  let publicConfig: ReturnType<typeof caddyConfiguration>;
  if (config.provider === "cloudflare") {
    const filename = `cloudflare-${config.id}.token`;
    await atomicFile(filename, cloudflareToken(config));
    publicConfig = caddyConfiguration(config, path.join(httpsRuntimeDirectory(), filename), gatewayIdentity(), staging());
  } else {
    const credentialsPath = path.join(httpsRuntimeDirectory(), `account-${config.id}.json`);
    await atomicJson(`account-${config.id}.json`, { ...accountCredentials(config), subdomain: config.subdomain,
    // The plugin never contacts administrator-supplied URLs. This limited relay
    // revalidates DNS and pins a public IP for EVERY request, including renewal.
      server_url: `http://app:3000/api/internal/automatic-https/acmedns/${config.id}` });
    publicConfig = caddyConfiguration(config, credentialsPath, gatewayIdentity(), staging());
  }
  if (!temporary) return publicConfig;
  return { ...publicConfig, apps: { ...publicConfig.apps, pki: temporary.apps.pki,
    tls: { ...publicConfig.apps.tls, certificates: { automate: [...publicConfig.apps.tls.certificates.automate, ip!] },
      automation: { policies: [...temporary.apps.tls.automation.policies, ...publicConfig.apps.tls.automation.policies] } },
    http: { servers: { ...publicConfig.apps.http.servers, ...temporary.apps.http.servers } } } };
}

async function loadCaddy(configuration: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.request({ socketPath: path.join(httpsRuntimeDirectory(), "admin.sock"), path: "/load", method: "POST",
      headers: { "Content-Type": "application/json" } }, (response) => {
      response.resume();
      if (response.statusCode === 200) {
        const value = configuration as { apps?: { http?: { servers?: { bootstrap?: unknown } } } };
        bootstrapListenerActive = Boolean(value.apps?.http?.servers?.bootstrap);
        resolve();
      }
      else reject(new HttpError(503, "Caddy rejected the HTTPS configuration."));
    });
    request.setTimeout(15_000, () => request.destroy());
    request.on("error", () => reject(new HttpError(503, "The private Caddy reload interface is unavailable.")));
    request.end(JSON.stringify(configuration));
  });
}

export async function verifyHttpsGateway(hostname: string): Promise<CertificateStatus> {
  return new Promise((resolve, reject) => {
    // Connect to the actual internal Caddy service, never the public hostname
    // that may resolve to the existing external tunnel. Verify hostname/SNI.
    const request = https.request({ hostname: "caddy", port: 443, servername: hostname,
      rejectUnauthorized: true, checkServerIdentity: (_name, cert) => checkServerIdentity(hostname, cert), agent: false,
      path: "/api/health", headers: { Host: hostname },
    }, (response) => {
      const certificate = (response.socket as TLSSocket).getPeerCertificate();
      let body = "";
      response.on("data", (chunk: Buffer) => { body += chunk.toString(); if (body.length > 4096) request.destroy(); });
      response.on("end", () => {
        try {
          const result = JSON.parse(body);
          if (response.statusCode !== 200 || result.ok !== true || response.headers["x-rispro-https-gateway"] !== "caddy") throw new Error();
          resolve({ issuer: String(certificate.issuer?.O || certificate.issuer?.CN || "Trusted public issuer"), expiresAt: new Date(certificate.valid_to).toISOString() });
        } catch { reject(new HttpError(409, "The verified LAN HTTPS gateway did not reach RISpro through Caddy.")); }
      });
    });
    request.setTimeout(10_000, () => request.destroy());
    request.on("error", () => reject(new HttpError(409, "HTTPS hostname, public trust or gateway verification failed.")));
    request.end();
  });
}

// Keep ordering and rollback explicit; the caller supplies fixed operations.
export async function activateWithRollback(operations: {
  credentials: () => Promise<void>; dns: () => Promise<void>; apply: () => Promise<void>;
  verify: () => Promise<void>; commit: () => Promise<void>; rollback: () => Promise<void>;
}): Promise<void> {
  try {
    await operations.credentials(); await operations.dns(); await operations.apply();
    await operations.verify(); await operations.commit();
  } catch (error) { await operations.rollback(); throw error; }
}

export async function getHttpsSettings() { return display(await readState()); }

export async function saveHttpsSettings(input: unknown, userId: UserId) {
  const client = await lock();
  try {
    const state = await readState(client);
    const requested = (input && typeof input === "object" && "provider" in input ? input.provider : "acmedns") === "cloudflare" ? "cloudflare" : "acmedns";
    const previous = (state.draft?.provider || "acmedns") === requested ? state.draft : state.providers?.[requested];
    const draft = validateHttpsConfiguration(input, previous);
    if (state.phase === "pending") throw new HttpError(409, "HTTPS activation is already running.");
    const providers = { ...state.providers, ...(state.draft ? { [state.draft.provider || "acmedns"]: state.draft } : {}), [draft.provider || "acmedns"]: draft };
    const next = { ...state, providers, draft, phase: "idle" as const, lastError: null };
    if (!draft.enabled && state.active) {
      const previous = await runtimeConfiguration(state.active);
      const bootstrap = await runtimeConfiguration(null);
      try {
        await loadCaddy(bootstrap);
        await applyHttpRedirect(null);
        next.active = null; next.certificate = null;
        await atomicJson("current.json", bootstrap);
        await persist(next, userId, "https_disabled");
      } catch {
        await loadCaddy(previous);
        await atomicJson("current.json", previous);
        await applyHttpRedirect(state.active);
        throw new HttpError(409, "HTTPS could not be disabled. The last working configuration was retained.");
      }
    } else {
      if (state.active) {
        if (draft.redirectHttpToHttps) {
          if (draft.hostname !== state.active.hostname) throw new HttpError(409, "Activate and verify the new hostname before enabling redirects.");
          await verifyHttpsGateway(state.active.hostname);
        }
        next.active = { ...state.active, redirectHttpToHttps: draft.redirectHttpToHttps };
      }
      try { await applyHttpRedirect(next.active); await persist(next, userId, "https_configuration_saved"); }
      catch (error) { await applyHttpRedirect(state.active); throw error; }
    }
    return display(next);
  } finally { await unlock(client); }
}

export async function checkHttpsDns() {
  const state = await readState();
  if (!state.draft) throw new HttpError(409, "Save the ACME-DNS configuration first.");
  if (state.draft.provider === "cloudflare") throw new HttpError(400, "Use Test Connection for Cloudflare DNS.");
  await checkCname(state.draft);
  return { valid: true, cname: requiredCname(state.draft) };
}

export async function checkHttpsConnection() {
  const state = await readState();
  if (!state.draft || state.draft.provider !== "cloudflare") throw new HttpError(409, "Save a Cloudflare configuration first.");
  await checkCloudflare(state.draft);
  return { valid: true };
}

export async function activateHttps(userId: UserId, fromBootstrap = false) {
  if (process.env.RISPRO_HTTPS_PROVISIONED !== "true") throw new HttpError(503, "Run the supported Docker setup/update to provision Caddy first.");
  if (activation) throw new HttpError(409, "HTTPS activation is already running.");
  const client = await lock();
  let state: HttpsState;
  try {
    state = await readState(client);
    if (!state.draft?.enabled) throw new HttpError(409, "Save and enable the HTTPS configuration first.");
    await persist({ ...state, phase: "pending", lastError: null }, userId, "https_activation_started");
  } catch (error) { await unlock(client); throw error; }
  const candidate = state.draft!;
  activation = (async () => {
    let certificate: CertificateStatus | null = null;
    try {
      const retainBootstrap = !state.active || fromBootstrap;
      const oldRuntime = await runtimeConfiguration(state.active, retainBootstrap);
      await activateWithRollback({
        credentials: () => candidate.provider === "cloudflare" ? checkCloudflare(candidate) : updateProvider(candidate),
        dns: () => candidate.provider === "cloudflare" ? Promise.resolve() : checkCname(candidate),
        apply: async () => loadCaddy(await runtimeConfiguration(candidate, retainBootstrap)),
        verify: async () => {
          if (staging()) throw new HttpError(409, "Staging certificate requested. Public trust activation requires a production deployment; staging is never treated as trusted.");
          const deadline = Date.now() + 180_000;
          let last: unknown;
          while (Date.now() < deadline) {
            try { certificate = await verifyHttpsGateway(candidate.hostname); break; } catch (error) { last = error; await delay(2000); }
          }
          if (!certificate) throw last || new HttpError(409, "Certificate issuance timed out.");
        },
        commit: async () => {
          const next: HttpsState = { ...state, active: candidate, phase: "idle", lastError: null, certificate };
          await atomicJson("current.json", await runtimeConfiguration(candidate));
          await applyHttpRedirect(candidate);
          await persist(next, userId, "https_activated");
          // Give the bootstrap browser one status poll to display the verified
          // hostname before removing the temporary listener automatically.
          if (retainBootstrap && bootstrapIp()) { await delay(8000); await loadCaddy(await runtimeConfiguration(candidate)); }
        },
        rollback: async () => {
          await loadCaddy(oldRuntime);
          await atomicJson("current.json", oldRuntime);
          await applyHttpRedirect(state.active);
        },
      });
    } catch (error) {
      const message = error instanceof HttpError ? error.message : "HTTPS activation failed. The last working configuration was retained; check the private Caddy service and provider connectivity.";
      await persist({ ...state, phase: "error", lastError: message }, userId, "https_activation_failed");
    } finally { await unlock(client); }
  })().catch(() => { console.error("Automatic HTTPS activation could not persist its result; administrator recovery is required."); }).finally(() => { activation = null; });
  return { accepted: true };
}

export async function getHttpsStatus() {
  const state = await readState();
  if (state.active) {
    try { state.certificate = await verifyHttpsGateway(state.active.hostname); }
    catch { state.lastError = "The active HTTPS certificate or gateway could not be verified. Check Caddy, renewal connectivity and provider DNS delegation."; state.phase = "error"; }
  }
  return display(state);
}

export async function relayAcmeDnsUpdate(req: Request, res: Response) {
  const state = await readState();
  const config = [state.active, state.draft].find((item) => item && item.provider !== "cloudflare" && item.id === req.params.id);
  if (!config) throw new HttpError(404, "Not found.");
  const credentials = accountCredentials(config);
  if (!equalSecret(String(req.headers["x-api-user"] || ""), credentials.username) || !equalSecret(String(req.headers["x-api-key"] || ""), credentials.password)) throw new HttpError(403, "Forbidden.");
  if (!req.body || Object.keys(req.body).sort().join(",") !== "subdomain,txt" || req.body.subdomain !== config.subdomain || typeof req.body.txt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(req.body.txt)) throw new HttpError(400, "Invalid ACME-DNS update.");
  await updateProvider(config, req.body.txt);
  res.json({ txt: req.body.txt });
}

// Recovery is bounded to this feature. It never starts/recreates containers.
export async function recoverHttpsConfiguration() {
  if (process.env.RISPRO_HTTPS_PROVISIONED !== "true") return;
  const client = await lock();
  try {
    const state = await readState(client);
    const configuration = await runtimeConfiguration(state.active);
    await atomicJson("current.json", configuration);
    await applyHttpRedirect(state.active);
    // Resolve the durable operation state before waiting on Docker startup;
    // gateway health dependencies can delay Caddy beyond this retry window.
    if (state.phase === "pending") await persist({ ...state, phase: "error", lastError: "Activation was interrupted by a restart. The last working configuration was restored; retry activation." }, null, "https_activation_recovered");
    // Caddy may still be waiting for gateway/app health during VM startup.
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await loadCaddy(configuration); break; }
      catch (error) { if (attempt === 29) throw error; await delay(2000); }
    }
    if (state.active && bootstrapIp()) {
      // An expired or otherwise unverifiable public certificate must not leave
      // the administrator without a protected recovery path after restart.
      try { await verifyHttpsGateway(state.active.hostname); }
      catch { await loadCaddy(await runtimeConfiguration(state.active, true)); }
    }
  } finally { await unlock(client); }
}

// Keep recovery available if a previously trusted certificate later becomes
// unverifiable. The advisory lock prevents a monitor reload during activation.
export function startHttpsBootstrapMonitor() {
  if (bootstrapMonitorStarted || process.env.RISPRO_HTTPS_PROVISIONED !== "true") return;
  bootstrapMonitorStarted = true;
  setInterval(() => {
    void (async () => {
      if (!bootstrapIp()) return;
      let client: PoolClient;
      try { client = await lock(); } catch { return; }
      try {
        const state = await readState(client);
        if (!state.active || state.phase === "pending") return;
        let trusted = false;
        try { await verifyHttpsGateway(state.active.hostname); trusted = true; } catch { /* recovery remains protected */ }
        if (!trusted && !bootstrapListenerActive) await loadCaddy(await runtimeConfiguration(state.active, true));
        else if (trusted && bootstrapListenerActive && state.phase !== "error") await loadCaddy(await runtimeConfiguration(state.active));
      } finally { await unlock(client); }
    })().catch(() => console.error("Automatic HTTPS bootstrap monitoring failed; check the private Caddy service."));
  }, 60_000).unref();
}
