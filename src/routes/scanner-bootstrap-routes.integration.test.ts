import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { errorHandler } from "../middleware/error-handler.js";
import { scannerBootstrapRouter } from "./scanner-bootstrap-routes.js";
import { getIntegrationStatus } from "../services/integration-service.js";
import { loadSettingsMap, upsertSettings } from "../services/settings-service.js";
import { configureNaps2ConnectOrigins, naps2ConnectOrigins } from "../config/naps2.js";
import { securityHeaders } from "../middleware/security.js";

let server: Server;
let base: string;
let userId: number;
let previousRows: { setting_key: string; setting_value: unknown }[];
const old = { endpoint: env.naps2WebscanEndpoint, enabled: env.naps2WebscanEnabled, origins: env.naps2WebscanAllowedOrigins };
const keys = ["naps2_webscan_endpoint", "naps2_webscan_enabled", "scanner_app_enabled", "scanner_bridge_mode", "naps2_setup_rispro_origin", "naps2_setup_firewall_sources", "naps2_webscan_allowed_origins"];
const cookie = (role = "receptionist") => `${env.cookieName}=${jwt.sign({ sub: userId, role }, env.jwtSecret)}`;

async function saveScanner(values: Record<string, string>) {
  return upsertSettings("documents_and_uploads", Object.entries(values).map(([key, value]) => ({ key, value })), userId);
}
function embeddedConfig(script: string) {
  return JSON.parse(Buffer.from(script.match(/FromBase64String\('([^']+)'\)/)![1], "base64").toString());
}

before(async () => {
  previousRows = (await pool.query("select setting_key, setting_value from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])", [keys])).rows;
  await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])", [keys]);
  userId = (await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'Scanner Settings Test','test-only','supervisor',true) returning id", [`naps2-settings-${process.pid}-${Date.now()}`])).rows[0].id;
  await saveScanner({ naps2_setup_rispro_origin: "http://192.9.101.30:8080", naps2_webscan_endpoint: "", naps2_webscan_enabled: "enabled", naps2_webscan_allowed_origins: "" });
  env.naps2WebscanEndpoint = "";
  env.naps2WebscanEnabled = true;
  const app = express();
  app.use(cookieParser());
  app.use(securityHeaders);
  app.use("/api/scanner-bootstrap", scannerBootstrapRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  env.naps2WebscanEndpoint = old.endpoint; env.naps2WebscanEnabled = old.enabled; env.naps2WebscanAllowedOrigins = old.origins;
  await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])", [keys]);
  for (const row of previousRows || []) await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads',$1,$2::jsonb)", [row.setting_key, JSON.stringify(row.setting_value)]);
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool.query("delete from audit_log where changed_by_user_id = $1", [userId]);
  await pool.query("delete from users where id = $1", [userId]);
  await pool.end();
});
describe("authorized independent scanner bootstrap", () => {
  it("requires an authorized workstation session", async () => {
    assert.equal((await fetch(`${base}/api/scanner-bootstrap/windows-setup`)).status, 401);
    assert.equal((await fetch(`${base}/api/scanner-bootstrap/windows-setup`, { headers: { Cookie: cookie("reporting_board") } })).status, 401);
    assert.equal((await fetch(`${base}/api/scanner-bootstrap/windows-setup`, { headers: { Cookie: cookie("administrative") } })).status, 403);
  });
  it("downloads exactly one fixed file using configured HTTP origin, ignoring Host and query input", async () => {
    const result = await fetch(`${base}/api/scanner-bootstrap/windows-setup?origin=http://attacker&path=/etc/passwd`, { headers: { Cookie: cookie(), Host: "attacker" } });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal(result.headers.get("content-type"), "application/octet-stream");
    assert.equal(result.headers.get("content-disposition"), 'attachment; filename="RISpro-NAPS2-Setup.cmd"');
    const script = await result.text();
    const config = JSON.parse(Buffer.from(script.match(/FromBase64String\('([^']+)'\)/)![1], "base64").toString());
    assert.equal(config.origin, "http://192.9.101.30:8080");
    assert.doesNotMatch(script, /attacker|passwd|PRIVATE KEY|password=/i);
    assert.equal((await fetch(`${base}/api/scanner-bootstrap/other.cmd`, { headers: { Cookie: cookie() } })).status, 404);
  });
  it("rejects invalid or missing configured origins", async () => {
    for (const origin of ["", "https://rispro.example.test", "http://192.9.101.30/unsafe"]) {
      await pool.query("update system_settings set setting_value = $1::jsonb where category='documents_and_uploads' and setting_key='naps2_setup_rispro_origin'", [JSON.stringify({ value: origin })]);
      assert.equal((await fetch(`${base}/api/scanner-bootstrap/windows-setup`, { headers: { Cookie: cookie() } })).status, 503);
    }
    await saveScanner({ naps2_setup_rispro_origin: "http://192.9.101.30:8080" });
  });
  it("selects a workstation origin only from the server CSP list", async () => {
    const response = await fetch(`${base}/api/scanner-bootstrap/windows-setup?endpoint=${encodeURIComponent("http://127.0.0.1:9849")}`, { headers: { Cookie: cookie() } });
    assert.equal(response.status, 200);
    const config = JSON.parse(Buffer.from((await response.text()).match(/FromBase64String\('([^']+)'\)/)![1], "base64").toString());
    assert.equal(config.endpoint, "http://127.0.0.1:9849");
    for (const target of ["http://attacker:9801", "http://127.0.0.1:9849/eSCL", "http://127.0.0.1:9849;whoami"]) assert.equal((await fetch(`${base}/api/scanner-bootstrap/windows-setup?endpoint=${encodeURIComponent(target)}`, { headers: { Cookie: cookie() } })).status, 400);
  });
  it("does not force port 9801 or advertise a legacy companion", async () => {
    const status = await getIntegrationStatus();
    assert.equal(status.scanner.naps2WebScanEndpoint, "");
    assert.equal(status.scanner.naps2WebScanEnabled, true);
    assert.equal(status.scanner.scannerAppEnabled, false);
    assert.equal(status.scanner.bridgeReady, false);
    assert.ok(status.scanner.naps2WebScanAllowedOrigins.includes("http://127.0.0.1:9850"));
  });
  it("honors global disablement even when the old bridge-mode field still says NAPS2", async () => {
    env.naps2WebscanEnabled = true;
    await saveScanner({ naps2_webscan_enabled: "disabled" });
    await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads','scanner_bridge_mode','{\"value\":\"naps2_webscan\"}'::jsonb)");
    const status = await getIntegrationStatus();
    assert.equal(status.scanner.naps2WebScanEnabled, false);
    assert.equal(status.scanner.scannerBridgeMode, "manual_browser_upload");
    await saveScanner({ naps2_webscan_enabled: "enabled" });
  });
  it("uses saved UI values immediately for download, endpoint precedence and exact CSP approval", async () => {
    env.naps2WebscanEndpoint = "http://192.9.101.99:9801";
    env.naps2WebscanAllowedOrigins = ["http://192.9.101.98:9801"];
    await saveScanner({
      naps2_setup_rispro_origin: "http://192.9.101.31:8081",
      naps2_webscan_endpoint: "http://192.9.101.40:9828",
      naps2_webscan_allowed_origins: "http://192.9.101.41:9814",
      naps2_setup_firewall_sources: "192.9.101.12,192.9.102.0/24",
    });
    const status = await getIntegrationStatus();
    assert.equal(status.scanner.naps2WebScanEndpoint, "http://192.9.101.40:9828");
    assert.ok(status.scanner.naps2WebScanAllowedOrigins.includes("http://192.9.101.41:9814"));
    assert.equal(status.scanner.naps2WebScanAllowedOrigins.includes(env.naps2WebscanEndpoint), false);
    assert.equal(status.scanner.naps2WebScanAllowedOrigins.includes(env.naps2WebscanAllowedOrigins[0]), false);
    const response = await fetch(`${base}/api/scanner-bootstrap/windows-setup`, { headers: { Cookie: cookie(), Host: "untrusted" } });
    assert.equal(response.status, 200);
    assert.deepEqual(embeddedConfig(await response.text()), { origin: "http://192.9.101.31:8081", endpoint: "http://192.9.101.40:9828", sources: ["192.9.101.12", "192.9.102.0/24"] });
    const csp = response.headers.get("content-security-policy")!;
    assert.ok(csp.includes("http://192.9.101.40:9828"));
    assert.ok(csp.includes("http://192.9.101.41:9814"));
    assert.equal(csp.includes("http://192.9.101.99:9801"), false);
    assert.ok(csp.includes("wss://localhost:8181"));
    assert.equal(csp.includes("*"), false);
  });
  it("rejects invalid UI configuration atomically and leaves active scanner approvals unchanged", async () => {
    const before = await loadSettingsMap(["documents_and_uploads"]);
    const origins = naps2ConnectOrigins();
    for (const [key, value] of [
      ["naps2_setup_rispro_origin", "https://192.9.101.30"],
      ["naps2_setup_rispro_origin", "http://192.9.101.30/unsafe"],
      ["naps2_webscan_endpoint", "http://user:pass@192.9.101.40:9801"],
      ["naps2_webscan_allowed_origins", "http://192.9.*:9801"],
      ["naps2_webscan_allowed_origins", "http://192.9.101.40:9801/eSCL"],
      ["naps2_setup_firewall_sources", "0.0.0.0/0"],
      ["naps2_setup_firewall_sources", "Any"],
    ]) {
      await assert.rejects(upsertSettings("documents_and_uploads", [{ key: "naps2_setup_rispro_origin", value: "http://192.9.101.55" }, { key, value }], userId), (error: unknown) => (error as { statusCode: number }).statusCode === 400);
      assert.deepEqual(await loadSettingsMap(["documents_and_uploads"]), before);
      assert.deepEqual(naps2ConnectOrigins(), origins);
    }
  });
  it("restores exact approvals from persisted settings on startup and keeps response headers free of DB reads", async () => {
    configureNaps2ConnectOrigins({ naps2_webscan_endpoint: "", naps2_webscan_allowed_origins: "" });
    assert.equal(naps2ConnectOrigins().includes("http://192.9.101.40:9828"), false);
    configureNaps2ConnectOrigins((await loadSettingsMap(["documents_and_uploads"])).documents_and_uploads);
    assert.ok(naps2ConnectOrigins().includes("http://192.9.101.40:9828"));
    const spy = mock.method(pool, "query", () => { throw new Error("Headers must not query the DB"); });
    try {
      for (let index = 0; index < 5; index++) {
        const headers: Record<string, string> = {};
        securityHeaders({} as any, { setHeader: (name: string, value: string) => { headers[name] = value; } } as any, () => {});
        assert.ok(headers["Content-Security-Policy"].includes("http://192.9.101.40:9828"));
      }
      assert.equal(spy.mock.callCount(), 0);
    } finally { spy.mock.restore(); }
  });

});
