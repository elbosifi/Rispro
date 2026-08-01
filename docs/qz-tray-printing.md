# QZ Tray direct printing

RISpro uses QZ Tray pixel printing for Base64 PDFs. Normal authenticated appointment, accession-label, and patient-PDF print actions submit directly to the workstation's configured queue without opening a RISpro preview or the browser print dialog. Existing browser-print code remains available only through a user-selected fallback action.

## Architecture

- `frontend/src/services/printing/qz-tray-service.ts` owns QZ connection, discovery, configuration, deterministic pre-signing, and PDF submission. It serializes concurrent connection attempts through one shared promise.
- `frontend/src/services/printing/direct-print-service.ts` resolves a document type to a workstation profile, verifies the exact queue still exists, generates/fetches content, validates the paper route, submits it, and records the outcome.
- `frontend/src/services/printing/workstation-printer-settings.ts` stores version 1 settings under `rispro.qzPrinterSettings.v1`. A separate stable UUID is stored under `rispro.workstationId.v1`.
- Appointment A4/A5 PDFs reuse `createAppointmentSlipPdfBlob`. Accession labels use a 50 x 30 mm PDF by default. Patient PDFs reuse `/api/documents/:documentId/view`.
- `/api/printing/qz-certificate`, `/api/printing/qz-sign`, and `/api/printing/runtime-config` are authenticated and limited to printing roles. The signer allowlist contains only QZ Tray 2.2.6 calls `printers.find` and `print`; every signed print call must contain exactly one `pixel` / `pdf` / `base64` item for one named local printer. The Base64 must be canonical and unwrapped, and its decoded bytes must begin with `%PDF-`. HTML, files, URLs, raw print languages, file/socket/serial/USB/HID calls, `printers.detail`, multiple documents, and unknown calls are rejected. The private key is used only by the server. `/api/printing/audit` stores validated client-reported metadata, never document content.
- Authenticated QZ signing requests are rate-limited per user before the route-specific JSON parser runs. A fixed global limiter admits at most four signing requests while their bodies are being parsed and processed; excess requests are rejected immediately with HTTP 503 and `QZ_SIGN_BUSY` rather than queued in memory. Slots are released idempotently when the response finishes or closes, or when the request is aborted.

For `printers.find` and `print`, the exact signed JSON contains only `call`, `params`, and `timestamp`, in that order. RISpro computes SHA-256 over that JSON and the server signs the lowercase hexadecimal digest string with RSA SHA-512. The QZ transport adds `signature`, `signAlgorithm: "SHA512"`, `uid`, and window `position` after signing; none of those transport fields is part of the signed content. RISpro never overrides `Date.now()`. A maintained `patch-package` patch for QZ Tray 2.2.6 supplies the active public `qz.security.getSignatureAlgorithm()` value on explicitly pre-signed messages and is applied by the frontend `postinstall` script. SHA1 is not used: QZ desktop defaults a missing `signAlgorithm` to SHA1, which cannot verify RISpro's RSA-SHA512 signature.

The server validates the complete QZ 2.2.6 `config.getOptions()` output rather than accepting arbitrary options. Required RISpro values include millimetre units, 1-99 integer copies, dimension-consistent portrait/landscape orientation, finite bounded dimensions, the correct standard/custom-media flag, four finite nonnegative margins within the page, a bounded control-character-free job name and optional tray name, and exact booleans for scaling and rasterization. Automatically emitted QZ defaults such as color mode, density, duplex, interpolation, rotation, raw/encoding/spool fields, and nullable fields are accepted only at their confirmed safe values. Unknown option and printer fields, file/network output targets, and inconsistent media are rejected before signing.

Base64 validation does not decode or re-encode the complete PDF. It validates the original string's alphabet, length, padding placement, and canonical final quartet, then decodes only an eight-character prefix to verify `%PDF-` and the final four-character quartet to verify canonical pad bits. The JSON parser, inner request string, parsed request, and Base64 value still inherently coexist during validation; this is bounded extra decoding, not a zero-copy signing path.

QZ 2.2.6 `printers.details()` exposes no public signature or timestamp parameters, so RISpro does not call it and the backend does not sign it. Automatic tray discovery is unavailable. The workstation page provides an optional manual tray-name field; enter the exact Windows driver tray name only when required. Empty uses the printer default, and refreshing printers does not erase a saved manual tray.

## Version-specific patch and production builds

RISpro pins `qz-tray` to exactly `2.2.6`. The version-specific `frontend/patches/qz-tray+2.2.6.patch` is required because the stock 2.2.6 pre-signed transport omits the configured signature algorithm. The patch adds `signAlgorithm: SHA512` to the transport message through `qz.security.getSignatureAlgorithm()`; the signed content remains only `{ call, params, timestamp }`.

Frontend `postinstall` runs `patch-package` without failure-suppression flags. `verify:qz-patch` checks the package pin, patch file, installed package version, and installed patched source. `prebuild` runs that check before every production build. After Vite builds, `verify:qz-bundle` inspects the generated JavaScript assets for the patched pre-signed transport context.

The production Docker frontend stage copies `frontend/patches` before `npm ci`, so the lifecycle script can apply the patch during the clean image install. The stage then verifies the installed source, builds the frontend, and verifies the generated bundle. Any missing patch, incompatible source, wrong QZ version, failed patch application, or missing bundled behavior fails the image build.

Self-hosted CI separately builds the real Dockerfile's `frontend-builder` target after the normal clean frontend install, tests, production build, and bundle verification. This deployment-path check executes Docker's own `npm ci`, installed-patch verification, production build, and bundle verification without relying on host `frontend/node_modules`.

> **Maintenance warning:** Do not upgrade `qz-tray` without reviewing the pre-signed `signAlgorithm` patch and rerunning the real-lifecycle tests. A version change requires confirming upstream behavior and recreating or removing the version-specific patch deliberately.

## Server configuration

Set these secrets on the RISpro application server and restart it:

```env
QZ_CERTIFICATE="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
QZ_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
QZ_ALLOW_INSECURE_WEBSOCKET=false
QZ_SIGNING_REQUEST_LIMIT_MB=25
```

Use the QZ-issued `digital-certificate.txt` content for `QZ_CERTIFICATE`, or deploy and trust a self-managed certificate on every workstation. Use its matching RSA private key for `QZ_PRIVATE_KEY`. The private key must remain server-side; never put it in frontend source or commit it. Trusted silent printing requires certificate provisioning, workstation trust, and physical verification with the target QZ Tray desktop and printer.

Production RISpro must use HTTPS. CSP always permits secure QZ WebSockets for `localhost`, `localhost.qz.io`, and `127.0.0.1` on ports 8181, 8282, 8383, and 8484. The browser may also require local-network-access permission. Plain-HTTP development can explicitly enable QZ ports 8182, 8283, 8384, and 8485 with `QZ_ALLOW_INSECURE_WEBSOCKET=true`; this is off by default. The authenticated runtime-config endpoint supplies this decision to the frontend, which passes QZ's exact `usingSecure` connection option. Production forcibly returns secure mode even if the environment variable is mistakenly enabled.

`QZ_SIGNING_REQUEST_LIMIT_MB` limits the UTF-8 bytes of the inner JSON signing request, whose PDF is represented as Base64; it is not a raw-PDF byte limit and does not raise RISpro's global parser limit. Base64 adds approximately one third to the raw document size, so at 25 MiB the request supports roughly 18 MiB of PDF bytes after allowing for outer/inner JSON and print-configuration overhead. RISpro sends the original exact deterministic request alongside its digest, recomputes SHA-256 server-side, validates the complete request without reconstructing it, then signs the verified digest with RSA SHA-512.

On each workstation:

1. Install and start a QZ Tray 2.2-compatible release.
2. Open RISpro over its production HTTPS origin and sign in.
3. Open **Account -> Workstation printing** (`/workstation/printing`). Receptionist, supervisor, modality staff, doctor, and super administrator roles can access this local-only page without gaining general administrative settings access.
4. Confirm QZ is connected. At the first trusted connection, approve the RISpro certificate in QZ Tray and remember the decision.
5. Refresh printers and select the exact OS queue returned by QZ for A4, A5, accession label, and receipt profiles. If a driver requires a particular tray, enter its exact Windows tray name manually; otherwise leave the field empty for the printer default.
6. Set label dimensions (50 x 30 mm initially) and receipt roll width (80 mm initially), configure matching custom media in the Windows driver, and enable per-profile rasterization only if that driver requires it. Orientation is read-only and derived from final physical dimensions: width greater than height is landscape, otherwise portrait. A4 and A5 remain portrait standard vector PDF jobs. Test print generates an exact-size PDF with the same orientation used by QZ and passes through normal queue validation, signing, duplicate protection, timeouts, and client-reported audit; run it, then save.

Settings are browser/workstation-local. The same user can therefore map different queue names on two workstations. Clearing site storage removes the mapping and workstation identity.

## Manual acceptance

Use non-production test appointments/documents and physical test queues.

1. With QZ running, configure distinct A4, A5, and label queues. Print an appointment using each configured appointment-slip paper size and confirm QZ accepts the correct queue job without a preview or browser dialog.
2. Print an accession label and verify patient name, accession, QR code, modality/date, optional MRN, 50 x 30 mm media, and no clipping.
3. Open an appointment document's More menu and submit the same PDF with Print A4 and Print A5 to their distinct queues.
4. Set copies above one and confirm the OS queue receives that copy count.
5. Rapidly click Print and confirm the button disables and only one matching job is active.
6. Stop QZ Tray and confirm the actionable connection error. Choose **Use browser printing** and verify the browser workflow starts only after that click. For `PRINT_STATUS_UNKNOWN` and `DUPLICATE_PRINT`, confirm no browser fallback action appears because the original job may still be active.
7. Rename or remove a configured queue and confirm RISpro refuses to use another/default queue.
8. Replace the certificate or private key with a nonmatching value in a safe test environment and confirm a certificate/signature failure is shown and audited.
9. Sign in as the same user in a second browser/workstation, select different queue names, and confirm each browser retains its own mapping.
10. Verify an unauthenticated request cannot read the certificate, sign data, fetch patient PDFs, or write print audit events. RISpro currently has no separate per-user print capability; authenticated access to the underlying appointment/document remains the print authorization boundary.

QZ resolving a print promise means the job was submitted to the operating-system queue. RISpro deliberately reports “submitted” or “sent,” not that a physical page was produced.

## Current limitations

QZ acceptance means submitted to the operating-system queue, not physically printed. If the 30-second submission-status wait expires, RISpro reports `status_unknown`, retains the duplicate lock until QZ settles, tells the user not to retry, and offers no browser fallback. Duplicate jobs likewise offer no browser fallback. Connection and installed-printer discovery each wait at most 15 seconds, and document preparation permits 60 seconds. A discovery timeout returns `PRINTER_DISCOVERY_FAILED`, releases the active-job lock, submits no print, and offers browser printing only when that workflow has a valid enabled browser fallback; otherwise the user is directed to workstation printing settings.

- Existing day-list, reporting-board, statistics, protocol-sheet, and public appointment preview workflows remain browser printing because they do not yet expose exact reusable PDF generators. They were not removed or silently redirected.
- Receipt routing and configuration exist, but RISpro has no current receipt document generator or receipt print button.
- Patient PDFs are routed explicitly as A4 or A5 by the user; RISpro does not guess a printer by inspecting PDF content.
- QZ tray/status capabilities vary by Windows driver. Deterministic QZ 2.2.6 mode cannot refresh driver tray details because `printers.details()` lacks explicit signing arguments; tray names are manual.
- Trusted silent printing is not considered physically verified by automated tests. Physical media output, Arabic glyph quality, certificate trust, RSA-SHA512 desktop verification, driver rasterization needs, manual tray names, and printer status still require testing on each supported workstation and printer model.
