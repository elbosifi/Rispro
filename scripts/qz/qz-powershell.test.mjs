import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/qz/windows/RISpro-Printing-Setup.ps1", "utf8");

test("PowerShell bootstrap exposes auditable Phase 1 functions and safety controls", () => {
  for (const name of ["Get-RisproManifest", "Test-InstallerSignature", "Test-FileHash", "Install-QzTray", "Set-QzRootTrust", "Add-QzAllowedCertificate", "Set-BrowserLocalNetworkPolicy", "Test-QzHealth"]) {
    assert.match(source, new RegExp(`function ${name.replace("-", "\\-")}`));
  }
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(source, /\$ErrorActionPreference = "Stop"/);
  assert.equal((source.match(/-Verb RunAs/g) || []).length, 1);
  assert.match(source, /ValidateSet\("Install", "Repair", "Diagnose"\)/);
  assert.match(source, /Diagnose mode: installation, trust, allowlist, browser policy, and startup writes were skipped/);
  assert.match(source, /LocalNetworkAccessAllowedForUrls/);
  assert.match(source, /--whitelist/);
  assert.match(source, /spawn \$script:QzExecutable/);
  assert.doesNotMatch(source, /Invoke-Expression|\|\s*iex\b|Set-ExecutionPolicy|PRIVATE_KEY|private-key/i);
});

test("PowerShell bootstrap pins exact QZ release integrity and official publisher identity", () => {
  assert.match(source, /2\.2\.6/);
  assert.match(source, /2F8040E46C966DB1154357F5E80B2BBEB0EEF342/);
  assert.match(source, /CN=QZ Industries LLC, O=QZ Industries LLC/);
  assert.match(source, /DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1/);
  assert.match(source, /Get-AuthenticodeSignature/);
});
