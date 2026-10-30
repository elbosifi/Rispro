# Doctor Workspace V2 Round 1

Date: 2026-10-30. Base: `56e4d1efe4f170e045fabebe626667c578978172`.
Changes are local and uncommitted. No production database, Orthanc archive, or patient data was used.

## Cause and focused changes

The committed catalogue query joined appointments and aggregated native reports before its page limit. PostgreSQL eliminated unused report JSON from the count, but retained the appointment lateral join: its plan performed 2,000 appointment lookups for the count and another 2,000 for the page. The appointment predicate combined a booking UID with a correlated source-resolution `EXISTS` using `OR`. Its plan repeatedly scanned booking primary keys and case assignments. The page also aggregated reports 2,000 times before a top-N sort returned 25 studies.

The existing PostgreSQL `historical_pacs_studies` catalogue and synchronization service remain the source. No additional cache or synchronization mechanism was added.

- Count only catalogue rows unless reporting/assignment filters require other data.
- Materialize the filtered, ordered page before hydrating attribution JSON and appointment display data. The measured report aggregation now executes 25 times.
- Use two indexed UID lookups with `UNION` to retain both direct booking and authoritative source-resolution matches without duplicate bookings.
- Add booking UID and authoritative resolution UID indexes in migration 238. Add a date index matching `DESC NULLS LAST`; the existing default descending index puts nulls first. Reuse the existing search trigram, modality GIN, date-filter and native-report UID indexes.
- Retain all search fields, date/modality filters, author/contributor filters, sorting, exact totals, offset pagination, authorization and archive/feature-flag gates.
- At the user's request, condense only the Reporting catalogue table: tighter padding, smaller shared badges, report counts beside the native state, and patient IDs kept together. Chromium measured 45 px synthetic rows and six complete rows visible in its desktop viewport. The existing mobile horizontal table remains available.

## Measured performance

Windows Node 24.14.1, local Docker PostgreSQL 16.14. Fixture: 2,000 synthetic PACS studies, 1,000 appointments and 1,400 native reports; CT/MR, unbooked studies, primary drafts, review, primary finals, additional finals, multiple reports, assignments and cached external states. The benchmark verifies these fixture counts. The fixture and settings are rolled back.

Each HTTP scenario has one warm-up, three timed authenticated requests, then a separate request to capture SQL for `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. API times are fetch-through-JSON medians, including real router/authentication, authorization, settings, database calls and serialization. SQL values below are the separate EXPLAIN execution times for count/page; they are not API medians. Requests use a fixture-wide search except the selective patient-name search. Page size is 25; deep offset is 1,900.

The baseline used the committed study-service source and original indexes. For its repeat measurement after migration 238, the three new indexes were dropped only inside the disposable fixture's rollback transaction. The final local source was saved and restored byte-for-byte before the after run. The new signature trigger affects fixture creation, which is outside all timings.

| Scenario | API before ms | API after ms | SQL count/page before ms | SQL count/page after ms |
| --- | ---: | ---: | ---: | ---: |
| First page | 640.26 | 22.34 | 318.374 / 348.631 | 5.416 / 1.838 |
| Deep page | 642.25 | 28.46 | 329.282 / 349.056 | 5.848 / 8.036 |
| Selective patient search | 22.35 | 17.79 | 3.187 / 3.449 | 2.640 / 3.074 |
| Date and modality | 323.92 | 16.22 | 157.069 / 171.826 | 3.550 / 1.726 |
| RISpro draft filter | 643.74 | 36.32 | 333.641 / 350.705 | 12.117 / 12.894 |
| My reports | 339.75 | 28.04 | 161.025 / 170.136 | 11.634 / 3.316 |
| Patient ascending sort | 638.75 | 23.98 | 320.803 / 359.534 | 4.615 / 6.576 |

First-page count shared-buffer hits fell from 51,861 to 64; page hits fell from 64,143 to 348. These are warm-cache runs (zero shared blocks read in those plans). The final page plan uses the new date index and booking UID index. All JSON plans, SQL, bind values and individual API samples are retained locally in `test-results/workspace-round1-before.json` and `test-results/workspace-round1-after.json`.

## Reporting accuracy and primary authority

Previously, simply enabling SonicDICOM forced otherwise unreported studies to `unknown`, and external finals were included in the native `final` state. Native state and external state now remain independent:

| Native state | Meaning |
| --- | --- |
| No RISpro Report | Zero active RISpro reports; says nothing about external report existence |
| RISpro Draft | A primary interpretation draft exists |
| In Review | A primary interpretation draft has requested review |
| RISpro Final | A typed authoritative primary final exists; linked V2 finals must match the registry designation |
| Additional Reports | Active additional interpretations exist without a primary draft/review/final |

The separate external field displays External Draft, External Final (including an existing manual final), or External Status Unknown. Missing/disabled/unavailable integration is not proof of no external report. Known cached `no_report`/`study_not_found` does not add an unknown badge. External filters operate independently, so a study can match No RISpro Report and External Final. The legacy `unknown` filter value is retained for external unknown status. Native final/draft filters now describe RISpro state explicitly.

The V2 service already serialized signing with the study registry lock and rejected competing primary finals under typed policy. Unrestricted policy permits additional independent signatures, with `is_primary=false`. That behavior remains configurable and is now covered explicitly. Drafts and typed additional interpretations are not exposed as authoritative primary reports. Legacy adoption requires primary report type as well as its old primary flag.

Migration 238 adds a database guard for future signatures, including legacy authoritative-Orthanc reports not linked to a registry yet. It rejects additional report types marked primary and serializes primary signatures by UID before checking archive identity. An absent legacy archive key is treated conservatively as potentially conflicting. Existing signed rows, addenda, versions, identities and audit history are not rewritten. SonicDICOM ownership checks remain unchanged and still block native creation/signing on external ownership or unverifiable status.

## Validation

PASS on the final application tree:

- Large catalogue HTTP/DB benchmark and regression: 1 test; exact native/external filter counts, all 2,000 studies paged without duplicates, PACS-only preservation, direct/resolved/deduplicated appointment paths, assignment filters, no remote catalogue retrieval.
- Workspace lifecycle integration: 16 tests, including competing signatures, unrestricted policy, duplicate legacy primary rejection, external ownership, revisions, immutable history, addenda, stale/archive identity and feature rollback.
- Reporting Board integration: 111 tests.
- Historical PACS index/synchronization integration: 47 tests.
- OHIF schema integration: 4 tests. Its trigger contract now names the added guard and the three existing immutable protections.
- Reporting validation/native authorization unit tests: 5 tests.
- OHIF reporting store: 6 tests.
- Native report and personal reporting frontend tests: 23 tests across 3 files.
- Real Chromium desktop/mobile catalogue/editor journey: 1 test; signing, attribution, review, collaboration, conflict handling, history, printing, policy and feature rollback. Screenshots and density JSON are in `test-results/workspace-round1-browser/`.
- Backend typecheck; frontend typecheck and production build after the final frontend edit; focused frontend lint; agent contract; harnesses; whitespace check.

Node test-worker/Git subprocess and Vite startup sandbox blocks were rerun outside the sandbox. The Windows `db:test:required` wrapper returned without executing tests; actual validation used `test:db:one` for each listed DB file. A browser rerun initially found prior synthetic reports because its reset had been omitted; rerunning after the documented disposable E2E reset passed. The compact row assertion caught wrapping during development and passed after patient-ID wrapping was corrected. No assertions were relaxed to conceal failures.

## Remaining validation and rollout limits

- These are single-client local synthetic warm-cache measurements, not hospital latency, throughput, cold-cache or million-study evidence. Exact counts still visit matching catalogue rows; status filters must evaluate matching reports, non-date sorts may sort matching catalogue rows, and deep offsets still skip rows.
- Before hospital rollout, measure representative archive size and distributions, concurrent synchronization/read/sign traffic, cold cache, search terms and deep pages on hospital hardware. Schedule migration 238 index creation for a suitable maintenance window and assess build time, locking and disk space.
- Confirm external cache refresh coverage and SonicDICOM/manual-final mappings with real hospital workflows. Unknown external state remains explicit; native write protections continue to fail closed.
- Existing conflicting legacy signatures/designations need clinical reconciliation; this change does not mutate signed records to resolve historical conflicts.
- Comprehensive and self-hosted exact-commit CI are UNRUN; no commit, push or deployment was authorized. Feature flags and policy options remain unchanged. No Appointments tab, MedASR, roster or unrelated product changes were made.
