import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { appendFile, readFile, stat, utimes } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import express from "express";
import { env } from "../config/env.js";
import { errorHandler } from "../middleware/error-handler.js";
import { __publicPrintingBootstrapTestables, publicPrintingBootstrapRouter } from "../routes/public-printing-bootstrap-routes.js";
import { __qzBootstrapTestables, getQzBootstrapManifest, qzWindowsScriptSha256, renderQzWindowsLauncher, renderQzWindowsScript } from "./qz-bootstrap-service.js";
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

  it("reports ready metadata only for a validated identity and matching installer hash", async () => {
    const installer = join(directory, "installer.exe");
    writeFileSync(installer, "test-installer");
    const digest = createHash("sha256").update(readFileSync(installer)).digest("hex");
    __qzBootstrapTestables.resetInstallerValidationCache();
    const manifest = await getQzBootstrapManifest({ installerPath: installer, expectedInstallerSha256: digest });
    assert.equal(manifest.ready, true);
    assert.equal(manifest.printingSettingsUrl, "https://rispro.example.test/workstation/printing");
    assert.equal(manifest.qzInstallerSha256, digest);
    assert.deepEqual(manifest.securePorts, [8181, 8282, 8383, 8484]);
    assert.equal(manifest.windowsScriptUrl, "https://rispro.example.test/api/public/printing-bootstrap/windows-script");
    assert.equal(manifest.windowsScriptSha256, qzWindowsScriptSha256());
    assert.equal(manifest.windowsLauncherUrl, "https://rispro.example.test/api/public/printing-bootstrap/windows-launcher");
    assert.equal((await getQzBootstrapManifest({ installerPath: installer, expectedInstallerSha256: "0".repeat(64) })).ready, false);
  });

  it("hashes the rendered script and embeds its exact origin and digest in an auditable launcher", () => {
    const firstScript = renderQzWindowsScript();
    const firstHash = qzWindowsScriptSha256();
    const launcher = renderQzWindowsLauncher();
    assert.equal(firstHash, createHash("sha256").update(Buffer.from(firstScript, "utf8")).digest("hex"));
    assert.match(launcher, new RegExp(firstHash));
    assert.match(launcher, /https:\/\/rispro\.example\.test\/api\/public\/printing-bootstrap\/windows-script/);
    assert.doesNotMatch(launcher, /http:\/\//);
    assert.deepEqual([...launcher.matchAll(/https:\/\/[^/"']+/g)].map((match) => match[0]).filter((value, index, values) => values.indexOf(value) === index), ["https://rispro.example.test"]);
    assert.doesNotMatch(launcher, /__RISPRO_BASE_URL__|BEGIN (?:RSA )?PRIVATE KEY|Invoke-Expression|\biex\b|Set-ExecutionPolicy/i);
    process.env.PUBLIC_APP_BASE_URL = "https://other.example.test";
    try { assert.notEqual(qzWindowsScriptSha256(), firstHash); } finally { process.env.PUBLIC_APP_BASE_URL = "https://rispro.example.test"; }
  });

  it("streams installer validation once for concurrent requests, caches success, and invalidates after modification", async () => {
    const installer = join(directory, "streamed-installer.exe");
    writeFileSync(installer, "streamed-installer");
    const digest = createHash("sha256").update(readFileSync(installer)).digest("hex");
    let calls = 0;
    const hashFile = async (path: string) => { calls += 1; await new Promise((resolveDelay) => setTimeout(resolveDelay, 25)); return createHash("sha256").update(await readFile(path)).digest("hex"); };
    __qzBootstrapTestables.resetInstallerValidationCache();
    const options = { installerPath: installer, expectedInstallerSha256: digest, hashFile };
    const [first, second] = await Promise.all([getQzBootstrapManifest(options), getQzBootstrapManifest(options)]);
    assert.equal(first.ready, true);
    assert.equal(second.ready, true);
    assert.equal(calls, 1);
    assert.equal((await getQzBootstrapManifest(options)).ready, true);
    assert.equal(calls, 1);
    await appendFile(installer, "-changed");
    await utimes(installer, new Date(), new Date(Date.now() + 2_000));
    assert.equal((await getQzBootstrapManifest(options)).ready, false);
    assert.equal(calls, 2);
  });

  it("removes failed validation from single-flight state so a corrected file can be retried", async () => {
    const installer = join(directory, "retry-installer.exe");
    writeFileSync(installer, "corrected-installer");
    const digest = createHash("sha256").update(readFileSync(installer)).digest("hex");
    let calls = 0;
    const hashFile = async () => { calls += 1; return calls === 1 ? "0".repeat(64) : digest; };
    __qzBootstrapTestables.resetInstallerValidationCache();
    const options = { installerPath: installer, expectedInstallerSha256: digest, hashFile };
    assert.equal((await getQzBootstrapManifest(options)).ready, false);
    assert.equal((await getQzBootstrapManifest(options)).ready, true);
    assert.equal(calls, 2);
  });

  it("reports installer read errors as not ready without whole-file synchronous hashing", async () => {
    __qzBootstrapTestables.resetInstallerValidationCache();
    const manifest = await getQzBootstrapManifest({ installerPath: join(directory, "missing-installer.exe"), expectedInstallerSha256: "0".repeat(64) });
    assert.equal(manifest.ready, false);
    const serviceSource = readFileSync(resolve("src/services/qz-bootstrap-service.ts"), "utf8");
    assert.match(serviceSource, /createReadStream\(path\)/);
    assert.doesNotMatch(serviceSource, /sha256\(readFileSync|readFileSync\(path/);
  });

  it("does not send the installer until validation and the immediate file snapshot check finish", async () => {
    const installer = join(directory, "route-installer.exe");
    writeFileSync(installer, "route-installer");
    const file = await stat(installer);
    let releaseValidation!: () => void;
    const validationGate = new Promise<void>((resolveGate) => { releaseValidation = resolveGate; });
    let sent = false;
    const response = {
      status() { return this; }, json() { return this; }, type() { return this; }, setHeader() { return this; },
      sendFile() { sent = true; return this; },
    } as unknown as Parameters<typeof __publicPrintingBootstrapTestables.sendQzInstaller>[0];
    const operation = __publicPrintingBootstrapTestables.sendQzInstaller(response, () => undefined, {
      manifest: async () => ({ ready: true }),
      validate: async () => { await validationGate; return { path: installer, size: file.size, modifiedMs: file.mtimeMs, expected: "0".repeat(64) }; },
      fileStat: stat,
    });
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assert.equal(sent, false);
    releaseValidation();
    await operation;
    assert.equal(sent, true);
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
      for (const endpoint of ["root-certificate", "signing-certificate", "windows-script", "windows-launcher"]) {
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
      const launcher = await fetch(`${base}/windows-launcher`);
      assert.equal(launcher.headers.get("content-type"), "application/octet-stream");
      assert.equal(launcher.headers.get("content-disposition"), 'attachment; filename="RISpro-Printing-Setup.cmd"');
      assert.match(await launcher.text(), new RegExp(qzWindowsScriptSha256()));
    } finally { await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())); }
  });
});
