# RISpro Whole-System Mobile UI Usability Audit

Date: 2026-09-19  
Status: audit complete; focused responsive hardening implemented and browser-proven  
Evidence: Chromium via Playwright against the disposable E2E database

## Scope and method

The audit covered the routed frontend surface with the existing seeded roles and synthetic data. It did not change backend behavior, clinical workflow authority, scheduling semantics, permissions, URL contracts, or identity handling.

The audit harness is [mobile-ui-usability.spec.ts](../../e2e/specs/mobile-ui-usability.spec.ts). It captures full-page screenshots and JSONL metrics under `test-results/mobile-usability/` and checks:

- document width against the viewport width;
- uncaught page exceptions and application-error text;
- key navigation/search/reporting interaction bounds;
- patient identity text wrapping;
- registration action target size and accessible labels.

Coverage is deliberately split into two levels:

- 61 catalog routes at 390x844 and 1440x960;
- 10 critical workflow routes at 360x800, 390x844, 430x932, 768x1024, and 1440x960.

The final clean-state run completed **174/174 PASS**. The final metrics contain zero document-overflow records and zero uncaught page errors at every measured viewport. The 390px and 1440px metric files contain 71 records each because the 10 critical routes are also rechecked in the matrix; the other matrix files contain 10 records each.

## Classification

- **A - Mobile-ready:** no material usability issue observed in the tested state.
- **B - Usable with contained friction:** readable and operable, but dense, table-oriented, or dependent on an intentional inner scroll surface.
- **C - Technical/admin follow-up:** no page-level overflow or runtime failure, but the screen is dense or primarily designed for specialist desktop administration.
- **D - Confirmed defect:** a material responsive defect found in the baseline audit. The defects below are resolved; no D classification remains in the final run.
- **X - Context-limited:** print-only, legacy, redirect, unauthenticated, missing-token, or synthetic not-found state where a normal mobile workflow cannot be judged from this fixture.

## Route audit summary

| Final class | Routes / states | Evidence and disposition |
|---|---|---|
| A | `/login`, `/dashboard`, `/patients/new`, `/patients/:id/edit`, `/appointments`, `/scheduling/override-requests`, `/recall-requests`, `/calendar`, `/request-scans`, `/queue`, `/queue/check-in`, `/queue/no-shows`, `/modality?modalityId=1`, `/comparisons`, `/print`, `/search`, `/incidents`, `/sops`, `/sops/new`, `/doctor/dashboard`, `/doctor/my-work`, `/doctor/today-cases`, `/doctor/additional-imaging`, `/doctor/ir-consultations`, `/reporting/worklist/:token`, `/mobile/reporting-view/:token` | Stacked forms/cards remain readable and actions remain reachable. The legacy reporting path correctly redirects. |
| B | `/patients`, `/patients/merge`, `/name-dictionary`, `/registrations`, `/modality/document-ingestion`, `/statistics`, `/worklist-monitor`, `/settings`, `/doctor/protocols`, `/doctor/roster`, `/doctor/availability`, `/doctor/reporting-board`, `/doctor/reporting-board/saved/:token`, `/doctor/doctor-worklists`, `/doctor/roster-planner`, `/doctor/team-workload` | Usable at mobile widths. Patients and registrations received targeted hardening. Reporting-board cases remain a wide clinical table inside a contained horizontal-scroll surface; the page itself no longer overflows. |
| C | `/v2/appointments/admin`, `/pacs`, `/pacs/remap`, `/systems/authoritative-orthanc`, `/workstation/printing`, `/doctor/doctors-directory`, `/doctor/advanced-setup` | No page-level overflow or uncaught page exceptions in the final run, but these are dense specialist/admin surfaces. They should be considered for a separate workflow-specific redesign rather than generalized mobile changes. |
| X | `/public/appointment`, `/public/cancel-appointment`, `/comparisons/1`, `/comparisons/ir/1`, `/comparisons/1/remap`, `/print/day-list`, `/print/reporting-board`, `/print/internal/appointment-slip`, `/print/internal/registration-list`, `/legacy-access-viewer`, `/doctor/ir-consultations/1`, anonymous `/queue/check-in` | The fixture intentionally lacks a public token, print payload, real detail identifier, or authenticated session. The observed redirect/error/empty states are context limitations, not responsive defects. |

## Confirmed findings and fixes

### D-01 - Doctor reporting board expanded the whole document on narrow screens

Baseline Chromium evidence measured an 883px document inside the 390px viewport for `/doctor/reporting-board` and `/doctor/reporting-board/saved/:token`. DOM tracing identified the reporting board grid item and table section retaining their min-content width.

Fix:

- added `min-w-0` to the protected application shell main;
- added the same constraint to the doctor workspace main;
- added `min-w-0` to the reporting-board split grid and its table section.

The table still supports intentional horizontal scrolling for its clinical columns, but the page document is now constrained to the viewport. The final 360/390/430/768/1440 regression matrix passed.

### D-02 - Mobile patient cards ellipsized patient identity

The mobile Patients card used `truncate` on the Arabic full name, producing visible `E2E Full Fi...`-style loss of identity in the baseline screenshot. The card now uses wrapping text with tighter line height. The final browser assertion verifies the name is not `ellipsis` or `nowrap`.

### D-03 - Registration card actions were cramped and partly undiscoverable

The baseline mobile registration card put six actions into one narrow row; printer, link, and notification controls did not expose accessible names. The action area now uses three columns on narrow screens and six from the small breakpoint, 40px full-width targets, and localized labels/titles for every action. The final browser assertion verifies at least six labeled targets at 390px.

## Visual review notes

Reviewed final Chromium screenshots include:

- `test-results/mobile-usability/390/patients-390.png` — full patient identity remains visible in cards;
- `test-results/mobile-usability/390/registrations-390.png` — action grid is two rows with reachable controls;
- `test-results/mobile-usability/390/doctor-reporting-board-390.png` and `doctor-reporting-board-saved-390.png` — contained table scroll, no document expansion;
- `test-results/mobile-usability/390/navigation-open-390.png` — mobile navigation drawer remains contained;
- `test-results/mobile-usability/390/appointments-patient-dialog-390.png` — global search panel remains inside the viewport;
- `test-results/mobile-usability/390/reporting-case-details-390.png` — reporting case details drawer remains usable;
- `test-results/mobile-usability/1440/registrations-1440.png` — desktop registration layout remains intact;
- `test-results/mobile-usability/360/doctor-reporting-board-360.png` — the narrowest critical board state remains page-contained.

## Runtime limitations recorded, not hidden

The final run had zero uncaught page exceptions, but expected browser console HTTP errors were recorded for fixture/environment states:

- 401 for anonymous or unauthenticated states;
- 403 for protected auxiliary calls in selected seeded-role routes;
- 400/404 for synthetic invalid or not-found detail inputs;
- 503 for the workstation-printing QZ certificate because `QZ_CERTIFICATE` is not configured in the disposable E2E environment.

The E2E server also reports that Authoritative Orthanc is disabled and emits existing Express/pg deprecation warnings. No production fix was inferred from those messages.

## Validation status

- **PASS:** dedicated mobile audit, 174/174 Chromium tests; zero measured document-overflow records and zero uncaught page errors.
- **PASS:** frontend typecheck, frontend production build, agent contract, UI harness, and focused Patients/Registrations tests (5/5).
- **PASS:** browser matrix inside the comprehensive E2E run; the mobile audit tests remained green.
- **FAIL, unrelated to this change:** frontend lint reports the pre-existing unused `acquisition` variable in `frontend/src/components/appointments/appointment-information-view.tsx:291`; full frontend tests report 1,993/1,998 passing, with five date-sensitive module-last-location/Doctor page assertions failing at the current date boundary.
- **FAIL, unrelated to this change:** the comprehensive E2E suite reports 244 passed and 2 failed: the existing Equipment Settings language-switcher timeout and the existing Patients global-search strict-mode duplicate-option failure.
- **BLOCKED:** none.
- **SKIPPED:** none in the dedicated mobile audit.

## Files changed

- `frontend/src/App.tsx`
- `frontend/src/pages/doctor/doctor-page.tsx`
- `frontend/src/pages/doctor/doctor-reporting-board-page.tsx`
- `frontend/src/pages/patients/patients-page.tsx`
- `frontend/src/pages/registrations/registrations-page.tsx`
- `e2e/specs/mobile-ui-usability.spec.ts`
- `docs/ui/MOBILE_USABILITY_AUDIT.md`

No backend, migration, scheduling, authorization, or clinical-domain files were changed.
