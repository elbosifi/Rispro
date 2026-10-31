# Single-series dynamic MRI

Local implementation for pinned OHIF v3.12.6 / Cornerstone 4.15.29. Enabled by default for an active, single-series MR dynamic volume with at least two verified temporal groups. No setting, database, API, dependency or production configuration change is required. `risproDynamicMri=off` disables these controls in one tab. Native and proxy delivery continue to use their existing authorized loaders.

## Integration and interaction

`configure-dynamic-mri.cjs` copies `dynamic-mri/` into the Cornerstone extension and inserts one component alongside the existing viewport overlays/Cine player. The patch checks its pinned source anchors. `configure-viewer.cjs` invokes it; the Dockerfile copies its source assets. UI uses OHIF's Button and Select primitives because RISpro's application components belong to a separate application/build.

`installPhaseNavigation()` wraps the existing tool-group StackScroll instance's mouse drag callback only for the active eligible viewport. It locks direction after 8 canvas pixels; horizontal movement must exceed vertical movement by 1.3 times. Horizontal motion advances one phase per 25 pixels, clamped to the available range. Vertical motion goes through the original callback, including the distance accumulated before direction lock. Mouse-up/cancellation clears the gesture. A local non-passive wheel listener handles predominantly horizontal wheel input only while StackScroll owns the primary interaction. Vertical wheel, modifier/pinch gestures and annotation editing retain priority. Cleanup restores the original callback and removes listeners.

The only phase state changed is `volume.dimensionGroupNumber` (1-based). The existing Cornerstone dimension-group event updates the chart marker and OHIF Cine slider. No viewport, display set, camera, slice, VOI, pan or zoom is recreated or reset. The panel uses existing Cine state to stay below its controls. Select Stack Scroll to navigate while the analysis panel is open; select Elliptical ROI to draw/edit. Closing restores the interaction tool saved when the panel opened. Unrelated annotations are untouched.

## Temporal and geometric safeguards

`temporalContext()` uses the existing `displaySet.dynamicVolumeInfo.timePoints` and actual cached dynamic volume. Supported grouping tags are TemporalPositionIdentifier, TemporalPositionIndex, and the pinned loader's TimeSlotVector compatibility path. Each group must have consistent increasing temporal identifiers or verifiably ordered acquisition date/time values. Diffusion grouping, positive b-values, diffusion image types, varying echo times/numbers, cardiac-trigger grouping and unknown dimensions are excluded. Separate series are never combined.

All source frames must have explicit Frame of Reference, position, orientation, pixel spacing and dimensions. Metadata-provider default geometry is not accepted. Frames across phases are paired by patient-space plane, orientation, spacing and matrix size, never array index. Every plane must match exactly once in each phase. Position tolerance is 0.1 mm; orientation/spacing tolerance is 0.0001. Motion/displacement, inconsistent geometry, oblique ROI planes or unsupported mappings produce no measurements.

`roiPlane()` reads the four patient-space EllipticalROI handles. `meanSignal()` maps them onto the corresponding source pixel grid, cross-checking Cornerstone's continuous world-to-index transform. DICOM Pixel Spacing is row spacing followed by column spacing; the first voxel's position identifies its center. See the [DICOM Image Plane Module](https://dicom.nema.org/medical/dicom/2023d/output/chtml/part03/sect_C.7.6.2.html).

`sampleCurve()` loads only one matching anatomical frame per phase, serially, through the existing image cache/authorized loader and request pool. Existing upstream dynamic-volume loading is unchanged and can independently load other frames. Sampling uses decoded source pixels, excludes padding/invalid/non-finite values, preserves decoded signedness and applies linear rescale only when Cornerstone has not already prescaled the pixels. Color/non-scalar pixels and nonlinear modality/real-world mappings are unavailable. It never samples displayed/windowed pixels or modifies diagnostic pixel arrays.

No baseline is silently identified as precontrast. The user explicitly selects a phase for enhancement, calculated as `100 * (SI - baseline) / baseline`. The baseline must be valid and nonzero, and phases must have identical valid-pixel masks and signal units. Unavailable phases appear as gaps with an incomplete-state message. Reliable per-frame acquisition date/time gives elapsed seconds; otherwise the axis uses phase numbers. The panel reports valid-pixel count, selected baseline and current mean. There is no registration, motion correction, classification, contrast concentration or pharmacokinetic analysis.

## Related initialization correction

The synthetic browser test exposed `No scalar data available` in the pre-existing `isDiagnosticReady()` check: Cornerstone's dynamic voxel manager does not implement the ordinary volume `scalarData` getter. The narrow dynamic branch now checks an actual loaded voxel at the rendered focal plane, without allocating a complete phase or treating unloaded voxels as zero. Ordinary stack/MPR checks, progressive metadata scheduling, request concurrency and fallback scheduling are unchanged. A focused regression test covers this failure.

## Local validation

Tests and build/browser logs are kept under the ignored `test-results/ohif-dynamic-mri/` directory. Validation is synthetic and local; no hospital deployment, real clinical examination or physical iPad testing has been performed.

Run the focused tests with:

```powershell
node --test docker/ohif/configure-dynamic-mri.test.mjs docker/ohif/configure-viewer.test.cjs
```

Build with `docker build -f docker/ohif/Dockerfile -t rispro-ohif:dynamic-mri-local .`. Local validation may reuse the existing pinned source/dependency builder after verifying its OHIF commit and Cornerstone compatibility patch; production minification and browser-build verification remain enabled.

The existing disposable-DB/Orthanc browser harness accepts `OHIF_LOADING_PROFILE_BENCHMARK=dynamic-mri`, with `OHIF_TEST_IMAGE` pointing to the local image and the existing synthetic native-delivery test configuration. Run `npm run agent:preflight`, `npm run db:test:up`, `npm run db:test:check`, then `node --import tsx scripts/ohif-native-reporting-browser.mjs` with `codex-db-test.env` loaded. These are existing test-harness selectors, not product configuration requirements. The new test branch uses only synthetic, authenticated loopback services and restores its disposable fixtures/settings.

The fixture has three phases (100/150/125 a.u.), eight anatomical planes, and a known spatial signal pattern outside the ROI. Browser acceptance draws/moves an actual ROI, checks 0/50/25% with explicit baseline 1, navigates by drag/wheel/Cine, checks unchanged camera/VOI and every decoded source pixel, and exercises unavailable geometry/data, recovery, tab opt-out and iPad-sized layout. A second enhanced MR multiframe fixture exercises the pinned TimeSlotVector path plus per-frame temporal/geometry attributes. This compatibility test does not establish support for arbitrary enhanced MR DimensionIndexSequence layouts. Layouts the pinned loader cannot expose as verified temporal groups remain ordinary OHIF views without analysis.

Measured browser results (SVG values after real ROI drawing):

The following table and benchmark results describe the original implementation's validation. Validation of the scalar-metadata follow-up is recorded in its section below.

| Phase | Mean SI (a.u.) | Enhancement with explicit baseline 1 |
| --- | ---: | ---: |
| 1 | 100 | 0% |
| 2 | 150 | 50% |
| 3 | 125 | 25% |

The ordinary multi-instance and supported enhanced multiframe fixtures both produced the expected SI values. The ordinary fixture reported 1,257 valid ROI pixels per phase. Every decoded pixel in all 24 ordinary dynamic frames matched the synthetic source after navigation and analysis. Missing-frame injection produced a visible incomplete curve with a null phase value, then recovered through the authorized loader. Invalid ROI geometry produced an unavailable message without a chart.

| Validation | Result |
| --- | --- |
| Focused dynamic/progressive tests plus existing responsive, viewport-reliability, thumbnail, windowing and Cornerstone compatibility tests | PASS, 49/49 |
| Final production OHIF build, minification and browser-build verification | PASS, existing upstream size/DefinePlugin warnings |
| Final dynamic MRI browser acceptance | PASS, 17 checks, no browser exceptions |
| Desktop and 1024×768 iPad-sized screenshots; panel clears Cine slider | PASS, layout emulation only |
| RISpro frontend typecheck and production build after final UI edit | PASS outside sandbox |
| Existing progressive synthetic browser benchmark on the final image | PASS, 8 timing runs and 14 checks, including native signed pixels, CT MPR, enhanced MR, authorization/settings and old loading profiles |
| Existing proxy CT/MR reporting browser journey on the final image | PASS, stack and annotated capture, CT coronal/sagittal/oblique/MIP, priors, enhanced multiframe frame 3, reporting persistence and zero reporting-triggered frame reloads |
| Native default reporting browser regression | FAIL before viewer launch: `source_unavailable`, logged `failureCategory: dns` |

The native default reporting test's host-side launch cannot resolve the disposable Docker archive alias. The sequence stopped at this unrelated environment failure. Its result is preserved in `test-results/ohif-dynamic-mri/reporting-browser.log`; no application/delivery fix was added to bypass it. Dynamic native acceptance and the progressive benchmark use the harness's existing container-backed launch path. The proxy reporting run is separate evidence and does not turn the failed native reporting run into a pass.

The unchanged progressive benchmark recorded navigation-to-first-diagnostic-pixel times below (seconds). These are current local measurements with its delayed-background-metadata fixture, not estimates or hospital measurements. Cold 2 Mbps loading remains slower than warm loading; no bundle/scheduler optimization was added.

| Network/cache | Baseline native | Progressive native |
| --- | ---: | ---: |
| LAN, cold | 6.131 | 1.076 |
| LAN, warm | 5.555 | 0.488 |
| 2 Mbps / 80 ms, cold | 20.056 | 15.118 |
| 2 Mbps / 80 ms, warm | 6.678 | 1.523 |

Final JSON evidence is in `test-results/ohif-dynamic-mri/dynamic-mri-results.json` and `progressive-results.json`; screenshots and all build/unit/browser logs are alongside them. Agent-contract and documentation checks also pass. Windows sandbox restrictions initially blocked Node/Docker/Vite child-process execution; the unchanged checks were rerun successfully outside the sandbox. The native DNS failure remains a distinct failed check.

## Files and rollback

Feature changes are isolated to `docker/ohif/configure-dynamic-mri.cjs`, `docker/ohif/dynamic-mri/{DynamicMri.tsx,analysis.mjs,navigation.mjs,dynamic-mri.css}`, registration and the dynamic-readiness branch in `docker/ohif/configure-viewer.cjs`, two Dockerfile COPY entries, `docker/ohif/configure-dynamic-mri.test.mjs`, the test-only dispatch in `scripts/ohif-native-reporting-browser.mjs`, `scripts/ohif-dynamic-mri-browser.mjs`, and this document. Existing progressive corrective changes in the working tree remain preserved.

Features are enabled without an administrator action for eligible series. To troubleshoot, append `&risproDynamicMri=off` to the already-authorized OHIF viewer tab URL and reload; remove it and reload to restore the controls. The ordinary Cine/StackScroll tools remain available with the override. Build-time rollback removes the configurator registration/COPY entries and its narrow source/readiness additions, while preserving the separate progressive corrective patch. No version/dependency, settings, delivery, cache-concurrency, authentication, reporting, Nginx or Orthanc configuration changes are part of this feature. The original dynamic MRI implementation is committed on `main` as `54250f1a`; the scalar-metadata correction below remains local, uncommitted and undeployed.

## Scalar metadata correction, 2026-10-31

A reported screenshot showed every phase rejected with the generic message `Comparable scalar MRI pixels unavailable.` It identifies the failed guard, but does not establish which of its conditions applied to that examination. Two compatibility defects were independently reproduced with synthetic scalar MR data: an empty optional LUT sequence and a valid linear Real World Value Mapping Sequence both triggered that message.

`meanSignal()` now accepts empty optional sequences and validates linear real-world mappings rather than rejecting every sequence. Signal intensity continues to use Cornerstone's modality-rescaled decoded pixels, matching the existing ROI signal path. Real-world slope/intercept are not applied on top of modality rescale and no physical-unit/concentration conversion is introduced. The [DICOM Real World Value Mapping specification](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.16.2.html#sect_C.7.6.16.2.11.1.1) defines that mapping independently of the modality transform.

Nonlinear modality LUTs, nonlinear/incomplete real-world mappings, color/multi-component images, incompatible decoded dimensions and missing pixels remain unavailable. Each now has a distinct failure reason. `curveStatus()` groups identical errors across phases: twenty matching failures produce one reason with the affected phase range and count, instead of twenty repeated paragraphs. Failed phases retain null measurements.

The synthetic browser fixture now includes a non-identity linear real-world mapping. It must still produce SI 100/150/125 and enhancement 0/50/25%, preserving every source pixel. Browser checks also inject an unsupported modality LUT, verify one grouped reason and no chart, then verify recovery after restoring the fixture metadata. The original clinical examination has not been accessed or retested; its exact failing attribute remains unconfirmed from the screenshot alone.

Follow-up validation: PASS 53/53 focused/existing viewer unit tests; PASS 20 synthetic dynamic MRI browser checks, including ordinary/enhanced frames, unchanged decoded pixels, mapping rejection/recovery and a compact error panel at 390×844 portrait size; PASS production OHIF build/browser-build verification; PASS final frontend typecheck/build; PASS agent contract and documentation checks. Test logs, JSON evidence and the portrait screenshot are under `test-results/ohif-dynamic-mri-scalar-fix/`. These are local synthetic/browser results, not verification of the clinical study in the screenshot. Changes remain uncommitted and undeployed.

## Limitations

Analysis requires matching native acquisition planes and scalar linear MR signal. Missing temporal evidence/geometry, varying diffusion or echo dimensions, separate-series dynamics, motion/displaced planes, nonlinear mappings and unsupported enhanced dimension layouts remain unavailable. Phase-number plots are used when timestamps are incomplete/unreliable. Pixel identity and synthetic numerical results do not constitute clinical validation. Vendor-specific layouts, representative clinical acquisitions, physical iPad gestures and clinical workflow require separate validation before hospital use.
