import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { enforceAutomaticHttps, httpsTransportPolicy, requireHttpsManagementTransport } from "./https-transport.js";

test("only verified transport permits management; HTTP remains available until redirects are explicitly enabled", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-https-transport-"));
  const names = ["RISPRO_HTTPS_PROVISIONED", "RISPRO_HTTPS_RUNTIME_DIR", "RISPRO_HTTPS_GATEWAY_IDENTITY_FILE"];
  const before = names.map((name) => process.env[name]);
  process.env.RISPRO_HTTPS_PROVISIONED = "true";
  process.env.RISPRO_HTTPS_RUNTIME_DIR = directory;
  process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE = path.join(directory, "identity");
  const token = "a".repeat(64);
  await writeFile(path.join(directory, "identity"), token);
  const app = express(); app.set("trust proxy", 1);
  app.get("/policy", httpsTransportPolicy);
  app.use(enforceAutomaticHttps);
  app.put("/api/settings/https", requireHttpsManagementTransport, (_req, res) => res.json({ ok: true }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/ohif/", (_req, res) => res.send("viewer"));
  app.use((error: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.sendStatus(error.statusCode || 500); });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const request = (route: string, headers: Record<string, string> = {}, method = "GET") => fetch(`${url}${route}`, { method, headers, redirect: "manual" });
  try {
    assert.equal((await request("/api/settings/https", { "X-Forwarded-Proto": "https" }, "PUT")).status, 403);
    assert.equal((await request("/api/settings/https", { "X-Forwarded-Proto": "https", "X-Rispro-Https-Gateway": token }, "PUT")).status, 200);
    assert.equal((await request("/api/settings/https", { Host: "localhost:3001", Origin: "http://localhost:3001", "X-Rispro-Local-Bootstrap": token }, "PUT")).status, 200);
    assert.equal((await request("/api/settings/https", { Host: "localhost:3001", Origin: "https://attacker.org", "X-Rispro-Local-Bootstrap": token }, "PUT")).status, 403);
    assert.equal((await request("/ohif/")).status, 200);
    await writeFile(path.join(directory, "active-origin.json"), JSON.stringify({ origin: "https://rispro.nccb.com.ly" }));
    const redirected = await request("/ohif/?study=synthetic", { "X-Forwarded-Proto": "https" });
    assert.equal(redirected.status, 307);
    assert.equal(redirected.headers.get("cache-control"), "no-store");
    assert.equal(redirected.headers.get("location"), "https://rispro.nccb.com.ly/ohif/?study=synthetic");
    assert.equal((await request("/api/health")).status, 200);
    assert.equal((await request("/ohif/", { "X-Forwarded-Proto": "https", "X-Rispro-Https-Gateway": token })).status, 200);
    assert.equal((await request("/policy", { "X-Rispro-Original-Uri": "/ohif/" })).status, 401);
    assert.equal((await request("/policy", { "X-Rispro-Original-Uri": "/ohif/", "X-Forwarded-Proto": "https", "X-Rispro-Https-Gateway": token })).status, 204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (let index = 0; index < names.length; index++) { if (before[index] === undefined) delete process.env[names[index]]; else process.env[names[index]] = before[index]; }
    await rm(directory, { recursive: true, force: true });
  }
});
