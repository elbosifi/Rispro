import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
