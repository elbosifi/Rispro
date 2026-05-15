# RISpro Scanner App

Windows companion app for attaching paper documents to RISpro appointments.

## Prerequisites

- Windows 10/11 workstation
- .NET 8 SDK for building
- Scanner driver installed and verified with the vendor app or Windows Scan
- WiX Toolset 5 via the local dotnet tool manifest for MSI builds

## Build

```powershell
.\build.ps1
.\build-installer.ps1 -Version 0.1.0
```

The MSI output is `RISpro.Scanner.Installer\bin\Release\RISproScannerSetup.msi`. Copy it to:

```text
assets\downloads\RISproScannerSetup.msi
```

RISpro serves that path as `/assets/downloads/RISproScannerSetup.msi` by default.

## Install

Interactive:

```powershell
msiexec /i RISproScannerSetup.msi
```

Silent:

```powershell
msiexec /i RISproScannerSetup.msi /qn /norestart
```

The installer registers:

```text
rispro-scanner://
```

## First Run

1. Open RISpro Scanner from the Start Menu.
2. Configure the RISpro server URL.
3. Use HTTPS for production. HTTP is only for explicitly enabled local development.
4. Refresh scanners and select the default scanner.
5. Test scan.
6. In RISpro, create/open an appointment and click Scan Paper.

## Security Notes

- The protocol URL contains only a short-lived scan token.
- The app sends the token in `X-RISpro-Scan-Token`.
- The app never receives patient or appointment IDs from the protocol URL.
- The app requires workstation user confirmation of patient and appointment identity before scanning/uploading.
- Passwords are not stored.
- Temp scanned PDFs are retained only for explicit retry after upload failure.

## Pilot Checklist

- One Windows 10/11 reception PC selected.
- Scanner driver installed.
- Vendor app or Windows Scan confirms scanner works.
- RISpro Scanner App installed.
- RISpro server URL configured.
- Test scan succeeds.
- RISpro Scan Paper launches the app.
- Appointment context is correct.
- Scan, preview, and upload succeed.
- Document appears on the appointment.
- Audit log contains scan-session lifecycle and upload entries.
- Manual upload and NAPS2/WebScan fallback still work.

## Troubleshooting

- App does not open: reinstall MSI and verify `rispro-scanner://` protocol registration.
- Scanner not listed: install vendor driver, verify scanner in Windows Scan, then refresh scanners.
- Upload fails: leave the app open and retry upload; the temporary PDF remains available.
- HTTPS error: configure a valid production URL or explicitly enable HTTP only for local development.
- SmartScreen warning: sign the MSI and app executable with an organization code-signing certificate before broad deployment.
