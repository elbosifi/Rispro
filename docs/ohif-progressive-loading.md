# Progressive Native OHIF loading

Implemented locally on 2026-10-30 for pinned OHIF v3.12.6, commit `2851f4349d586f475c279e34d2fdb1d0b56e2fc7`, with Cornerstone 4.15.29. Changes are uncommitted and undeployed. Production Orthanc and hospital data were not accessed.

The administrator setting **Settings > OHIF Viewer > Progressive OHIF Loading** defaults to OFF. It uses the existing authenticated, supervisor/admin-only, recently reauthenticated settings endpoint and audit log. Migration `240_ohif_progressive_loading.sql` adds one default-false column to the existing singleton settings table. There are no new tables or runtime environment variables. Saving ON adds `risproLoadingProfile=progressive` to newly generated native launch URLs. Saving OFF removes that automatic selection. Open tabs keep their URL, configuration and authorized session. The local browser checks exercise persistence, both switch states, administrator restrictions and an already-open tab across changes.

Loading profiles remain independently selectable per tab:

| Delivery and selector | Interaction / thumbnail / prefetch | Initialization |
| --- | --- | --- |
| Native, selector absent; administrator OFF | 100 / 4 / 25 | Existing deployed sequence |
| Native + `risproLoadingProfile=progressive` | 100 / 1 / 1 | Preferred initial series, render gate, serial background metadata |
| Native + `risproLoadingProfile=current` | 4 / 4 / 1 | Existing rollback profile |
| Native + `risproLoadingProfile=upstream` | 100 / 75 / 25 | Existing upstream experiment |
| Native + upstream + `risproThumbnailProfile=current` | 100 / 4 / 25 | Existing bounded-thumbnail experiment |
| Proxy, including a progressive selector | 4 / 1 / 1 | Existing proxy behavior |

The progressive-only image background limits were reduced after the synthetic 2 Mbps run showed a 2.05-second wheel step with 25 prefetch requests. With one prefetch and one thumbnail request, the corresponding measured wheel step was 0.48 seconds. Cornerstone still owns its image loading, cache and request pools. OFF does not change the deployed limits.

Initial retrieval priority is computed from the existing lightweight series QIDO response. Explicit `initialSeriesInstanceUID` selection wins, including a series in another current acquisition. Otherwise the heuristic reuses RISpro's weighted CT/MR, image-count and supported SOP-class preferences. ImageType and description clues lower localizer, scout, survey, pilot, topogram and clearly non-diagnostic series. Non-image modalities are lower priority. Available instance/frame counts provide a small bounded preference for a substantial stack even without helpful descriptions. Stable ties retain OHIF's existing sorting. No instance metadata is downloaded to classify a series, no candidates are discarded, and the original series summary and sidebar sort are retained.

Only the default/basic hanging protocol receives `hpInitiationCriteria: { minSeriesLoaded: 1 }` in progressive mode. The source patch leaves the global HangingProtocolService method and other protocols unchanged. For explicit series plus SOP selections, the selected series is retrieved first and OHIF still locates the requested SOP. A SOP-only URL retains upstream all-series matching: series-level QIDO cannot identify its containing series reliably.

The route consumes OHIF's existing DeferredPromises. It retrieves one candidate, creates its normal display set, applies the default protocol and waits for Cornerstone's image-render event plus RISpro's existing decoded-pixel readiness check. Remaining metadata starts only after actual diagnostic rendering, with at most one background series request in flight. Before starting the next background series, a newly selected active viewport must finish rendering. The active frame uses Cornerstone's interaction pool. An existing in-flight metadata response is allowed to finish. Failed or unsupported initial candidates advance to the next candidate. A 30-second image-render watchdog is a failure escape, not the normal scheduling trigger. Exhausted candidates show an explicit error, and route cleanup removes listeners and prevents subsequent queued starts. Existing server metadata timeouts remain unchanged.

Native metadata compression is a separate Nginx change. `native-location.conf` enables level-1 gzip for `application/dicom+json` and `application/json`, with a 1,024-byte minimum and `Vary: Accept-Encoding`. The upstream is requested without Accept-Encoding; Nginx performs the negotiated browser encoding. Binary and multipart frame MIME types are excluded. Native Orthanc streaming, `proxy_buffering off`, authentication, timeout, privacy and no-cache directives remain intact. The original route is preserved in `native-location.uncompressed.conf` and compared with the pre-change version. The UI switch does not disable gzip.

The timing comparison uses the same synthetic 12-series MRI examination and real Chromium, production-built OHIF, Nginx authorization and disposable Orthanc. One non-selected series has a five-second authorization delay. Both timing arms use metadata gzip, isolating the loading-sequence improvement; compression is measured separately against the original route. Cold/warm refer to the browser HTTP asset cache; metadata remains no-store. The slow condition is Chromium's 250,000-byte/s download cap with 80-ms latency, approximately 2 Mbps. These are single local samples, not hospital performance estimates.

| Network / HTTP cache | Baseline first pixels (s) | Progressive first pixels (s) | Metadata bytes before first render, baseline / progressive |
| --- | ---: | ---: | ---: |
| LAN / cold | 7.711 | 2.555 | 31250 / 2756 |
| LAN / warm | 6.949 | 1.271 | 30718 / 2764 |
| 2Mbps-80ms / cold | 21.453 | 16.587 | 30875 / 2668 |
| 2Mbps-80ms / warm | 7.720 | 2.059 | 30798 / 2668 |

All times below are seconds after navigation. The complete resource timeline, including all twelve background metadata requests, is in `progressive-results.json`.

| Network / profile / cache | First metadata request | Initial metadata complete | First frame request | First frame complete | First pixels |
| --- | ---: | ---: | ---: | ---: | ---: |
| LAN / baseline / cold | 1.832 | 1.900 | 7.274 | 7.322 | 7.711 |
| LAN / baseline / warm | 0.926 | 1.098 | 6.626 | 6.671 | 6.949 |
| LAN / progressive / cold | 1.869 | 1.922 | 2.167 | 2.217 | 2.555 |
| LAN / progressive / warm | 0.723 | 0.773 | 0.963 | 1.017 | 1.271 |
| 2Mbps-80ms / baseline / cold | 14.991 | 15.095 | 20.752 | 21.233 | 21.453 |
| 2Mbps-80ms / baseline / warm | 1.371 | 1.508 | 6.959 | 7.511 | 7.720 |
| 2Mbps-80ms / progressive / cold | 15.142 | 15.262 | 15.655 | 16.369 | 16.587 |
| 2Mbps-80ms / progressive / warm | 1.086 | 1.199 | 1.476 | 1.884 | 2.059 |

The progressive series switch and real wheel event are exercised while background metadata is still loading. Times below are milliseconds. Cancellations are recorded separately from failures.

| Network / profile / cache | Series switch | Wheel to pixels | Long tasks before first pixels | Failed HTTP/network requests | Canceled requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| LAN / baseline / cold | 403.7 | 90.7 | 1638.0 | 0 | 18 |
| LAN / baseline / warm | 343.8 | 69.1 | 611.0 | 0 | 18 |
| LAN / progressive / cold | 310.7 | 246.7 | 1590.0 | 0 | 32 |
| LAN / progressive / warm | 263.1 | 233.9 | 589.0 | 0 | 32 |
| 2Mbps-80ms / baseline / cold | 2262.7 | 680.1 | 2068.0 | 0 | 11 |
| 2Mbps-80ms / baseline / warm | 1614.8 | 351.4 | 694.0 | 0 | 15 |
| 2Mbps-80ms / progressive / cold | 944.1 | 510.8 | 1901.0 | 0 | 19 |
| 2Mbps-80ms / progressive / warm | 854.2 | 453.5 | 647.0 | 0 | 19 |

The 15-second slow-link cold-start target remains unmet in the measured sample. Viewer asset transfer/initialization accounts for most of the remaining delay before the first metadata request. This task does not expand into viewer bundle optimization. All twelve series become available; progressive rendering and a series switch occur before the delayed final metadata response completes. The final sidebar order is checked against the baseline. The benchmark also records frame completion, background metadata timing, transferred/decoded bytes, real mouse-wheel responsiveness, long tasks, HTTP/network failures and expected Cornerstone cancellations.

| Measurement | Original native route | Metadata-gzip route |
| --- | --- | --- |
| HTTP status | 200 | 200 |
| Metadata Content-Type | application/dicom+json | application/dicom+json |
| Metadata Content-Encoding | none | gzip |
| Metadata response-body bytes | 55681 | 2456 |
| Decoded bytes | 55681 | 55681 |
| Browser transferSize / encodedBodySize | Not sampled in browser | 2756 / 2456 |
| Metadata response transfer encoding | Streaming | chunked |
| Diagnostic frame Content-Encoding | none | none |
| Diagnostic pixel payload bytes | 73728 | 73728 |

Compression is 22.67:1, a 95.59% response-body reduction. Metadata SHA-256 after decoding is `201fa46b2ae3220c2d3fd8216100ba62f9b5705599a50fa9acfa1ca4b5493292`. Diagnostic pixel-payload SHA-256 is `321ebb7e80c706b473a3b3ee2b6765b449e08c43ba412e73edb3f524934bce34`; transfer syntax remains Explicit VR Little Endian (1.2.840.10008.1.2.1).

Decoded metadata and extracted diagnostic pixel payloads are byte-identical across the original and compressed routes. Multipart framing remains parseable; part headers and transfer syntax match. Native frames have no Content-Encoding and traverse Nginx directly to Orthanc; the native-only test phase records zero Express frame requests. A signed CT sentinel and its rescale are verified in Cornerstone, and all three CT MPR viewports contain rendered pixels. Enhanced MR multiframe rendering also passes.

Local validation completed:

- OHIF production build and compiled browser compatibility verification: PASS. The normal Dockerfile built the first candidate. Docker Hub timed out resolving the base image during the final rebuild; the final source was built using the cached pinned builder, restoring tracked upstream source and verifying the unchanged Cornerstone compatibility patch before applying the current RISpro source patches. No dependencies or versions were changed.
- Full configuration `nginx -t` on both isolated native gateways, compression negotiation, decoded metadata equality, frame equality and original-route rollback comparison: PASS.
- OHIF configurator/native configuration/deployment-check tests: 43 PASS.
- Existing OHIF authorization, adapter, matching, session and configuration tests: PASS; the final runtime profile test separately verifies the new bounded profile.
- Focused OHIF schema/persistence integration: 5 PASS on disposable PostgreSQL after preflight, DB startup/check and migration.
- Reporting store/provenance tests: 9 PASS.
- OHIF settings component tests: 4 PASS. Actual component rendering, ON/OFF save and reload at 1440 and 390 pixels: PASS.
- Backend typecheck, final frontend typecheck and final frontend production build: PASS.
- Existing authenticated native browser acceptance: PASS, including authorization failures, credential isolation, original pixel-byte equality, range behavior, CT/MR rendering, scrolling, mobile widths, independent sessions and proxy rollback.
- Existing multi-study reporting browser acceptance with progressive enabled: PASS for CT/MR, explicit selection in the second current study, current/prior authorization, one shared report, annotated key-image capture/provenance and mobile rendering.
- Agent contract and repository harness: PASS. Comprehensive CI, self-hosted CI and deployment are UNRUN; no commit or push was requested.

Sandbox `spawn EPERM` failures were rerun outside the sandbox. The synthetic harness startup window was bounded more generously for cold imports, and its administrator fixture cleanup was corrected during development. These were not recorded as product test passes before rerunning them. Build/network and intermediate experiment logs are retained with the local artifacts.

To reproduce locally, start with `npm run agent:preflight`, `npm run db:test:up`, `npm run db:test:check`, and `npm run test:db:one -- src/modules/ohif-viewer/ohif-schema.integration.test.ts`. Build the viewer with `docker build -f docker/ohif/Dockerfile -t rispro-ohif:progressive-local .`. Use the existing synthetic harness with the disposable test DB environment, `OHIF_TEST_IMAGE=rispro-ohif:progressive-local`, the existing native-delivery test gates, and `OHIF_LOADING_PROFILE_BENCHMARK=progressive`, then run `node --import tsx scripts/ohif-native-reporting-browser.mjs`. These are test harness selectors; switching the product setting requires no environment change or rebuild. Screenshots, JSON measurements and build/test logs are retained locally under `test-results/ohif-progressive/`.

After review and a separately authorized deployment of this implementation, enable the setting, save it, and open a new authorized Native OHIF tab. Confirm the generated URL includes both `risproDelivery=native` and `risproLoadingProfile=progressive`. For per-tab testing, edit the loading selector in an already-authorized launch URL. Remove it to restore the deployed 100/4/25 sequence, or select `current` for 4/4/1. Set the administrator switch OFF to restore the original sequence for new tabs. Existing tabs can be reloaded with their selector removed when the reader chooses.

To roll back compression independently, restore the native gateway template from `docker/ohif/native-location.uncompressed.conf`, validate the complete rendered Nginx configuration with `nginx -t`, and reload/recreate only the relevant Nginx gateway through the existing deployment procedure. The local acceptance test runs the original and compressed routes as separate isolated gateways. No production rollback or deployment was performed.

Remaining acceptance outside this task is hospital network routing/throughput, physical iPad/Safari behavior, and representative vendor studies, including large enhanced/dynamic acquisitions. No hospital access is needed to reproduce the local evidence. The heuristic remains advisory when QIDO lacks useful classification/count fields, and SOP-only selection deliberately retains the upstream initialization barrier.

Exact changed files and purpose:

| File | Purpose |
| --- | --- |
| `docker/ohif/app-config.js` | Native-only per-tab flag and bounded progressive image pools; existing defaults retained |
| `docker/ohif/configure-progressive.cjs` | Pinned source patches, QIDO priority, render gate, serial metadata/fallback and cleanup |
| `docker/ohif/configure-viewer.cjs` | Register progressive patches and reuse first-image error/readiness UI |
| `docker/ohif/Dockerfile` | Include the new build-time source patch helper |
| `docker/ohif/native-location.conf` | Selective lossless metadata gzip |
| `docker/ohif/native-location.uncompressed.conf` | Preserve the original complete native route for independent rollback |
| `src/db/migrations/240_ohif_progressive_loading.sql` | Default-OFF flag on the existing settings row |
| `src/modules/ohif-viewer/types.ts` | Settings contract |
| `src/modules/ohif-viewer/repository.ts` | Persist/read the setting |
| `src/modules/ohif-viewer/service.ts` | Save through the existing audited path and select new native launch URLs |
| `frontend/src/pages/settings/ohif-viewer-section.tsx` | Administrator control in the existing settings form |
| `frontend/src/pages/settings/ohif-viewer-section.test.tsx` | Default-OFF and saved toggle coverage |
| `docker/ohif/configure-viewer.test.cjs` | Priority, render gate, fallback, exhaustion and route cleanup coverage |
| `src/modules/ohif-viewer/ohif-runtime-config.test.ts` | Profile limits and proxy/native isolation |
| `src/modules/ohif-viewer/ohif-schema.integration.test.ts` | Default-OFF and persisted ON/OFF coverage |
| `scripts/ohif-native-benchmark.mjs` | Reuse existing synthetic fixture and byte-comparison helpers |
| `scripts/ohif-native-benchmark-server.mjs` | Synthetic non-selected-series delay without disabling browser caches |
| `scripts/ohif-native-reporting-browser.mjs` | Existing harness wiring, isolated rollback gateway, synthetic signed CT/non-image fixtures and bounded startup readiness |
| `scripts/ohif-progressive-benchmark.mjs` | Twelve-series compression, performance, fallback and browser regression measurements |
| `scripts/ohif-multi-study-browser.mjs` | Explicit progressive selection in the second current study |
| `docs/ohif-progressive-loading.md` | Local evidence, limitations, activation and independent rollback instructions |

Final branch is `main`, with unchanged HEAD `a22bd3c96530d6a8bef6cbf76f86f75514ee3a7f`. Exact final `git status --short`:

```text
 M docker/ohif/Dockerfile
 M docker/ohif/app-config.js
 M docker/ohif/configure-viewer.cjs
 M docker/ohif/configure-viewer.test.cjs
 M docker/ohif/native-location.conf
 M frontend/src/pages/settings/ohif-viewer-section.test.tsx
 M frontend/src/pages/settings/ohif-viewer-section.tsx
 M scripts/ohif-multi-study-browser.mjs
 M scripts/ohif-native-benchmark-server.mjs
 M scripts/ohif-native-benchmark.mjs
 M scripts/ohif-native-reporting-browser.mjs
 M src/modules/ohif-viewer/ohif-runtime-config.test.ts
 M src/modules/ohif-viewer/ohif-schema.integration.test.ts
 M src/modules/ohif-viewer/repository.ts
 M src/modules/ohif-viewer/service.ts
 M src/modules/ohif-viewer/types.ts
?? docker/ohif/configure-progressive.cjs
?? docker/ohif/native-location.uncompressed.conf
?? docs/ohif-progressive-loading.md
?? scripts/ohif-progressive-benchmark.mjs
?? src/db/migrations/240_ohif_progressive_loading.sql
```
