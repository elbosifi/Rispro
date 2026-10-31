import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import tls from "node:tls";
import { X509Certificate, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { bootstrapCaddyConfiguration, temporaryBootstrapConfiguration } from "../src/modules/automatic-https/https-configuration.ts";
import { issueBootstrapCode } from "../src/modules/automatic-https/https-bootstrap.ts";
import { pool } from "../src/db/pool.ts";

test.after(() => pool.end());

test("host IP selection prefers a unique default interface and fails closed on ambiguity", () => {
  const script = String.raw`
set -eu
mkdir -p /tmp/rispro-ip/scripts /tmp/rispro-ip/docker/reverse-proxy
sed 's/\r$//' /source/scripts/docker-deployment-lib.sh > /tmp/rispro-ip/scripts/docker-deployment-lib.sh
cp /source/docker/reverse-proxy/https-headers.sh /tmp/rispro-ip/docker/reverse-proxy/https-headers.sh
cat > /tmp/rispro-ip/mock.cjs <<'EOF'
const fs = require('node:fs'); const os = require('node:os'); const read = fs.readFileSync;
os.networkInterfaces = () => ({ eth0: [{ family:'IPv4', internal:false, address:process.env.FIXTURE_IP || '192.9.101.250' }], eth1: [{ family:'IPv4', internal:false, address:'10.8.0.10' }] });
fs.readFileSync = function(file,...args) { if (file === '/proc/net/route') return process.env.BOOTSTRAP_IP_FIXTURE === 'docker' ? 'Iface Destination Gateway Flags RefCnt Use Metric Mask\ndocker0 00000000 01000000 0003 0 0 100 00000000\n' : 'Iface Destination Gateway Flags RefCnt Use Metric Mask\neth0 00000000 01000000 0003 0 0 100 00000000\neth1 00000000 01000000 0003 0 0 '+(process.env.BOOTSTRAP_IP_FIXTURE === 'ambiguous' ? '100' : '200')+' 00000000\n'; return read.call(this,file,...args); };
EOF
source /tmp/rispro-ip/scripts/docker-deployment-lib.sh
export NODE_OPTIONS='--require /tmp/rispro-ip/mock.cjs'
export BOOTSTRAP_IP_FIXTURE=preferred
prepare_automatic_https
[ "$(cat "$PROJECT_ROOT/secrets/https/bootstrap-ip")" = '192.9.101.250' ]
export BOOTSTRAP_IP_FIXTURE=ambiguous
prepare_automatic_https
[ "$(cat "$PROJECT_ROOT/secrets/https/bootstrap-ip")" = '!ambiguous-routes' ]
export BOOTSTRAP_IP_FIXTURE=docker
prepare_automatic_https
[ "$(cat "$PROJECT_ROOT/secrets/https/bootstrap-ip")" = '!no-default-route' ]
export BOOTSTRAP_IP_FIXTURE=preferred
for FIXTURE_IP in 127.0.0.1 169.254.1.1 224.0.0.1 0.0.0.0 255.255.255.255; do
  export FIXTURE_IP
  prepare_automatic_https
  [ "$(cat "$PROJECT_ROOT/secrets/https/bootstrap-ip")" = '!no-unicast-address' ]
done
`;
  docker(["run", "--rm", "--network", "none", "--mount", `type=bind,source=${process.cwd()},target=/source,readonly`, "node:22-bookworm-slim", "bash", "-c", script]);
});

test("Caddy uses the non-RFC1918 server IP and allows only the explicitly authorized client", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-source-"));
  const name = `rispro-bootstrap-source-${randomUUID()}`;
  const gateway = `${name}-gateway`; const caddy = `${name}-caddy`;
  const subnet = `198.18.${Math.floor(Math.random() * 200 + 20)}`;
  const identity = "b".repeat(64); const serverIp = "192.9.101.250";
  const fetchFrom = (ip, spoof = false) => docker(["run", "--rm", "--network", name, "--ip", ip, "node:22-bookworm-slim", "node", "-e", `
    const https = require('node:https'); const { X509Certificate } = require('node:crypto');
    let attempts = 0; function run() { const req = https.get({host: '${subnet}.2', port:3443, rejectUnauthorized:false,
      headers:{host:'${serverIp}:3443'${spoof ? `, 'x-forwarded-for':'${subnet}.3'` : ""}}}, res => {
      const cert = new X509Certificate(res.socket.getPeerCertificate().raw); res.resume(); res.on('end', () => console.log(JSON.stringify({ status:res.statusCode, ip:cert.checkIP('${serverIp}') })));
    }); req.on('error', e => { if (++attempts < 40) setTimeout(run, 250); else { console.error(e.message); process.exit(1); } }); } run();
  `]);
  try {
    await writeFile(path.join(directory, "config.json"), JSON.stringify(temporaryBootstrapConfiguration(serverIp, identity, `${subnet}.3`)));
    docker(["network", "create", "--subnet", `${subnet}.0/24`, name]);
    docker(["run", "-d", "--name", gateway, "--network", name, "--ip", `${subnet}.5`, "--network-alias", "gateway", "node:22-bookworm-slim", "node", "-e", "require('node:http').createServer((req,res)=>res.end('ok')).listen(8080,'0.0.0.0')"]);
    docker(["run", "-d", "--name", caddy, "--network", name, "--ip", `${subnet}.2`, "--tmpfs", "/run/rispro-https", "--mount", `type=bind,source=${directory},target=/fixture,readonly`, "--entrypoint", "caddy", "rispro-caddy:https-validation", "run", "--config", "/fixture/config.json"]);
    assert.deepEqual(JSON.parse(fetchFrom(`${subnet}.3`)), { status: 200, ip: serverIp });
    assert.deepEqual(JSON.parse(fetchFrom(`${subnet}.4`, true)), { status: 404, ip: serverIp });
    await writeFile(path.join(directory, "restricted.json"), JSON.stringify(temporaryBootstrapConfiguration(serverIp, identity)));
    docker(["exec", caddy, "caddy", "reload", "--config", "/fixture/restricted.json", "--address", "unix//run/rispro-https/admin.sock"]);
    assert.deepEqual(JSON.parse(fetchFrom(`${subnet}.3`)), { status: 404, ip: serverIp });
  } finally {
    spawnSync("docker", ["rm", "-f", caddy, gateway], { encoding: "utf8" });
    spawnSync("docker", ["network", "rm", name], { encoding: "utf8" });
    await rm(directory, { recursive: true, force: true });
  }
});

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

test("pinned Caddy issues an internal IP certificate and exposes only bootstrap paths across restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-bootstrap-"));
  const name = `rispro-bootstrap-${randomUUID()}`;
  const gateway = `${name}-gateway`; const caddy = `${name}-caddy`; const volume = `${name}-data`;
  const ip = Object.values(os.networkInterfaces()).flat().find((item) => item && !item.internal && item.family === "IPv4" && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address))?.address;
  assert.ok(ip, "A private host IPv4 address is required for this direct-IP test");
  const identity = "a".repeat(64);
  const savedIpFile = process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE;
  const existingCode = await pool.query("select * from system_settings where category='automatic_https' and setting_key='bootstrap_code'");
  try {
    await writeFile(path.join(directory, "config.json"), JSON.stringify(temporaryBootstrapConfiguration(ip, identity)));
    await writeFile(path.join(directory, "gateway.mjs"), `import http from 'node:http'; http.createServer((req,res)=>{res.end(JSON.stringify({path:req.url,identity:req.headers['x-rispro-temporary-bootstrap']}))}).listen(8080,'0.0.0.0');`);
    docker(["network", "create", name]); docker(["volume", "create", volume]);
    docker(["run", "-d", "--name", gateway, "--network", name, "--network-alias", "gateway", "--mount", `type=bind,source=${directory},target=/fixture,readonly`, "node:22-bookworm-slim", "node", "/fixture/gateway.mjs"]);
    docker(["run", "-d", "--name", caddy, "--network", name, "--publish", `${ip}::3443`, "--volume", `${volume}:/data`, "--tmpfs", "/run/rispro-https", "--mount", `type=bind,source=${directory},target=/fixture,readonly`, "--entrypoint", "caddy", "rispro-caddy:https-validation", "run", "--config", "/fixture/config.json"]);
    let port = Number(JSON.parse(docker(["inspect", caddy]))[0].NetworkSettings.Ports["3443/tcp"][0].HostPort);
    const request = (url) => new Promise((resolve, reject) => {
      const req = https.request({ host: ip, port, path: url, rejectUnauthorized: false, headers: { Host: `${ip}:3443` }, agent: false }, (res) => {
        const cert = new X509Certificate(res.socket.getPeerCertificate().raw); let body = "";
        res.on("data", (chunk) => { body += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body, fingerprint: cert.fingerprint256, ip: cert.checkIP(ip) }));
      }); const deadline = setTimeout(() => req.destroy(new Error("TLS request timed out")), 5000);
      req.on("close", () => clearTimeout(deadline)); req.setTimeout(3000, () => req.destroy()); req.on("error", reject); req.end();
    });
    let response;
    for (let attempt = 0; attempt < 60; attempt++) { try { response = await request("/settings"); if (response.status === 200) break; } catch {} await delay(250); }
    assert.equal(response?.status, 200); assert.equal(response.ip, ip);
    assert.equal(JSON.parse(response.body).identity, identity);
    assert.equal((await request("/api/patients")).status, 404);
    assert.equal((await request("/ohif/")).status, 404);
    const fingerprint = response.fingerprint;
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const result = await page.goto(`https://${ip}:${port}/settings`);
      assert.equal(result?.status(), 200);
    } finally { await browser.close(); }
    await writeFile(path.join(directory, "ip"), ip);
    process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE = path.join(directory, "ip");
    const connect = tls.connect;
    const connection = mock.method(tls, "connect", (options, callback) => connect({ ...options, host: ip, port }, callback));
    try {
      const consoleResult = await issueBootstrapCode();
      assert.equal(consoleResult.fingerprint, fingerprint);
      assert.match(consoleResult.code, /^[a-f0-9]{16}$/);
      const stored = await pool.query("select setting_value from system_settings where category='automatic_https' and setting_key='bootstrap_code'");
      assert.equal(JSON.stringify(stored.rows).includes(consoleResult.code), false);
    } finally { connection.mock.restore(); }
    const restartStarted = Date.now();
    docker(["restart", caddy]);
    console.log(`Synthetic Caddy restart: ${Date.now() - restartStarted}ms`);
    port = Number(JSON.parse(docker(["inspect", caddy]))[0].NetworkSettings.Ports["3443/tcp"][0].HostPort);
    response = undefined;
    for (let attempt = 0; attempt < 60; attempt++) { try { response = await request("/settings"); if (response.status === 200) break; } catch {} await delay(250); }
    console.log("Synthetic Caddy TLS restored");
    assert.equal(response?.status, 200); assert.equal(response.fingerprint, fingerprint);
    assert.ok((await readFile(path.join(directory, "config.json"), "utf8")).includes('"install_trust":false'));
    await writeFile(path.join(directory, "final.json"), JSON.stringify(bootstrapCaddyConfiguration()));
    const reloadStarted = Date.now();
    docker(["exec", caddy, "caddy", "reload", "--config", "/fixture/final.json", "--address", "unix//run/rispro-https/admin.sock"]);
    console.log(`Synthetic bootstrap removal: ${Date.now() - reloadStarted}ms`);
    await assert.rejects(request("/settings"));
  } finally {
    if (savedIpFile === undefined) delete process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE; else process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE = savedIpFile;
    await pool.query("delete from system_settings where category='automatic_https' and setting_key='bootstrap_code'");
    for (const row of existingCode.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [row.category, row.setting_key, JSON.stringify(row.setting_value), row.updated_by_user_id]);
    spawnSync("docker", ["rm", "-f", caddy, gateway], { encoding: "utf8" });
    spawnSync("docker", ["network", "rm", name], { encoding: "utf8" });
    spawnSync("docker", ["volume", "rm", volume], { encoding: "utf8" });
    await rm(directory, { recursive: true, force: true });
  }
});
