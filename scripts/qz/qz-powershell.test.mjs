import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/qz/windows/RISpro-Printing-Setup.ps1", "utf8");
const backendSource = readFileSync("src/services/qz-bootstrap-service.ts", "utf8");

test("PowerShell bootstrap exposes auditable Phase 1 functions and safety controls", () => {
  for (const name of ["Get-RisproManifest", "Test-InstallerSignature", "Test-FileHash", "Install-QzTray", "Set-QzRootTrust", "Test-QzAllowedCertificate", "Add-QzAllowedCertificate", "Test-ExactPolicyValue", "Set-BrowserLocalNetworkPolicy", "Test-QzAutostart", "Test-QzProcessOwner", "Test-QzHealth"]) {
    assert.match(source, new RegExp(`function ${name.replace("-", "\\-")}`));
  }
  assert.match(source, /Set-StrictMode -Version Latest/);
  assert.match(source, /\$ErrorActionPreference = "Stop"/);
  assert.equal((source.match(/-Verb RunAs/g) || []).length, 1);
  assert.match(source, /@\("-NoProfile", "-ExecutionPolicy", "Bypass", "-File"/);
  assert.match(source, /ValidateSet\("Install", "Repair", "Diagnose"\)/);
  assert.match(source, /Diagnose mode: installation, trust, allowlist, browser policy, and startup writes were skipped/);
  assert.match(source, /LocalNetworkAccessAllowedForUrls/);
  assert.match(source, /--whitelist/);
  assert.match(source, /spawn \$script:QzExecutable/);
  assert.match(source, /InteractiveUserSid/);
  assert.match(source, /\^S-1-/);
  assert.match(source, /Registry::HKEY_USERS\\\$UserSid/);
  assert.match(source, /QZ Tray 2\.2\.6 shared Startup shortcut/);
  assert.match(source, /\.autostart/);
  assert.match(source, /GetOwnerSid/);
  assert.match(source, /\.Split\("`t"\)/);
  assert.match(source, /\$fields\.Count -ne 6/);
  assert.match(source, /TrimStart\(\[char\]0xFEFF\)/);
  assert.match(source, /LocalNetworkAccessAllowedForUrls/);
  assert.match(source, /Test-ExactPolicyValue \$chromePolicy/);
  assert.match(source, /Test-ExactPolicyValue \$edgePolicy/);
  assert.doesNotMatch(source, /RISpro printing is ready/);
  assert.doesNotMatch(source, /Invoke-Expression|\|\s*iex\b|Set-ExecutionPolicy|PRIVATE_KEY|private-key/i);
});

test("PowerShell bootstrap pins exact QZ release integrity and official publisher identity", () => {
  assert.match(source, /2\.2\.6/);
  assert.match(source, /2F8040E46C966DB1154357F5E80B2BBEB0EEF342/);
  assert.match(source, /CN=QZ Industries LLC, O=QZ Industries LLC/);
  assert.match(source, /DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /UrlRetrievalTimeout = \[TimeSpan\]::FromSeconds\(10\)/);
  assert.match(source, /RevocationMode = .*::Offline/);
  assert.match(source, /RevocationFlag = .*::EntireChain/);
  assert.match(source, /VerificationFlags = .*::NoFlag/);
  assert.doesNotMatch(source, /AllowUnknownCertificateAuthority|IgnoreNotTimeValid|IgnoreWrongUsage|X509RevocationMode\]::NoCheck/);
});

test("CMD launcher downloads, verifies, executes with process-scoped bypass, propagates status, and cleans up", () => {
  assert.match(backendSource, /const scriptUrl = `\$\{origin\}\/api\/public\/printing-bootstrap\/windows-script`/);
  assert.match(backendSource, /RISPRO_SCRIPT_URL=\$\{scriptUrl\}/);
  assert.match(backendSource, /RISPRO_SCRIPT_SHA256=\$\{scriptHash\}/);
  assert.match(backendSource, /NewGuid\(\).*\.ps1/);
  assert.match(backendSource, /Invoke-WebRequest[^\n]+-OutFile/);
  assert.match(backendSource, /Get-FileHash[^\n]+SHA256/);
  assert.match(backendSource, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -File/);
  assert.match(backendSource, /set "RISPRO_EXIT=%ERRORLEVEL%"/);
  assert.match(backendSource, /del \/f \/q/);
  assert.doesNotMatch(backendSource, /Invoke-Expression|\biex\b|Set-ExecutionPolicy|BEGIN (?:RSA )?PRIVATE KEY/i);
});
