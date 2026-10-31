// Disposable transport fixtures only. This certificate is never an application
// fallback and does not prove public certificate issuance or renewal.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { caddyConfiguration } from "../src/modules/automatic-https/https-configuration.ts";

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, `${result.error?.message || ""}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const docker = (args) => command("docker", args);

test("synthetic TLS streams OHIF/native frames, dictation, documents and large DICOM uploads through Caddy and Nginx", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-https-proxy-"));
  const name = `rispro-https-smoke-${randomUUID()}`;
  const containers = [`${name}-app`, `${name}-gateway`, `${name}-caddy`, `${name}-client`];
  const token = "a".repeat(64);
  const mount = (source, target) => ["--mount", `type=bind,source=${source},target=${target},readonly`];
  const fixtureMount = mount(directory, "/fixture");
  let application;
  let browser;
  try {
    const openssl = process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
    command(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(directory, "key.pem"), "-out", path.join(directory, "cert.pem"), "-days", "1", "-subj", "/CN=rispro.nccb.com.ly", "-addext", "subjectAltName=DNS:rispro.nccb.com.ly"]);
    await writeFile(path.join(directory, "identity"), token);
    // Docker's Linux entrypoint needs the same LF shell script as a Linux checkout.
    await writeFile(path.join(directory, "https-headers.sh"), (await readFile("docker/reverse-proxy/https-headers.sh", "utf8")).replace(/\r\n/g, "\n"), { mode: 0o755 });
    await writeFile(path.join(directory, "backend.mjs"), `
import {randomBytes} from 'node:crypto';
const database=new URL(process.env.DATABASE_URL||'invalid:');
if(process.env.RISPRO_E2E!=='1'||!['localhost','127.0.0.1'].includes(database.hostname)||database.pathname!=='/rispro_e2e')throw Error('Disposable E2E database required');
process.env.PGHOST=database.hostname;process.env.PGPORT=database.port;process.env.PGDATABASE='rispro_e2e';process.env.PGUSER=database.username;process.env.PGPASSWORD=database.password;
process.env.RISPRO_SECRET_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
process.env.RISPRO_HTTPS_PROVISIONED='false';
const {createApp}=await import(${JSON.stringify(pathToFileURL(path.resolve("src/app.ts")).href)});
const app=createApp();app.set('trust proxy',1);
// The fixture supplies transport identity after startup, without contacting any
// Docker control interface from the application process.
process.env.RISPRO_HTTPS_PROVISIONED='true';
process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE=${JSON.stringify(path.join(directory, "identity"))};
process.env.RISPRO_HTTPS_RUNTIME_DIR=${JSON.stringify(directory)};
const server=app.listen(0,'0.0.0.0',()=>console.log('RISPRO_TEST_PORT='+server.address().port));
`);
    application = spawn(process.execPath, ["--env-file=e2e/.env", "--import", "tsx", path.join(directory, "backend.mjs")], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    const backendPort = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Synthetic application did not start")), 20_000);
      application.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/RISPRO_TEST_PORT=(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
      application.on("error", (error) => { clearTimeout(timer); reject(error); });
      application.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Synthetic application exited: ${code}`)); });
    });
    const config = caddyConfiguration({ hostname: "rispro.nccb.com.ly" }, "/unused", token, true);
    config.apps.tls = { certificates: { load_files: [{ certificate: "/fixture/cert.pem", key: "/fixture/key.pem" }] } };
    config.apps.http.servers.rispro.automatic_https.disable_certificates = true;
    await writeFile(path.join(directory, "caddy.json"), JSON.stringify(config));
    await writeFile(path.join(directory, "app.mjs"), String.raw`
import http from 'node:http'; import {createHash} from 'node:crypto';
const token='${token}'; let active=false;
function handle(req,res) {
  if(req.url==='/toggle-active'||req.url==='/toggle-parallel'){active=req.url==='/toggle-active';res.end('ok');return;}
  if(req.url==='/api/internal/automatic-https/transport-policy'){
    if(active&&req.headers['x-rispro-https-gateway']!==token&&!req.headers['x-rispro-local-bootstrap']){res.statusCode=401;res.setHeader('X-Rispro-Https-Redirect','https://rispro.nccb.com.ly');}
    else res.statusCode=204;res.end();return;
  }
  if(req.url==='/api/ohif/native/authorize'){
    res.setHeader('X-Rispro-Orthanc-Origin','http://app:3000');res.setHeader('X-Rispro-Dicomweb-Path','/studies/1/series/2/instances/3/frames/1');res.end();return;
  }
  if(req.url.startsWith('/dicom-web/')||req.url.startsWith('/ohif-dicomweb/')){res.setHeader('Content-Type','application/octet-stream');res.end(Buffer.from('synthetic pixel bytes'));return;}
  if(req.url.startsWith('/ohif/')){res.setHeader('Content-Type','text/html');res.end('<title>synthetic OHIF routing fixture</title>');return;}
  if(req.url==='/api/medical-dictation/transcribe'){req.resume();req.on('end',()=>{res.setHeader('Content-Type','text/plain');res.write('first');setTimeout(()=>res.end('last'),500);});return;}
  if(req.method==='POST'&&(req.url.startsWith('/api/documents/')||req.url.startsWith('/api/pacs/remap/'))){let bytes=0;req.on('data',chunk=>bytes+=chunk.length);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({bytes,proto:req.headers['x-forwarded-proto']}));});return;}
  if(req.url!=='/headers'){const upstream=http.request({hostname:'host.docker.internal',port:${backendPort},method:req.method,path:req.url,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({proto:req.headers['x-forwarded-proto'],clientIp:req.headers['x-forwarded-for']}));
}
for(const port of [80,3000]){const server=http.createServer(handle);server.on('upgrade',(req,socket)=>{const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');});server.listen(port,'0.0.0.0');}
`);
    await writeFile(path.join(directory, "client.mjs"), String.raw`
import assert from 'node:assert/strict';import https from 'node:https';import http from 'node:http';import {readFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';
const ca=readFileSync('/fixture/cert.pem');
function request(route,{secure=true,method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{const start=Date.now();let first=0;const req=(secure?https:http).request({hostname:secure?'caddy':'gateway',port:secure?443:8080,servername:'rispro.nccb.com.ly',ca,agent:false,path:route,method,headers:{Host:'rispro.nccb.com.ly',...headers}},res=>{let text='';res.on('data',chunk=>{first ||= Date.now()-start;text+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,first,total:Date.now()-start}));});req.setTimeout(10000,()=>req.destroy(Error('timeout')));req.on('error',reject);req.end(body);});}
let ready=false;const deadline=Date.now()+15000;while(Date.now()<deadline){try{const result=await request('/headers');if(result.status===200){ready=true;break;}console.log('TLS readiness status',result.status);}catch(error){console.log('TLS readiness',error.message);}await delay(100);}assert.ok(ready,'TLS proxy did not become ready');console.log('TLS gateway ready');
assert.equal(JSON.parse((await request('/headers')).text).proto,'https');
const direct=JSON.parse((await request('/headers',{secure:false,headers:{'X-Forwarded-Proto':'https','X-Forwarded-For':'203.0.113.1'}})).text);assert.equal(direct.proto,'http');assert.notEqual(direct.clientIp,'203.0.113.1');
assert.notEqual(JSON.parse((await request('/headers',{headers:{'X-Forwarded-For':'203.0.113.1'}})).text).clientIp,'203.0.113.1');
assert.match((await request('/ohif/')).text,/synthetic OHIF routing fixture/);
for(const route of ['/ohif-native/session/studies/1/series/2/instances/3/frames/1','/ohif-dicomweb/studies/1/series/2/instances/3/frames/1'])assert.equal((await request(route)).text,'synthetic pixel bytes');console.log('OHIF and native image routing ready');
const small=await request('/api/documents/upload',{method:'POST',body:Buffer.alloc(1024*1024)});assert.equal(JSON.parse(small.text).bytes,1024*1024);
const large=await request('/api/pacs/remap/jobs/stage-multipart',{method:'POST',body:Buffer.alloc(80*1024*1024),headers:{'Content-Type':'multipart/form-data; boundary=synthetic'}});assert.equal(large.status,200);assert.equal(JSON.parse(large.text).bytes,80*1024*1024);
const stream=await request('/api/medical-dictation/transcribe',{method:'POST',body:'synthetic audio'});assert.equal(stream.text,'firstlast');assert.ok(stream.total-stream.first>=250,'dictation response was buffered');console.log('Uploads and streaming ready');
await new Promise((resolve,reject)=>{const req=https.request({hostname:'caddy',servername:'rispro.nccb.com.ly',ca,path:'/ws',headers:{Host:'rispro.nccb.com.ly',Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':'c3ludGhldGljLXRlc3Qta2V5'}},res=>reject(Error('WebSocket failed: '+res.statusCode)));req.setTimeout(5000,()=>req.destroy(Error('WebSocket timed out')));req.on('upgrade',(_res,socket)=>{socket.destroy();resolve();});req.on('error',reject);req.end();});console.log('WebSocket ready');
await new Promise((resolve,reject)=>http.get('http://app:3000/toggle-active',res=>{res.resume();res.on('end',resolve);}).on('error',reject));
for(const route of ['/ohif/','/headers']){const response=await request(route,{secure:false,headers:{'X-Forwarded-Proto':'https'}});assert.equal(response.status,307);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers.location,'https://rispro.nccb.com.ly'+route);}
assert.equal((await request('/headers')).status,200);
await new Promise((resolve,reject)=>http.get('http://app:3000/toggle-parallel',res=>{res.resume();res.on('end',resolve);}).on('error',reject));
assert.equal((await request('/headers',{secure:false})).status,200);console.log('PASS: synthetic TLS, OHIF/native bytes, 80 MiB upload, dictation streaming, WebSocket and optional HTTP enforcement');
`);
    docker(["network", "create", name]);
    docker(["run", "-d", "--name", containers[0], "--network", name, "--network-alias", "app", "--network-alias", "ohif", ...fixtureMount, "node:22-bookworm-slim", "node", "/fixture/app.mjs"]);
    docker(["run", "-d", "--name", containers[1], "--network", name, "--network-alias", "gateway", "--publish", "127.0.0.1::8080",
      "--env", `OHIF_NATIVE_AUTH_SECRET=${"b".repeat(64)}`, "--env", "NGINX_ENVSUBST_FILTER=^OHIF_NATIVE_AUTH_SECRET$", "--env", "NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/ohif-native",
      ...["ohif-native", "https-identity", "https-bootstrap", "https-listen"].flatMap((folder) => ["--tmpfs", `/etc/nginx/${folder}:mode=0700`]),
      ...mount(path.resolve("docker/reverse-proxy/nginx.conf"), "/etc/nginx/nginx.conf"),
      ...mount(path.join(directory, "https-headers.sh"), "/docker-entrypoint.d/40-https-headers.sh"),
      ...mount(path.resolve("docker/ohif/native-location.conf"), "/etc/nginx/templates/native.conf.template"),
      ...mount(path.join(directory, "identity"), "/run/secrets/https_gateway_identity"), "nginx:1.27.5-alpine"]);
    docker(["run", "-d", "--name", containers[2], "--network", name, "--network-alias", "caddy", "--publish", "127.0.0.1::443", "--tmpfs", "/run/rispro-https:mode=0700", ...fixtureMount,
      "--entrypoint", "caddy", "rispro-caddy:https-validation", "run", "--config", "/fixture/caddy.json"]);
    assert.match(docker(["run", "--rm", "--name", containers[3], "--network", name, ...fixtureMount, "node:22-bookworm-slim", "node", "/fixture/client.mjs"]), /PASS: synthetic TLS/);
    const httpPort = JSON.parse(docker(["inspect", containers[1]]))[0].NetworkSettings.Ports["8080/tcp"][0].HostPort;
    const httpsPort = JSON.parse(docker(["inspect", containers[2]]))[0].NetworkSettings.Ports["443/tcp"][0].HostPort;
    browser = await chromium.launch({ args: ["--host-resolver-rules=MAP rispro.nccb.com.ly 127.0.0.1", "--no-proxy-server"] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 960 } });
    const signIn = async (url) => {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("rispro-language", "en"));
      await page.goto(url);
      await page.locator('input[autocomplete="username"]').fill("e2e_super_admin");
      await page.locator('input[autocomplete="current-password"]').fill("E2ePassword!2026");
      await page.getByRole("button", { name: /^sign in$/i }).click();
      await page.locator('input[autocomplete="username"]').waitFor({ state: "hidden" });
      return page;
    };
    const legacy = await signIn(`http://rispro.nccb.com.ly:${httpPort}/`);
    const secure = await signIn(`https://rispro.nccb.com.ly:${httpsPort}/`);
    const reauth = await secure.evaluate(() => fetch("/api/auth/re-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "E2ePassword!2026" }) }).then((response) => response.status));
    assert.equal(reauth, 200);
    await secure.goto(`https://rispro.nccb.com.ly:${httpsPort}/settings?section=deployment_identity`);
    await secure.getByRole("heading", { name: "Automatic HTTPS", exact: true }).waitFor();
    assert.equal(await secure.getByLabel("Redirect HTTP to HTTPS").isChecked(), false);
    await secure.getByLabel("Hostname", { exact: true }).fill("rispro.nccb.com.ly");
    await secure.getByLabel("ACME-DNS server URL").fill("https://provider.example.org");
    await secure.getByLabel("ACME-DNS username").fill("synthetic-browser-user");
    await secure.getByLabel("ACME-DNS password").fill("synthetic-browser-secret");
    await secure.getByLabel("ACME-DNS subdomain").fill("synthetic-browser");
    await secure.getByLabel("ACME-DNS full domain").fill("synthetic-browser.provider.example.org");
    await secure.getByRole("button", { name: "Save Configuration" }).click();
    await secure.getByText("Configuration saved. Credentials are never displayed.").waitFor();
    assert.equal(await secure.getByLabel("ACME-DNS password").inputValue(), "");
    const saved = await secure.evaluate(() => fetch("/api/settings/https").then((response) => response.text()));
    assert.equal(saved.includes("synthetic-browser-secret"), false);
    await secure.getByLabel("Certificate Provider").selectOption("cloudflare");
    assert.equal(await secure.getByLabel("ACME-DNS password").count(), 0);
    const cloudToken = `synthetic_${"x".repeat(30)}`;
    await secure.getByLabel("Cloudflare DNS API Token").fill(cloudToken);
    await secure.getByRole("button", { name: "Save Configuration" }).click();
    await secure.getByText("Configuration saved. Credentials are never displayed.").waitFor();
    assert.equal(await secure.getByLabel("Cloudflare DNS API Token").inputValue(), "");
    const cloudSaved = await secure.evaluate(() => fetch("/api/settings/https").then((response) => response.text()));
    assert.equal(cloudSaved.includes(cloudToken), false);
    await secure.route("**/api/settings/https/test-connection", (route) => route.fulfill({ json: { valid: true } }));
    await secure.getByRole("button", { name: "Test Connection" }).click();
    await secure.getByText("The token can read the Cloudflare zone for this hostname.").waitFor();
    const cookieName = process.env.COOKIE_NAME || "rispro_session";
    const cookies = await context.cookies();
    assert.equal(cookies.find((cookie) => cookie.name === cookieName)?.secure, false);
    assert.equal(cookies.find((cookie) => cookie.name === `${cookieName}_https`)?.secure, true);
    await legacy.reload();
    await legacy.locator('input[autocomplete="username"]').waitFor({ state: "hidden" });
    assert.equal(new URL(legacy.url()).pathname.startsWith("/login"), false);
    const screenshots = path.resolve("test-results/https-proxy");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(screenshots, { recursive: true }));
    await secure.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("*").forEach((element) => { if (element.scrollTop) element.scrollTop = 0; }); });
    await secure.screenshot({ path: path.join(screenshots, "https-settings-desktop.png"), fullPage: true });
    await secure.setViewportSize({ width: 390, height: 844 });
    await secure.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("*").forEach((element) => { if (element.scrollTop) element.scrollTop = 0; }); });
    assert.equal(await secure.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await secure.screenshot({ path: path.join(screenshots, "https-settings-mobile.png"), fullPage: true });
    await secure.getByLabel("Certificate Provider").selectOption("acmedns");
    assert.equal(await secure.getByLabel("ACME-DNS server URL").inputValue(), "https://provider.example.org");
  } catch (error) {
    for (const container of containers.slice(0, 3)) {
      const logs = spawnSync("docker", ["logs", "--tail", "12", container], { encoding: "utf8" });
      console.error(logs.stdout, logs.stderr);
    }
    throw error;
  } finally {
    await browser?.close();
    application?.kill();
    for (const container of containers.reverse()) spawnSync("docker", ["rm", "-f", "-v", container], { encoding: "utf8" });
    spawnSync("docker", ["network", "rm", name], { encoding: "utf8" });
    await rm(directory, { recursive: true, force: true });
  }
});
