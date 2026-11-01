# Institution identity and native radiology print review

Implemented locally on `main`, without commit, push, deployment, production data access, or changes to diagnostic images. The supplied SonicDICOM screenshot guided document density, separators, metadata, image arrangement and sign-off. Samples contain synthetic data only.

## Implementation

Settings now presents **Institution & Application Identity** at the existing `deployment_identity` section URL. A single `deployment_identity.institution` JSON setting holds bilingual hospital/department names, addresses, contact information, phone numbers, website, hospital logo and optional department logo. The existing public RISpro URL key and HTTPS implementation remain in place in the same settings section.

The existing audited settings writer and super-admin/recent-reauthentication boundary protect changes. Public branding exposes institutional fields only. Logos accept PNG/JPEG up to 2 MB, decode with a pixel limit, strip metadata by re-encoding to PNG, and reduce to at most 600 pixels per side. SVG and remote asset URLs are rejected. Validated logo bytes use existing JSON settings storage; no new storage system or dependencies were introduced. The existing NCCB asset remains the requested default.

Appointment slips, patient QR information, registration lists, incident reports, protocol sheets, legacy appointment print headers, queue/login branding, document titles and icons consume the shared identity. QR room/floor, department location, arrival instructions, parking, maps, WhatsApp, working hours and functional access/cancellation controls remain separate.

The existing native report print routes render compact A4 HTML, bilingual institutional columns, one examination title, available demographics and study metadata, plain narrative sections, optional three-column key images, authoritative sign-off and a minimal numbered footer. The print renderer preserves text whitespace, omits empty optional sections and images, and computes age only from a valid birth date and examination date. It does not substitute the current date or an appointment booking date for a missing study date.

New signatures capture institutional names and the actual logo bytes in the existing immutable signed snapshot. Both native signing paths retain their existing permissions, ownership, revisions, addenda, audit and image provenance. Pre-existing finals with no institution snapshot retain that absence and show an explicit note, instead of acquiring today's institution. No historical signed rows or history were backfilled or rewritten. No signature image is generated; no authorized signature-asset source exists in the current native report model.

## Migration

`241_institution_identity.sql` seeds the single setting from existing slip names and QR address/phone fields, preserving the original records and the existing URL/HTTPS configuration. Slip names take precedence over different QR center names; missing names use QR values, then the previous application defaults. Existing institution settings are never overwritten. If the two legacy name configurations differ, review the chosen values in the new settings editor; the original values remain stored as migration evidence.

No tables or columns were added. The migration was applied only to the disposable `rispro_test` database during validation.

## Validation

| Check | Result |
| --- | --- |
| Migration preservation and repeatability | PASS, 1 test, wrapped and unwrapped legacy configurations |
| Workspace native reporting integration | PASS, 33 tests, including frozen identity/logo and historical finals |
| Original appointment-based native reporting | PASS, 15 tests, including permissions, signing, concurrency, images and ownership |
| Patient QR cancellation/report/image access | PASS, 13 tests |
| Focused backend report, logo, QR, slip, route and authorization regressions | PASS, 19 tests |
| Focused frontend settings, print, QR and document regressions | PASS, 86 tests before broader validation |
| Broader frontend selection, including i18n, queue and HTTPS | 99 passed, 2 failed on pre-existing i18n catalog baseline |
| Backend typecheck | PASS |
| Final-tree frontend typecheck and production build | PASS; existing bundle-size warnings |
| Agent contract and harness | PASS; existing report-only harness warnings |
| Desktop/mobile/Arabic mobile built settings screen | PASS with synthetic API responses; save, RTL, no horizontal overflow, no page errors |
| Six Chromium A4 print cases, rendered using installed PDF.js | PASS; dimensions, page numbering, repeated headers, all 65 long-report paragraphs retained |
| Visual inspection | Performed on rendered A4 pages and settings screenshots |
| Frontend lint, full quality gate, comprehensive CI, physical printers, hospital LAN and other print engines | NOT RUN |

Sandbox process launches returned `EPERM` for several checks. The unchanged checks were rerun outside the sandbox. The existing `db:test:required` command returned without executing tests in this Windows invocation, so the documented `test:db:one` entry point performed the migrations and focused DB validation. No test runner or environment configuration was changed.

The broader frontend run stopped at the unrelated catalog-baseline failure. `i18n.test.ts` expects 3,566 entries and historical hashes; unchanged `HEAD` already contains 4,066 entries in each locale. Unchanged HEAD hashes are `26e78808d46f037c2dcbe9db926e8228ad8c66fe96c23ec76d8d234d79d7386c` (English) and `2015b21cc75bf8b1580efa5d446eacbca81fb635cfaf21978b5a8bb71cf20acd` (Arabic), both different from the saved test expectations. The baseline test was not edited. The intended identity translations also change catalog values, so a separate reviewed baseline update is required.

## Reproduction commands

```powershell
npm run agent:preflight
npm run db:test:up
npm run db:test:check
npm run test:db:one -- src/db/migrations/241_institution_identity.test.ts
npm run test:db:one -- src/modules/reporting/workspace.integration.test.ts
npm run test:db:one -- src/modules/appointments-v2/tests/integration/public-cancel-flow.test.ts
$env:JWT_SECRET = 'test-secret'
$env:NODE_ENV = 'test'
node --env-file=codex-db-test.env --experimental-test-module-mocks --import tsx --test --test-name-pattern='native reporting enforces' src/modules/doctor-portal/reporting-board.integration.test.ts
node --env-file=codex-db-test.env --import tsx --test src/services/generated-print-html-service.test.ts src/services/institution-identity-service.test.ts src/modules/appointments-v2/public/utils/appointment-slip-settings.test.ts src/modules/appointments-v2/public/utils/patient-qr-settings.test.ts src/routes/appointment-slip-render-routes.test.ts src/routes/deployment-identity.guardrails.test.ts
npm run test:frontend -- src/pages/settings/institution-identity-section.test.tsx src/pages/settings/deployment-identity-section.test.tsx src/pages/settings/patient-qr-settings-section.test.tsx src/lib/appointment-slip-html.test.ts src/lib/appointment-slip-settings.api-hooks.test.ts src/lib/print-utils.list.test.ts src/lib/incident-printing.test.ts src/lib/protocol-printing.test.ts src/pages/public/cancel-appointment-page.test.tsx src/lib/i18n.test.ts src/pages/queue/queue-check-in-page.test.tsx src/pages/settings/automatic-https-section.test.tsx
npm run typecheck
npm run typecheck:frontend
npm run build:frontend
npm run agent:contract
npm run harness:all
node --env-file=codex-db-test.env --import tsx scripts/validate-institution-report.ts
node scripts/validate-institution-settings-browser.mjs
git diff --check
```

## Review artifacts

Generated PDFs, their self-contained HTML and rendered pages are under `output/pdf/`. The no-image, one-image, draft and missing-demographics cases are one page each; five images use two pages; the long report uses five pages. These files are synthetic review artifacts, not clinical records. Browser screenshots and validation logs are under ignored `test-results/`.

- [Five key images](../output/pdf/report-five-images.pdf)
- [Long report](../output/pdf/report-long.pdf)
- [No images](../output/pdf/report-no-images.pdf)
- [One image](../output/pdf/report-one-image.pdf)
- [Draft](../output/pdf/report-draft.pdf)
- [Missing demographics](../output/pdf/report-missing-demographics.pdf)

Page numbering and pagination were verified in Chromium. Other browser print engines may not support CSS margin-box page numbers. Use A4 portrait and disable browser-added headers/footers. Physical printer acceptance remains for review. Existing finals cannot recover an institutional identity that was never recorded.

## Modified-file inventory and exact final status

The following inventory is the final `git status --short`. Generated sample files are grouped by Git under `output/`.

```text
 M frontend/index.html
 M frontend/src/components/auth/login-form.tsx
 M frontend/src/lib/api/appointments.ts
 M frontend/src/lib/appointment-slip-settings.api-hooks.test.ts
 M frontend/src/lib/i18n.ts
 M frontend/src/lib/i18n/ar.ts
 M frontend/src/lib/i18n/en.ts
 M frontend/src/lib/incident-printing.test.ts
 M frontend/src/lib/incident-printing.ts
 M frontend/src/lib/print-utils.list.test.ts
 M frontend/src/lib/print-utils.ts
 M frontend/src/lib/protocol-printing.test.ts
 M frontend/src/lib/protocol-printing.ts
 M frontend/src/lib/registration-list-printing.ts
 M frontend/src/pages/legacy-access-viewer/legacy-access-viewer-page.tsx
 M frontend/src/pages/modality/modality-page.tsx
 M frontend/src/pages/print/internal-registration-list-render-page.tsx
 M frontend/src/pages/public/cancel-appointment-page.tsx
 M frontend/src/pages/queue/queue-check-in-page.tsx
 M frontend/src/pages/settings/appointment-slip-settings-section.tsx
 M frontend/src/pages/settings/deployment-identity-section.tsx
 M frontend/src/pages/settings/patient-qr-settings-section.test.tsx
 M frontend/src/pages/settings/patient-qr-settings-section.tsx
 M frontend/src/pages/settings/reporting-policies-section.tsx
 M frontend/src/providers/language-provider-component.tsx
 M index.html
 M src/app.ts
 M src/modules/appointments-v2/public/utils/appointment-slip-settings.ts
 M src/modules/appointments-v2/public/utils/patient-qr-settings.ts
 M src/modules/reporting/reporting-routes.ts
 M src/modules/reporting/reporting-service.ts
 M src/modules/reporting/workspace-report-service.ts
 M src/modules/reporting/workspace-study-service.ts
 M src/modules/reporting/workspace.integration.test.ts
 M src/routes/appointment-slip-render-routes.ts
 M src/routes/deployment-identity.guardrails.test.ts
 M src/routes/settings.ts
 M src/services/generated-print-html-service.test.ts
 M src/services/generated-print-html-service.ts
 M src/services/settings-service.ts
?? docs/institution-identity-report-print.md
?? frontend/src/lib/institution-identity.ts
?? frontend/src/pages/settings/institution-identity-section.test.tsx
?? frontend/src/pages/settings/institution-identity-section.tsx
?? output/
?? scripts/validate-institution-report.ts
?? scripts/validate-institution-settings-browser.mjs
?? src/db/migrations/241_institution_identity.sql
?? src/db/migrations/241_institution_identity.test.ts
?? src/services/institution-identity-service.test.ts
?? src/services/institution-identity-service.ts
```
