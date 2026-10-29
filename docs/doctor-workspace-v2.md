# Doctor Workspace V2: implementation and local review

## Delivery

Implemented locally on `main`, starting from `16840bd6f8347297cd3bfb1fb5b4af6e7f4f6102`. Changes are uncommitted. Doctor Workspace V2 is disabled by default. No production database, Orthanc configuration, patient records, deployment, commit or push was performed.

The workspace extends the existing native reporting records, revision history, indexed Orthanc metadata, doctor permissions, roster, printing, key-image storage and MedASR infrastructure.

## Implemented behavior

- Home provides backend-aggregated assigned/pending work, personal/shared drafts, review counts, actual signer activity for Today/7/30 days, unique department-completed studies and the next published roster duty.
- My Worklist provides pending/draft/in-review/final/all-assigned views and separate report and image actions. Existing supervisor assignment, reassignment, holds and administration remain on the Reporting Board.
- Reporting browses authorized Orthanc studies, including studies without bookings, with server pagination/search/sort/status/modality/date filters, URL return state and visible index freshness. Catalogue and editor opening do not retrieve diagnostic frames.
- Study selection lists existing reports without creating a draft. Explicit creation selects a permitted report type, independent/shared mode and a blank or structured narrative template.
- The full-page editor provides five continuous fields, serialized autosave, explicit save, retained unsaved text on conflicts, manual comparison/reconciliation, review, signer confirmation, printing, history, signed addenda and authorized deletion/recovery.
- Revisions retain editor attribution and snapshots. Comparison highlights changed spans. Restoring an active-draft revision creates a new revision and restores its retained key-image selection/captions.
- Standalone and OHIF use the same report IDs and backend. OHIF selects reports, saves before switching and preserves existing capture validation, source provenance and key-image printing.
- Standalone uses the existing global dictation provider directly. The OHIF adapter uses the same recorder, shortcut/device preferences, target validation, cleanup and authenticated MedASR endpoint. Cursor insertion, autosave and cancellation on report navigation are preserved.
- Personal nonclinical preferences are user-scoped in local storage: remembered status/modality, template, compact fields and dashboard range. Existing microphone/shortcut preferences remain separate from hospital policy.
- Supervisor Board visibility and management requests are restricted for ordinary doctors in V2. Supporting clinical tools and old bookmarks retain compatible routes.

## Study identity, authority and persistence

[Migration 236](../src/db/migrations/236_doctor_workspace_v2.sql) adds a verified study registry, report-to-study links, contributors, review events, optional booking/patient links, report type/mode, review/deletion metadata, source-bound index state and supporting indexes. The original report/version/key-image tables and signed-content guards remain in use. The appointment-wide uniqueness constraint is replaced by a partial legacy-primary constraint after dependent queries are migrated to select one applicable report.

A registry entry is unique by configured archive fingerprint and Study Instance UID. Patient ID and accession provide additional checks. A booking is linked by a verified UID, never by accession alone. Missing booking/patient records remain absent; reporting does not fabricate them. Duplicate UIDs, conflicting patient identity, ambiguous booking matches, held/incomplete linked examinations and uncertain external ownership block writes with reconciliation errors.

The existing historical sync binds a successful full reconciliation to the configured archive. A source change clears that binding and forces reconciliation. There is no additional synchronization engine or per-request archive rescan. Search/date/modality and report attribution indexes support paged queries. Study report selection loads attribution, images and addenda in batches.

One immutable primary pointer determines native study completion. Study locking serializes competing signatures. Second opinions, additional interpretations and peer reviews never replace that primary. A study with only signed additional reports displays `additional reports`, without being counted as primary-final or as an active draft. Department completion counts unique archive/UID pairs; personal activity credits the actual signer.

Every mutation checks authorization, current policy, identity and expected revision. Policy row locking prevents settings changes racing an action. Signing verifies live archive metadata and retained image assets, confirms the signer and stores the current policy version in the immutable snapshot. Soft deletion excludes drafts from active status but retains their versions/assets and audit history. Review can be withdrawn/returned after formal review is disabled. Existing finals still accept permitted signed addenda after a review-policy change.

Existing authoritative-archive signed reports are linked through a separate immutable association after exact UID/patient/source verification; their signed rows and snapshots are not rewritten. SonicDICOM and manual-final ownership continue to block conflicting native creation/signing. Unknown external status is never labeled No Report.

## Routes and API

Frontend routes:

| Route | Purpose |
| --- | --- |
| `/doctor/home` | Personal dashboard |
| `/doctor/my-work` | Assigned examinations |
| `/doctor/reporting` | Authorized archive catalogue |
| `/doctor/reporting/studies/:studyKey` | Report selection and explicit creation |
| `/doctor/reporting/reports/:reportId` | Standalone report editor/history |
| `/doctor/schedule` | Existing published personal roster and availability link |
| `/doctor/reporting-board` | Existing supervisor management |

All new APIs are under `/api/native-reporting`, authenticated, private/no-store, and protected against cross-origin writes:

| Method and relative path | Purpose |
| --- | --- |
| `GET /workspace/config` | Feature flag |
| `GET /workspace/policies` | Administrator policy and presets |
| `PUT /workspace/policies` | Version-checked audited update; recent administrator reauthentication |
| `GET /workspace/studies` | Paged catalogue and freshness |
| `GET /workspace/my-work` | Paged assigned cases |
| `GET /workspace/dashboard` | Aggregated workload/activity and next duty |
| `GET /workspace/schedule` | Existing published personal roster |
| `GET /workspace/studies/:studyKey` | Identity and existing report selection |
| `POST /workspace/studies/:studyKey/reports` | Explicit retry-safe creation |
| `GET /reports/:reportId` | Authorized preserved record |
| `PUT /reports/:reportId/draft` | Expected-revision draft save |
| `POST /reports/:reportId/finalize` | Confirmed signer and immutable final |
| `POST /reports/:reportId/review` | Submit/feedback/return/withdraw |
| `POST /reports/:reportId/delete` and `/recover` | Confirmed audited soft deletion/recovery |
| `GET /reports/:reportId/history` and `/reviewers` | Revisions/review events and qualified reviewers |
| `POST /reports/:reportId/restore-revision` | Restore as a new draft revision |
| `POST /reports/:reportId/addenda` | Append-only signed correction |
| `GET /reports/:reportId/print` | Existing server-owned print HTML |
| `POST /reports/:reportId/images-launch` | Existing OHIF session/token pathway, including unbooked studies |
| `GET /reports/:reportId/images/:imageId` | Authorized retained image |
| `POST /reports/:reportId/images` and `PUT /reports/:reportId/images` | Existing validated capture/selection, scoped to selected report |

Existing context, appointment reporting and MedASR routes remain. V2 blocks appointment-only mutation bypasses while enabled; report-specific APIs enforce the new policy.

## Policies and defaults

Settings location: **Doctor Workspace → Reporting Policies**. Core supervisor/super-admin settings authority and recent reauthentication apply. The stored JSON lives in `system_settings`, category `doctor_workspace`, key `reporting_policy`. Updates increment a version, audit prior/new values and apply without restart. Generic settings writes cannot bypass its validation.

| Setting | NCCB default | Other finite options |
| --- | --- | --- |
| Doctor Workspace V2 | Disabled | Enabled |
| Creation | Any authorized accessible study | Assigned only; assigned plus existing explicit supervisor capability |
| Collaboration | Shared and independent | Independent only; shared only |
| Review | Optional | None; mandatory for configured roles |
| Mandatory review roles | Resident, senior house officer; inactive while review is optional | Consultant, specialist, resident, senior house officer |
| Review eligibility | Open qualified review with optional preferred reviewer | Any qualified doctor; designated reviewer/supervisor |
| Signing | Existing signing permission | Explicitly allow all qualified reporting doctors; permission plus independent review |
| Additional reports | Typed additional reports after primary final | Unrestricted configured types; signed corrections/addenda only |
| Allowed types | Primary, Second Opinion, Additional Interpretation, Peer Review | Configurable nonempty subset |
| Deletion | Creator for single-author drafts; supervisor for shared contributions | Supervisor only; routine deletion disabled |
| Revision restoration | Enabled for authorized active drafts | Disabled |

Presets populate this same policy: Open Collaborative Reporting, Teaching Hospital and Assignment-Controlled Reporting. They do not automatically enable the feature. Mandatory safeguards cannot be disabled. Review-dependent signing applies to draft finalization; it does not retroactively turn an immutable final into a reviewable draft or prevent an otherwise authorized signed addendum.

## Enablement and rollback

1. Review and release through the existing Git/CI/deployment process. Apply migration 236 and rebuild backend, RISpro frontend and the pinned OHIF image together. The OHIF change is a narrow existing-extension patch, retaining the pinned viewer and imaging infrastructure.
2. Confirm the existing authoritative Orthanc and native OHIF integrations are configured correctly. Complete the existing Historical PACS full reconciliation against that same source. Verify catalogue freshness reports ready; an unbound/stale index is not sufficient for writes.
3. Review doctor reporting/modality/signing permissions and the hospital policy. In Settings → Doctor Workspace → Reporting Policies, select **Enable Doctor Workspace V2** and save after reauthentication.
4. Validate the intended workflows using authorized test studies before clinical enablement. No production enablement occurred during this task.

For rollback, disable **Enable Doctor Workspace V2** and save. Retain migration 236 and all data. The legacy workspace returns, while saved `/doctor/reporting/reports/:reportId` URLs remain authorized/readable/printable with the same archive identity, including reports without appointments. Their V2 mutations require the flag to be re-enabled. Legacy appointment views select the authoritative primary final or applicable legacy record; additional/unbooked reports are accessed by their stable report URLs. Do not roll back the schema or run an old binary that assumes appointment-wide uniqueness.

An index outage permits preserved report reading using stored source/modalities, with mutations disabled. A changed archive identity still requires reconciliation; rollback does not grant access to a different archive. Patient identity changes likewise preserve prior content read-only. Reconciliation is deliberately fail-closed; this release does not add an automatic clinical remapping tool.

## Executed local validation

All data was synthetic. DB integration used the guarded disposable test database; browser acceptance used the separate disposable E2E database and temporary synthetic Orthanc/MedASR services. Commands blocked by sandbox subprocess/Docker restrictions were rerun outside the sandbox.

| Validation | Result |
| --- | --- |
| `agent:contract`, environment preflight, disposable DB start/check | PASS; preflight reported `DOCKER_OK` |
| Migration 236 on clean disposable databases | PASS |
| Reporting workspace DB integration | PASS, 13/13 scenarios |
| Existing Reporting Board DB integration | PASS, 111/111 |
| Historical PACS index discovery/synchronization integration | PASS, 39/39 |
| Existing MedASR DB integration | PASS, 7/7 |
| Focused reporting, OHIF, Orthanc, printing and MedASR unit files | PASS, 73/73 |
| SonicDICOM selection/ownership unit files | PASS, 43/43 |
| Focused doctor shell, native report, revision diff, dictation and settings frontend tests | PASS, 133/133 across 6 files |
| OHIF serialized report store | PASS, 6/6 |
| Chromium workspace + Fast Preview journeys | PASS, 8/8 |
| Actual modified OHIF Docker browser journey, feature off | PASS, CT/MRI, stack/annotations, CT MPR/MIP, priors, enhanced MR, key images, signing/addenda/printing |
| Actual modified OHIF Docker browser journey, feature on | PASS, CT/MRI multi-report selection, cursor dictation, delayed transcription cancellation, selected-report capture and primary signing |
| Backend typecheck | PASS |
| Final frontend typecheck and real frontend build | PASS; existing large-chunk/performance warnings |
| Focused new frontend ESLint | PASS, no errors/warnings |
| Agent harnesses and whitespace check | PASS |
| Comprehensive CI, self-hosted CI, full local quality/coverage suites | NOT RUN; changes remain uncommitted |

Workspace DB scenarios include 215 studies, unbooked reports, identity/duplicate-accession failures, shared/independent edits, revision conflict/attribution/restoration, review transitions, permission denial, deletion/recovery, competing primary signatures, additional-report status, actual signer credit, runtime policy changes, rollback reads, template safety and archive outages. Adopting an existing legacy final is explicitly checked to preserve its exact signed row, snapshot and history while allowing a separate additional interpretation.

Chromium acceptance uses real authenticated backend requests, real MediaRecorder audio with synthetic microphone input and a synthetic MedASR response. It proves Findings/Impression insertion, cursor preservation, hold shortcut, autosave, late-response cancellation, two-browser collaboration/conflict reconciliation, allowed-type changes, addenda-only creation restriction, review, history, signing/printing, URL state, mobile layout and read-only rollback. Catalogue/editor requests are checked for absence of DICOM pixel/viewer requests.

Run focused DB files with `npm run db:test:required -- <file>`; on this Windows environment the wrapper did not emit actual test assertions, so explicit `npm run test:db:one -- <file>` runs supplied the results above. The direct unit invocation initially omitted its required environment for two SonicDICOM files; those 43 tests passed with the normal unit-runner placeholder environment. A synthetic OHIF fixture-cleanup failure was fixed and the 39 index tests passed afterward. No product test failure remains unresolved.

Reproducible browser commands:

```powershell
npm run e2e:db:up
npm run test:e2e -- e2e/specs/doctor-workspace-v2.spec.ts e2e/specs/fast-preview.spec.ts --project=chromium --workers=1
npm run e2e:db:down

docker build -f docker/ohif/Dockerfile -t rispro-ohif:doctor-workspace-v2 .
$env:OHIF_TEST_IMAGE='rispro-ohif:doctor-workspace-v2'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
$env:OHIF_WORKSPACE_V2='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

Desktop/editor/history/mobile evidence is under `test-results/doctor-workspace-v2-real-r-098cc-signing-mobile-and-rollback-chromium/`. OHIF artifacts were written to the temporary directories reported by the harness: `rispro-native-reporting-h0oehL` (legacy) and `rispro-native-reporting-mTPwfv` (V2). These generated screenshots/logs/PDFs are local evidence and are not committed.

## Remaining production validation and limits

No requested local implementation is intentionally left as a placeholder. Blank and structured narrative templates are supplied; this task does not create an institutional template-authoring system or live collaborative editing engine.

Required before clinical rollout:

- Exact-release comprehensive and self-hosted CI, migration/release review, and hospital backup/restore procedures.
- Real archive metadata reconciliation/freshness, clinical authorization and ambiguous identity handling against the institution's authorized test studies.
- Real SonicDICOM service/SQL ownership and manual-final coexistence; local regressions use synthetic fixtures/mocks.
- Real MedASR quality/latency, HTTPS/LAN microphone access, selected devices and physical SpeechMike/shortcut behavior. Existing recorder/device handling is reused; synthetic browser audio does not prove a physical microphone or LAN relay.
- Actual clinical workstation/GPU and CT/MRI/prior/MPR/MIP viewing, physical mobile browsers, representative large-archive performance and clinical printed-report review.
- Published roster/duty/availability behavior with the institution's configured roster and staffing permissions. Local implementation reuses the existing roster repository and services.

## Files for review

The exact final status below lists every modified/new file. Responsibilities are grouped in the source: `src/modules/reporting/workspace-*` and `reporting-policy.ts` hold V2 services; the existing reporting service owns persistence/history/images. `frontend/src/pages/doctor/` holds the new workspace/editor/history pages, with one settings section. Existing doctor-board/roster/OHIF/index/printing integrations have narrow changes. The migration, synthetic integration/browser tests, completed execution plan and this delivery note are included.

## Exact final git status --short

```text
 M docker/ohif/Dockerfile
 M docker/ohif/register-reporting.cjs
 M docker/ohif/rispro-reporting/report-store.test.mjs
 M docker/ohif/rispro-reporting/src/ReportPanel.tsx
 M docker/ohif/rispro-reporting/src/report-store.js
 M frontend/src/pages/doctor/doctor-page.test.tsx
 M frontend/src/pages/doctor/doctor-page.tsx
 M frontend/src/pages/settings/__snapshots__/settings-page.composition.test.ts.snap
 M frontend/src/pages/settings/settings-page.composition.test.ts
 M frontend/src/pages/settings/settings-page.composition.ts
 M frontend/src/pages/settings/settings-page.tsx
 M frontend/vite.config.ts
 M scripts/ohif-native-reporting-browser.mjs
 M src/modules/doctor-portal/reporting-board-repository.ts
 M src/modules/doctor-portal/reporting-board-routes.ts
 M src/modules/doctor-portal/reporting-board.integration.test.ts
 M src/modules/doctor-portal/roster-repository.ts
 M src/modules/doctor-portal/roster-service.ts
 M src/modules/ohif-viewer/repository.ts
 M src/modules/ohif-viewer/service.ts
 M src/modules/reporting/reporting-routes.ts
 M src/modules/reporting/reporting-service.ts
 M src/services/authoritative-orthanc-service.ts
 M src/services/generated-print-html-service.ts
 M src/services/historical-pacs-index-service.integration.test.ts
 M src/services/historical-pacs-index-service.ts
 M src/services/reporting-board-sonicdicom-cache-service.ts
 M src/services/settings-service.ts
?? docker/ohif/rispro-reporting/src/dictation-adapter.tsx
?? docs/doctor-workspace-v2.md
?? docs/plans/completed/doctor-workspace-v2.md
?? e2e/specs/doctor-workspace-v2.spec.ts
?? frontend/src/lib/reporting-revision-diff.test.ts
?? frontend/src/lib/reporting-revision-diff.ts
?? frontend/src/lib/reporting-workspace-api.ts
?? frontend/src/pages/doctor/doctor-home-v2.tsx
?? frontend/src/pages/doctor/report-revision-history.tsx
?? frontend/src/pages/doctor/reporting-study-page.tsx
?? frontend/src/pages/doctor/reporting-workspace-page.tsx
?? frontend/src/pages/doctor/standalone-report-editor.tsx
?? frontend/src/pages/settings/reporting-policies-section.tsx
?? scripts/ohif-workspace-v2-acceptance.mjs
?? src/db/migrations/236_doctor_workspace_v2.sql
?? src/modules/reporting/reporting-policy.ts
?? src/modules/reporting/reporting-templates.ts
?? src/modules/reporting/workspace-dashboard-service.ts
?? src/modules/reporting/workspace-report-service.ts
?? src/modules/reporting/workspace-study-service.ts
?? src/modules/reporting/workspace-viewer-service.ts
?? src/modules/reporting/workspace.integration.test.ts
```
