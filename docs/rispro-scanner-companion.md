# RISpro Scanner Companion Deployment

RISpro web remains the primary system. The Windows scanner app is an optional helper for reception workstations.

## Server Setup

1. Run database migrations.
2. Build the scanner MSI from `tools/rispro-scanner-app`.
3. Copy `RISproScannerSetup.msi` to `assets/downloads/RISproScannerSetup.msi`.
4. In RISpro settings, confirm:
   - RISpro Scanner App is enabled.
   - Download URL points to `/assets/downloads/RISproScannerSetup.msi`.
   - Scan session expiry is 10-15 minutes.

## Workstation Setup

1. Verify scanner works outside RISpro.
2. Install the MSI.
3. Open RISpro Scanner and configure the RISpro server URL.
4. Select scanner, DPI, color mode, and source.
5. Test scan.

## User Workflow

1. In RISpro, open the appointment documents panel.
2. Click Scan Paper.
3. Confirm the scanner app opens.
4. Confirm the patient and appointment identity in the app.
5. Scan, preview, choose document type, and upload.
6. Verify document appears in RISpro.

## Rollback

Disable `scanner_app_enabled` in `documents_and_uploads`. Manual upload and NAPS2/WebScan remain available. Uninstall the MSI from Windows Apps & Features if needed.

## Signing

Code signing is recommended before production rollout. Sign both the app executable and MSI with an organization certificate to reduce SmartScreen friction.
