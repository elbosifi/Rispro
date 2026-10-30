# Doctor Workspace V2 Round 2: clinical usability and navigation

Date: 2026-10-30. Base: `e79e5955f833cf7600e847de553086f22dcce0be` on clean `main`, fetched and equal to `origin/main` before editing. All changes remain local and uncommitted. No production patient data, database, Orthanc archive, commit, push or deployment was used.

## Result

- Reporting defaults to **PACS Studies**, using the existing PostgreSQL authoritative Orthanc catalogue, including PACS-only and historical studies. Its Round 1 page-first SQL, indexes, pagination, filters and native/external status separation are unchanged.
- **RISpro Appointments** is a separate read-only view. It extends the existing doctor case service/repository and reuses its assigned/roster visibility for ordinary doctors and supervisor visibility for managers, restricted to reportable modalities and report-required appointments. It includes unlinked appointments and adds no assignment controls. Appointment details use the existing read-only drawer.
- Appointment associations require a unique indexed UID, matching patient identity and nonconflicting accession, authorized diagnostic modalities, the configured archive binding, and no ambiguous booking/study association. Invalid/unavailable associations display **Not in PACS / Study Not Linked**. They offer no report or linked-study action. No appointment or report is fabricated.
- PACS rows provide separate **Open Reports** and **View Images** actions. Dates are validated calendar dates, formatted without UTC conversion. Rows remain 45 px in Chromium, including representative multiple-report attribution. Full author/signer lists remain available in tooltips; the dense tables scroll horizontally on narrow screens.

## Endpoints and viewer authority

New endpoints under the existing authenticated, private/no-store, same-origin native-reporting router:

| Method and path | Behavior |
| --- | --- |
| `GET /api/native-reporting/workspace/appointments` | Paged, searched, filtered and sorted authorized reporting appointments with verified catalogue associations and separate report statuses |
| `POST /api/native-reporting/workspace/studies/:studyKey/images-launch` | Launch an authorized authoritative Orthanc study without a report or appointment |

Reused endpoints include `/workspace/studies`, `/workspace/studies/:studyKey`, study report creation, `/reports/:reportId` and its draft/review/finalize/delete/recover/history APIs, `/reports/:reportId/images-launch`, `/api/ohif/availability`, `/api/ohif/launch/:token`, and the existing Reporting Board appointment viewer-launch endpoint used by My Worklist.

The new study launch reuses `requireStudy`, live Orthanc identity verification, current modality permissions, the V2 verified-study registry, launch tokens, existing viewer sessions and patient/issuer history authorization. It also checks live diagnostic modalities and limits authorized history to the doctor's modalities. Registry identity and session insertion share a transaction after successful verification; this path never creates, adopts, changes or signs a report. Failure before launch leaves clinical reports untouched. Existing report-specific launching delegates to the same function. Native delivery, proxy fallback and OHIF configuration are unchanged; the configured opening mode is returned and honored.

All three V2 image entry points share synchronous blank-tab reservation before saving or requesting authorization. They detach the opener, serialize repeated in-flight clicks, navigate the reserved tab after authorization and close it on failure/unmount. Popup blocking shows an explicit same-tab fallback, which makes a fresh authorized request. Launch tokens are not stored in rendered error/fallback state. Same-tab viewer navigation retains the unsaved-navigation guard.

## Navigation, caching and saving

View, search, modality, status, dates, sort/direction and offset are URL state. Older worklist URLs and validated `returnTo` paths remain supported. Remembered defaults are materialized in the URL. The editor's return actions use React Router navigation through the existing guard. Browser Back remains guarded. Worklist scroll positions, including horizontal table position, are remembered in bounded in-memory state.

Worklists use TanStack Query with a 60-second freshness period, 15-minute retention and previous-page data while loading. Returning to a recently visited unchanged page avoids a list request; explicit Refresh remains available. A text save refreshes catalogue pages containing the study. Changed lifecycle/contributors additionally invalidate native-status page membership/counts, linked appointment/assigned lists and dashboard counts. The affected report cache and study report selection are updated/invalidated by report ID/study key; unrelated application queries are not invalidated. Study/report detail reads remain fresh on entry.

The serialized autosave chain, expected revisions and conflict reconciliation remain in place. Navigation waits for pending transcription and all save generations; active recording requires the doctor to stop dictation first. Failed saves retain text and prevent leaving. Report mutations wait for saves and do not interrupt dictation. Save indicators distinguish Unsaved Changes, Saving, Saved, Save Failed, Revision Conflict, Read Only and Read Only / Finalized. A background report-read error does not unmount an editor that already has content. No signing, ownership, review policy, report state or signed-data structure changed.

## Performance

Existing rollback-only 2,000-study fixture: 1,000 appointments and 1,400 reports, PostgreSQL 16.14, Windows Node 24.14.1. Each scenario uses one warm-up, three authenticated HTTP measurements and separate EXPLAIN plans. The before measurement uses the committed Round 1 tree. The final after run was measured without concurrent browser/build load; an earlier loaded run was retained only in the intermediate log, not selected as the final comparison. All seven captured catalogue SQL strings are identical before and after.

| Scenario | Before Round 2 API median ms | After Round 2 API median ms |
| --- | ---: | ---: |
| First page | 21.65 | 21.05 |
| Deep offset 1,900 | 24.57 | 25.10 |
| Selective search | 18.70 | 19.95 |
| Date and modality | 16.70 | 18.89 |
| RISpro draft filter | 36.51 | 36.63 |
| My reports | 28.57 | 27.41 |
| Patient ascending | 24.61 | 23.33 |

Round 1's recorded after values were 22.34 ms first-page and 36.32 ms draft-filter, following its 640.26/643.74 ms original baseline. Round 2 preserves that improvement. Measurements are local synthetic warm-cache medians, not hospital latency or concurrency results. Raw samples and plans: `test-results/workspace-round2-before.json` and `test-results/workspace-round2-after.json`.

## Validation

PASS:

- Workspace integration: 18/18, including unlinked/linked appointment visibility, modality/scope checks, archive/identity rejection, report-free sessions, token consumption, live modality changes, restricted patient history, existing lifecycle/primary-final/revision/immutability/rollback safeguards.
- Large catalogue HTTP/DB benchmark and regression: 1/1 with all 2,000 studies, pagination, filters and unchanged page-first SQL.
- Reporting Board integration: 111/111.
- OHIF schema integration: 4/4.
- Medical dictation integration: 7/7.
- Frontend regression set: 449/449 in 17 files; includes the new 18-test Round 2 file, Doctor Workspace shell, My Worklist, Reporting Board desktop/mobile, viewer actions, native reports, revision comparison, navigation guard and dictation.
- Chromium: both workspace journeys executed successfully, covering real synthetic DB/API report creation, autosave/dictation, conflicts, history, review/signing/rollback; report-free launch/token exchange; popup timing/blocking and same-tab fallback; Reporting/My Worklist/editor image entry points; appointment details; failed-save retention; exact return filters/view/offset, cached return and scroll; desktop/mobile/tablet density and overflow.
- Backend typecheck; frontend typecheck and production build after the final frontend edit; focused frontend lint; agent contract; all harnesses; `git diff --check`. Build emitted existing large-chunk/plugin timing warnings.

FAIL, outside this change's scope:

- The requested broader focused backend unit invocation executed 88 tests: **86 passed, 2 failed**. Both failures are existing source-text assertions in unchanged `src/modules/doctor-portal/reporting-board.test.ts` against unchanged `reporting-board-repository.ts`: the old direct `cache.finalized_by_doctor_id` join/filter strings no longer match the repository's existing native/external coalescing. The broader check was stopped and neither file was patched. Log: `test-results/workspace-round2-units.log`. Passing Reporting Board DB/frontend results are separate evidence and do not make this unit invocation pass.

Environment handling:

- `agent:preflight` reported `DOCKER_OK`; `db:test:up` preserved the existing disposable test container and `db:test:check` passed on `localhost:5433/rispro_test`.
- On Windows, `db:test:required` returned without executing its tests. Actual DB runs used `test:db:one` for each listed file and reported executed test counts.
- Node workers, Vite and contract Git subprocesses blocked by sandbox EPERM were rerun outside the sandbox. Chromium was already available. The build completed successfully outside the sandbox; no dependencies or browser versions were changed.
- Browser data used the separately reset disposable `127.0.0.1:5444/rispro_e2e` database, a local synthetic archive/MedASR server and a synthetic viewer document after the real launch-token exchange. This is not diagnostic-frame or real Orthanc image-delivery acceptance. The E2E container is stopped after validation; the pre-existing unit-test DB container is preserved.

## Screenshot artifacts

Directory: `test-results/workspace-round2-browser/doctor-workspace-v2-Round--60320--worklist-and-editor-return-chromium/`

- `round2-desktop-pacs.png`
- `round2-desktop-appointments.png`
- `round2-mobile-pacs.png`
- `round2-mobile-appointments.png`
- `round2-mobile-image-actions.png`
- `round2-tablet-pacs.png`
- `round2-evidence.json` records measured row height and cached-return request count.

The companion original workspace journey also captures the full-page editor, history and mobile reporting statuses. Screenshots were visually inspected.

## Files and remaining validation

Frontend: `reporting-workspace-api.ts`, new `use-workspace-images.ts`, new `use-reporting-position.ts`, `reporting-workspace-page.tsx`, `reporting-study-page.tsx`, `standalone-report-editor.tsx`, and new `reporting-round2.test.tsx`.

Backend: `cases-repository.ts`, `cases-service.ts`, OHIF `repository.ts`, `reporting-routes.ts`, `workspace-study-service.ts`, `workspace-viewer-service.ts`, `workspace-report-service.ts`, and `workspace.integration.test.ts`. Browser coverage: `e2e/specs/doctor-workspace-v2.spec.ts`. This review note is the only documentation addition.

No migration or dependency change is needed. Feature flag and rollback remain unchanged. Comprehensive and self-hosted exact-commit CI are UNRUN because no commit/push was authorized. Before hospital rollout, validate actual diagnostic image delivery/native and proxy behavior, hospital browser/popup policy and shared-doctor usage against the real authoritative archive, and repeat measurements on representative hospital hardware/data distributions. Resolve/review the two existing unit assertion failures separately before a full green release gate. No production acceptance is claimed.

Final `git status --short`:

```text
 M e2e/specs/doctor-workspace-v2.spec.ts
 M frontend/src/lib/reporting-workspace-api.ts
 M frontend/src/pages/doctor/reporting-study-page.tsx
 M frontend/src/pages/doctor/reporting-workspace-page.tsx
 M frontend/src/pages/doctor/standalone-report-editor.tsx
 M src/modules/doctor-portal/cases-repository.ts
 M src/modules/doctor-portal/cases-service.ts
 M src/modules/ohif-viewer/repository.ts
 M src/modules/reporting/reporting-routes.ts
 M src/modules/reporting/workspace-report-service.ts
 M src/modules/reporting/workspace-study-service.ts
 M src/modules/reporting/workspace-viewer-service.ts
 M src/modules/reporting/workspace.integration.test.ts
?? docs/plans/completed/doctor-workspace-v2-round2.md
?? frontend/src/lib/use-reporting-position.ts
?? frontend/src/lib/use-workspace-images.ts
?? frontend/src/pages/doctor/reporting-round2.test.tsx
```
