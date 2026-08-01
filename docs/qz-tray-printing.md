# QZ Tray direct printing

RISpro uses QZ Tray pixel printing for PDFs and HTML. Normal authenticated appointment, accession-label, and patient-PDF print actions submit directly to the workstation's configured queue without opening a RISpro preview or the browser print dialog. Existing browser-print code remains available only through a user-selected fallback action.

## Architecture

- `frontend/src/services/printing/qz-tray-service.ts` owns QZ connection, discovery, configuration, signing callbacks, PDF/HTML submission, and test printing. It serializes concurrent connection attempts through one shared promise.
- `frontend/src/services/printing/direct-print-service.ts` resolves a document type to a workstation profile, verifies the exact queue still exists, generates/fetches content, validates the paper route, submits it, and records the outcome.
- `frontend/src/services/printing/workstation-printer-settings.ts` stores version 1 settings under `rispro.qzPrinterSettings.v1`. A separate stable UUID is stored under `rispro.workstationId.v1`.
- Appointment A4/A5 PDFs reuse `createAppointmentSlipPdfBlob`. Accession labels use a 50 x 30 mm PDF by default. Patient PDFs reuse `/api/documents/:documentId/view`.
- `/api/printing/qz-certificate` and `/api/printing/qz-sign` are authenticated. The private key is used only by the server. `/api/printing/audit` writes metadata to the existing audit log and never stores document content.

## Server configuration

Set these secrets on the RISpro application server and restart it:

```env
QZ_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
QZ_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Use the QZ-issued `digital-certificate.txt` content for `QZ_CERTIFICATE`. Use its matching RSA private key for `QZ_PRIVATE_KEY`. Do not put either value in frontend source, and never commit the real values. RISpro signs QZ requests with RSA SHA-512.

On each workstation:

1. Install and start a QZ Tray 2.2-compatible release.
2. Open RISpro over its production HTTPS origin and sign in.
3. Open **Settings -> Printing -> QZ Tray**.
4. Confirm QZ is connected. At the first trusted connection, approve the RISpro certificate in QZ Tray and remember the decision.
5. Refresh printers, select the exact OS queue returned by QZ for A4, A5, accession label, and receipt profiles, and select a tray when the driver exposes trays.
6. Set label dimensions (50 x 30 mm initially) and receipt roll width (80 mm initially), run a test print, then save.

Settings are browser/workstation-local. The same user can therefore map different queue names on two workstations. Clearing site storage removes the mapping and workstation identity.

## Manual acceptance

Use non-production test appointments/documents and physical test queues.

1. With QZ running, configure distinct A4, A5, and label queues. Print an appointment using each configured appointment-slip paper size and confirm QZ accepts the correct queue job without a preview or browser dialog.
2. Print an accession label and verify patient name, accession, QR code, modality/date, optional MRN, 50 x 30 mm media, and no clipping.
3. Open an appointment document's More menu and submit the same PDF with Print A4 and Print A5 to their distinct queues.
4. Set copies above one and confirm the OS queue receives that copy count.
5. Rapidly click Print and confirm the button disables and only one matching job is active.
6. Stop QZ Tray and confirm the actionable connection error. Choose **Use browser printing** and verify the browser workflow starts only after that click.
7. Rename or remove a configured queue and confirm RISpro refuses to use another/default queue.
8. Replace the certificate or private key with a nonmatching value in a safe test environment and confirm a certificate/signature failure is shown and audited.
9. Sign in as the same user in a second browser/workstation, select different queue names, and confirm each browser retains its own mapping.
10. Verify an unauthenticated request cannot read the certificate, sign data, fetch patient PDFs, or write print audit events. RISpro currently has no separate per-user print capability; authenticated access to the underlying appointment/document remains the print authorization boundary.

QZ resolving a print promise means the job was submitted to the operating-system queue. RISpro deliberately reports “submitted” or “sent,” not that a physical page was produced.

## Current limitations

- Existing day-list, reporting-board, statistics, protocol-sheet, and public appointment preview workflows remain browser printing because they do not yet expose exact reusable PDF generators. They were not removed or silently redirected.
- Receipt routing and configuration exist, but RISpro has no current receipt document generator or receipt print button.
- Patient PDFs are routed explicitly as A4 or A5 by the user; RISpro does not guess a printer by inspecting PDF content.
- QZ tray/status capabilities vary by Windows driver. RISpro records submission acceptance, not physical completion.
