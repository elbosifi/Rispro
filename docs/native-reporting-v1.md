# Native reporting v1

Implemented, disabled by default, and locally exercised with synthetic CT/MRI data. Local results and remaining rollout gates are recorded below. This document is not clinical rollout approval.

## Ownership and enablement

Migration `235_native_reporting.sql` adds `ohif_viewer_settings.native_reporting_enabled` (default false), per-tab launch context/patient/date fields, and `native_reports`, `native_report_versions`, and `native_report_key_images`.

In Settings > OHIF Viewer, enable **RISpro native reporting (CT/MRI)** and save through the existing supervisor settings authorization. Open an eligible completed, report-required, appointment-backed CT/MRI case in OHIF, click **Report**, verify patient/examination identity, and explicitly click **Create RISpro Report**. A GET, opening the panel, or viewing images does not create a report. No normal findings are inserted. Comparison requests remain outside this workflow.

Existing external drafts/finals, known external document ownership, and active manual final overrides reject native creation. When SonicDICOM reporting is enabled, its absence of a report must be verified; unavailable/ambiguous ownership is rejected. There is no report migration, dual write, reopening of signed text, or PACS writeback. Once explicitly selected, native state supplies Reporting Board rows, resolved filters/pagination, statistics, and Personal Desk state. SonicDICOM status writes and manual-final overrides cannot take over a native case; legacy cases keep their existing behavior.

Disabling the setting stops creation/editing/signing entry points. It does not delete data; authorized saved report and print access remains available, including finalized reports. **Open Report** on the Reporting Board and Personal Desk retrieves the same native report. Continue editing from the authorized OHIF case launch.

## Context and authorization

The server persists a per-launch UUID with the launching user, appointment, patient, primary study, imaging source, allowed study UIDs, and primary study date. The UUID in `risproContext` is a selector requiring the existing live RISpro login, not a bearer credential. The scoped image-session cookie is not used to authorize reporting API calls.

New launches use `/ohif-dicomweb/context/<uuid>/...`; the original cookie gateway remains compatible. Each tab retains its own exact-study allowlist even when another tab changes the old shared cookie. Clinical responses are private/no-store. No PACS credentials are sent to OHIF. The report stays with the launch appointment/primary study while the active viewport switches to an authorized prior.

All report/image/history/print requests enforce case read access. Editing additionally requires native enablement, an eligible case without holds, modality reporting permission and assignment or doctor-manager scope. Signing/addenda require the separate existing `canFinalizeReports` permission. Mutations recheck access after acquiring the case lock and validate the persisted patient/study/source mapping. A changed, missing, old, revoked, or expired context fails closed; reopen/reconcile from RISpro. Older image-only sessions must be relaunched before reporting.

## Persistence and signing

Text is plain Unicode with Clinical history, Comparison, Technique, Findings and Impression. Autosave follows approximately one second of idle typing. Saves are serialized, use expected revisions, and show Saved only after acknowledgment. No-op text/selection saves create no version. Conflicts preserve unsaved text in memory and require explicit discard/reload; failed ordinary saves can be retried. Unsaved text, captions, addenda and pending captures stay in this tab's memory, with a leave warning. There is no browser-crash recovery or clinical localStorage backup.

Finalize shows patient and examination identity, flushes pending edits, rejects unresolved uploads/conflicts, and checks revision and signing authority. The transaction preserves a signed snapshot of text, identity, author, signer, timestamp, ordered images, captions and provenance. An appointment uniqueness constraint protects creation retries; request IDs protect upload/finalization/addendum retries. PostgreSQL guards prevent signed-report changes, image/provenance replacement and history edits. Corrections are append-only signed text addenda. Audits contain report identity/action/revision, never report bodies or image bytes.

## Key images and storage

The extension captures the active Cornerstone canvas and clinical SVG annotation layer directly, without creating a second viewport or changing tools/camera. It derives orientation labels from displayed LPS geometry and excludes OHIF chrome/demographic overlays. Capture checks render identity, camera, display properties, dimensions, annotation content, active viewport and scrolling state; it rejects blank or changed captures. PNGs are rendered **report illustrations**, not original DICOM data, SR, KOS, secondary capture, or editable annotations.

Stack provenance includes original Study/Series/SOP UIDs and a one-based DICOM frame number. MPR/MIP provenance includes source study/series, Frame of Reference, camera/focal point/orientation, slab and mapper blend mode; it deliberately omits a fictitious single SOP. Captures support one CT/MRI source series; fusion and 3D volume rendering are excluded. Locate Source finds stack SOP/frame. Volume captures offer **Open Source Series**, without claiming exact plane restoration. Unsupported/unresolvable frame references fail closed.

The backend verifies allowed-study and same-patient metadata against the configured archive, PNG signature/actual decoding, dimensions (32–4096 pixels), size (12 MB maximum), and SHA-256. It uses the existing document storage configuration, preferred network root and allowed local fallback under a dedicated `report-key-images` directory. There are no `documents` rows that generic scan/QR/document endpoints could expose. Files are flushed and verified before database acknowledgment; failed known-unreferenced writes are cleaned up. Uncertain commit outcomes retain bytes unless absence of a database reference can be established. Removed draft illustrations are retained, never delete PACS data, and cannot modify a signed selection. V1 limits a report to 24 images and captions to 2,000 characters.

## Backup, HA and rollback

The ordinary file is canonical. Temporary document HA excludes reports and does not protect these PNGs. PostgreSQL HA alone therefore does not make report illustrations available on another application host: use the configured protected shared document storage or restore the canonical files as well as PostgreSQL.

Backup V3 discovers the three public native tables through its existing database metadata exporter. Its configured uploads/project-storage/document-storage roots include canonical PNGs; external document roots must satisfy the existing allowlist. Database-only backups do not protect image bytes. Preserve these roots, filenames, checksums and database references together. Do not change storage roots or delete retained assets as a rollback operation. Turning off native reporting is the normal feature rollback; keep the migration/tables and signed files. Do not run a destructive schema downgrade after reports exist.

Print uses the existing server HTML printing service and browser Print/Save as PDF. Output contains saved identity/sections/signatures, a draft watermark, ordered illustrations/captions/source dates, and chronological signed addenda. Final output reads immutable snapshots and protected stored PNGs; PACS availability is not required. No anonymous/QR route is added.

## Pinned-source decisions and references

Inspected tag `v3.12.6`, commit `2851f4349d586f475c279e34d2fdb1d0b56e2fc7` (annotated tag object `ea7053182ace97dbe52f8af7e8f7fadaa63453f0`). Cornerstone core/tools remain `4.15.29`; OHIF React remains `18.3.1` and is a peer, not a second RISpro React runtime. The Docker build registers a workspace extension in `platform/app/pluginConfig.json` and the longitudinal mode dependency map. No generated/minified bundle patching is used.

The panel uses OHIF UI-next buttons, inputs and confirmation dialogs. The pinned package has no exported multiline text control, so narrative fields use ordinary textareas within that panel. RISpro's read-only report page reuses its existing shared primitives.

Pinned `SidePanelWithServices` retains `closedManually` despite `activatePanel(..., true)`. Report first sends the existing public PubSub `PANELS_CHANGED` event with `rightPanelClosed:false`, then activates its tab. This reopens a collapsed panel without resetting the panel registry or imaging engine. Capture's render signature includes the stack's pending target index as well as its displayed index, so scrolling that starts during PNG encoding fails closed.

- [OHIF panel modules](https://docs.ohif.org/platform/extensions/modules/panel/) and [toolbar modules](https://docs.ohif.org/platform/extensions/modules/toolbar/): architectural entry points. Actual integration uses the pinned module registry, `panelService.addPanels/activatePanel`, `toolbarService.register/updateSection` and the existing resizable right panel.
- [Viewer toolbar](https://docs.ohif.org/user-guide/viewer/toolbar/) and [measurement panel](https://docs.ohif.org/user-guide/viewer/measurement-panel/): existing viewing/measurement tools remain available. Measurement SR export is a different workflow from a signed narrative report.
- [Pinned OHIF source](https://github.com/OHIF/Viewers/tree/v3.12.6): inspected extension registration, basic/longitudinal mode configuration, PanelService, ToolbarService, Cornerstone viewport services and `extensions/cornerstone/src/commandsModule.ts`.
- [Pinned download implementation](https://github.com/OHIF/Viewers/blob/v3.12.6/extensions/cornerstone/src/utils/CornerstoneViewportDownloadForm.tsx): creates another viewport, copies only stack properties or a volume ID, and enables/disables annotation tools. It does not establish faithful active volume camera/slab/annotation capture, so reporting uses a small direct adapter instead.
- [SonicDICOM report operations](https://docs.sonicdicom.com/user-manual/report/operation.html) and [report toolbar](https://docs.sonicdicom.com/user-manual/report/toolbar.html): workflow inspiration for explicit creation/save/final status/history/print. No SonicDICOM mutation or template system is adopted.
- [DICOM PS3.3 A.35.4](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_A.35.4.html): KOS identifies significant DICOM objects. Stored rendered PNG illustrations do not constitute KOS objects.

The live OHIF documentation currently describes newer versions; pinned source takes precedence for API names.

## Validation and clinical acceptance

All local DB validation used the guarded disposable `localhost:5433/rispro_test` target. Real browser validation used isolated Orthanc 26.4.0 (Orthanc 1.12.11, DICOMweb 1.23), nginx 1.27.5, the modified OHIF production Docker image, the real RISpro backend, and the production-built RISpro frontend. No production patient, database or archive was accessed. The synthetic fixture harness cleans up its own containers, settings, rows and upload bytes; screenshots/PDFs are retained in its printed temporary artifact directory.

The browser journey covers annotated CT and MRI stack PNGs, window/level, inversion, horizontal flip and rotation, coronal/sagittal and oblique MPR, a 12 mm MIP slab, same-patient priors, and an enhanced MR object's third DICOM frame. Stored PNG pixels are decoded and checked for nonblank content and colored annotations. Capture/upload success is not mocked. A deliberately aborted first upload is retried against the real API and produces one attachment. The harness also exercises failed text saves retaining input, a visible two-editor conflict, signing, signed addenda, reopening from the built RISpro page, two independent patient tabs, feature disablement, 1600x1000 and 1024x800 layouts, and printing with Orthanc paused. The HTTP test hostname resolves only inside Chromium to the loopback fixture and asserts `isSecureContext === false`.

The focused DB test covers unique concurrent creation, no-create GETs, wrong-user/case rejection, separate read/edit/sign authority, expired JWT and revoked account rejection, stale revisions, no-op history, native status/filter/count consistency, legacy ownership and synchronization guards, real PNG persistence/protected retrieval, captions/order/removal, upload versus signing races, immutable signatures, append-only addenda, disabled-feature reads, changed patient/study/source mappings, expired and revoked launch contexts. Backup V3's real collector and storage restore recovered three deliberately damaged/retained synthetic PNG files with byte equality; its database metadata included all three native tables with rows. This proves canonical image collection/restoration and table discovery, not a full replacement-server database/HA recovery rehearsal.

Validation commands and observed results (2026-10-26):

| Command | Result |
| --- | --- |
| `npm run agent:contract` | PASS outside sandbox after startup EPERM inside sandbox. |
| `npm run agent:preflight` | DOCKER_OK outside sandbox; sandbox Docker EPERM was an execution boundary. |
| `npm run db:test:up` / `npm run db:test:check` | PASS; existing disposable PostgreSQL container preserved. |
| `npm run db:test:required -- src/modules/doctor-portal/reporting-board.integration.test.ts` | Exited without assertions on Windows; **not counted as a test pass**. Actual focused proof used the next command. |
| `npm run test:db:one -- src/modules/doctor-portal/reporting-board.integration.test.ts` | PASS, 107 tests, zero skipped. |
| `npm run test:db:one -- src/modules/ohif-viewer/ohif-schema.integration.test.ts` | PASS, 3 tests, zero skipped; final migration applied to the disposable DB. |
| `node --import tsx --test src/modules/reporting/reporting-validation.test.ts src/modules/ohif-viewer/ohif-runtime-config.test.ts src/modules/ohif-viewer/viewer-session.test.ts src/modules/ohif-viewer/proxy-authorization.test.ts src/modules/ohif-viewer/adapters.test.ts src/services/generated-print-html-service.test.ts` | PASS, 20 tests, zero skipped. |
| `node --test docker/ohif/rispro-reporting/report-store.test.mjs` | PASS, 5 tests, including text entered while an addendum signature is pending; unchanged host rerun after sandbox EPERM. |
| `npm run test:frontend -- --run src/pages/settings/ohif-viewer-section.test.tsx src/pages/doctor/personal-reporting-viewer-actions.behavior.test.tsx src/pages/doctor/doctor-reporting-board-page.test.tsx src/pages/doctor/native-report-page.test.tsx` | PASS, 112 tests. JSDOM's existing `scrollTo` warnings are nonfailing. Host rerun used after sandbox native-binding/EPERM startup failure. |
| `npm run typecheck` | PASS. |
| `npm run typecheck:frontend` / `npm run build:frontend` | PASS after the final browser-side code edit. Existing bundle-size warnings remain. |
| `npm run lint:frontend` | PASS, zero errors and nine existing warnings. |
| `npm run harness:all` | PASS with existing report-only warnings; UI normalization debt did not increase. |
| `docker build --progress=plain -f docker/ohif/Dockerfile -t rispro-ohif:native-v1 .` | PASS, actual pinned production compilation; upstream webpack warnings remain. |
| `$env:OHIF_TEST_IMAGE='rispro-ohif:native-v1'; node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs` | PASS, actual modified viewer journey, including non-secure HTTP capture. |
| `$env:OHIF_TEST_IMAGE='rispro-ohif:native-baseline'; $env:OHIF_PHASE2_NETWORK='10mbps'; node --env-file=codex-db-test.env --import tsx scripts/ohif-performance-benchmark.mjs` | Initial complete baseline PASS in Chromium/WebKit. Instrumented repeat produced Chromium/CT WebKit metrics but timed out navigating the unchanged viewer's WebKit MRI case. An earlier repeat also timed out awaiting first render. These failed repeats are not passing runs. |
| `$env:OHIF_TEST_IMAGE='rispro-ohif:native-v1'; $env:OHIF_PHASE2_NETWORK='10mbps'; node --env-file=codex-db-test.env --import tsx scripts/ohif-performance-benchmark.mjs` | Earlier modified-image runs PASS in Chromium/WebKit, including actual pixels/switch/scroll and exact lossless JPEG decoding. **Exact handoff-image repeat FAIL:** Chromium CT completed, then MRI bootstrap resources returned 504s/NetworkError and first render timed out at 90 seconds; subsequent viewer cases did not run. Repeatable performance verification remains open. |
| `git diff --check` | PASS. |
| Comprehensive / self-hosted CI | NOT RUN: changes remain uncommitted and unpushed. No deployment. |

Corrected implementation/verification failures included the pinned build's JSX parser requirement (extension entry/panel are TSX), nginx's required quoted regex token, the RISpro API client's relative-path convention, exact Saved-state assertions, and collapsed-panel reopening. Intermittent browser-navigation/pending-upload timeouts are retained in diagnostic evidence; successful final reporting journeys used real uploads and unchanged OHIF rendering. The final performance failure's first actionable evidence is 504 responses on non-DICOM bootstrap resources (classified as assets by the harness), followed by NetworkError and no diagnostic render. Individual failing resource URLs were not retained. Similar startup failures occurred with the unchanged baseline; the infrastructure cause is unresolved, and no delivery/time-limit workaround was added. On ordinary insecure HTTP, pinned upstream `platform/app/public/init-service-worker.js:1` raises `Cannot read properties of undefined (reading 'getRegistrations')`. Reporting completes despite this unrelated console error; it is documented and left unchanged.

PDF pages were rasterized with the repository's existing PDF.js in Chromium because Poppler was absent. The synthetic CT output has seven pages and MRI has four, preserving image aspect ratios, captions/order and chronological addenda. Text and images remain within page boundaries. Full-page browser print screenshots and per-page/contact-sheet PNGs are retained alongside both PDFs.

The browser harness emits artifact paths and screenshots named `CT-report-panel.png`, `MR-report-panel.png`, `CT-key-images.png`, `MR-key-images.png`, `CT-visible-conflict.png`, `CT-narrow.png`, `MR-narrow.png`, `CT-reopened.png`, `MR-reopened.png`, `CT-print.png`, `MR-print.png`, and both `*-report.pdf` files. Handoff links point to the verified run's actual local artifacts, rather than committing synthetic captures as product assets.

## Performance observations

Read `docs/plans/completed/ohif-performance-phase-2.md` first. Its historical measurements were not reused as new evidence. A fresh unchanged OHIF image was built and measured before changing static delivery. One delivery change was made: explicit immutable caching only for the pinned build's verified hashed app/numeric JavaScript bundles, no-store for HTML/runtime configuration, and revalidation for other JavaScript/CSS/JSON. Protected clinical APIs and image responses remain no-store. Security headers, gzip, transfer cancellation, thumbnail mode, request concurrency and image quality remain unchanged.

Single Chromium observations from a complete modified-image run, simulated 10 Mbps / 40 ms, milliseconds. This measured build precedes the final in-flight addendum-text preservation guard; the final-image repeat below is not a full passing run:

| Case | Metric | Baseline image | Modified image |
| --- | --- | ---: | ---: |
| CT | DOMContentLoaded / main chunk complete | 3800 / 3209 | 3783 / 3214 |
| CT | First verified diagnostic pixels | 6647 | 6577 |
| CT | Series switch / scroll | 539 / 192 | 494 / 198 |
| MRI | DOMContentLoaded / main chunk complete | 3829 / 3238 | 3791 / 3226 |
| MRI | First verified diagnostic pixels | 6457 | 6462 |
| MRI | Series switch / scroll | 297 / 343 | 311 / 350 |

These are individual observations, not medians or statistically established improvements. Direct/gateway metadata in the measured loopback probes was approximately 11-17 ms; gateway CT/MRI metadata in the final attempt was 12/12 ms. The performance harness uses the existing authenticated cookie gateway and a synthetic runtime configuration. New per-tab real-case launches were measured separately by the final successful native harness: CT/MRI context resolution 80/41 ms in its non-secure HTTP run; complete visible-pixel checks 2678/6542 ms include UI/onboarding waits and are not comparable to the throttled harness. Opening/closing the report panel and typing produced **zero diagnostic-frame refetches** and preserved the rendering-engine identity. Scrolling and changing active viewport during capture were rejected without an attachment.

The corresponding complete unthrottled loopback WebKit run verified first diagnostic pixels at 2377/2191 ms for CT/MRI and switch/scroll at 561/284 and 414/272 ms. The initial complete baseline observed 2674/2210 ms and 504/289, 438/263 ms respectively. Repeat baseline navigation failures limit repeatability; no cross-browser speedup is claimed. Patient-wide QIDO's intentional 403 and deliberate canceled transfers are reported separately from successful exact-study image requests.

The exact handoff-image repeat completed Chromium CT bootstrap at 3808 ms (main chunk 3218 ms), verified diagnostic pixels at 6533 ms, and switched/scrolled at 581/176 ms. MRI bootstrap then failed on resource 504s and a 90-second first-render timeout; no final-repeat MRI or WebKit viewer timing is claimed. Direct/gateway metadata probes and lossless JPEG decoder verification had completed. This is an open performance/infrastructure gate, despite the separate full CT/MRI reporting acceptance journey passing on that same image.

Static-header checks on actual nginx containers confirmed hashed bundles use `public, max-age=31536000, immutable`; HTML, viewer SPA fallback and `app-config.js` use no-store. A nonexistent hashed chunk falls back to HTML with no-store, not immutable caching. Security headers remained present. A cold/warm browser fetch of the main bundle transferred approximately 3.71 MB / zero bytes for both images (baseline already benefited from browser heuristic caching); the explicit policy is not presented as a measured warm-load speedup. Updated HTML/configuration are re-fetched and reference the new build's hashed chunks.

No hospital LAN, remote deployment, real scanner/GPU or production data was measured. Clinical rollout still requires operational performance and capture-fidelity acceptance on the intended systems.

For each synthetic CT and MRI case: assign a reporting-authorized doctor; enable the setting; launch OHIF; confirm identity; create a native draft; type/paste Findings and Impression; wait for Saved; explicitly save; capture an annotated stack image; edit caption/order; reopen the image; capture supported MPR/MIP views; finalize with identity confirmation; reopen Open Report from RISpro; append/sign an addendum; print and check image order. Repeat with two patient tabs, conflicting editors, failed save/upload, prior display, stale mapping, revoked access, and feature disablement.

Rollout requires verified capture fidelity on the actual clinical CT/MRI and enhanced multiframe encodings, oblique MPR, thick-slab MIP, supported browser/GPU combinations, readability/page breaks, storage failover/backup restore, operational signer permissions and hospital performance. Comprehensive and self-hosted CI for an explicitly committed exact SHA remain deployment gates; this task leaves changes uncommitted.

For manual CT and MRI acceptance, follow the sequence above separately for each modality. Use synthetic cases first, verify the persistent primary-case header before creating/signing, and check that a prior illustration is labeled as prior without changing that header. Inspect the saved report through **Open Report** in RISpro, then disconnect the synthetic archive and verify its protected print images still load. Do not enable this feature for clinical use until the remaining local-deployment and clinical acceptance gates are approved.

## MRI bootstrap follow-up (2026-10-26)

This continuation preserves the intentional uncommitted implementation on `main`. Only the two synthetic browser harnesses and this handoff were edited. The OHIF image, application code, migration, reporting extension, authentication, image quality, request concurrency, caching policy and production nginx configuration were preserved.

### Reproduced failure and bounded fix

The first unchanged-image run completed all CT/MRI cases. The next instrumented run reproduced six asset HTTP 504s, `NetworkError: Load failed`, a blank viewer and the existing 90-second first-render timeout, this time in WebKit CT. The failing requests included `5491.bundle.4866d2ecb20dd089e071.js`, `3461.bundle.43b84be8f8920d3407c2.js` and `4819.css`. The edge error log identifies `upstream timed out ... while connecting to upstream` at `192.168.65.254:51248`, the Windows `host.docker.internal` address and published viewer port. Those requests were absent from the viewer nginx log. Other assets completed; direct/gateway MRI frames and metadata and both engines' exact lossless JPEG decoding had already passed.

The evidence locates this reproduced failure in the harness's edge-to-Windows-published-port-to-viewer connection, before diagnostic decoding or reporting initialization. The precise Docker Desktop TCP failure mechanism is not established. It is not evidence for changing MRI rendering, archive timeouts or reporting behavior. The earlier handoff MRI incident did not retain URLs/logs, so its identical root cause cannot be proved retrospectively.

Both harnesses now create a uniquely named temporary Docker network and use the production `/ohif/` upstream `http://ohif:80` through a viewer network alias. This matches `docker-compose.yml`, where gateway and OHIF share a network, and removes the unnecessary Windows published-port hop between them. Browser and archive ports remain loopback-only; the host-run RISpro test server still uses `host.docker.internal`. Cleanup removes only each run's containers/network and restores disposable-DB settings. No timeout increase, retry or rendering workaround was added.

The performance harness now retains failed resource paths/types, browser error details, pending requests, console warnings/errors, document/resource state, failure screenshots and both container log streams before cleanup. An unexpected failed asset also fails the run even if diagnostic pixels eventually appear. All retained paths/logs contain only generated synthetic fixtures; this harness still accepts no external archive or patient-data input.

### Repeatability and remaining limitation

Three full native-image stress runs passed after removing the connection hop, including a final run with all failure diagnostics enabled. Each verified CT and MRI diagnostic pixels in Chromium and WebKit, five series switches and five scrolls per case, no unexpected failed assets/frames, exact original frame bytes, and all 262,144 lossless JPEG pixels. Together with the two complete diagnostic baseline repeats, this totals 100 verified series switches and 100 scrolls. Deliberate canceled transfers and denied patient-wide QIDO remain separate from failures.

A subsequent baseline-image run encountered a **separate unresolved WebKit MRI startup stall**: blank viewer, no recorded request failure or browser error, no DICOMweb requests for that navigation, and a 90-second render timeout. Container logs had no 504 or upstream connection timeout. Pending-request/document-state diagnostics were added after this occurrence; two diagnostic baseline repeats then completed all cases and stress cycles. The failed baseline run remains FAIL and is not represented as resolved by successful repeats. No speculative OHIF or browser patch was made. These observations do not establish universal WebKit/Safari reliability.

The same existing image IDs were used throughout: native image `sha256:5d1cf77af3e9e5a82d04b55f8f1b4954c87632113975f6433ca2f2c48e92e67f`, baseline image `sha256:a07eb543adf05f54a0aa1b75ecd1d9de1f83126256304c0a362527dbd14ffbb0`. No image rebuild or production deployment occurred in this continuation.

Native-image MRI first verified pixels were 6412/6431/6464 ms at simulated 10 Mbps / 40 ms in the three corrected runs; WebKit loopback was 2051/2043/2261 ms. Two complete corrected baseline repeats observed 6530/6584 ms and 2298/2150 ms respectively. These small samples do not demonstrate a speed improvement or a reporting-induced regression. Both images' main Chromium bundle completed around 3.2 seconds and DOMContentLoaded around 3.8 seconds; gateway MRI metadata was approximately 12 ms. Bootstrap traffic remains the dominant measured cost, not archive metadata. The five-second simulated-link target remains unmet. Real hospital LAN/public HTTPS, actual Safari and clinical GPU/data performance remain unverified.

### Continuation validation and evidence

- PASS: agent contract; preflight (`DOCKER_OK`); disposable DB startup/check at `localhost:5433/rispro_test`. Sandbox Docker access denial was followed by the unchanged successful host-side commands.
- PASS: reporting-store tests, 5/5; focused OHIF adapter/runtime/session/authorization tests, 12/12. Sandbox `spawn EPERM` was followed by unchanged successful host-side tests.
- PASS: `npm run test:db:one -- src/modules/doctor-portal/reporting-board.integration.test.ts`, 107/107, and the same command for `src/modules/ohif-viewer/ohif-schema.integration.test.ts`, 3/3; zero skipped. The schema test's sandbox worker EPERM was followed by the unchanged successful host-side command. `db:test:required` again exited without assertions on Windows and is not counted as passing validation; the explicit focused commands supplied the actual proof. Its wrapper was left outside this task's scope.
- PASS: backend typecheck; frontend typecheck and production build on the preserved application tree. The build's sandbox Vite/Tailwind startup failure was followed by the unchanged successful host-side build; existing bundle/plugin timing warnings remain.
- PASS: full real CT/MRI native-reporting browser journey on the corrected network, including ordinary insecure HTTP, annotated stack/volume/prior/enhanced-MR capture, failed save/upload recovery, conflict, signing, addenda, reopening, two patient tabs, feature disablement, narrow layout and PACS-independent print. Reporting panel interactions caused zero diagnostic-frame reloads. The previously documented upstream insecure-HTTP service-worker console error remains unchanged.
- PASS: both harnesses' syntax checks, repository harness and whitespace validation. Comprehensive/self-hosted CI remain NOT RUN; changes are uncommitted and unpushed.

Synthetic evidence is retained under the local temporary directory. The connection-timeout reproduction is in `rispro-ohif-phase2-EBRhEO` (`bootstrap-failure.json`, `rispro-ohif-phase2-37468-edge.log`, viewer log and failure PNG). The separate silent baseline stall is in `rispro-ohif-phase2-1cPKpG`. Passing corrected native stress artifacts are in `rispro-ohif-phase2-AfXsQt`, `rispro-ohif-phase2-OxhIBU` and final run `rispro-ohif-phase2-QHygf0`; passing diagnostic baseline repeats are in `rispro-ohif-phase2-L19WUQ` and `rispro-ohif-phase2-i7G9yx`. The full reporting journey, screenshots and PDFs are in `rispro-native-reporting-aqGBCP`. All temporary run containers/networks were confirmed removed, and the pre-existing disposable PostgreSQL container remained running. These local artifacts are synthetic test evidence, not product assets or deployment approval.

Reproduce serially after disposable DB preflight/up/check, using PowerShell:

```powershell
$env:OHIF_TEST_IMAGE='rispro-ohif:native-v1' # use native-baseline for comparison
$env:OHIF_PHASE2_NETWORK='10mbps'
$env:OHIF_PHASE2_STRESS='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-performance-benchmark.mjs
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

## Changed files

```text
docker/ohif/Dockerfile
docker/ohif/app-config.js
docker/ohif/nginx.conf
docker/ohif/register-reporting.cjs
docker/ohif/rispro-reporting/package.json
docker/ohif/rispro-reporting/report-store.test.mjs
docker/ohif/rispro-reporting/src/ReportPanel.tsx
docker/ohif/rispro-reporting/src/capture.js
docker/ohif/rispro-reporting/src/index.tsx
docker/ohif/rispro-reporting/src/report-store.js
docker/ohif/rispro-reporting/src/reporting.css
docker/reverse-proxy/nginx.conf
docs/native-reporting-v1.md
frontend/src/App.tsx
frontend/src/pages/doctor/doctor-reporting-board-page.tsx
frontend/src/pages/doctor/native-report-page.test.tsx
frontend/src/pages/doctor/native-report-page.tsx
frontend/src/pages/doctor/personal-reporting-viewer-actions.tsx
frontend/src/pages/settings/ohif-viewer-section.tsx
frontend/src/types/api.ts
scripts/ohif-native-reporting-browser.mjs
scripts/ohif-performance-benchmark.mjs
src/app.ts
src/db/migrations/235_native_reporting.sql
src/modules/doctor-portal/reporting-board-repository.ts
src/modules/doctor-portal/reporting-board-service.ts
src/modules/doctor-portal/reporting-board.integration.test.ts
src/modules/ohif-viewer/ohif-runtime-config.test.ts
src/modules/ohif-viewer/ohif-schema.integration.test.ts
src/modules/ohif-viewer/repository.ts
src/modules/ohif-viewer/routes.ts
src/modules/ohif-viewer/service.ts
src/modules/ohif-viewer/types.ts
src/modules/reporting/report-image-storage-service.ts
src/modules/reporting/reporting-routes.ts
src/modules/reporting/reporting-service.ts
src/modules/reporting/reporting-validation.test.ts
src/modules/reporting/reporting-validation.ts
src/services/generated-print-html-service.test.ts
src/services/generated-print-html-service.ts
src/services/reporting-board-sonicdicom-cache-service.ts
```
