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

6. Tracked generated artifacts and validation logs
   - Where: `dist-frontend/`, `restore-v3-validation-20260527-173335/`, `tools/rispro-scanner-app/artifacts/`, `app.js`, `styles.css`, `tsconfig.tsbuildinfo`
   - Why it matters: Build outputs, logs, zips, and binaries make diffs noisy and may retain operational data.
   - Changed: Untracked generated frontend build output, restore-validation output, TypeScript build info, and scanner `bin`/`obj`/`artifacts` output; added `.gitignore` rules. Kept root `app.js`, `styles.css`, and `index.html` tracked because Docker copies them and the app serves them under `/legacy`.
   - Status: Fixed now.

7. Database-backed verification setup and cleanup
   - Where: `src/services/patient-service.directory.test.ts`, `src/modules/appointments-v2/tests/integration/helpers.ts`
   - Why it mattered: Local DB tests were blocked by a stale fixture national ID length and cleanup order for `special_reason_codes` user references.
   - Changed: Kept generated test national IDs within the 12-character schema and cleared test-user references from both `public.special_reason_codes` and `appointments_v2.special_reason_codes` before deleting users.
   - Status: Fixed now.

8. Patient directory ownership boundary
   - Where: `src/services/patient-directory-service.ts`, re-exported from `src/services/patient-service.ts`
   - Why it mattered: Patient directory SQL and ranking logic was embedded in the broad patient service, making future directory changes riskier.
   - Changed: Moved the directory query, parameter builder, and output types into a dedicated service while keeping the existing import surface intact.
   - Status: Fixed now.

9. Registrations page local `any` cleanup
   - Where: `frontend/src/pages/registrations/registrations-page.tsx`
   - Why it mattered: Repeated `any` in mutation error handling and small UI helpers weakened the page's local type safety.
   - Changed: Typed mutation errors as `unknown`, centralized local error-message extraction, typed `Field` values as `ReactNode`, and removed the modality callback `any`.
   - Status: Fixed now.

10. Print/worklist small-page local type cleanup
    - Where: `frontend/src/pages/print/print-page.tsx`, `frontend/src/pages/worklist-monitor/worklist-monitor-page.tsx`
    - Why it mattered: The print page repeated the same loose local helper and modality callback pattern; worklist monitor had the helper pattern but was already typed.
    - Changed: Typed print-page `Field` values as `ReactNode`, removed the modality callback `any`, and confirmed worklist monitor has no local `any`.
    - Status: Fixed now.

11. DICOM devices settings type cleanup
    - Where: `frontend/src/pages/settings/dicom-devices-section.tsx`, `frontend/src/lib/mappers.ts`, `frontend/src/types/api.ts`
    - Why it mattered: The section hid form and row assumptions behind `any`, and the mapper dropped modality metadata the UI tried to render.
    - Changed: Added a local DICOM device form type, typed mutation errors as `unknown`, typed device rows from the API response, and mapped `modalityCode`/modality names explicitly.
    - Status: Fixed now.

12. Exam types settings error typing cleanup
    - Where: `frontend/src/pages/settings/exam-types-section.tsx`
    - Why it mattered: Mutation errors and one language call were still widened to `any` despite the section already having local row/form types.
    - Changed: Added local unknown-error message extraction, typed mutation errors as `unknown`, and removed the language cast.
    - Status: Fixed now.

13. Catalog import draft-row typing cleanup
    - Where: `frontend/src/pages/settings/catalog-import-export-panel.tsx`
    - Why it mattered: Workbook preview rows were rendered from generic records, forcing error rendering back to `any`.
    - Changed: Added local draft-row and import-error types, kept the API boundary cast at preview assignment, and removed the row-error callback `any`.
    - Status: Fixed now.

14. DICOM monitoring settings response typing cleanup
    - Where: `frontend/src/pages/settings/dicom-monitoring-section.tsx`
    - Why it mattered: The monitoring section cast API responses to `any`, hiding assumptions about overview, service-status, logs, and tool-detection payloads.
    - Changed: Added local response/log/tool interfaces, typed the direct `api()` calls, replaced process/server `any` with `unknown`, and removed render-time `any` casts.
    - Status: Fixed now.

## Critical Issues

None currently selected.

## Medium Cleanup Items

1. Large files are becoming ownership boundaries
   - Where: `frontend/src/pages/settings/settings-page.tsx`, `frontend/src/lib/api-hooks.ts`, `src/services/dicom-remap-service.ts`, remaining broad areas of `src/services/patient-service.ts`
   - Why it matters: Changes will keep getting riskier because unrelated behavior shares the same files.
   - Recommend: Continue splitting only when touching a domain: backup panel, restore panel, DICOM remap jobs, reporting APIs, remaining patient summary/identifier workflows.
   - Safe now: Wait for feature-adjacent cleanup.

## Nice-To-Have Polish

1. Repeated tiny UI primitives and `any` usage
   - Where: the large `frontend/src/pages/settings/settings-page.tsx` shell and any remaining local page helpers discovered during feature work
   - Why it matters: Duplicate `Field`/input/card patterns and `any` make UI behavior drift.
   - Recommend: Tighten local types first; extract shared primitives only after 3+ real repeated uses.
   - Safe now: Continue only for isolated child sections; avoid broad edits in the 4k+ line settings shell.

2. `.gitignore` is too sparse
   - Where: `.gitignore`
   - Why it matters: It ignores only a few paths while generated build/test artifacts are tracked.
   - Recommend: Keep extending as new generated outputs appear.
   - Safe now: Already paired with artifact cleanup; revisit only if new noisy outputs appear.

3. Root legacy frontend files need an ownership decision
   - Where: `app.js`, `styles.css`, root `index.html`
   - Why it matters: They look like legacy UI beside the Vite frontend and can confuse future changes.
   - Recommend: Leave tracked while `/legacy` remains supported; remove only with a deliberate legacy-route removal.
   - Safe now: Decision made for now: keep tracked.
