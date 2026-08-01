import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { env } from "../config/env.js";
import { errorHandler } from "../middleware/error-handler.js";
import { publicPrintingBootstrapRouter } from "../routes/public-printing-bootstrap-routes.js";
import { getQzBootstrapManifest } from "./qz-bootstrap-service.js";
import { loadValidatedQzIdentity } from "./qz-signing-service.js";

const directory = mkdtempSync(join(tmpdir(), "rispro-qz-bootstrap-"));
const identity = join(directory, "identity");
const original = { mode: env.qzTrustMode, production: env.isProduction, base: process.env.PUBLIC_APP_BASE_URL };
const names = ["QZ_ROOT_CERTIFICATE_FILE", "QZ_CERTIFICATE_FILE", "QZ_PRIVATE_KEY_FILE", "QZ_CERTIFICATE", "QZ_PRIVATE_KEY"] as const;
const originalValues = Object.fromEntries(names.map((name) => [name, process.env[name]]));

function bashExecutable(): string {
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  return process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
}

before(() => {
  execFileSync(bashExecutable(), [resolve("scripts/qz/generate-qz-signing-identity.sh")], { env: { ...process.env, QZ_IDENTITY_DIR: identity }, stdio: "pipe" });
  env.qzTrustMode = "internal_ca";
  env.isProduction = true;
  process.env.PUBLIC_APP_BASE_URL = "https://rispro.example.test";
  process.env.QZ_ROOT_CERTIFICATE_FILE = join(identity, "qz-root-ca.crt");
  process.env.QZ_CERTIFICATE_FILE = join(identity, "qz-signing-certificate.pem");
  process.env.QZ_PRIVATE_KEY_FILE = join(identity, "qz-signing-private-key.pem");
  process.env.QZ_CERTIFICATE = "inline-must-not-be-used";
  process.env.QZ_PRIVATE_KEY = "inline-must-not-be-used";
});

after(() => {
  env.qzTrustMode = original.mode;
  env.isProduction = original.production;
  if (original.base === undefined) delete process.env.PUBLIC_APP_BASE_URL; else process.env.PUBLIC_APP_BASE_URL = original.base;
  for (const name of names) { const value = originalValues[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  rmSync(directory, { recursive: true, force: true });
});

describe("QZ Phase 1 identity and bootstrap", () => {
  it("loads file-mounted PKCS#8 RSA identity, matches the key, and validates the internal chain", () => {
    const loaded = loadValidatedQzIdentity();
    assert.equal(loaded.trustMode, "internal_ca");
    assert.equal(loaded.privateKey.asymmetricKeyType, "rsa");
    assert.ok((loaded.privateKey.asymmetricKeyDetails?.modulusLength || 0) >= 2048);
    assert.equal(loaded.root?.ca, true);
    assert.equal(loaded.signing.ca, false);
    assert.doesNotMatch(loaded.signingCertificate, /PRIVATE KEY/);
  });

  it("never falls back to inline material when a configured file is invalid", () => {
    const previous = process.env.QZ_CERTIFICATE_FILE;
    process.env.QZ_CERTIFICATE_FILE = join(directory, "missing.pem");
    assert.throws(() => loadValidatedQzIdentity(), /file is configured but could not be read/);
    process.env.QZ_CERTIFICATE_FILE = previous;
  });

  it("retains qz_issued file mode without requiring or reading an internal root", () => {
    const previousMode = env.qzTrustMode;
    const previousRoot = process.env.QZ_ROOT_CERTIFICATE_FILE;
    env.qzTrustMode = "qz_issued";
    process.env.QZ_ROOT_CERTIFICATE_FILE = join(directory, "must-not-be-read.pem");
    try {
      const loaded = loadValidatedQzIdentity();
      assert.equal(loaded.trustMode, "qz_issued");
      assert.equal(loaded.root, null);
    } finally {
      env.qzTrustMode = previousMode;
      process.env.QZ_ROOT_CERTIFICATE_FILE = previousRoot;
    }
  });

  it("reports ready metadata only for a validated identity and matching installer hash", () => {
    const installer = join(directory, "installer.exe");
    writeFileSync(installer, "test-installer");
    const digest = createHash("sha256").update(readFileSync(installer)).digest("hex");
    const manifest = getQzBootstrapManifest({ installerPath: installer, expectedInstallerSha256: digest });
    assert.equal(manifest.ready, true);
    assert.equal(manifest.printingSettingsUrl, "https://rispro.example.test/workstation/printing");
    assert.equal(manifest.qzInstallerSha256, digest);
    assert.deepEqual(manifest.securePorts, [8181, 8282, 8383, 8484]);
    assert.equal(getQzBootstrapManifest({ installerPath: installer, expectedInstallerSha256: "0".repeat(64) }).ready, false);
  });

  it("serves only public certificate/script material with strict download headers", async () => {
    const app = express();
    app.use("/api/public/printing-bootstrap", publicPrintingBootstrapRouter);
    app.use(errorHandler);
    const server = createServer(app);
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/api/public/printing-bootstrap`;
    try {
      for (const endpoint of ["root-certificate", "signing-certificate", "windows-script"]) {
        const response = await fetch(`${base}/${endpoint}`);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.doesNotMatch(body, /BEGIN (?:RSA )?PRIVATE KEY/);
      }
      const script = await fetch(`${base}/windows-script`);
      assert.equal(script.headers.get("content-disposition"), 'attachment; filename="RISpro-Printing-Setup.ps1"');
      assert.match(await script.text(), /https:\/\/rispro\.example\.test/);
    } finally { await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }
  });
});
