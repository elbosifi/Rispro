# Execution Plan: native Orthanc image delivery

## Problem

All existing OHIF source strategies stream through Express. Implement an opt-in native Orthanc pathway and compare it against the existing proxy and official Orthanc OHIF with synthetic studies.

## Scope

Reuse existing login, per-tab viewer sessions, study allowlists and reporting authorization. The official Orthanc Authorization plugin calls RISpro for authorization; nginx streams study metadata, rendered thumbnails and unchanged diagnostic frames directly from Orthanc. Exact-study discovery remains on the existing proxy. Keep native delivery disabled by default and retain the proxy for rollback. Correct the separately authorized stale SonicDICOM test fixture race.

## Files Likely to Touch

- `src/modules/ohif-viewer/`, `src/config/env.ts`
- `docker/ohif/`, `docker/reverse-proxy/`, `.env.example`
- `scripts/ohif-native-benchmark.mjs`
- `src/modules/doctor-portal/reporting-board.integration.test.ts`
- OHIF domain documentation and operations runbook

## Explicit Non-Goals

No production archive, patient data, deployment, dependency upgrade, new thumbnail server/cache, permission redesign, or changes to diagnostic compression/VOI. No commits or pushes.

## Acceptance Criteria

- Native frames bypass Express, with login/session/study authorization, expiration and revocation enforced by the real Authorization plugin.
- Default and rollback use the existing proxy.
- Real diagnostic pixels, series switching/revisiting, CT/MR VOI, MPR, measurements, reporting and responsive layouts remain functional in feasible local tests.
- Record measured stock/proxy/native results, thumbnail 1/4/8 and separate interaction/prefetch experiments, minification and HTTP compression comparisons.
- Identify LAN and physical-device checks as pending; do not activate production.

## Validation Commands

- Agent contract, environment preflight, disposable DB start/check.
- Focused OHIF unit and DB integration tests; reporting-board integration suite.
- Isolated Docker benchmark with official OHIF/Authorization plugins and synthetic CT/MR, including a large CT.
- Backend typecheck; frontend typecheck and production build after viewer source changes; harness checks.

## Rollback Considerations

Native delivery is opt-in. Turn off its environment gate and relaunch to return to Express; no migration or clinical data changes are required. Existing proxy routes remain available throughout.

## Execution Notes

- Starting HEAD: `5881fe61f02e33835f05ccae8d3419e69882df66`; clean main, fetched origin, ahead/behind 0/0.
- User explicitly authorized proceeding without LAN and correcting the unrelated SonicDICOM test failure. All archive work must use isolated synthetic Docker fixtures.
- The preferred required-DB wrapper exits without running on Windows due to its entry-point comparison; use the documented `test:db:one` runner after preflight/start/check. Do not treat the wrapper's exit zero as test evidence.
- The final production Dockerfile build succeeded with minification and compiled-browser checks. An initial candidate had reused upstream Lerna cached output; that candidate is not the final image.
- Official Authorization 0.11.2 requires a service-user profile for existing Basic archive operations, and validates internal DICOMweb `POST /tools/find` at study level. Native resource validation accepts that internal lookup; the public native nginx route accepts GET only. The archive REST/STOW listener is a private backend dependency, never a browser route. Study/profile authorization caches last one second, with native grants ending before login or viewer-session expiry.
- The final reporting integration suite passes 110/110, including native authorization and native-off authenticated rollback. All 79 focused SonicDICOM unit tests pass. Production SonicDICOM logic was unchanged.
- Final minified acceptance passed CT/MR reporting, immutable finalization/addenda, visible measurement capture, MPR/MIP/oblique, priors and enhanced MR multiframe. Both complete responsive sweeps pass (24 CT/MR Chromium/WebKit cases), along with six CT reliability/fallback cases.
- The rendered-thumbnail correction must unwrap the pinned client's singlepart response array and use `imageLoadPoolManager`: OHIF applies `maxNumRequests` to that pool, not the separate retrieval pool. Earlier exploratory scheduling runs using the retrieval pool are excluded from final concurrency decisions.
- Synthetic codec acceptance passed RLE, JPEG lossless, JPEG-LS, JPEG2000 lossless and uncompressed secondary images, with byte-identical stored frames, pixel-exact 512x512 decoding and original DICOM files unchanged. GDCM's test configuration permits all input syntaxes; its image default restricts it to JPEG2000 inputs and cannot encode the RLE fixture.
- Ten alternating identity/gzip pairs per syntax showed gzip increasing complete-frame time: approximately 4.1 to 7.3 ms RLE, 3.2 to 7.4 ms JPEG lossless, 3.1 to 5.6 ms JPEG-LS, 3.0 to 5.9 ms JPEG2000, 5.8 to 11.9 ms uncompressed. Native frame gzip remains off. These are loopback observations, not LAN measurements.
- The corrected matrix passes all 99 launches: three cases (CT, MR, 656-slice 512x512 large CT), eleven variants, three repeats, separate Docker backend/Orthanc CPU and DB metrics. Network collection includes Cornerstone's intentional multipart-tail cancellation. Final 4/4/1 settings use these measurements.
- Additional JPEG2000 MR acceptance passes exact pixels, stored VOI, original compressed-frame bytes and original file hash. A Windows prior-QIDO hairpin stall was diagnosed from the edge log; direct Docker networking passes full responsive reruns without a viewer workaround.
- The [results report](ohif-native-delivery-results.md) records the full tables, evidence, reproduction, default-off rollout/rollback behavior and unrun hospital LAN, physical Safari, clinical export and exact-SHA CI gates. Production remains disabled and untouched.
