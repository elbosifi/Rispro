import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const bash = process.platform === "win32" && existsSync("C:\\Program Files\\Git\\bin\\bash.exe") ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const script = resolve("scripts/qz/generate-qz-signing-identity.sh");
const files = ["qz-root-ca.crt", "qz-root-ca.key", "qz-signing-certificate.pem", "qz-signing-private-key.pem", "qz-signing-public-key.pem", "qz-signing-metadata.json"];
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("QZ identity generation is complete, idempotent, and refuses partial material", () => {
  const root = mkdtempSync(join(tmpdir(), "rispro-qz-deploy-"));
  const identity = join(root, "identity");
  const env = { ...process.env, QZ_IDENTITY_DIR: identity };
  try {
    execFileSync(bash, [script], { env, stdio: "pipe" });
    assert.deepEqual(files.filter((name) => existsSync(join(identity, name))), files);
    const first = Object.fromEntries(files.map((name) => [name, digest(join(identity, name))]));
    execFileSync(bash, [script], { env, stdio: "pipe" });
    assert.deepEqual(Object.fromEntries(files.map((name) => [name, digest(join(identity, name))])), first);

    const partial = join(root, "partial");
    writeFileSync(partial, "not-a-directory");
    const refused = spawnSync(bash, [script], { env: { ...process.env, QZ_IDENTITY_DIR: partial }, encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.match(`${refused.stdout}${refused.stderr}`, /refusing replacement without --repair/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("QZ installer caching preserves an already validated pinned file", () => {
  const root = mkdtempSync(join(tmpdir(), "rispro-qz-cache-"));
  const cache = join(root, "cache");
  const installer = join(cache, "qz-tray-2.2.6-x86_64.exe");
  const env = { ...process.env, QZ_INSTALLER_CACHE_DIR: cache };
  try {
    execFileSync(bash, [resolve("scripts/qz/cache-qz-installer.sh")], { env, stdio: "pipe" });
    const first = digest(installer);
    assert.equal(first, "aeb93a601c27f5fa6bb464f63471e7acd43052ba384fef49dceec8290d4f7587");
    execFileSync(bash, [resolve("scripts/qz/cache-qz-installer.sh")], { env, stdio: "pipe" });
    assert.equal(digest(installer), first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rendered Compose grants QZ runtime resources only to app", () => {
  const root = mkdtempSync(join(tmpdir(), "rispro-qz-compose-"));
  try {
    cpSync(resolve("docker-compose.yml"), join(root, "docker-compose.yml"));
    cpSync(resolve(".env.example"), join(root, ".env"));
    const rendered = execFileSync("docker", ["compose", "config", "--format", "json"], { cwd: root, encoding: "utf8" });
    const model = JSON.parse(rendered);
    const app = model.services.app;
    const worker = model.services["request-scan-worker"];
    const secretNames = (service) => (service.secrets || []).map((entry) => typeof entry === "string" ? entry : entry.source);
    const volumes = (service) => service.volumes || [];
    const qzSecrets = ["qz_root_certificate", "qz_signing_certificate", "qz_signing_private_key"];
    assert.deepEqual(secretNames(app).filter((name) => qzSecrets.includes(name)).sort(), [...qzSecrets].sort());
    assert.deepEqual(secretNames(worker).filter((name) => qzSecrets.includes(name)), []);
    const installerMount = volumes(app).find((entry) => entry.target === "/var/lib/rispro/qz-bootstrap");
    assert.ok(installerMount);
    assert.equal(installerMount.read_only, true);
    assert.equal(volumes(worker).some((entry) => entry.target === "/var/lib/rispro/qz-bootstrap"), false);
    assert.deepEqual(app.environment, { ...app.environment,
      QZ_ROOT_CERTIFICATE_FILE: "/run/secrets/qz_root_certificate",
      QZ_CERTIFICATE_FILE: "/run/secrets/qz_signing_certificate",
      QZ_PRIVATE_KEY_FILE: "/run/secrets/qz_signing_private_key",
      QZ_INSTALLER_FILE: "/var/lib/rispro/qz-bootstrap/qz-tray-2.2.6-x86_64.exe",
    });
    for (const [variable, secret] of [["QZ_ROOT_CERTIFICATE_FILE", "qz_root_certificate"], ["QZ_CERTIFICATE_FILE", "qz_signing_certificate"], ["QZ_PRIVATE_KEY_FILE", "qz_signing_private_key"]]) {
      assert.equal(app.environment[variable], `/run/secrets/${secret}`);
      assert.ok(secretNames(app).includes(secret));
    }
    assert.equal(secretNames(worker).includes("qz_signing_private_key"), false);
    assert.doesNotMatch(rendered, /qz-root-ca\.key/);
    assert.equal(volumes(app).some((entry) => /secrets[\\/]qz[\\/]identity[\\/]?$/.test(entry.source || "")), false);
    assert.deepEqual(Object.values(model.secrets).map((entry) => entry.file.split(/[\\/]/).pop()).sort(), ["qz-root-ca.crt", "qz-signing-certificate.pem", "qz-signing-private-key.pem"].sort());
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("deployment readiness checks mounted files in app and denies them to the request-scan worker", () => {
  const source = readFileSync("scripts/docker-deployment-lib.sh", "utf8");
  assert.match(source, /exec -T app sh -c 'test -r \/run\/secrets\/qz_root_certificate && test -r \/run\/secrets\/qz_signing_certificate && test -r \/run\/secrets\/qz_signing_private_key && test -r \/var\/lib\/rispro\/qz-bootstrap\/qz-tray-2\.2\.6-x86_64\.exe'/);
  assert.match(source, /exec -T request-scan-worker sh -c 'test ! -e \/run\/secrets\/qz_root_certificate && test ! -e \/run\/secrets\/qz_signing_certificate && test ! -e \/run\/secrets\/qz_signing_private_key && test ! -e \/var\/lib\/rispro\/qz-bootstrap'/);
});
