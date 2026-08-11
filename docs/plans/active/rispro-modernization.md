# Execution Plan: RISpro behavior-preserving modernization

## Problem

RISpro has accumulated large cross-domain modules, duplicated frontend paths, unused code, and report-only quality debt that make small changes harder to review. The modernization must reduce that structural risk without changing clinical workflows, scheduling authority, PACS behavior, permissions, public APIs, or database contracts.

## Scope

- Remove only code and dependencies proven unreachable or unused.
- Split frontend translation, settings, and API-client seams behind stable import facades.
- Consolidate only helpers with identical active semantics.
- Characterize and then split Reporting Board and DICOM remap internals one concern at a time.
- Ratchet the existing quality baseline without turning unrelated legacy warnings into blanket failures.

## Explicit Non-Goals

- Product features, UI redesign, database migrations, endpoint changes, or authorization changes.
- Framework upgrades or broad dependency upgrades.
- Retirement of legacy appointments, backup v2, embedded MWL, SonicDICOM diagnostic modes, or Legacy Access Viewer.
- Bulk route/service renaming, cross-domain architecture moves, or log-schema migration.
- Changes to the active OHIF integration plan.

## Protected Contracts

- HTTP method/path/status/body shapes and frontend route paths.
- Database schema, transaction boundaries, scheduling/booking authority, permissions, and audit events.
- `@/lib/i18n` and `@/lib/api-hooks` import surfaces.
- Reporting Board route/service exports and appointment-versus-comparison semantics.
- DICOM remap staging, manifests, leases, UID plans, one-study selection, Orthanc verification, and asynchronous PACS sending.

## Pass Ledger

| Pass | State | Completion evidence |
| --- | --- | --- |
| Baseline and documentation | Complete | Clean synchronized `main` at `3d782b3fffcce1cfe4477516ad25bf0f5e448341`; agent contract and docs harness pass. |
| Dead artifacts and unused dependencies | Complete | Ten unreachable files and three unused packages removed; 12 scheduling evaluator, 52 Appointments V2, 36 Doctor Portal/Action PIN, 23 Request Scan/patient safety, and 7 QR settings assertions pass; typechecks, build, dependency tree, and harness pass. Strict-unused is clean except the excluded active OHIF service. |
| Translation catalogs | Complete | 1,998 keys per language and fixed SHA-256 catalog hashes preserved; 3 parity assertions, frontend typecheck, lint, and production build pass. |
| Settings seams | Complete | `settings-page.tsx` is now a 280-line composition/re-auth shell. Shared catalog import/export replaced the duplicate implementation; nine inline ownership areas were extracted. Settings tests pass 73/73 and guarded Backup V3 browser journeys pass 2/2. |
| Frontend API clients | Complete | `api-hooks.ts` is now a 12-line compatibility facade over domain clients. API contract and compatibility tests pass 32/32; frontend typecheck, lint, and production build pass. |
| Duplicate helpers | Complete | Identical raw response coercion moved to one domain-adjacent helper; six table-driven coercion cases and all API contract tests pass. Domain validators with different fallback/error semantics remain local. |
| Reporting Board | First bounded extraction complete | Added the appointment/comparison, presentation, permission, and cache-invalidation parity contract; extracted pure timeline/aggregate metrics behind the unchanged service facade. Backend unit tests pass 29/29, disposable-DB integration passes 38/38, desktop/mobile/print and PACS UI tests pass 119/119, and saved-view mobile E2E passes 1/1. UI, saved-view, assignment-job, query, and notification ownership splits remain separate follow-up passes. |
| DICOM remap | First bounded extraction complete | Added the state-transition/parity contract and extracted public types plus pure request validation under the unchanged service facade. Service tests pass 104/104, durable-processing tests 4/4, async-send tests 2/2, and PACS remap UI parity is included in the 119-test frontend batch. Staging, UID rewrite, Orthanc verification, and persistence remain separate follow-up passes. |
| Final ratchet | Complete | Agent contract, backend/frontend typechecks, frontend lint/build, harness, focused DB tests, browser checks, and generated-artifact cleanup pass. The report-only hotspot baseline is updated below without enabling blanket failures. |

## Validation Rules

- Add characterization evidence before moving behavior-bearing logic.
- Run the smallest focused test first and stop at the first unrelated failure.
- Use `npm run agent:preflight` and `npm run db:test:required -- <files>` for DB-backed passes.
- Run frontend typecheck and production build after every component or API-client extraction.
- Keep changes uncommitted on `main` for manual review.

## Rollback Considerations

Every pass is isolated by concern and retains its previous facade or route entrypoint. A pass can be reverted without a database rollback. No migration or external system mutation is permitted by this plan.

## Execution Notes

- Baseline contract, harness, backend typecheck, and frontend typecheck passed before implementation.
- Existing route-aggregator exceptions remain documented architecture allowances, not cleanup targets.
- A stale Reporting Board source assertion was updated to the quick-tab behavior introduced by `12a93156`; the focused suite then passed 36/36 assertions.
- The frontend production build retains its existing large-chunk warning. `npm audit` reports 9 existing frontend dependency advisories; upgrades are outside this refactor plan.
- The root frontend typecheck remains the repository's solution-level command. The production build additionally runs `tsc` against `tsconfig.app.json` and `tsconfig.node.json`, so it is the stronger cross-project extraction check.
- The strict backend unused check now reports only the two known findings in the excluded active OHIF integration (`pool` and `UnknownRecord`). Enabling the compiler flags globally remains coupled to that separate plan.
- Reporting Board and DICOM work deliberately stopped after their first independently reviewable extractions. The parity specifications are prerequisites for the remaining ownership splits; no durable-processing architecture or facade was removed.
