# Native Orthanc delivery: local results

2026-10-27. Local implementation and synthetic acceptance completed. **Native delivery remains disabled by default. Production/LAN acceptance is unrun.** No production archive, configuration or patient data was accessed or changed.

## Result

The native path streams study metadata, JPEG thumbnails and original diagnostic frames from nginx to Orthanc. Express handles the existing login/case/study authorization callback and exact-study discovery, but receives **zero native frame requests**. The original Express transport remains available.

Across nine samples per configuration, native ResPro reduced median first visible image time by **18% versus the existing proxy** and **15% versus stock Orthanc OHIF**. All thumbnails appeared **34% sooner than the proxy** and **22% sooner than stock**. These are Docker loopback results, not hospital LAN measurements.

Retained changes:

- Native concurrency **4 interaction / 4 thumbnail / 1 prefetch**; proxy rollback retains 4/1/1.
- Production minification (`QUICK_BUILD=false`).
- A guarded correction to OHIF v3.12.6's rendered-thumbnail client call, using native Orthanc JPEG and the existing thumbnail request pool.
- HTTP gzip **off on native image responses**; existing compressed startup assets and proxy behavior retained.
- Existing authentication, case permissions, per-tab study allowlists and reporting integration retained; one-second plugin decision caching bounds revocation.

## Environment and method

- Starting checkout: clean `main`, `5881fe61f02e33835f05ccae8d3419e69882df66`, fetched and level with `origin/main`. Changes are left uncommitted.
- Temporary Docker network and loopback-published containers; disposable PostgreSQL 16 test database only. Real RISpro application middleware/routes run in a separate Node 22 container for CPU/query measurement. No authentication mocks or grant-all browser tokens.
- `orthancteam/orthanc:26.4.0`: Orthanc 1.12.11, official OHIF 1.8, Authorization 0.11.2, DICOMweb 1.23 and GDCM 1.8 plugins. Stock OHIF is used as shipped by that plugin; ResPro uses pinned OHIF v3.12.6. This compares the delivered products, including their bundles and scheduling, rather than attributing every difference to transport alone.
- A: stock OHIF directly on that Orthanc, authenticated with the archive service credential. B: existing ResPro image (`rispro-ohif:ios-reliability`), Express proxy, 4/1/1. C: final minified native image (`rispro-ohif:lan-native-final`), 4/4/1. The same archive/data and real Authorization plugin serve all three; A's few database calls are service-credential callbacks, not image proxying.
- Three equivalent synthetic cases across configurations: CT with 12 series, MR with 13 series including enhanced multiframe MR, and a **656-slice, 512x512 CT** with 12 series. Ordinary CT/MR primary stacks are 256x256/192x192; added CT/MR series are 512x512/256x256. Multiple stored series VOIs and authorized priors are included.
- Three repetitions per case/configuration; variant order rotates each repetition. Eleven configurations produce **99 successful launches**. No concurrent builds or test suites ran during the measured matrix.
- First-image timing requires a rendered Cornerstone viewport, complete original-resolution decoded pixels, the correct study/series UID and visible canvas contrast. Thumbnail timing requires every expected thumbnail's actual image pixels (`naturalWidth > 0`). Network completion alone never establishes readiness. Tour/disclaimer dismissal is applied equally.
- Startup below means navigation to DOMContentLoaded; first image means navigation to rendered pixels. Launch preparation/exchange occurs before timing. The cold journey includes opening the study, selecting an unloaded series, completing thumbnails and revisiting the first series. Reopen reloads the same study in the same browser context with its normal asset cache.
- CDP records transferred bytes, frame headers/data, cancellations and socket queueing. Cornerstone intentionally cancels some multipart tails after decoding; these transfers are counted. Download time ends at the last received data rather than later cancellation processing. Concurrency and queued work are sampled from the actual Cornerstone image-load pool.
- CPU is process/container CPU time during the cold journey, not utilization percentage. Query counts/elapsed time instrument `pool.query` on the image/authentication read paths; launch transactions are outside the window. Pool wait counts/time and sampled waiting clients are recorded separately. Summed query/metadata durations can overlap and are not wall-clock startup time.
- Final A/B/C runs have no Playwright routing. Concurrency experiments override only app-config; their interception can affect browser caching, so their reopen values are excluded from the cached-reopen comparison.

## Side-by-side results

Medians of nine samples per column. Times are milliseconds; MiB = 1,048,576 bytes.

| Metric | A: stock Orthanc OHIF | B: existing ResPro proxy | C: optimized native ResPro |
| --- | ---: | ---: | ---: |
| Startup / DOMContentLoaded | 826 | 725 | **519** |
| First visible diagnostic image | 1,439 | 1,503 | **1,229** |
| All study-browser thumbnails visible | 1,901 | 2,226 | **1,478** |
| First image after unloaded-series selection | 239 | 223 | **191** |
| Returning to previously viewed series | 89 | 109 | 101 |
| Reopening study, assets cached | 793 | 688 | **584** |
| Metadata requests, CT / MR / large CT | 12 / 13 / 12 | 12 / 13 / 12 | 12 / 13 / 12 |
| Per-metadata-request latency | 8.6 | 39.0 | 18.4 |
| Sum of metadata request latencies | 117 | 579 | 234 |
| Frame TTFB | 4.6 | 23.3 | **3.8** |
| Frame download | 6.2 | 2.8 | **0.5** |
| Browser frame queue, median / maximum | 1.0 / 73.1 | 0.1 / 0.7 | 0.1 / 0.7 |
| Network requests, cold journey | 110 | 112 | 105 |
| Transferred, cold journey (MiB) | 31.6 | 8.3 | 6.3 |
| Transferred to first image on reopen (MiB) | 23.0 | 0.2 | 0.8 |
| Peak simultaneous image requests, median | 24 | 3 | 6 |
| Backend CPU | 37 | 609 | **77** |
| Orthanc container CPU | 321 | 164 | 210 |
| PostgreSQL query calls | 3 | 642 | **101** |
| Summed query time | 1.8 | 916 | 120 |
| Pool waits / wait time / maximum waiting clients | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Image frame requests entering Express | 0 | 33 | **0** |
| Browser script CPU through first pixels | 871 | 968 | **789** |

Request/transfer totals describe the measured journey, not downloading the complete examination. Background progress differs between viewers. A's stock static delivery transfers substantially more startup assets in this configuration. Native metadata latency still exceeds A's; scoped authorization and Express discovery remain in the path. No pool saturation was observed.

### Per-study medians

Three samples per row; avoids hiding the large CT behind a pooled median.

| Case | Viewer | First pixels | All thumbnails | Unloaded-series pixels | Revisit | Reopen | Cold MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CT | Stock | 1,435 | 1,901 | 239 | 83 | 776 | 31.6 |
| CT | Proxy | 1,491 | 2,226 | 223 | 97 | 687 | 8.3 |
| CT | Native | **1,179** | **1,460** | **167** | 99 | **555** | **6.3** |
| MR | Stock | 1,427 | 1,837 | **126** | **81** | 770 | 26.3 |
| MR | Proxy | 1,451 | 2,162 | 141 | 107 | 646 | 6.8 |
| MR | Native | **1,207** | **1,478** | 149 | 97 | **584** | **5.3** |
| Large CT | Stock | 1,526 | 2,083 | 746 | 273 | 902 | 124.6 |
| Large CT | Proxy | 1,566 | 2,397 | 338 | 164 | 764 | **10.6** |
| Large CT | Native | **1,250** | **1,483** | **246** | **148** | **664** | 17.3 |

Large-CT native transfers more bytes than B because B gzips uncompressed pixels. Native nevertheless renders and switches faster locally, with much less Express CPU. LAN bandwidth may change that tradeoff. MR selection/revisit is about 16-23 ms slower than A here; no substantial native first-image or thumbnail regression against stock was observed. Increasing background work did not improve the selected-series result reliably.

## Concurrency experiment

Nine samples per row, same production image, independent interaction and prefetch changes. Active selected-series first frames had not been requested before selection. Native thumbnails never request diagnostic frames.

| Interaction / thumbnail / prefetch | First pixels | All thumbnails | Selected series, median / maximum | Cold MiB | Maximum browser frame queue |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4 / 1 / 1 | 1,203 | 1,585 | 148 / 272 | 7.3 | 0.2 |
| **4 / 4 / 1** | 1,218 | 1,514 | 162 / 263 | 6.3 | 0.2 |
| 4 / 8 / 1 | 1,199 | 1,436 | 153 / 293 | 6.2 | 66.3 |
| 8 / 4 / 1 | 1,240 | 1,504 | 164 / 267 | 6.3 | 0.4 |
| 12 / 4 / 1 | 1,251 | 1,506 | 155 / 253 | 6.3 | 0.4 |
| 4 / 4 / 2 | 1,216 | 1,523 | 222 / 272 | 7.9 | 0.3 |
| 4 / 4 / 4 | 1,262 | 1,479 | 223 / 321 | 7.9 | 0.3 |

Four thumbnails reduce serialization; eight save another 78 ms in the median but introduce a 66 ms browser socket queue and a worse slowest selected-series result. Four is the bounded choice pending LAN measurements. Interaction peaks at one in this stack workload, so higher limits have no demonstrated benefit. Prefetch 2/4 increases bytes and worsens median selection by about 60 ms; retain one. MPR functionality is validated separately, but this is not a multi-viewport MPR throughput benchmark. Stock's 100/75/25 defaults were not restored.

## Production build and thumbnails

Matched native 4/1/1 comparisons, nine samples each:

| Metric | QUICK_BUILD | Production minification |
| --- | ---: | ---: |
| Main app JS, bytes on disk | 15,431,557 | 6,886,187 |
| All top-level JS, bytes on disk | 34,703,134 | 14,450,481 |
| Startup asset wire bytes | 5,905,916 | 3,433,569 |
| DOMContentLoaded, ms | 733 | 517 |
| First pixels, ms | 1,469 | 1,203 |
| Browser script CPU, ms | 923 | 772 |

Main JS shrinks 55%; startup asset transfer shrinks 42%; first pixels improve 18%. The quick comparator uses the same JPEG API and image-load pool; its earlier error handler differs only on retrieval failure. The final production handler also rejects failures occurring while constructing the thumbnail Blob.

Separate cold traces, outside the timing matrix, measured V8 parse / parse+compile CPU intervals: stock **748 / 849 ms**, proxy **854 / 970 ms**, native quick **904 / 1,052 ms**, native minified **557 / 657 ms**. These are single diagnostic traces, not statistical medians. Nested intervals are merged per thread using V8 thread CPU clocks; HTML/CSS parsing and network-wait wrappers are excluded. About 11-16% of relevant events lack CPU clocks and are omitted, so these are observed intervals, not complete profiler accounting. Raw traces remain in the harness artifact directory.

The HTTP 400 cause is the pinned rendered-thumbnail branch calling `bulkDataURI` with a media-type shape that does not produce the rendered endpoint's JPEG Accept header. The small build-time correction calls the existing client's `retrieveInstanceRendered`, supplies `image/jpeg`, unwraps its singlepart response array and uses the existing **imageLoadPoolManager** thumbnail queue. A different retrieval pool would not obey OHIF's configured limits and was excluded from the final experiment. Orthanc performs the only thumbnail rendering. No second generator/cache was added. Diagnostic WADO-RS retrieval and `transfer-syntax=*` remain unchanged.

The real Dockerfile production build passed its compiled ONNX async-chunk/worker guard and Chromium/WebKit acceptance. No renderer/decoder version was changed.

## Additional HTTP gzip

Ten alternating identity/gzip pairs per syntax through otherwise equivalent native test locations. Gzip level 1, no pixel codec conversion. Bytes below include the multipart envelope; time is complete frame TTFB + download, milliseconds.

| Stored syntax | Identity bytes | Gzip bytes, median | Identity time | Gzip time |
| --- | ---: | ---: | ---: | ---: |
| RLE lossless | 133,797 | 114,731 | **4.1** | 7.4 |
| JPEG lossless (.70) | 129,577 | 111,322 | **3.2** | 6.7 |
| JPEG-LS lossless (.80) | 95,515 | 95,689 | **3.1** | 5.5 |
| JPEG2000 lossless (.90) | 102,628 | 102,790 | **3.2** | 5.8 |
| Explicit VR little endian | 524,800 | 150,045 | **5.5** | 12.1 |

Gzip loses on complete-frame time in every local case, and slightly expands JPEG-LS/JPEG2000. The native route explicitly disables it. Stored compressed frame bytes were compared exactly after removing only the HTTP envelope/compression; originals were never decompressed/recompressed for delivery. Synthetic codec generation is isolated test setup. Recheck the bandwidth/CPU tradeoff on the hospital LAN before activation.

## Authorization and diagnostic acceptance

| Check | Local result |
| --- | --- |
| Real plugin, logged-in study metadata | PASS: 200 |
| Existing but unpermitted study; wrong user/context; missing login | PASS: denied |
| Expired login, expired viewer session, revoked session | PASS: denied; revocation tested after the one-second plugin cache bound |
| Two simultaneous viewer contexts | PASS: separate study allowlists; revoking one leaves the permitted other context working |
| Browser writes / unrestricted study discovery | PASS: 405 / 404 |
| Native frames bypass Express | PASS: zero frame requests in every native measured run |
| Native flag off and proxy fallback | PASS: runtime/default gate tests; explicit authenticated archive callback/profile retained when flag is off; original proxy comparisons and three final-minified proxy rollback journeys pass |
| Full original-resolution frames | PASS: decoded dimensions/count, exact 512x512 lossless CT pixels and exact 192x192 JPEG2000 MR pixels |
| Stored WW/WC / linear DICOM VOI | PASS: switching/revisits restore stored series VOI; compressed MR retains -200..1599 range |
| Ordinary CT/MR scrolling and switching | PASS in desktop, phone and tablet browser layouts |
| RLE, JPEG lossless, JPEG-LS, JPEG2000 lossless | PASS: actual diagnostic rendering and byte-identical stored frame payloads; original DICOM file hashes unchanged |
| Enhanced MR multiframe | PASS: frame 3 renders through the native path |
| MPR, coronal/sagittal/oblique, MIP | PASS: actual rendered/captured diagnostic views |
| Measurements / annotations / reporting | PASS: visible Length annotation and captured key images; draft/no-op/stale-write handling, immutable finalization and addenda |
| Current study, authorized priors, newly added series/secondary image | PASS: expected identities; new series/secondary images visible after reopening |
| Responsive behavior | PASS: 24 CT/MR Chromium/WebKit phone, tablet and desktop cases; six CT reliability/fallback cases |
| SonicDICOM regression | PASS: 110 reporting integration tests; 79 focused SonicDICOM unit tests |

The SonicDICOM failure was a test-fixture race: changing the simulated upstream status queued a durable cache write that replaced the deliberately seeded stale status before the protected refresh assertion. The fixture now changes the upstream map directly for that case; production refresh logic and assertions remain unchanged.

One initial MR tablet sweep failed with an empty study browser. The edge log identifies a prior-study QIDO canceled after 29 seconds on the Windows published-port route; the isolated tablet rerun passed unchanged. Moving the real backend/callback/discovery onto the Docker network eliminated that test topology, and complete CT/MR sweeps then passed. No speculative viewer workaround was added.

## Validation and remaining gates

PASS: final minified OHIF Docker build; default nginx syntax with native include absent; native nginx startup in the integration harness; backend typecheck; frontend typecheck and build; focused OHIF unit/patch/runtime tests; reporting integration; SonicDICOM unit tests; agent contract and harness checks. Sandbox process/Docker blocks were rerun outside the sandbox. The Windows required-DB wrapper's entry-point no-op was not counted as validation; preflight, disposable DB start/check and `test:db:one` performed the real suite.

**UNRUN:** hospital LAN latency/bandwidth/concurrency and realistic simultaneous-user load; clinical workstation/GPU and actual iPad/Safari; site-specific VOI LUT/presentation-state and representative clinical modality exports; production TLS/routing/plugin deployment; comprehensive and self-hosted CI for a committed exact SHA. No commit/push/deployment was performed. These remain activation gates, not passing results.

Native startup is now faster than stock in this local experiment. Its remaining startup cost is predominantly client work: about 789 ms script CPU versus 3.8 ms median frame TTFB and 0.5 ms frame download. Metadata/scoped discovery still adds work relative to stock, but no pool waits occurred. No further optimization is proposed without target-LAN evidence.

## Reproduction and evidence

Use the disposable DB instructions and run serially; the harness guards the database, restores settings/fixtures and removes temporary containers/networks. Build:

```powershell
docker build -f docker/ohif/Dockerfile -t rispro-ohif:lan-native-final .
docker build --build-arg QUICK_BUILD=true -f docker/ohif/Dockerfile -t rispro-ohif:lan-native-quick .
docker build -f docker/ohif/benchmark-backend.Dockerfile -t rispro-ohif:benchmark-backend .
$env:OHIF_NATIVE_DELIVERY_ENABLED='true'
$env:OHIF_NATIVE_AUTH_SECRET='synthetic-only-local-callback'
$env:OHIF_TEST_IMAGE='rispro-ohif:lan-native-final'
$env:OHIF_NATIVE_BENCHMARK='1'
$env:OHIF_BENCH_REPEATS='3'
$env:OHIF_BENCH_TRACE='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

The benchmark expects the pre-change proxy image `rispro-ohif:ios-reliability` to be retained locally. Do not rebuild that tag from modified source. For responsive acceptance, omit the benchmark flag and set `OHIF_RESPONSIVE=1`, with `OHIF_RESPONSIVE_MODALITY=CT` or `MR`; `OHIF_RELIABILITY=1` runs the existing CT reliability/fallback cases. For full reporting acceptance, omit those flags. The build's default minification can be overridden only for the explicit quick comparison.

Raw matrix and codec JSON, plus representative pixel screenshots, are retained locally in `test-results/ohif-native-final/`. Execution logs are in `test-results/ohif-lan-inspection/` (`native-benchmark-docker-final.log`, `native-codecs-mr-final.log`, `native-acceptance-final.log`, `native-responsive-ct-docker.log`, `native-responsive-mr-docker.log`, `native-responsive-final.log`, `native-proxy-rollback-final.log`, `reporting-rollback-final.log`, `sonicdicom-focused-final.log`). The harness prints its temporary directory for complete per-request data, screenshots and compilation traces. Its JSON compilation summary uses CPU-clock analysis; the earlier console trace summary used broader wall-clock events and is superseded.

See the [operations runbook](../../ohif-viewer-operations-runbook.md) and [rollback](../../ohif-viewer-rollback.md). The callback follows the [official Authorization plugin protocol](https://orthanc.uclouvain.be/book/plugins/authorization.html); the image/static viewer uses the [official OHIF plugin](https://orthanc.uclouvain.be/book/plugins/ohif.html) and [DICOMweb plugin](https://orthanc.uclouvain.be/book/plugins/dicomweb.html).
