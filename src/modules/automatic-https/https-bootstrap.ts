import { createHash, randomBytes, X509Certificate } from "node:crypto";
import tls from "node:tls";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { logSecurityAuditEntry } from "../../services/audit-service.js";
import { BOOTSTRAP_COOKIE, bootstrapIp, bootstrapSessionHash, temporaryBootstrapRequest } from "./https-transport.js";

const CODE_LIFETIME_MS = 5 * 60_000;
const digest = (code: string) => createHash("sha256").update(code).digest("hex");

// Called only by a trusted server-console command after fetching the actual
// leaf certificate from the private Caddy service. The code itself is never stored.
export async function issueBootstrapCode(): Promise<{ ip: string; fingerprint: string; code: string }> {
  const ip = bootstrapIp();
  if (!ip) throw new Error("No unambiguous private bootstrap address is available.");
  const fingerprint = await new Promise<string>((resolve, reject) => {
    const socket = tls.connect({ host: "caddy", port: 3443, rejectUnauthorized: false }, () => {
      try {
        const peer = socket.getPeerCertificate();
        const certificate = new X509Certificate(peer.raw);
        if (!certificate.checkIP(ip) || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error("Caddy is not serving a current certificate for the expected IP.");
        resolve(certificate.fingerprint256);
      } catch (error) { reject(error); } finally { socket.destroy(); }
    });
    socket.setTimeout(5000, () => socket.destroy(new Error("Bootstrap TLS connection timed out.")));
    socket.on("error", reject);
  });
  const code = randomBytes(8).toString("hex");
  await pool.query(`insert into system_settings(category, setting_key, setting_value) values('automatic_https','bootstrap_code',$1::jsonb)
    on conflict(category,setting_key) do update set setting_value=excluded.setting_value,updated_at=now()`,
  [JSON.stringify({ digest: digest(code), expiresAt: Date.now() + CODE_LIFETIME_MS })]);
  return { ip, fingerprint, code };
}

export async function authorizeBootstrap(req: Request, res: Response) {
  if (!temporaryBootstrapRequest(req)) throw new HttpError(403, "Bootstrap authorization requires the temporary HTTPS connection.");
  const code = req.body?.code;
  if (typeof code !== "string" || !/^[a-f0-9]{16}$/.test(code)) throw new HttpError(400, "Invalid bootstrap authorization code.");
  const session = req.cookies?.[`${env.cookieName}_https`];
  if (!session) throw new HttpError(401, "Authentication required.");
  // DELETE is atomic, so concurrent submissions cannot reuse a valid code.
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`delete from system_settings where category='automatic_https' and setting_key='bootstrap_code'
      and setting_value->>'digest'=$1 and (setting_value->>'expiresAt')::bigint > $2 returning setting_key`, [digest(code), Date.now()]);
    if (!result.rowCount) throw new HttpError(403, "The bootstrap code is invalid, expired or already used.");
    await logSecurityAuditEntry({ entityType: "https_configuration", actionType: "https_bootstrap_authorized", changedByUserId: req.user!.sub }, client);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
  const grant = jwt.sign({ purpose: "https-bootstrap", session: bootstrapSessionHash(session) }, env.jwtSecret, { expiresIn: "10m" });
  res.cookie(BOOTSTRAP_COOKIE, grant, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/settings/https", maxAge: 10 * 60_000 });
  res.json({ authorized: true });
}
