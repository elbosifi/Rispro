# Execution Plan: Doctor roster board

## Problem

Roster managers must understand assignment configuration before arranging a working week. The normal workflow needs an editable Sunday–Thursday creation flow and a daily board with grouped doctors.

## Scope

Reuse existing roster weeks, assignments as daily sections, memberships, configured duties, authorization, audit events and publish conflict validation. Preserve My Roster and Advanced Setup. No migration is planned.

## Files Likely to Touch

- `frontend/src/pages/doctor/doctor-roster-page.tsx` and local board components/helpers/tests
- `frontend/src/lib/api/doctor-portal-reporting.ts`, API types and English/Arabic catalogs
- `src/modules/doctor-portal/roster-repository.ts`, service, routes and focused tests
- `e2e/specs/doctor-roster-board.spec.ts`
- `docs/doctor-portal-roster-planning.md`

## Acceptance Criteria

- Short creation flow with editable Tripoli dates, explicit saved source, weekday preview and independent draft.
- Daily sections, grouped searchable doctors, drag and tap assignment, explicit move/copy, responsibility editing and clear conflicts.
- Atomic protected copy/move; no duplicate membership; published and unauthorized users cannot edit.
- English/Arabic, RTL, desktop/mobile and light/dark workflows validated with inspected screenshots.

## Validation Commands

- `npm run agent:contract` and `npm run agent:preflight`
- `npm run db:test:up`, `npm run db:test:check`, focused `npm run db:test:required -- ...`
- Focused Vitest, backend tests and changed-file lint
- `npm run typecheck`, `npm run typecheck:frontend`, `npm run build:frontend`
- Guarded disposable E2E DB and focused Playwright workflow
- `npm run harness:all`

## Rollback Considerations

Start: clean synchronized main `b232b204078e07a0e32785e1b092d650df99b3e9`. Temporary local branch: `codex/doctor-roster-board-goal`. No push, PR or deployment. After required checks pass, retain a local checkpoint and squash-apply onto unchanged main without committing.

## Execution Notes

- Agent contract passed. Preflight DOCKER_OK; existing disposable container retained; DB connection check passed.
- CURRENT_TASK.md is a completed unrelated task; this plan and the active request define scope.
- Confirmed Monday/+6 defaults, implicit prior-source copy, flat sidebar, unrelated slot cards, hard-coded specialist drops and non-atomic move.
- Existing schema only requires end >= start. Current copy offsets dates and appends; replace with protected transactional weekday mapping.

## Completed Milestones

1. Creation: editable Tripoli Sunday–Thursday defaults, blank/last-week/selected-source choices, historical/future saved sources, published-source preference, date/status labels and included/excluded weekday preview. Creation/copy/audit are atomic. Existing targets are protected; explicit API replacement rolls back on failure. No migration.
2. Board: daily sections and two-action presets, custom names, optional section settings, searchable collapsible professional grades, drag/tap assignment, backend role suggestions, explicit atomic move/copy, membership removal, populated-section confirmation, automatic persistence and validated publication. My Roster retains its viewing defaults; Advanced Setup retains its existing tools. Active-account filtering, professional-grade coverage and overlapping published-roster checks remain server-side.
3. Verification: actual Chromium workflows, screenshots inspected, responsive/theme corrections applied, focused frontend/backend regressions and final TypeScript production build. The board remains local to the roster module.

## Validation Results

All commands were executed outside the sandbox. Disposable test databases only; no production connection or external-system write.

| Check | Result |
| --- | --- |
| `npm run agent:contract` | Pass |
| `npm run agent:preflight` | Pass, DOCKER_OK |
| `npm run db:test:up` / `npm run db:test:check` | Pass; existing disposable test container retained |
| `npm run db:test:required -- src/modules/doctor-portal/roster-board.integration.test.ts src/modules/doctor-portal/doctor-portal.integration.test.ts` | Pass, 12 + 26 tests, no skips |
| `node --import tsx --test src/modules/doctor-portal/availability.test.ts src/modules/doctor-portal/roster-planning.test.ts src/modules/doctor-portal/roster-template.test.ts` | Pass, 13 tests |
| `cd frontend && npm run test -- src/pages/doctor/roster/roster-board-utils.test.ts src/pages/doctor/roster/doctor-roster-board.test.tsx src/pages/doctor/doctor-page.test.tsx src/lib/i18n.test.ts` | Pass, 106 tests |
| `npm run typecheck` | Pass |
| `npm run typecheck:frontend` / `npm run build:frontend` | Pass on the final frontend tree; existing large-bundle warning |
| Changed-file ESLint (roster directory, roster wrapper, Doctor page tests, API client/types, i18n catalogs/test) | Pass |
| `npm run lint:frontend` | Failed outside scope: unchanged `doctor-admin-doctors-page.tsx:473` set-state-in-effect; unchanged `sop-editor.tsx:61` fast-refresh export and `:72` conditional hook. These files match starting HEAD. Stopped broad validation; no workaround changes. |
| `VITE_API_PROXY_TARGET=http://127.0.0.1:3100 npm run test:e2e -- e2e/specs/doctor-roster-board.spec.ts --reporter=line` | Pass, 2 real Chromium journeys |
| `npm run harness:all` | Structure, docs and quality pass; UI ratchet fails on existing total 44 versus baseline 42. Starting HEAD and final tracked sources both contain 44 markers; new roster files contain none. Baseline was not changed. |
| Full frontend/backend suites and remote CI | Not run; no push authorized |

The 133 new roster translation keys are paired in both catalogs (3555 total). The pre-task catalogs already contained 3422 keys while their old snapshot expected 3419; this pre-existing snapshot drift was observed while refreshing snapshots for the intended catalog additions. No existing translation values were changed.

## Screenshots and Usability Review

Artifacts are ignored generated files, retained locally under:

- `test-results/doctor-roster-board-superv-83805-sktop-mobile-themes-and-RTL-chromium/`
- `test-results/doctor-roster-board-touch--b6d97-thorized-users-cannot-write-chromium/`

Inspected captures:

| File | Evidence |
| --- | --- |
| `01-create-roster-1440-light.png` | Two editable dates, clear next action |
| `02-source-selection.png` | Saved range/status, source choice and exclusions before copying |
| `03-empty-board.png` | Five daily columns with one Add Roster action each |
| `04-doctor-drag.png` | Drag overlay and highlighted target |
| `05-populated-board-1440-light.png` | Names, distinct roster responsibilities and daily membership |
| `06-conflict-state.png` | Specific publish rejection and affected doctor/section |
| `07-board-1440-light.png`, `07-board-1440-dark.png` | Desktop hierarchy and dark contrast |
| `07-board-1280-light.png`, `07-board-1280-dark.png` | Narrow desktop columns; long synthetic names wrap rather than overflow |
| `07-board-390-light.png`, `07-board-390-dark.png` | Full-width roster/day selectors, collapsed doctor panel and reachable actions |
| `08-mobile-rtl-dark.png` | Arabic labels and RTL board, dark controls |
| `09-published-read-only.png` | Published state without editing controls |
| `10-mobile-create.png`, `11-mobile-touch-keyboard.png` | Touch date entry and keyboard/touch doctor assignment |

The normal flow requires one short creation dialog. Adding CT requires Add Roster then CT. Adding a doctor takes one drag or opens the section's searchable picker. Managers can copy, rename, move and publish without opening Advanced Setup. Keyboard and actual touch alternatives pass. The viewport matrix has no horizontal page overflow; the main browser journey has no page errors or unexpected console errors. Expected rejected publication remains visible and recoverable.

Screenshot review led to a collapsed mobile doctor panel, full-width saved-roster selection, a sticky action bar, clearer publish errors and scoped dark input/text fixes. Screenshots during an active drag use viewport capture because full-page capture resizes and cancels the installed dnd-kit sensor. The move dialog test also allows the pointer to reach it after the sensor's trailing-click suppression.

## Limits and Handoff

- This is local synthetic-data/browser evidence, not a trial with radiology supervisors. No automated staff scheduling, workload balancing or new roster subsystem was introduced.
- The existing Doctor shell and Advanced Setup remain English. Arabic/RTL and system-dark support are scoped to the redesigned board and its dialogs.
- Global lint has the three unchanged errors above. The UI ratchet also has unchanged baseline drift (44 markers versus 42). Comprehensive remote CI remains unexecuted because this goal prohibits pushing.
- Test-generated tracked worklist side effects are restored before checkpointing. No generated DICOM files belong to the review patch.
- Keep the temporary branch as a rollback checkpoint. Squash-apply the validated tree to unchanged synchronized local main without committing; no push, PR or deployment.
