# OHIF loading profile experiment

2026-10-29. **Partial implementation; browser benchmark and clinical regression acceptance are unrun.** Changes are local and uncommitted. No production archive, patient data, deployment settings, or production containers were changed.

## Stop condition

The repository requires stopping at the first unrelated failure. After successful focused configuration/patch tests and the production OHIF build, this command failed against the disposable database:

```powershell
npm run test:db:one -- src/modules/ohif-viewer/ohif-schema.integration.test.ts
```

The assertion at `src/modules/ohif-viewer/ohif-schema.integration.test.ts:19` expects a table constraint `UNIQUE (appointment_id)` on `native_reports`. Existing migration `236_doctor_workspace_v2.sql:39` deliberately drops that constraint and replaces it with a partial unique index for active legacy primary reports. This loading experiment changes neither the schema nor that test. Two schema checks passed and one failed. Further implementation, benchmark execution, and broader validation stopped; the conflicting reporting assertion was not changed.

`npm run db:test:required -- ...` returned without running its Windows entry point, so it is not passing DB evidence. Preflight reported `DOCKER_OK`; `db:test:up` preserved the existing disposable container; `db:test:check` passed. The documented `test:db:one` runner executed migrations through 236 and the actual failing test. Sandbox spawn/Docker restrictions encountered earlier were rerun outside the sandbox.

## Source findings

The cached builder contains the actual upstream Git checkout at OHIF **v3.12.6**, commit `2851f4349d586f475c279e34d2fdb1d0b56e2fc7`, and Cornerstone **4.15.29**. Upstream files were read through `git show HEAD:<path>`, independently of the builder's customized working files.

| Surface inspected | Loading consequence |
| --- | --- |
| Upstream `platform/app/public/config/default.js` | Shipped image-load pool limits are **100 interaction / 75 thumbnail / 25 prefetch**. |
| Upstream `extensions/cornerstone/src/init.tsx` | Missing settings fall back to **10/5/5**, with compute 10. Omitting RISpro's limits would therefore not reproduce the shipped default config. |
| Upstream `CornerstoneViewportService.ts` | Enables `stackContextPrefetch` on `VIEWPORT_NEW_IMAGE_SET`. RISpro retains this code. |
| Installed `stackContextPrefetch.js` | Starts around the current image, adapts to scrolling, and can naturally expand to a cache fill budget based on one quarter of the maximum cache size. No RISpro full-series downloader is present. A higher prefetch limit changes simultaneous work, not the algorithm or a guarantee of series completion. |
| Installed `imageRetrievalPoolManager.js` | Separate upstream retrieval pool allows 200 requests per interaction/thumbnail/prefetch category, with grab delay zero. RISpro does not override it. Browser connections and bandwidth also constrain actual concurrency. |
| `docker/ohif/app-config.js` | Current native image-load limits are **4/4/1**; proxy is **4/1/1**. Study metadata remains lazy. Native WADO metadata, frames and rendered JPEG thumbnails use the existing native route; exact-study QIDO discovery uses the scoped proxy. |
| `docker/ohif/configure-thumbnails.cjs` | Corrects upstream rendered-thumbnail media negotiation using the existing client, `image/jpeg`, 160x160 rendering, and the **image-load** thumbnail pool. It does not download diagnostic frames for native thumbnails. High thumbnail concurrency could compete for network resources; the experiment retains the fix and isolates its limit. |
| `docker/ohif/Dockerfile` | Pins upstream and retains all configurators/reporting registration. Production minification remains enabled. Startup bundle cost is separate from diagnostic frame scheduling. |
| `docker/ohif/configure-viewer.cjs` | First-pixel readiness and cached-frame progress observe rendering/cache events and cached promises. The active stack is scanned once on attachment; subsequent cache events update membership. These are UI observers with some CPU/render work, not downloaders or throttles. Authorized history discovery adds exact-study requests and remains on demand for prior images. Diagnostic hanging-protocol preferences affect the initially selected series. Explicit full-dynamic-range calculation visits only the displayed frame. |
| `configure-series-windowing.cjs` | Restores stored CT/MR VOI when assigning a different stack, using existing metadata. No image requests or pool changes. |
| `configure-responsive.cjs` | Preserves panel/touch selection and supported-content routing, including scanned-image stack fallback. Panel visibility may affect when upstream thumbnails are needed; no independent scheduler is added. |
| `configure-viewport-reliability.cjs`, `configure-cornerstone-compat.cjs` | Handle viewport completion/rejections and float-opacity texture compatibility. They preserve MPR reliability without changing normal image-pool limits or pixel transfer syntax. |
| `docker/ohif/rispro-reporting/` | Fetches report/context/history data, saves reports/key images and integrates dictation. Capture reads rendered pixels and annotations; Locate Source selects through existing OHIF commands. These features remain installed. |
| `docker/ohif/native-location.conf` | GET-only Nginx-to-Orthanc pathway, no frame buffering, gzip off, private/no-store responses, existing context/cookie authorization header. Frames do not need to enter Express. No changes were made here. |
| `src/modules/ohif-viewer/` | Existing launch/session allowlists, prior discovery, source resolution, audit, authorization callback and proxy fallback remain untouched. The plugin's existing one-second decision lifetime coalesces callbacks and bounds revocation. Their actual CPU/query/latency contribution still requires measurement in this experiment. |

The existing [native delivery results](plans/completed/ohif-native-delivery-results.md) measure a different loopback experiment, with smaller concurrency variations and a proxy comparator. Those results do not establish the requested stock/current/upstream slow-link comparison. Stock Orthanc's bundled viewer has not yet been inspected in this run; its defaults and version must not be assumed equivalent to v3.12.6.

## Selecting a test profile

After obtaining an ordinary authorized native viewer launch URL in the synthetic test environment, append one of these selectors and reload:

| Selector | Interaction / thumbnail / prefetch |
| --- | --- |
| No selector, or `&risproLoadingProfile=current` | **4/4/1**, current default and immediate rollback |
| `&risproLoadingProfile=upstream` | **100/75/25**, pinned upstream default config |
| `&risproLoadingProfile=upstream&risproThumbnailProfile=current` | **100/4/25**, isolates thumbnail scheduling from the upstream interaction/prefetch experiment |

Unknown profile values retain current behavior. The upstream selector takes effect only with native delivery and a syntactically valid viewer context. It grants no access: the existing backend/plugin still authorize requests. Proxy delivery ignores it and retains 4/1/1. Neither profile modifies stack prefetch, the retrieval pool, the JPEG thumbnail fix, reporting, tools, lossless delivery, or authorization. No new settings UI, cache, scheduler, service, database object, or loader was added.

Rollback for a test tab: remove `risproLoadingProfile=upstream` or change it to `current`, then reload. This immediately restores current native limits. The existing `risproDelivery=proxy` transport fallback remains separate. No deployment change is needed to select between profiles in an image containing this experiment.

## Benchmark preparation

The new `scripts/ohif-loading-profile-benchmark.mjs` extends the existing guarded synthetic harness. Its browser instrumentation has **not been executed yet** and should be treated as provisional.

The intended matrix compares stock Orthanc, current native, upstream native and upstream native with four thumbnail requests. It reuses the same generated multi-series MR and 656-slice CT study with a 512-slice primary stack, real login/launch authorization, official Orthanc authorization plugin, and temporary loopback-only containers. Variant order rotates between repetitions. It uses no Playwright response routing or custom image requests.

Conditions: unthrottled Docker loopback; Chromium CDP 2 Mbps with 80 ms configured latency; 5 Mbps with 40 ms configured latency. Upload and download limits are symmetric, decimal Mbps, without injected packet loss. This is browser emulation over local HTTP/1.1, not a hospital LAN measurement. Cold launches clear the browser HTTP cache in a fresh context. Warm reloads retain the same context and normal HTTP cache; a reload creates a fresh Cornerstone memory cache. Native no-store image responses may still require network transfer on warm reload.

The harness records first rendered original-resolution pixels, series-switch pixels, wheel and uncached-jump wait, actual loaded images in the active Cornerstone cache every 500 ms, natural completion only when all active image IDs are loaded, frame request outcomes including pending/canceled transfers, other-series frames, thumbnail completion, metadata/request timing, browser queueing, pool concurrency, bytes, backend CPU, authorization callback durations and DB query/pool metrics. Metadata and thumbnails never count as loaded diagnostic frames. Idle observation is fixed at eight seconds before scrolling; absence of completion is not a full-cache timing result. The additional two-second observation after switching is also bounded.

After addressing the unrelated test failure separately, the prepared invocation is:

```powershell
$env:OHIF_NATIVE_DELIVERY_ENABLED='true'
$env:OHIF_NATIVE_AUTH_SECRET='synthetic-only-local-callback'
$env:OHIF_TEST_IMAGE='rispro-ohif:loading-profiles'
$env:OHIF_NATIVE_BENCHMARK='1'
$env:OHIF_LOADING_PROFILE_BENCHMARK='1'
$env:OHIF_BENCH_REPEATS='3'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

The existing harness also expects its locally retained baseline and quick comparator images, even though this profile matrix does not time those variants. Results are written to the temporary artifact directory printed by the harness. Optional `OHIF_LOADING_NETWORKS` and `OHIF_LOADING_VARIANTS` comma-separated filters support an initial smoke run. No measured matrix or clinical acceptance result exists for this new experiment yet.

## Validation status and recommendation

- **PASS:** focused runtime configuration tests, 5/5; benchmark request-accounting test, 1/1; existing focused OHIF configurator/report-store tests, 32/32.
- **PASS:** actual production OHIF Docker build, including compiled ONNX/service-worker guard; synthetic backend image build.
- **FAIL:** existing OHIF schema regression, 2/3 passing; unrelated constraint mismatch described above.
- **UNRUN after the required stop:** Chromium benchmark, A/B/C measurements, frontend typecheck/build, backend typecheck, agent contract/harness, other authorization/reporting/SonicDICOM regressions, responsive browser acceptance and clinical feature journeys.
- **UNVERIFIED:** CT/MR scrolling and switching under either experiment profile, stored VOI, dynamic and enhanced multiframe studies, phone/tablet layouts, MPR/MIP/oblique views, measurements/annotations, key-image capture/provenance/Locate Source, independent/shared reporting drafts/review/history/signing/addenda/printing, dictation, authorized priors, native/proxy fallback and unauthorized/revoked denial in the built image.
- **UNRUN externally:** hospital slow LAN, concurrent users, physical iPad/iPhone/Safari and diagnostic workstation/GPU acceptance, representative clinical modality data, comprehensive/self-hosted CI.

All protected feature code remains installed and available by source inspection. Absence of runtime regressions is **not established**. Keep **current 4/4/1 as the default** until repeated measurements and regression acceptance justify a change; no performance winner can be recommended from the available evidence.

Local execution logs: `test-results/ohif-loading-profiles/production-build.log`, `backend-build.log`, `patch-tests.log`, `db-required.log`, and `ohif-db.log` in that same directory. No commit, push, or deployment occurred.
