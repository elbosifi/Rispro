import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { caddyConfiguration } from "../src/modules/automatic-https/https-configuration.ts";

const root = process.cwd();
const caddyImage = "rispro-caddy:https-validation";
function docker(args) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 0, `${result.error?.message || ""}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("pinned Caddy includes both DNS providers and validates file placeholders without network access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-caddy-validation-"));
  try {
    const config = { id: "synthetic", enabled: true, hostname: "rispro.nccb.com.ly", serverUrl: "https://provider.example.org", subdomain: "synthetic", fullDomain: "synthetic.provider.example.org", credentials: {} };
    await writeFile(path.join(directory, "account.json"), JSON.stringify({ username: "synthetic-user", password: "synthetic-password", subdomain: config.subdomain, server_url: "http://app:3000/api/internal/automatic-https/acmedns/synthetic" }));
    await writeFile(path.join(directory, "config.json"), JSON.stringify(caddyConfiguration(config, "/validation/account.json", "a".repeat(64), true)));
    assert.match(docker(["run", "--rm", "--network", "none", "--entrypoint", "caddy", caddyImage, "list-modules"]), /^dns\.providers\.acmedns$/m);
    assert.match(docker(["run", "--rm", "--network", "none", "--entrypoint", "caddy", caddyImage, "list-modules"]), /^dns\.providers\.cloudflare$/m);
    docker(["run", "--rm", "--network", "none", "--tmpfs", "/run/rispro-https", "--mount", `type=bind,source=${directory},target=/validation,readonly`, "--entrypoint", "caddy", caddyImage, "validate", "--config", "/validation/config.json"]);
    const token = `synthetic_${"x".repeat(30)}`;
    await writeFile(path.join(directory, "token"), token);
    const cloud = caddyConfiguration({ ...config, provider: "cloudflare" }, "/validation/token", "a".repeat(64), true);
    await writeFile(path.join(directory, "cloudflare.json"), JSON.stringify(cloud));
    assert.equal(JSON.stringify(cloud).includes(token), false);
    docker(["run", "--rm", "--network", "none", "--tmpfs", "/run/rispro-https", "--mount", `type=bind,source=${directory},target=/validation,readonly`, "--entrypoint", "caddy", caddyImage, "validate", "--config", "/validation/cloudflare.json"]);
    await rm(path.join(directory, "token"));
    const missing = spawnSync("docker", ["run", "--rm", "--network", "none", "--tmpfs", "/run/rispro-https", "--mount", `type=bind,source=${directory},target=/validation,readonly`, "--entrypoint", "caddy", caddyImage, "validate", "--config", "/validation/cloudflare.json"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    assert.notEqual(missing.status, 0, "Caddy must read the token file when provisioning Cloudflare");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Nginx retains its specialized routes and validates the transport policy configuration", () => {
  docker(["run", "--rm", "--network", "none", "--add-host", "app:127.0.0.1", "--mount", `type=bind,source=${path.join(root, "docker/reverse-proxy/nginx.conf")},target=/etc/nginx/nginx.conf,readonly`, "--entrypoint", "nginx", "nginx:1.27.5-alpine", "-t"]);
});

test("HTTPS overlay preserves every database, Orthanc and MPPS deployment mode", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rispro-https-compose-"));
  const envFile = path.join(directory, "synthetic.env");
  try {
    await writeFile(envFile, `DATABASE_URL=postgresql://synthetic:synthetic@postgres:5432/synthetic_test\nOHIF_NATIVE_AUTH_SECRET=${"a".repeat(64)}\n`);
    for (const internalDb of [false, true]) for (const dicom of ["embedded", "orthanc_internal", "orthanc_external"]) for (const mpps of [false, true]) {
      const files = ["docker-compose.yml", ...(internalDb ? ["docker-compose.internal-db.yml"] : []), ...(dicom === "orthanc_internal" ? ["docker-compose.orthanc-internal.yml"] : []), ...(mpps ? ["docker-compose.mpps-bridge.yml"] : []), "docker-compose.ohif-native.yml", "docker-compose.https.yml"];
      const result = JSON.parse(docker(["compose", "--env-file", envFile, ...files.flatMap((file) => ["-f", file]), "config", "--no-env-resolution", "--format", "json"]));
      const s = result.services;
      assert.equal(Boolean(s.postgres), internalDb);
      assert.equal(Boolean(s.orthanc), dicom === "orthanc_internal");
      assert.equal(Boolean(s["mpps-bridge"]), mpps);
      assert.equal(s.caddy.restart, "unless-stopped");
      assert.ok(s.caddy.ports.some((port) => String(port.published) === "443" && port.target === 443));
      assert.ok(!s.caddy.ports.some((port) => port.target === 2019));
      assert.ok(s.gateway.ports.some((port) => String(port.published) === "3000" && port.target === 8080));
      assert.ok(s.gateway.ports.some((port) => port.host_ip === "127.0.0.1" && String(port.published) === "3001" && port.target === 8081));
      assert.ok(s.app.secrets.some((secret) => secret.source === "runtime_secret_encryption_key"));
      assert.ok(!(s["request-scan-worker"].secrets || []).some((secret) => secret.source === "runtime_secret_encryption_key"));
      for (const service of Object.values(s)) assert.ok(!(service.volumes || []).some((volume) => /docker\.sock/.test(volume.source || "")));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("private Caddy reload rejects invalid configuration and committed configuration survives restart", async () => {
  const name = `rispro-https-validation-${randomUUID()}`;
  const volume = `${name}-runtime`;
  docker(["volume", "create", volume]);
  try {
    docker(["run", "-d", "--name", name, "--network", "none", "--volume", `${volume}:/run/rispro-https`, caddyImage]);
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = spawnSync("docker", ["exec", name, "sh", "-c", "test -S /run/rispro-https/admin.sock"], { encoding: "utf8" });
      if (result.status === 0) { ready = true; break; }
      await delay(100);
    }
    assert.ok(ready, "Caddy private socket did not start");
    assert.equal(docker(["exec", name, "stat", "-c", "%a", "/run/rispro-https/admin.sock"]).trim(), "600");
    const settings = JSON.parse(docker(["inspect", name]))[0];
    assert.deepEqual(settings.HostConfig.PortBindings, {});
    const apply = String.raw`
const http = require('node:http'); const fs = require('node:fs');
const configuration = {admin:{listen:'unix//run/rispro-https/admin.sock|0600'},apps:{http:{servers:{fixture:{listen:[':8088'],routes:[{handle:[{handler:'static_response',body:'synthetic reload works'}]}]}}}}};
function load(config) { return new Promise((resolve,reject)=>{const request=http.request({socketPath:'/run/rispro-https/admin.sock',path:'/load',method:'POST',headers:{'Content-Type':'application/json'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.end(JSON.stringify(config));}); }
(async()=>{ if(await load(configuration)!==200)throw Error('reload failed');fs.writeFileSync('/run/rispro-https/current.json',JSON.stringify(configuration),{mode:0o600});if(await load({unrecognized:true})===200)throw Error('invalid config accepted'); })().catch(()=>process.exitCode=1);
`;
    docker(["run", "--rm", "--network", "none", "--volume", `${volume}:/run/rispro-https`, "node:22-bookworm-slim", "node", "-e", apply]);
    assert.equal(docker(["exec", name, "wget", "-qO-", "http://127.0.0.1:8088/"]), "synthetic reload works");
    docker(["restart", name]);
    let restored = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = spawnSync("docker", ["exec", name, "wget", "-qO-", "http://127.0.0.1:8088/"], { encoding: "utf8" });
      if (result.status === 0 && result.stdout === "synthetic reload works") { restored = true; break; }
      await delay(100);
    }
    assert.ok(restored, "Committed runtime configuration did not survive restart");
    assert.equal(docker(["exec", name, "stat", "-c", "%a", "/run/rispro-https/current.json"]).trim(), "600");
  } finally {
    spawnSync("docker", ["rm", "-f", "-v", name], { encoding: "utf8" });
    docker(["volume", "rm", volume]);
  }
});

test("Linux deployment preserves existing encryption keys, rejects conflicting keys and keeps HTTP cookie defaults", () => {
  const output = docker(["run", "--rm", "--network", "none", "--mount", `type=bind,source=${root},target=/source,readonly`, "node:22-bookworm-slim", "bash", "-c", String.raw`
set -eu
mkdir -p /tmp/https-key/scripts /tmp/https-key/docker/reverse-proxy
sed 's/\r$//' /source/scripts/docker-deployment-lib.sh > /tmp/https-key/scripts/docker-deployment-lib.sh
cp /source/docker/reverse-proxy/https-headers.sh /tmp/https-key/docker/reverse-proxy/https-headers.sh
source /tmp/https-key/scripts/docker-deployment-lib.sh
fixture_key="$(node -e 'process.stdout.write(Buffer.alloc(32,5).toString("base64"))')"
printf 'RISPRO_SECRET_ENCRYPTION_KEY="%s"\nCOOKIE_SECURE=false\n' "$fixture_key" > "$ENV_FILE"
umask 022
prepare_automatic_https
[ "$(cat "$PROJECT_ROOT/secrets/https/runtime-secret-key")" = "$fixture_key" ]
before="$(sha256sum "$PROJECT_ROOT/secrets/https/runtime-secret-key" "$PROJECT_ROOT/secrets/https/gateway-identity")"
prepare_automatic_https
[ "$before" = "$(sha256sum "$PROJECT_ROOT/secrets/https/runtime-secret-key" "$PROJECT_ROOT/secrets/https/gateway-identity")" ]
[ "$(stat -c '%a' "$PROJECT_ROOT/secrets/https/runtime-secret-key")" = 600 ]
[ "$(stat -c '%a' "$PROJECT_ROOT/secrets/https/gateway-identity")" = 600 ]
[ "$(umask)" = 0022 ]
printf 'RISPRO_SECRET_ENCRYPTION_KEY=invalid-existing-key\n' > "$ENV_FILE"
if prepare_automatic_https > /tmp/key-error.log 2>&1; then exit 1; fi
[ "$before" = "$(sha256sum "$PROJECT_ROOT/secrets/https/runtime-secret-key" "$PROJECT_ROOT/secrets/https/gateway-identity")" ]
printf 'COOKIE_SECURE=false\n' > "$ENV_FILE"
load_existing_config
hydrate_deployment_config_from_current_env
[ "$COOKIE_SECURE" = false ]
printf 'COOKIE_SECURE=true\n' > "$ENV_FILE"
load_existing_config
hydrate_deployment_config_from_current_env
[ "$COOKIE_SECURE" = true ]
printf 'PASS: encryption key persistence and unchanged HTTP cookie defaults\n'
`]);
  assert.match(output, /PASS: encryption key persistence/);
});
