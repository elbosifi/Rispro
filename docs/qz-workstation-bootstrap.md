# RISpro QZ workstation bootstrap — Phase 1

## Architecture and trust modes

Phase 1 uses `NCCB RISpro QZ Root CA` to issue `NCCB RISpro Printing`. This authority signs QZ messages only; it is not the RISpro HTTPS certificate, the QZ localhost TLS certificate, a Windows machine certificate, or a printer certificate.

- `internal_ca` is the supported automated bootstrap mode. `scripts/qz/generate-qz-signing-identity.sh` creates a 3072-bit RSA SHA-256 root (10 years) and leaf (3 years), with a PKCS#8 signing key. It validates and preserves a complete identity, refuses partial/inconsistent files, and replaces them only with the explicit `--repair` workflow. Approaching expiry is reported by metadata/validation and never triggers silent rotation.
- `qz_issued` retains externally supplied certificate/private-key file support for a future QZ-issued identity. Inline `QZ_CERTIFICATE` and `QZ_PRIVATE_KEY` remain fallback compatibility only.

Persistent host files are under ignored directories:

```text
secrets/qz/identity/qz-root-ca.crt
secrets/qz/identity/qz-root-ca.key
secrets/qz/identity/qz-signing-certificate.pem
secrets/qz/identity/qz-signing-private-key.pem
secrets/qz/identity/qz-signing-public-key.pem
secrets/qz/identity/qz-signing-metadata.json
var/qz-bootstrap/qz-tray-2.2.6-x86_64.exe
```

Compose mounts only the root public certificate, signing public certificate, and signing private key into `app` as read-only secrets. It does not mount `qz-root-ca.key`, and the request-scan worker receives none of the QZ secrets. Protect and deliberately back up the root key using an encrypted secret-backup mechanism; RISpro does not include it in ordinary storage backups. Losing it prevents issuance of another leaf under the same workstation trust chain.

## Deployment and installer integrity

`setup-docker.sh` and `update-docker.sh` provision/validate the identity before Compose starts, preserve existing fingerprints, and cache the official QZ Tray 2.2.6 x86-64 release asset from GitHub. Acquisition permits HTTPS redirects only to GitHub release hosts and enforces the publisher's SHA-256 `aeb93a601c27f5fa6bb464f63471e7acd43052ba384fef49dceec8290d4f7587`. The installer is outside Git and mounted read-only. Deployment finishes with the public manifest readiness check.

Ordinary `docker compose up` never generates or rotates keys. Use the supported setup/update command first on a clean deployment.

## Public bootstrap endpoints

The public, GET-only router exposes no user data, paths, environment values, or private keys:

```text
/api/public/printing-bootstrap/manifest
/api/public/printing-bootstrap/root-certificate
/api/public/printing-bootstrap/signing-certificate
/api/public/printing-bootstrap/windows-script
/api/public/printing-bootstrap/qz-installer
```

Manifest, certificates, and script are `no-store` and `nosniff`; downloads use fixed filenames/content types. Installer downloads have a separate rate limiter. The authenticated browser endpoint `/api/printing/qz-certificate` remains protected and uses the same validated certificate loader.

Download `RISpro-Printing-Setup.ps1` from:

```text
https://<rispro-origin>/api/public/printing-bootstrap/windows-script
```

The response safely embeds the configured HTTPS RISpro origin and opens the real `/workstation/printing` route when setup completes.

## Windows workflow

The readable Windows PowerShell 5.1 script supports Windows 10/11 x86-64, QZ Tray 2.2.6, Chrome, and Edge. ARM64 is detected and rejected in Phase 1 even though QZ publishes a separate ARM64 artifact; RISpro never installs the x86-64 package by assumption.

Run the downloaded script normally. It self-elevates once and preserves `-Mode`, `-RisproBaseUrl`, and `-ForcePinnedVersion`:

```powershell
.\RISpro-Printing-Setup.ps1                 # Repair (default)
.\RISpro-Printing-Setup.ps1 -Mode Install
.\RISpro-Printing-Setup.ps1 -Mode Diagnose
```

It validates the manifest, hashes, certificate fingerprints/chain, Authenticode status, the pinned QZ Industries publisher certificate and DigiCert chain, installed version, QZ root override, QZ-generated system allowlist, and a secure local port. QZ uses the documented `/S` installer mode, `override.crt`, and `qz-tray-console.exe --whitelist`. Existing exact 2.2.6 installations are repaired without reinstalling; newer versions require explicit `-ForcePinnedVersion` before downgrade. QZ's documented `spawn` command starts the normal interactive tray process rather than leaving an elevated tray process.

Chrome and Edge receive only the exact RISpro origin in their documented machine policy arrays:

```text
HKLM\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls
HKLM\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls
```

Existing entries are preserved and repeat execution does not duplicate the origin. Restart already-open browser windows if the policy has not refreshed. QZ is restarted after trust changes. `Diagnose` downloads/verifies temporary public artifacts and reads current configuration but does not install, modify trust/allowlists/policies, or start QZ.

Logs rotate at 2 MiB and remain at `%ProgramData%\RISpro\PrintingSetup\setup.log`. They contain phases, hashes, fingerprints, versions, exit codes, and health state, never PEM bodies, cookies, private keys, patient data, or print content.

## Recovery

- **Manifest not ready:** run the supported server setup/update and inspect the manifest reason. Confirm the identity and pinned installer cache exist.
- **Installer signature invalid:** discard the cache and rerun acquisition. Do not bypass Authenticode or substitute a newer release.
- **QZ version mismatch:** repair/install 2.2.6. A newer version needs the controlled `-ForcePinnedVersion` choice.
- **Root override missing:** rerun `-Mode Repair` as administrator and verify `C:\Program Files\QZ Tray\override.crt`.
- **Allowlist failure:** inspect QZ console output and `%ProgramData%\qz\allowed.dat`; repair preserves unrelated allowed certificates.
- **Secure port unavailable:** close only confirmed QZ processes, rerun Repair, and inspect QZ logs/firewall state. Expected secure ports are 8181, 8282, 8383, and 8484.
- **Browser still denies local access:** verify `chrome://policy` or `edge://policy`, restart the browser, and confirm the exact RISpro origin is present without wildcards.

Automated health proves installation/configuration and local secure-port readiness only. A signed browser call, actual printer selection, media/driver behavior, Arabic rendering, and physical output remain mandatory Windows workstation acceptance tests.
