# DESLOPPIFY Cleanup Backlog

## Completed In Current Pass

1. Patient directory SQL interpolation
   - Where: `src/services/patient-service.ts`, called from `src/routes/patients.ts`
   - Why it mattered: Search/category/age values were interpolated into SQL strings.
   - Changed: Directory count/list queries now use parameter arrays; sort remains whitelisted.
   - Status: Fixed now.

2. Backup passphrase allowed in query string
   - Where: `src/routes/admin.ts`
   - Why it mattered: Query passphrases can leak through browser history, proxies, logs, and monitoring.
   - Changed: Backup downloads now read passphrases from `x-backup-passphrase` only.
   - Status: Fixed now.

3. Patient directory logs PHI-adjacent query params
   - Where: `src/routes/patients.ts`
   - Why it mattered: Search terms can include names, phone numbers, MRNs, or national IDs.
   - Changed: Removed the query log and added route-level enum validation for directory filters.
   - Status: Fixed now.

4. Scheduling query parsing is too trusting
   - Where: `src/modules/appointments-v2/api/routes/scheduling-v2-routes.ts`
   - Why it mattered: Raw numeric and enum query values could flow into availability loops.
   - Changed: Added route-local parsing for IDs, bounded `days`/`offset`, case category, and capacity mode.
   - Status: Fixed now.

5. Dynamic import via `new Function`
   - Where: `src/services/sonicdicom-report-service.ts`
   - Why it mattered: `new Function` obscured dependency loading and was fragile under static analysis.
   - Changed: Replaced with direct dynamic `import("mssql")`.
   - Status: Fixed now.

## Critical Issues

1. Tracked generated artifacts and validation logs
   - Where: `dist-frontend/`, `restore-v3-validation-20260527-173335/`, `tools/rispro-scanner-app/artifacts/`, `app.js`, `styles.css`, `tsconfig.tsbuildinfo`
   - Why it matters: Build outputs, logs, zips, and binaries make diffs noisy and may retain operational data.
   - Recommend: Decide which artifacts are truly source, untrack the rest, and expand `.gitignore`.
   - Safe now: Wait until deploy/runtime expectations for root `app.js`, `styles.css`, and scanner artifacts are confirmed.

## Medium Cleanup Items

1. Large files are becoming ownership boundaries
   - Where: `frontend/src/pages/settings/settings-page.tsx`, `frontend/src/lib/api-hooks.ts`, `src/services/dicom-remap-service.ts`, `src/services/patient-service.ts`
   - Why it matters: Changes will keep getting riskier because unrelated behavior shares the same files.
   - Recommend: Split only when touching a domain: backup panel, restore panel, patient directory query, DICOM remap jobs, reporting APIs.
   - Safe now: Wait for feature-adjacent cleanup.

## Nice-To-Have Polish

1. Repeated tiny UI primitives and `any` usage
   - Where: `frontend/src/pages/registrations/registrations-page.tsx`, `print-page.tsx`, `worklist-monitor-page.tsx`, settings sections
   - Why it matters: Duplicate `Field`/input/card patterns and `any` make UI behavior drift.
   - Recommend: Tighten local types first; extract shared primitives only after 3+ real repeated uses.
   - Safe now: Wait.

2. `.gitignore` is too sparse
   - Where: `.gitignore`
   - Why it matters: It ignores only a few paths while generated build/test artifacts are tracked.
   - Recommend: Add build outputs, tsbuildinfo, validation logs, local scratch dirs, and generated scanner binaries after deciding what stays tracked.
   - Safe now: Pair with artifact cleanup.

3. Root legacy frontend files need an ownership decision
   - Where: `app.js`, `styles.css`, root `index.html`
   - Why it matters: They look like legacy UI beside the Vite frontend and can confuse future changes.
   - Recommend: Document as legacy/runtime-required or remove after confirming no server/deploy path serves them.
   - Safe now: Wait.
