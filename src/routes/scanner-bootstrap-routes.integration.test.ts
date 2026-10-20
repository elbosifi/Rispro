import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { errorHandler } from "../middleware/error-handler.js";
import { scannerBootstrapRouter } from "./scanner-bootstrap-routes.js";
import { getIntegrationStatus } from "../services/integration-service.js";

let server: Server;
let base: string;
let previousRows: { setting_key: string; setting_value: unknown }[];
const old = { origin: env.naps2SetupRisproOrigin, endpoint: env.naps2WebscanEndpoint, enabled: env.naps2WebscanEnabled };
const keys = ["naps2_webscan_endpoint", "naps2_webscan_enabled", "scanner_app_enabled", "scanner_bridge_mode"];
const cookie = (role = "receptionist") => `${env.cookieName}=${jwt.sign({ sub: 1, role }, env.jwtSecret)}`;

before(async () => {
  previousRows = (await pool.query("select setting_key, setting_value from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])", [keys])).rows;
  await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])", [keys]);
  env.naps2SetupRisproOrigin = "http://192.9.101.30:8080";
  env.naps2WebscanEndpoint = "";
  env.naps2WebscanEnabled = true;
  const app = express();
  app.use(cookieParser());
  app.use("/api/scanner-bootstrap", scannerBootstrapRouter);
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  env.naps2SetupRisproOrigin = old.origin; env.naps2WebscanEndpoint = old.endpoint; env.naps2WebscanEnabled = old.enabled;
  await pool.query("delete from system_settings where category='documents_and_uploads' and setting_key=any($1::text[])", [keys]);
  for (const row of previousRows || []) await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads',$1,$2::jsonb)", [row.setting_key, JSON.stringify(row.setting_value)]);
  await new Promise<void>((resolve) => server?.close(() => resolve()));
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
      env.naps2SetupRisproOrigin = origin;
      assert.equal((await fetch(`${base}/api/scanner-bootstrap/windows-setup`, { headers: { Cookie: cookie() } })).status, 503);
    }
    env.naps2SetupRisproOrigin = "http://192.9.101.30:8080";
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
    env.naps2WebscanEnabled = false;
    await pool.query("insert into system_settings(category,setting_key,setting_value) values('documents_and_uploads','scanner_bridge_mode','{\"value\":\"naps2_webscan\"}'::jsonb)");
    const status = await getIntegrationStatus();
    assert.equal(status.scanner.naps2WebScanEnabled, false);
    assert.equal(status.scanner.scannerBridgeMode, "manual_browser_upload");
  });
});
