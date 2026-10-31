import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import pg from "pg";
import { temporaryBootstrapConfiguration } from "../src/modules/automatic-https/https-configuration.ts";

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test("super admin configures HTTPS through the restricted temporary IP listener", async () => {
  const target = new URL(process.env.DATABASE_URL || "invalid:");
  assert.ok(process.env.RISPRO_E2E === "1" && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/rispro_e2e");
  const ip = Object.values(os.networkInterfaces()).flat().find((item) => item && !item.internal && item.family === "IPv4" && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address))?.address;
  assert.ok(ip, "A private host IPv4 address is required");
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-browser-"));
  const name = `rispro-bootstrap-browser-${randomUUID()}`;
  const containers = [`${name}-app`, `${name}-gateway`, `${name}-caddy`];
  const identity = "d".repeat(64);
  const mount = (source, destination) => ["--mount", `type=bind,source=${source},target=${destination},readonly`];
  let appProcess; let browser;
  try {
    await writeFile(path.join(directory, "identity"), identity);
    await writeFile(path.join(directory, "ip"), ip);
    await writeFile(path.join(directory, "https-headers.sh"), (await readFile("docker/reverse-proxy/https-headers.sh", "utf8")).replace(/\r\n/g, "\n"), { mode: 0o755 });
    await writeFile(path.join(directory, "backend.mjs"), `
const db=new URL(process.env.DATABASE_URL); if(process.env.RISPRO_E2E!=='1'||db.pathname!=='/rispro_e2e'||!['localhost','127.0.0.1'].includes(db.hostname)) throw Error('Disposable E2E DB required');
process.env.PGHOST=db.hostname;process.env.PGPORT=db.port;process.env.PGDATABASE='rispro_e2e';process.env.PGUSER=db.username;process.env.PGPASSWORD=db.password;
process.env.RISPRO_SECRET_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.RISPRO_HTTPS_PROVISIONED='false';
const {createApp}=await import(${JSON.stringify(pathToFileURL(path.resolve("src/app.ts")).href)});const app=createApp();app.set('trust proxy',1);
process.env.RISPRO_HTTPS_PROVISIONED='true';process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE=${JSON.stringify(path.join(directory, "identity"))};process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE=${JSON.stringify(path.join(directory, "ip"))};process.env.RISPRO_HTTPS_RUNTIME_DIR=${JSON.stringify(directory)};
app.listen(0,'0.0.0.0',function(){console.log('BOOTSTRAP_TEST_PORT='+this.address().port)});
`);
    appProcess = spawn(process.execPath, ["--env-file=e2e/.env", "--import", "tsx", path.join(directory, "backend.mjs")], { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
    const backendPort = await new Promise((resolve, reject) => {
      let output = ""; const timeout = setTimeout(() => reject(new Error("Synthetic backend startup timed out")), 20_000);
      appProcess.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/BOOTSTRAP_TEST_PORT=(\d+)/); if (match) { clearTimeout(timeout); resolve(Number(match[1])); } });
      appProcess.once("exit", () => { clearTimeout(timeout); reject(new Error("Synthetic backend stopped")); });
    });
    await writeFile(path.join(directory, "app.mjs"), `import http from 'node:http';http.createServer((req,res)=>{const proxy=http.request({hostname:'host.docker.internal',port:${backendPort},method:req.method,path:req.url,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});proxy.on('error',()=>{res.statusCode=502;res.end()});req.pipe(proxy)}).listen(3000,'0.0.0.0');`);
    await writeFile(path.join(directory, "config.json"), JSON.stringify(temporaryBootstrapConfiguration(ip, identity)));
    docker(["network", "create", name]);
    docker(["run", "-d", "--name", containers[0], "--network", name, "--network-alias", "app", ...mount(directory, "/fixture"), "node:22-bookworm-slim", "node", "/fixture/app.mjs"]);
    docker(["run", "-d", "--name", containers[1], "--network", name, "--network-alias", "gateway", "--env", `OHIF_NATIVE_AUTH_SECRET=${"b".repeat(64)}`, "--env", "NGINX_ENVSUBST_FILTER=^OHIF_NATIVE_AUTH_SECRET$", "--env", "NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/ohif-native",
      ...["ohif-native", "https-identity", "https-bootstrap", "https-listen"].flatMap((folder) => ["--tmpfs", `/etc/nginx/${folder}:mode=0700`]),
      ...mount(path.resolve("docker/reverse-proxy/nginx.conf"), "/etc/nginx/nginx.conf"), ...mount(path.join(directory, "https-headers.sh"), "/docker-entrypoint.d/40-https-headers.sh"),
      ...mount(path.resolve("docker/ohif/native-location.conf"), "/etc/nginx/templates/native.conf.template"), ...mount(path.join(directory, "identity"), "/run/secrets/https_gateway_identity"), "nginx:1.27.5-alpine"]);
    docker(["run", "-d", "--name", containers[2], "--network", name, "--network-alias", "caddy", "--publish", `${ip}::3443`, "--tmpfs", "/run/rispro-https", ...mount(directory, "/fixture"), "--entrypoint", "caddy", "rispro-caddy:https-validation", "run", "--config", "/fixture/config.json"]);
    const port = Number(JSON.parse(docker(["inspect", containers[2]]))[0].NetworkSettings.Ports["3443/tcp"][0].HostPort);
    const fingerprint = () => new Promise((resolve, reject) => { const req = https.get({ host: ip, port, path: "/login", rejectUnauthorized: false, agent: false }, (res) => { const cert = new X509Certificate(res.socket.getPeerCertificate().raw); res.resume(); resolve({ fingerprint: cert.fingerprint256, ip: cert.checkIP(ip) }); }); req.setTimeout(3000, () => req.destroy()); req.on("error", reject); });
    let certificate;
    for (let attempt = 0; attempt < 60; attempt++) { try { certificate = await fingerprint(); break; } catch {} await delay(250); }
    assert.equal(certificate?.ip, ip); assert.match(certificate.fingerprint, /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    browser = await chromium.launch({ args: ["--no-proxy-server"] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 960 } });
    const page = await context.newPage(); await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
    await page.goto(`https://${ip}:${port}/settings?section=deployment_identity`);
    await page.locator('input[autocomplete="username"]').fill("e2e_super_admin");
    await page.locator('input[autocomplete="current-password"]').fill("E2ePassword!2026");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.locator('input[autocomplete="username"]').waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => fetch("/api/auth/re-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "E2ePassword!2026" }) }).then((res) => res.status)), 200);
    await page.goto(`https://${ip}:${port}/settings?section=deployment_identity`);
    await page.getByLabel("Single-use bootstrap authorization code").waitFor();
    assert.equal(await page.getByLabel("Public RISpro URL").count(), 0);
    assert.equal(await page.getByLabel("ACME-DNS password").isDisabled(), true);
    const code = "0123456789abcdef";
    const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try { await db.query(`insert into system_settings(category,setting_key,setting_value) values('automatic_https','bootstrap_code',$1::jsonb) on conflict(category,setting_key) do update set setting_value=excluded.setting_value`, [JSON.stringify({ digest: createHash("sha256").update(code).digest("hex"), expiresAt: Date.now() + 60_000 })]); }
    finally { await db.end(); }
    await page.getByLabel("Single-use bootstrap authorization code").fill(code);
    await page.getByRole("button", { name: "Authorize temporary setup" }).click();
    await page.getByLabel("ACME-DNS password").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector('#https-password')?.disabled);
    await page.getByLabel("Hostname", { exact: true }).fill("ris.example.org");
    await page.getByLabel("ACME-DNS server URL").fill("https://provider.example.org");
    await page.getByLabel("ACME-DNS username").fill("synthetic-user"); await page.getByLabel("ACME-DNS password").fill("synthetic-password");
    await page.getByLabel("ACME-DNS subdomain").fill("account"); await page.getByLabel("ACME-DNS full domain").fill("account.provider.example.org");
    await page.getByRole("button", { name: "Save Configuration" }).click();
    await page.getByText("Configuration saved. Credentials are never displayed.").waitFor();
    assert.equal(await page.getByLabel("ACME-DNS password").inputValue(), "");
    assert.equal(await page.getByLabel("Public RISpro URL").count(), 0);
    assert.equal(await page.evaluate(() => fetch("/api/patients").then((res) => res.status)), 404);
    assert.equal(await page.evaluate(() => fetch("/api/settings/deployment-identity", { method: "PUT" }).then((res) => res.status)), 404);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("*").forEach((element) => { if (element.scrollTop) element.scrollTop = 0; }); });
    await page.screenshot({ path: path.resolve("test-results/https-bootstrap-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("*").forEach((element) => { if (element.scrollTop) element.scrollTop = 0; }); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.resolve("test-results/https-bootstrap-mobile.png"), fullPage: true });
    // Exercise the address-selection failure message without changing host networking.
    await page.route("**/api/settings/https/status", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), bootstrapUrl: null, temporaryBootstrap: false, managementTransportReady: false } });
    });
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await page.getByText(/unambiguous unicast server IPv4 address/).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
  } finally {
    await browser?.close(); appProcess?.kill();
    for (const container of containers.reverse()) spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" });
    spawnSync("docker", ["network", "rm", name], { encoding: "utf8" });
    await rm(directory, { recursive: true, force: true });
  }
});
