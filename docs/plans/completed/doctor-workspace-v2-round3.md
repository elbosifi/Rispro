# Doctor Workspace V2 Round 3

Date: 2026-10-30. Base: `84b65bcd8f762d92e5fb71fef94fd6c9dc47496f`.
Scope includes the subsequently requested PACS worklist and SonicDICOM improvements. Changes remain uncommitted. Development and validation use disposable databases and synthetic studies only.

## Confirmed findings and corrections

- Open review requests were counted as personal awaiting-review work for every eligible doctor. Designated requests, the available open queue, personal submissions, and shared contributions now have separate counts and labels. Each query counts a report once; deleted drafts are excluded.
- Personal modality attribution used the first DICOM modality, including companion objects such as SR. Statistics now use diagnostic modalities, normalize MRI to MR, and count each signed report once. Mixed diagnostic studies have their own combined modality bucket. Author and assignee are independent of the actual signer.
- Native signatures and externally attributed examinations lacked an explicit distinction. Doctor Home labels native signatures, additional interpretations, SonicDICOM appointment finals with known finalizer/date, and all-time departmental unique completions separately. Manual external finals without a known actual signer do not become personal signatures. Calendar windows include the hospital date and preceding 6/29 dates in Africa/Tripoli, with an exclusive next-day boundary.
- Assigned work only found native reports by appointment ID. A primary final created before its later appointment association could remain pending. Assigned aggregation now also checks the verified archive/study registry. A separate draft cannot displace its authoritative final. Departmental completion includes PACS-only cached external finals and deduplicates native/external study identities and includes unindexed external examinations using their appointment identity.
- Recovery previously reactivated deleted drafts alongside replacements and cleared `legacy_primary`. Deletion now retains that flag. Supervisor recovery rejects any active replacement for the study/appointment with HTTP 409, rechecks external ownership, and restores legacy compatibility only when no replacement exists. Older deleted drafts with an already-cleared flag follow the same rule. Signed records are untouched.
- Live study verification checked patient/UID/accession but omitted diagnostic modality changes. Creation, signing, addenda, and viewer launch now reject a changed live modality set. Connectivity failures return a recoverable HTTP 503. Reading also rejects reuse of an Orthanc key for a different Study Instance UID.
- Starting a synchronization retry cleared the previous error before success and could briefly mark the catalogue fresh. The existing worker now retains that error until successful synchronization.
- The editor treated every HTTP 409 as a revision conflict. Stale-index and recovery/ownership failures now retain their own error message; actual revision conflicts retain the existing comparison and reconciliation flow.
- Both Reporting Board unit failures were obsolete source assertions. The repository already preferred native finalizer attribution over cached external attribution. The assertions now reflect that behavior; integration coverage additionally verifies native-only, external-only, combined fields, and assignee-versus-signer filtering. Working Board logic was not changed.
- The PACS catalogue response also returned unused search-normalization metadata. The final page projection retains the fields consumed by the worklist and avoids that extra payload. The PACS catalogue already had no default age cutoff, but defaulted to 25 rows and silently reused old saved status filters. It now defaults to 50, keeps date-descending order, and uses an indexed valid-date expression with study ID as the stable tie-breaker. Invalid/partial dates sort last. Unversioned saved status/modality defaults reset once; explicit URLs and newly remembered filters remain effective. Old explicit `status=unknown` bookmarks are visibly normalized to Not Checked instead of leaving a hidden filter under an All Studies label. Editor/dictation preferences are retained.
- PACS-only studies lacked external status storage. The new small external-observation mapping uses archive identity, SonicDICOM source identity, and exact Study Instance UID. No appointment is fabricated. Short badges carry full explanations and last-verification/error information in tooltips. Native and external states remain separate.

## Dashboard metric definitions

| Metric | Meaning |
| --- | --- |
| Currently assigned examinations | Distinct active reporting assignments in permitted modalities |
| Awaiting authoritative final | Assigned examinations without a native authoritative primary, external final, or active manual final |
| My active drafts | Active drafts authored by or contributed to by this user |
| Shared drafts I contribute to | Shared active drafts with this user's retained contribution |
| Review requests designated to me | Active requests naming this doctor, excluding their own submissions |
| Open review requests available to me | Undesignated requests available under current reviewer/modality policy, excluding own submissions; a shared queue |
| Submitted by me for review | Active requests submitted by this user |
| RISpro signatures | Native reports actually signed by this authenticated user in the selected period, including separately identified additional interpretations |
| SonicDICOM appointment finals | Cached external final appointments with this doctor's mapped finalizer and known external signing date; not a complete external document history or PACS-only finalizer statistic |
| Department completed | All-time unique authoritative examinations, independently of personal activity or extra interpretations |

## Concurrency, retention, permissions and outage evidence

The existing expected-revision mechanism, study/appointment/report transaction locks, immutable version/signature triggers, shared/independent report IDs, and primary-final policy remain in use. No collaboration transport or reporting architecture was added.

Synthetic integration coverage proves sequential edits by two doctors, correct contributor/editor attribution, exactly one winner for simultaneous saves, explicit stale-save rejection, separate independent content/history, competing primary signatures, unrestricted additional signatures without second primary authority, mandatory/designated review and direct-API bypass rejection, optional review transitions, and signed-addendum preservation. Browser coverage exercises retained unsaved text and manual conflict reconciliation.

Deletion/recovery tests retain real synthetic PNG bytes, image identity, earlier immutable versions, and new restoration revisions. They reject recovery beside a replacement draft, a replacement final, and later external ownership. Signed deletion/restoration and history updates are rejected. Current modality/authentication checks protect report reads, history, print, creation, editing, review, recovery, signing, addenda and OHIF launch. Existing Reporting Board tests also cover ordinary doctors, signers, supervisors, unauthorized roles/accounts, legacy viewer contexts, and SonicDICOM ownership.

| Situation | Before / after |
| --- | --- |
| Same-source stale catalogue | Cached browsing already worked; it remains available with an explicit outdated-metadata warning and Tripoli synchronization time |
| Existing signed report during outage | Preserved read/print path retained and tested through authenticated HTTP, including a missing index row and an unreachable synthetic archive; no frames are needed |
| Draft during stale/unverifiable index | Remains read-only. Opening retains the explanation; a failed save retains unsaved text |
| Finalization | Stale index rejects with 409; unavailable live verification rejects with 503; a cached status/timestamp cannot authorize signing |
| Retry in progress after failure | Previous error now remains visible and reporting stays restricted until success |
| Successful recovery | Existing synchronization cycle clears the error; reads and mutations become available without application restart |
| Archive/UID/patient mismatch | Fails closed; no automatic ownership or signed-data repair |

## PACS-only SonicDICOM status and additive migration

Migration 239 adds `doctor_portal.workspace_sonicdicom_cache`, its due index, a strict immutable date-normalization function, and an expression index on the existing catalogue. Existing application/schema versions remain compatible; no signed row, report identity, history, or cached catalogue row is rewritten. Index creation requires a suitable hospital maintenance window and assessment of archive size, disk and locking.

The existing SonicDICOM worker and advisory lock process at most 50 queued PACS studies per tick. The new UID batch entry point reuses the existing SQL Server connection, readiness query, configured status codes and document mapping. PACS-only lookup deliberately uses exact UID only; arbitrary accession fallback is not safe for these source-bound studies. Existing appointment fallback behavior remains unchanged.

Worklist reads perform only PostgreSQL queries. Missing page observations are queued in a bounded local insert. The external SQL system is never called synchronously per worklist row. Disabled or inapplicable integrations do not queue work. No historical archive scan runs on deployment. Cached observations display immediately; Refresh and normal query-cache expiry retrieve newer observations.

States distinguish external final, draft, verified no report, verified missing external study, not checked, unavailable, disabled and inapplicable SQL integration. An unavailable result retains its last successful observation/date but is displayed as unavailable. PACS-only external finals contribute to the deduplicated departmental total; personal external attribution is explicitly scoped to the existing appointment finalizer cache. Relevant catalogue metadata changes request reverification while retaining known external ownership. Archive or SQL-source changes cannot reuse another source's display observation.

Unchanged queued recent drafts/absence are checked after five minutes; recent finals after one hour; studies older than 30 hospital days after seven days. Failures back off from one minute to at most one hour. These display-cache intervals never authorize native creation or signing. Those operations retain live external ownership checks when enabled, and retained known external drafts/finals block takeover even when integration is subsequently disabled.

An authorized supervisor may explicitly enqueue a bounded historical page through `POST /api/native-reporting/workspace/external-status/backfill` with `{ "limit": 100, "cursor": "" }`. Maximum 200, restricted to current modality scope. `nextCursor` advances through study identifiers; null means complete. Each request only queues that page; it does not start a full historical scan or create appointments. Routine worker updates operate only on queued due identities.

## Validation

Local commands and results (final benchmark/browser status recorded below):

| Command / group | Result |
| --- | --- |
| `npm run agent:preflight`, `npm run db:test:up`, `npm run db:test:check` | PASS; pre-existing disposable PostgreSQL 16.14 preserved on localhost:5433/rispro_test |
| `npm run test:db:one -- src/modules/reporting/workspace.integration.test.ts` | PASS 30/30 |
| `npm run test:db:one -- src/modules/doctor-portal/reporting-board.integration.test.ts` | PASS 111/111 |
| `npm run test:db:one -- src/services/historical-pacs-index-service.integration.test.ts` | PASS 47/47 |
| `npm run test:db:one -- src/modules/ohif-viewer/ohif-schema.integration.test.ts` | PASS 4/4 |
| `npm run test:db:one -- src/modules/medical-dictation/medical-dictation.integration.test.ts` | PASS 7/7 |
| `npm run test:db:one -- src/services/sonicdicom-report-service.test.ts` | PASS 33/33; includes exact-UID SQL binding, configured tombstones, missing result safety and final/draft/absence distinctions |
| `npm run test:db:one -- src/services/reporting-board-sonicdicom-cache-service.test.ts` | PASS 12/12 |
| `npm run test:db:one -- src/modules/reporting/workspace-catalogue.integration.test.ts` | PASS 1/1; 2,000-study benchmark and complete pagination/filter assertions |
| Final Chromium workspace group | PASS 4/4 |
| Original focused reporting/OHIF unit group | PASS 88/88, including both formerly failing Board assertions |
| Focused frontend group, 18 files | PASS 457/457 |
| `npm run typecheck` | PASS |
| `npm run typecheck:frontend` | PASS on final frontend application tree |
| `npm run build:frontend` | PASS on final frontend application tree; existing chunk-size/plugin-timing warnings |
| Focused ESLint on changed frontend files | PASS |
| `npm run agent:contract`, `npm run harness:all`, `git diff --check` | PASS; existing report-only harness warnings |

The 88-test command is `node --import tsx --test docker/ohif/rispro-reporting/report-store.test.mjs src/modules/doctor-portal/cases.test.ts src/modules/doctor-portal/reporting-board.test.ts src/modules/medical-dictation/medasr-client.test.ts src/modules/medical-dictation/medical-dictation-proxy.test.ts src/modules/ohif-viewer/adapters.test.ts src/modules/ohif-viewer/examination-matching.test.ts src/modules/ohif-viewer/native-authorization.test.ts src/modules/ohif-viewer/proxy-authorization.test.ts src/modules/ohif-viewer/validation.test.ts src/modules/ohif-viewer/viewer-session.test.ts src/modules/reporting/reporting-validation.test.ts`.

Exact frontend test command:

```powershell
npm run test:frontend -- src/pages/doctor/reporting-round3.test.tsx src/pages/doctor/reporting-round2.test.tsx src/pages/doctor/doctor-page.test.tsx src/pages/doctor/doctor-worklists-page.test.tsx src/pages/doctor/doctor-reporting-board-page.test.tsx src/pages/doctor/reporting-board-mobile-page.test.tsx src/pages/doctor/reporting-board-mobile-page.behavior.test.tsx src/pages/doctor/native-report-page.test.tsx src/pages/doctor/personal-reporting-viewer-actions.behavior.test.tsx src/pages/doctor/personal-reporting-patient-history.behavior.test.tsx src/lib/reporting-revision-diff.test.ts src/lib/unsaved-navigation-guard.test.ts src/providers/dictation-provider.test.tsx src/hooks/use-dictation-shortcuts.test.tsx src/lib/dictation-target.test.ts src/lib/dictation-preferences.test.ts src/lib/medical-dictation-cleanup.test.ts src/pages/settings/medical-dictation-section.test.tsx
```

Focused lint, from `frontend/`:

```powershell
npx eslint src/pages/doctor/doctor-home-v2.tsx src/pages/doctor/reporting-workspace-page.tsx src/pages/doctor/standalone-report-editor.tsx src/pages/doctor/reporting-round2.test.tsx src/pages/doctor/reporting-round3.test.tsx src/lib/reporting-workspace-api.ts
```

The initial focused Board reproduction failed on the same two obsolete assertions (41/43 in that subset). After correction the original Round 2 invocation passes all 88. Initial local tooling blocks and test-fixture corrections are not passing evidence: Node/Git/Vite/Chromium/Docker sandbox blocks were rerun outside the sandbox unchanged. `db:test:required` again exited without executing tests on Windows, so actual counted DB proof uses `test:db:one`. Direct Sonic unit invocations lacking test environment variables were replaced by that repository wrapper. Browser outage controls now fail every synthetic Orthanc endpoint and hold the existing synchronization advisory lock so periodic ticks cannot overwrite the controlled UI state; actual worker-cycle failure/recovery remains separately integration-tested. Browser fixture corrections account for an appointment whose accession no longer matches the fixture prefix, a corrected test-only deep-page URL, and explicit no-report seed data so the synthetic worker cannot mark the native-report appointment unavailable on its periodic tick. Production ownership checks remain unchanged. Failed browser workers reseed their fixture, so earlier cascading totals of 430 were not accepted as valid catalogue evidence. The E2E environment defaults `OHIF_ENABLED=false`; browser acceptance explicitly enables it only for the test process. No application authorization guard was relaxed.

## Performance and browser artifacts

The rollback-only 2,000-study / 1,000-appointment / 1,400-report fixture measures authenticated HTTP through JSON, one warm-up and three measurements per scenario, with separate EXPLAIN plans. The committed service and matching routes were temporarily measured at 25 and 50 rows, then restored byte-for-byte. The added migration remains installed in the disposable test DB; its index does not change the old query. No production or LAN latency is claimed.

Committed current-run baseline: 25-row first page 21.62 ms, draft filter 36.46 ms; 50-row first page 28.18 ms, draft filter 42.09 ms. Raw baselines: `test-results/workspace-round3-base-25.json` and `test-results/workspace-round3-base-50.json`. Final 50-row measurement, per-query timings and EXPLAIN plans are in `test-results/workspace-round3-50.json`. The final run had no concurrent browser/build load.


| Scenario | Committed 25 rows ms | Committed 50 rows ms | Final 50 rows ms |
| --- | ---: | ---: | ---: |
| First page | 21.62 | 28.18 | 27.17 |
| Offset 1,900 | 25.35 | 27.44 | 35.73 |
| Selective search | 19.07 | 19.39 | 19.17 |
| Date and modality | 16.82 | 18.94 | 20.84 |
| Draft filter | 36.46 | 42.09 | 42.19 |
| My reports | 27.34 | 31.09 | 32.82 |
| Patient ascending | 24.40 | 27.05 | 25.90 |

The equivalent 50-row first page is 1.01 ms faster and the draft filter differs by +0.10 ms. The deep offset remains 8.29 ms slower than the equivalent committed 50-row query; valid-date ordering adds work at deep offsets. This is a remaining measurement limit, not a claim of identical performance across every scenario. Page-first hydration remains bounded to 50 rows, the date expression index is used for ordinary first-page ordering, and no SonicDICOM network lookup occurs on catalogue reads. Repeat cold/deep-page and representative-scale measurements in staging. Earlier loaded/intermediate runs were diagnostic and are not substituted for this final comparison.

Browser command: `npm run e2e:db:up`, then `npm run test:e2e -- e2e/specs/doctor-workspace-v2.spec.ts --output=test-results/workspace-round3-browser` with process-only `OHIF_ENABLED=true`, then `npm run e2e:db:down`. It uses the separate disposable localhost:5444/rispro_e2e database, local synthetic archive/MedASR and a synthetic diagnostic-viewer document after the real token exchange. It proves report-free authorized launch and prior restrictions, not actual diagnostic-frame delivery.

Artifacts and complete logs are under `test-results/workspace-round3-*`. Screenshots cover original desktop/mobile editor/history, Round 2 worklist/appointments/tablet return, Round 3 dashboard, stale catalogue, preserved signed report, and 50-row compact PACS/Sonic states. Final Chromium result: PASS 4/4 on the final application tree. PACS row height: 41 px without a fixed row height; 50 default studies, 215-study complete pagination, old-study search and invalid-date ordering verified. Returning to the unchanged cached worklist made zero new list requests. Desktop/mobile dashboard, desktop/mobile PACS, and outage signed-report screenshots were visually inspected. The E2E container was stopped after acceptance; the pre-existing unit-test DB container was preserved.

## Files, limits and handoff

Backend changes: workspace dashboard/report/study services and routes; Historical PACS retry error retention; existing SonicDICOM batch service/worker; the small new external-status cache service; additive migration 239. Tests extend workspace integration, catalogue benchmark, Board source assertions and Sonic batch coverage. Frontend changes: Doctor Home labels, worklist badges/freshness, preference versioning/API fields and precise editor conflict classification; focused frontend tests and the existing browser spec are extended.

No dependencies, diagnostic OHIF delivery, report architecture, signing policy options, assignment authority, MedASR insertion, React Query retention, navigation safeguards, V2 rollout flag or rollback mechanism are replaced. Comprehensive and self-hosted exact-commit CI are UNRUN: no commit or push was authorized. Local synthetic results are not hospital acceptance. Before rollout, validate real SonicDICOM schema/status codes, UID coverage and external document ownership, SQL permissions/timeouts, representative concurrent doctors, archive size/index build costs, cold/deep-page performance, actual native/proxy frames and hospital browser policies. The external display cache may lag its stated verification time; live signing and ownership checks remain mandatory.

Final contract/harness and whitespace checks pass. No commit, push, branch switch, PR, merge or deployment was performed.

Final `git status --short`:

```text
 M e2e/specs/doctor-workspace-v2.spec.ts
 M frontend/src/lib/reporting-workspace-api.ts
 M frontend/src/pages/doctor/doctor-home-v2.tsx
 M frontend/src/pages/doctor/reporting-round2.test.tsx
 M frontend/src/pages/doctor/reporting-workspace-page.tsx
 M frontend/src/pages/doctor/standalone-report-editor.tsx
 M src/modules/doctor-portal/reporting-board.test.ts
 M src/modules/reporting/reporting-routes.ts
 M src/modules/reporting/workspace-catalogue.integration.test.ts
 M src/modules/reporting/workspace-dashboard-service.ts
 M src/modules/reporting/workspace-report-service.ts
 M src/modules/reporting/workspace-study-service.ts
 M src/modules/reporting/workspace.integration.test.ts
 M src/services/historical-pacs-index-service.ts
 M src/services/reporting-board-sonicdicom-cache-worker.ts
 M src/services/sonicdicom-report-service.test.ts
 M src/services/sonicdicom-report-service.ts
?? docs/plans/completed/doctor-workspace-v2-round3.md
?? frontend/src/pages/doctor/reporting-round3.test.tsx
?? src/db/migrations/239_workspace_external_status.sql
?? src/services/workspace-sonicdicom-cache-service.ts
```
