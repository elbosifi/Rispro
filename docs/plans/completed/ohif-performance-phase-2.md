# Execution Plan: OHIF performance phase 2

## Problem

The viewer can list series promptly while diagnostic images take substantially longer to appear. This phase measures delivery and scheduling using synthetic ordinary CT and conventional single-echo MRI. Actual rendered pixels, rather than OHIF's first-image timer, determine success.

## Scope

Inspect the pinned OHIF 3.12.6 build, authenticated streaming gateway, reverse proxy, thumbnail requests, concurrency, cancellation, and metadata retrieval. Implement at most two independently measured, low-risk improvements. Retain all diagnostic pixels and study/session restrictions.

## Starting state

- Branch: `main`; HEAD: `747f1485012e2fcb74d3ba5c7c84dafb8f3def05`.
- Working tree clean; fetched origin; ahead/behind `0/0`.
- Agent contract passed; preflight reported `DOCKER_OK`.
- `CURRENT_TASK.md` describes a completed unrelated mobile-widget task; it is preserved.
- Recent commits added upstream compression-header handling, eight-hour viewer-session expiry after launch exchange, edge gzip, and concurrency 4/1/1.

## Architecture and initial hypotheses

Browser → HTTPS nginx → authenticated RISpro Express gateway → Authoritative Orthanc DICOMweb → streaming response → existing OHIF/Cornerstone decoder and renderer.

The gateway validates both the login cookie and a user-bound, exact-study viewer session on every request. It uses native Fetch, which decodes HTTP compression; it correctly omits the resulting stale encoded Content-Length. nginx applies gzip to private/no-store DICOMweb responses without proxy buffering. OHIF already requests `transfer-syntax=*`. Thumbnails currently retrieve diagnostic frames. The OHIF build uses QUICK_BUILD and its origin nginx does not configure static-asset compression. Client disconnects currently do not abort the upstream Fetch. These are hypotheses to measure, not reasons to patch automatically.

## Explicit non-goals

No dual-echo investigation or testing, dynamic-volume changes, echo grouping, rendering logic, DICOM metadata changes, dependency/version upgrades, preview/full-quality modes, lossy diagnostic compression, production access/configuration, persistent patient caches, unrelated fixes, commit, push, or deployment.

## Measurement and validation

- Use temporary loopback-only Orthanc and OHIF containers, with synthetic fixtures and no production volumes or configuration.
- Observe actual viewport pixels in Chromium and Playwright WebKit; distinguish WebKit compatibility from a real Safari test.
- Measure navigation/render, metadata, frame TTFB/download/bytes, unloaded scrolling, series switching, bounded concurrency, and failed requests. Compare local direct Orthanc with the authenticated gateway. Real LAN/public HTTPS measurements remain unavailable without explicitly authorized test data/access.
- Evaluate the pinned rendered-thumbnail endpoint and fallback before changing thumbnail mode.
- Measure gzip for uncompressed and losslessly compressed synthetic DICOM; compare byte-identical diagnostic frames.
- Run focused unit/DB regression tests, `npm run typecheck`, agent contract, and documentation checks. Any frontend application edit also requires frontend typecheck and build on the final tree.
- Stop at an unrelated validation failure and report it without changing unrelated code.

## Rollback

Changes remain local and uncommitted. Revert only the eventual phase-2 file changes after review. No database migration or production setting change is planned. Remove only explicitly named temporary benchmark containers; leave production resources untouched.

## Execution notes

**Status: local phase complete; two improvements implemented and validated with synthetic data.** Work initially stopped under AGENTS.md rule 6. On 2026-10-10 the user authorized continuing focused OHIF validation despite the existing unrelated CI failures. The strengthened final baseline and optimized runs passed in Chromium and WebKit. Real LAN/public HTTPS and actual Safari validation remain unavailable; this is not deployment approval.

## Findings and implemented changes

1. **Compress viewer assets at the OHIF origin.** The unchanged main JavaScript bundle is 15,427,671 bytes. nginx gzip level 1 delivered approximately 3,709,919 bytes, a 76% reduction. Identity and gzip responses decoded to identical bytes in Chromium and WebKit. This affects startup assets only; it introduces no image-quality change or patient cache.
2. **Cancel disconnected gateway transfers.** The proxy now forwards a disconnect AbortSignal through the authorized service to all existing source adapters, combined with the configured upstream timeout. A completed response does not trigger cancellation. No authorization check or source-selection behavior was removed. In the controlled slow-frame test through real authenticated RISpro and nginx, the original transfer remained open after 250 ms and produced 753,664 bytes; the changed path closed within 250 ms and produced 16,384–49,152 bytes across runs. These are producer bytes, not measured wire bytes.

The largest demonstrated bottleneck on the simulated slow connection was viewer bootstrap traffic. Local metadata and frame TTFB were small. The existing lossless frame gzip remained useful for the synthetic uncompressed images. Native Fetch decompression followed by gateway gzip is correct but can recompress a response from archives that already use HTTP compression; the isolated Orthanc frame response did not use upstream HTTP gzip. There is no measured justification for rewriting the streaming transport.

## Test conditions and measurements

Fixtures were generated locally: ordinary CT at 512×512 and conventional single-echo MRI at 256×256, 16-bit pixels, two series of twelve slices per study. A distinct lossless JPEG CT fixture tested original compressed-pixel preservation. No production records, databases, archive configuration, or excluded MRI data were accessed. Source synthetic DICOM files were hash-checked to remain unchanged.

The isolated dated Orthanc image `orthancteam/orthanc:26.4.0` reported Orthanc 1.12.11 / DICOMweb plugin 1.23. OHIF remained 3.12.6; nginx was 1.27.5; Node was 22.22.2. The application and published container ports used loopback only. The gateway used the real router, authentication middleware, session repository, adapters, and guarded disposable `rispro_test` database. Temporary source settings were restored and fixture rows/containers removed on exit.

Fresh Playwright contexts used Chromium and WebKit at 1440×1000. Chromium CDP simulated **10 Mbps download/upload and 40 ms latency**; WebKit measurements were unthrottled loopback. The final procedure acknowledges the onboarding tour and confirmation banner before inspecting pixels, including that interaction time in the navigation measurement. Diagnostic viewport events identify the requested series and changed scroll image; screenshots verify nonblank pixels. No viewer rendering code was changed. Verification times are conservative upper bounds including screenshot sampling, not OHIF's `studyToFirstImage` timer.

| Metric | Baseline | Optimized | Conditions / result |
| --- | --- | --- | --- |
| Main JavaScript wire bytes | 15,427,671 | ~3,709,919 | Observed nginx; decoded bytes identical |
| Main JavaScript download | 12.473 s | 3.062 s | Simulated 10 Mbps / 40 ms; asset-only comparison |
| First verified CT image | 20.399 s | 5.723 s | Simulated Chromium; final paired run |
| First verified MRI image | 20.200 s | 5.696 s | Simulated Chromium; final paired run |
| CT unloaded-series image | 529 ms | 533 ms | Simulated Chromium; 12 frames previously unloaded |
| MRI unloaded-series image | 238 ms | 292 ms | Simulated Chromium; 12 frames previously unloaded |
| CT scroll to valid pixels | 263 ms | 241 ms | Simulated Chromium; first scroll |
| MRI scroll to valid pixels | 249 ms | 276 ms | Simulated Chromium; first scroll |
| First verified CT image | 946 ms | 868 ms | Observed WebKit loopback |
| First verified MRI image | 875 ms | 774 ms | Observed WebKit loopback |

First-image improvement is about 72% on this simulated link. The five-second target was **not met**. These are individual observations, not medians or production guarantees. Both final runs completed five series switches and five scrolls per CT/MRI case in each engine: 40 switches and 40 scrolls in total, with requested image identities and visible pixels verified, and zero unexpected failed frames. Earlier exploratory loopback tests also verified ordinary CT/MRI pixels, switching and scrolling for interaction limits 2, 4 and 6 in both engines.

| Retrieval | Direct isolated Orthanc | Authenticated gateway + nginx | Conditions |
| --- | --- | --- | --- |
| CT frame TTFB / complete response | 3 / 5 ms | 6 / 14 ms | Observed loopback example |
| MRI frame TTFB / complete response | 1 / 1 ms | 4 / 5 ms | Observed loopback example |
| CT series metadata | 9 ms / 34,493 bytes | 5 ms / 34,493 bytes | Observed loopback; cache warmup affects comparison |
| MRI series metadata | 5 ms / 40,445 bytes | 4 ms / 40,445 bytes | Observed loopback |
| Browser QIDO TTFB / download | — | roughly 5–10 / 0–1 ms | Observed loopback matrix |
| CT frame HTTP body | 524,708–524,709 bytes | ~165–167 KB encoded | ~68% gzip saving, fixture-specific |
| MRI frame HTTP body | 131,492–131,493 bytes | ~41–42 KB encoded | ~68% gzip saving, fixture-specific |
| Stored lossless JPEG frame | 157,324 encoded pixel bytes | ~140 KB gzip multipart | ~11% additional HTTP gzip saving |

With default `transfer-syntax=*`, Orthanc returned the stored lossless JPEG syntax and identical compressed pixel bytes. The existing OHIF worker decoded all 262,144 pixels exactly in both engines; startup plus decode was approximately 87–180 ms in one observed run. Original uncompressed frame payloads also matched their reference bytes. No transfer-syntax override was added. JPEG2000/JPEG-LS and clinical compressibility were not measured.

The real LAN archive, real LAN gateway, public HTTPS domain, and actual Safari application were **unavailable / unauthorized for this goal**. Loopback and WebKit results do not establish those targets. An upstream CDN might already compress assets on the public route; that route's additional benefit is unmeasured.

## Thumbnail, scheduling, and metadata decisions

**Retain `thumbnailRendering: 'wadors'`.** Orthanc returned authenticated plain `image/jpeg` for the instance `/rendered` endpoint when explicitly requested: CT 46,507 bytes / ~3 ms direct; MRI 13,113 bytes / ~3 ms direct. However, the pinned OHIF rendered-thumbnail branch drops `mediaTypes` through `bulkDataURI`. Both engines actually sent `Accept: multipart/related; type="application/octet-stream"` and received HTTP 400 / text/plain. There is no automatic WADO-RS fallback in that branch, and its direct DICOMweb requests bypass the configured thumbnail image-load queue. A simple toggle is not supported safely. This evaluation did not substitute thumbnail pixels for diagnostic pixels.

**Retain concurrency 4/1/1.** In the completed loopback matrix, first verified CT/MRI times were:

| Interaction / thumbnail / prefetch | Chromium CT / MRI | WebKit CT / MRI |
| --- | --- | --- |
| 2 / 1 / 1 | 1,005 / 923 ms | 771 / 697 ms |
| 4 / 1 / 1 | 951 / 901 ms | 926 / 713 ms |
| 6 / 1 / 1 | 949 / 915 ms | 746 / 688 ms |

The actual browser configuration values were recorded. Initial frame concurrency peaked at only 1–2, so this workload did not saturate interaction limits. There is no reliable evidence that increasing them improves first-image performance or prevents contention. Background limits and the existing radiologist/scroll/thumbnail/prefetch scheduling remain unchanged. Browser series switching produced deliberate network aborts (for example 3 CT and 12 MRI requests in the final simulated Chromium run), recorded separately from unexpected frame failures. The new gateway cancellation stops their upstream work; no custom client scheduler or loader was added. Browser memory usage was not profiled.

**No new metadata cache.** Each fresh navigation retrieved the two series metadata sets; local metadata latency was small. The isolated archive had `EnableMetadataCache: true` and Full metadata modes. The production cache's version, settings, warmup and effectiveness remain unknown. For an authorized operational review, verify the installed plugin supports metadata caching, keep Full metadata, and review whether older studies need Housekeeper cache warmup. This is an operator recommendation only; see the [Orthanc metadata-cache documentation](https://orthanc.uclouvain.be/book/plugins/dicomweb.html#fine-tuning-server-for-wado-rs-retrieve-metadata). No persistent patient-image cache, shared gateway cache, metadata filtering or metadata alteration was introduced.

## Validation results and remaining failures

Passed locally, with unit/DB/browser/typecheck/harness execution outside the sandbox:

- `npm run agent:contract`; `npm run agent:preflight` (`DOCKER_OK`); `npm run db:test:up`; `npm run db:test:check`.
- `RISPRO_E2E=1 node --env-file=codex-db-test.env --import tsx --test src/modules/ohif-viewer/adapters.test.ts src/modules/ohif-viewer/proxy-authorization.test.ts src/modules/ohif-viewer/viewer-session.test.ts src/modules/ohif-viewer/ohif-runtime-config.test.ts`: **11/11**, rerun after the final benchmark edit.
- `npm run db:test:required -- src/modules/doctor-portal/reporting-board.integration.test.ts`: **93/93**, migrations and guarded DB checks passed. Covers wrong user, missing cookies, unauthorized studies and unrestricted search, expiration, reopening, compressed upstream metadata, frame bytes, and disconnect cancellation through the real HTTP route.
- `npm run typecheck` on the final backend tree; `npm run harness:all` (existing report-only warnings; no hard failures).
- Isolated nginx syntax validation; identity/gzip multipart and raw-byte integrity, private/no-store headers, 206 byte ranges, preserved 401, byte-exact worker decoding in both engines.
- Static-asset gzip/identity byte comparison and browser decoding; full 2/4/6 loopback matrix completed with valid CT/MRI pixels and switching/scrolling. Rendered-thumbnail evaluations intentionally recorded their HTTP 400 incompatibility.
- The final paired baseline/optimized runs completed all five-switch/five-scroll CT/MRI cases in both engines with valid requested diagnostic pixels and zero **unexpected** failed frame requests. Deliberate cancellations were recorded separately. The optional patient-wide QIDO request remained denied with 403.

**Earlier failed checks:** an uninstrumented WebKit MRI series-switch pixel check failed after 30 seconds. Its exact cause cannot be proven retrospectively. Resumed failure diagnostics reproduced a CT pixel-check failure whose saved screenshot showed valid diagnostic pixels beneath a dimming onboarding overlay, rather than a blank image. The benchmark had inspected pixels before reliably acknowledging onboarding. It now waits for and acknowledges the existing prompts, retains the same pixel thresholds, saves failure screenshots, and verifies requested series/image identities using observable viewport events. The strengthened final paired runs passed. An earlier exploratory interaction-6 startup also timed out; subsequent matrix cases completed. These historical incidents do not establish actual Safari or universal clinical compatibility. The event observers use the documented [render event](https://v3.cornerstonejs.org/docs/api/core/namespaces/Types/namespaces/EventTypes/interfaces/ImageRenderedEventDetail/) and [new stack image event](https://www.cornerstonejs.org/docs/api/core/namespaces/types/namespaces/eventtypes/interfaces/stacknewimageeventdetail/); they do not alter rendering.

**Existing unrelated CI failures:** read-only inspection of starting SHA `747f1485012e2fcb74d3ba5c7c84dafb8f3def05` returned `CI_INSPECT_NOT_READY`:

- [CI run 38082358882](https://github.com/elbosifi/Rispro/actions/runs/38082358882): browser E2E teaching-anatomy card click times out because the atlas link overlay intercepts pointer events; backend scheduling fails `booking-flow.test.ts:436` with PostgreSQL `23514`, `users_username_canonical_check`.
- [Self-hosted CI run 38082358910](https://github.com/elbosifi/Rispro/actions/runs/38082358910): the same booking-flow username constraint failure.

These failures predate this uncommitted patch. No workflow was rerun and no unrelated code or test assertion was changed. The user authorized focused OHIF validation to continue after the rule-6 stop. CI for the phase-2 patch is not available until a future authorized commit/push; existing failures still prevent deployment gating. Frontend application code was not changed; frontend build/typecheck were not run or claimed as passing in this phase.

The new code adds no logs or telemetry. Benchmark output contains synthetic-only modality, category, counts, timing and size fields, with multipart boundaries redacted and no patient names, PatientIDs, accessions, cookies or archive credentials. No clinical screenshots or HAR data were collected.

## Reproduce and finish validation

The [synthetic benchmark](../../../scripts/ohif-performance-benchmark.mjs) accepts no archive URL or patient-data input. Run it serially with other DB tests, on Docker Desktop with `host.docker.internal` support. It checks the test DB address/user, prevents `.env` overrides, uses temporary loopback-only containers, restores test settings and removes fixture rows on exit. It leaves only synthetic screenshot/config artifacts in its printed temporary directory. Abrupt process termination may require resetting the disposable DB and removing only the benchmark's named temporary containers.

Use the existing dependencies and compatible Playwright binaries; do not upgrade OHIF, Cornerstone or Playwright. Prepare the guarded DB with preflight/up/check and migrations. Required local images are `rispro-ohif:v3.12.6`, `nginx:1.27.5-alpine`, and `orthancteam/orthanc:26.4.0`. Build/pull those locally if missing, using the existing OHIF Dockerfile. No production Compose file or archive volume is used by this benchmark.

```sh
npm run agent:contract
npm run agent:preflight
npm run db:test:up
npm run db:test:check
npm run db:test:required -- src/modules/doctor-portal/reporting-board.integration.test.ts
OHIF_PHASE2_VARIANT=baseline OHIF_PHASE2_STRESS=1 OHIF_PHASE2_NETWORK=10mbps node --env-file=codex-db-test.env --import tsx scripts/ohif-performance-benchmark.mjs
OHIF_PHASE2_STRESS=1 OHIF_PHASE2_NETWORK=10mbps node --env-file=codex-db-test.env --import tsx scripts/ohif-performance-benchmark.mjs
OHIF_PHASE2_MATRIX=1 node --env-file=codex-db-test.env --import tsx scripts/ohif-performance-benchmark.mjs
```

The baseline flag explicitly disables static gzip in a temporary origin configuration; it does not revert gateway cancellation. The separate pre-patch cancellation measurement is reported above. The stress flag adds five alternating series switches and scrolls per case; ordinary mode performs one. All fixtures remain conventional CT/single-echo MRI. Keep the excluded issue untouched.

For a future authorized test on the real LAN/public route, use a designated synthetic or explicitly approved ordinary CT/single-echo MRI study. Repeat cold-context trials in actual Safari and Chromium. Record navigation time when diagnostic pixels are visibly displayed, QIDO/metadata timings, frame TTFB/download, encoded/decoded sizes, response MIME/encoding, unexpected failures and deliberate aborts. Compare exact same frames directly from Orthanc, through RISpro LAN, and through public HTTPS. Test unloaded-series switching, scrolling and expiration/reopening. Export only aggregate categories and timings; do not export clinical URLs, headers, metadata or screenshots. Recheck the under-three-second LAN / under-five-second HTTPS targets rather than treating this simulated result as proof.

## Files changed, operations and rollback

- [OHIF origin nginx](../../../docker/ohif/nginx.conf): six static gzip directives.
- [Proxy route](../../../src/modules/ohif-viewer/routes.ts), [service](../../../src/modules/ohif-viewer/service.ts), [adapters](../../../src/modules/ohif-viewer/adapters.ts): disconnect cancellation with retained timeout and authorization.
- [Adapter regressions](../../../src/modules/ohif-viewer/adapters.test.ts), [HTTP/DB regressions](../../../src/modules/doctor-portal/reporting-board.integration.test.ts).
- [Benchmark](../../../scripts/ohif-performance-benchmark.mjs), this assessment, and the [domain documentation](../../domains/ohif-viewer/README.md).

After target-environment validation and required exact-commit CI are green, an explicitly authorized deployment would rebuild the app and OHIF images using the supported update workflow. The origin nginx configuration is packaged in the OHIF image. No production Orthanc setting, database migration, reverse-proxy configuration, viewer config, rendering code, dependency, or image-quality change is required by this patch. No commit, push or deployment was performed.

Rollback the six gzip directives and the AbortSignal propagation in the three backend files, after reviewing that only this phase's changes are being reverted. Rebuild the previous app/OHIF image versions through the approved workflow if the patch has later been deployed. Remove the corresponding regression/benchmark/documentation additions only when reverting the whole phase. No schema reversal or archive deletion is required. Do not use a broad working-tree reset.

## Remaining opportunities, ranked

| Priority | Opportunity | Expected benefit | Risk / prerequisite |
| --- | --- | --- | --- |
| 1 | Authorized real LAN/public HTTPS and actual Safari validation; repair unrelated CI separately | Establish real targets and release confidence | Requires approved test data/access; no production changes in this phase |
| 2 | Measure a standard minified pinned OHIF build instead of QUICK_BUILD | Further reduce remaining bootstrap traffic/parse time | Low-to-medium; separate build/resource/browser benchmark, no upgrade |
| 3 | Authorized archive/LAN/public comparison and Full metadata-cache effectiveness review | Potentially high on a slow uplink or cold storage | Operational authorization; current synthetic metadata is already fast |
| 4 | Correct rendered-thumbnail MIME handling, bounded scheduling and unsupported-endpoint fallback | Smaller thumbnail transfers | Medium; simple config toggle currently fails in both engines |
| 5 | Tune interaction concurrency with larger workloads that actually saturate the queue | Unproven here | Medium contention/memory risk; retain 4/1/1 until measured |

The local phase is complete with two measured improvements, passing focused validation and reproducible synthetic/target-environment instructions. Production targets, actual Safari compatibility and future exact-commit CI remain unverified. Temporary benchmark containers and rows were cleaned up; the pre-existing disposable PostgreSQL container was preserved.
