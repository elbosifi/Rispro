# OHIF iOS rendering and document selection reliability

## Scope and version evidence

Local, uncommitted correction based on clean `main` at
`8bf9aa14176d5646d2a77768ead31e5277dbc820`, fetched and equal to `origin/main`
before editing. No production deployment, commit, push or merge was performed.

The baseline local image is `rispro-ohif:ios-responsive-window`; its installed
source reports OHIF **3.12.6** and Cornerstone **4.15.29**. The final local image is
`rispro-ohif:ios-reliability`, ID
`sha256:237318778af63a72ac60090cbdf69775142b27cea72db034fe67d9b9a12276b0`.
Both dependency versions remain unchanged. The final builder is retained as
`rispro-ohif:ios-reliability-builder` for source inspection.

No locally running deployed OHIF container was available. The deployed bundle,
the actual study's SOP classes, and its Safari exception were unavailable;
the user confirmed they did not have those diagnostics. Do not equate the local
baseline with a verified production deployment.

## Confirmed rendering defects

### Floating-point opacity filtering

The installed ESM mapper contains the exact unsafe WebGL2 condition corrected by
[Cornerstone PR #2810](https://github.com/cornerstonejs/cornerstone3D/pull/2810),
merged July 17, 2026. WebGL2 float textures still require
`OES_texture_float_linear` for linear filtering. The old condition selects a
float opacity texture for every WebGL2 context.

The unpatched WebKit reproduction uses a 512-image signed CT volume,
`Int16Array` data and actual `SHORT` scalar texture uploads. With the float-linear
extension withheld, the mapper uploads a `FLOAT` opacity texture and the central
image pixels are all zero. The active GL context is not lost, its error is zero,
and the camera and image index remain finite. This isolates opacity filtering
from memory exhaustion, camera failure and context loss in that reproduction.

PR #2810 was **applied** as a narrow backport of commit
`c4a864febdd7d553826324637172d69a0b9d9932`. The patch adds
`canUseFloatOpacityTexture()` and replaces only the opacity capability condition
in the installed package's consumed ESM source:
`node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/vtkClasses/vtkStreamingOpenGLVolumeMapper.js`.
The existing byte opacity table handles missing float-linear support; supported
hardware keeps its float opacity texture. Scalar textures are unchanged. The
Docker patch rejects a different Cornerstone version or changed source anchors.
It does not modify an app bundle or upgrade dependencies.

[Cornerstone issue #2653](https://github.com/cornerstonejs/cornerstone3D/issues/2653)
describes the matching iOS volume-only failure.
[OHIF issue #5925](https://github.com/OHIF/Viewers/issues/5925) reports a different
`uniformMatrix3fv` error. That particular error has not been reproduced here.

### Scanned documents inheriting an MPR viewport

A separate synthetic reproduction matches the reported `NaN/undefined` overlay
and a long app-bundle exception. A supported Secondary Capture instance
(`1.2.840.10008.5.1.4.1.1.7`, modality OT) lacks patient-space reconstruction
geometry. OHIF correctly marks its display set `isReconstructable: false`.
Selecting it from MPR nevertheless retains the orthographic viewport type.

That feeds invalid volume bounds and sample distance into vtk.js. The generated
fragment shader contains `vtkMaximumNumberOfSamples NaN`; shader compilation
fails and the shader program is null. The captured exception is:

```text
TypeError: Cannot read properties of null (reading 'isAttributeUsed')
```

The original source is `@kitware/vtk.js/Rendering/OpenGL/VolumeMapper.js:342`
(`program.isAttributeUsed('vertexDC')`), reached through
`publicAPI.setMapperShaderParameters`. Its ray-length/sample-distance calculation
is at lines 199-202. The baseline unminified bundle frame is
`app.bundle.4119ca9981182ad42074.js:377015:19`.

Cornerstone's volume slice calculations then produce an invalid index and an
undefined slice count. `ViewportImageScrollbar.tsx` reads those values and
`CustomizableViewportOverlay.tsx:459` formats them as `NaN/undefined`.
This is invalid volume state, not a CSS or overlay-formatting defect. No overlay
values were hidden or substituted.

The selection boundary now sends supported, non-reconstructable default-stack
display sets to OHIF's existing stack command before volume initialization.
Reconstructable CT/MR retains normal selection. PDF/SR and other registered
handlers retain their original selection callback.

The actual Clinical Documents SOP class remains **unconfirmed**. Secondary Capture
is a demonstrated failure mechanism, not an assertion about that patient's data.

### Unsupported display sets

The synthetic Encapsulated CDA instance (`1.2.840.10008.5.1.4.1.1.104.2`, DOC) is
actually marked `unsupported: true`, handler `unsupported`. It is not treated as
CT or PDF. OHIF's hanging-protocol service checks that flag only after its early
return for custom layouts; a custom layout can therefore lose its compatible
viewport when this set is selected.

The touch/double-click boundary now rejects unsupported sets before mutating the
grid, keeps the current image and series browser usable, and displays an
understandable notification. Rejected selection callbacks are handled as well.
Series remain visible in the browser. Warning badges alone do not block content.

## Recovery

Static mobile CT/MR MPR creation, volume assignment and orientation rejections
restore the affected display set through the existing stack viewport API and
show `MPR unavailable`. No automatic volume retry, study reload, WebGL reset or
rendering-engine recreation was added. A late failure cannot overwrite a later
series selection. Dynamic volumes and multi-layer/specialized viewports do not
enter this automatic stack fallback.

The viewport service now returns its existing assignment-completion promise;
the viewport component awaits it so rejected asynchronous assignments can reach
the recovery handler. The default first-image loading behavior is unchanged.

## Files and preservation

| File | Reason |
| --- | --- |
| `docker/ohif/configure-cornerstone-compat.cjs` | Version/anchor-checked PR #2810 backport |
| `docker/ohif/configure-viewport-reliability.cjs` | Await assignment and recover failed mobile MPR |
| `docker/ohif/configure-responsive.cjs` | Validate display-set support and route non-reconstructable images to stack |
| `docker/ohif/Dockerfile` | Apply the two new source patches before the existing build |
| Corresponding three `.test.cjs` files | Capability, selection and recovery regression coverage |
| `scripts/ohif-native-reporting-browser.mjs` | Optional signed 512-image CT and explicit document fixtures |
| `scripts/ohif-responsive-browser.mjs` | Optional reliability matrix and GPU/pixel/state assertions |
| This report | Evidence, limitations, reproduction and rollback |

Twelve protected source files match the previous builder byte-for-byte:
tool groups, hotkeys, presets, Cornerstone initialization and prefetch, cache
service, first-image loading/progress, hanging protocol, responsive header/CSS,
native reporting and runtime DICOMweb configuration. Evidence is in ignored
`test-results/ohif-ios-reliability/source-preservation.json`.
The files under `docker/ohif/responsive/` and thumbnail touch recognition
are unchanged. Notifications reuse OHIF's existing service; no generic UI control
was introduced into the separate upstream workspace.

## Validation

Local implementation and synthetic validation are complete. The new reliability
matrix is **PASS, 6/6**, the existing responsive matrix is **PASS, 12/12**, and the
existing desktop CT/MRI native-reporting browser journey is **PASS**.

| Engine/profile | Float-linear support | Result |
| --- | --- | --- |
| Chromium phone | Available; float opacity | PASS |
| Chromium desktop | Available; float opacity | PASS |
| WebKit phone | Available; float opacity, SHORT scalars | PASS |
| WebKit desktop | Available; float opacity, SHORT scalars | PASS |
| WebKit phone | Withheld; byte opacity, SHORT scalars | PASS |
| WebKit desktop | Withheld; byte opacity, SHORT scalars | PASS |

Each case returns to rendered CT after MPR and document selection. All final
active contexts have `isContextLost() === false` and GL error zero. The final CT
image's central contrast is 247 or 255 grayscale levels. Mobile creation,
assignment and orientation fault injections recover without uncaught exceptions.

- Focused source/backport/selection/recovery/windowing/loading/report-store tests:
  **PASS, 27/27**.
- Final source Docker build, builder inspection and compiled ONNX bootstrap
  verification: **PASS**. Existing upstream build warnings remain.
- Required frontend typecheck and production build after the final application
  edit: **PASS**. Existing bundle-size warnings remain.
- Agent contract and source preservation: **PASS**.
- Environment preflight and guarded disposable test DB up/check: **PASS** outside
  the sandbox. The already-running test DB is retained.
- Existing desktop browser journey: **PASS** for CT/MRI stack capture, CT
  coronal/sagittal/oblique/MIP capture, prior-study identity, enhanced multiframe
  MRI capture, failed-upload retry, saving/finalization and signed addenda.
  Reporting-triggered frame reloads are zero for both modalities.
- Existing responsive browser matrix: **PASS, 12/12** across 390x844, 844x390,
  375x667, 768x1024, 1024x768 and 1440x900 in Chromium and WebKit. This retains
  its toolbar, touch/mouse gesture, rotation/presentation, panel, report-editing,
  key-image retry and duplicate-request assertions.

The reliability matrix uses signed 256x256 CT with 512 source images (about 64 MiB
of source voxels), another CT series, two scanned Secondary Capture documents,
unsupported CDA and a supported PDF handler. It checks sagittal/coronal/axial
MPR, contrast inside the rendered image, finite camera/indices/overlays, actual
opacity/scalar texture uploads, document selection from MPR, return to the
original stack, subsequent CT selection, and injected mobile creation,
assignment and orientation failures. Uncaught page errors and active-context
GL errors fail the matrix.

The host Chromium software GPU has no `EXT_texture_norm16`; removing float-linear
support there also invalidates its separate scalar-image texture path. It cannot
model the stated working-stack iPhone scenario. Missing-extension volume
regressions therefore use WebKit, which supports norm16 and actually uploads CT
scalars as `SHORT`; Chromium covers the supported float path. Unit tests cover
both WebGL versions and extension combinations. No capability is faked as present.

An existing, separate **PDF rendering limitation** was found: OHIF's registered
PDF viewport uses `<object>`, blocked by the viewer's existing `object-src 'none'`
CSP. The matrix verifies that PDF selection still reaches that handler and
receives its blob URL, and that CT works afterward. It does **not** claim visible
PDF rendering passed. Security policy and the PDF component were left unchanged.
The synthetic PDF is supplied as inline DICOM metadata because the fixture
archive's absolute loopback BulkDataURI is unsuitable for the browser's authorized
gateway origin; this is a harness-only substitution, not a production retrieval
or authorization change.

Physical iPhone Safari is **NOT RUN**. Real-study memory exhaustion and real
hardware context loss remain unexcluded hypotheses. Exact-SHA CI is **NOT RUN**
for this uncommitted tree.

## Reproduction

Run serially against the existing migrated disposable `rispro_test` database.
Never supply a clinical archive URL or production DB to this harness.

```powershell
npm run agent:preflight
npm run db:test:up
npm run db:test:check
node --test docker/ohif/configure-cornerstone-compat.test.cjs docker/ohif/configure-viewport-reliability.test.cjs docker/ohif/configure-responsive.test.cjs docker/ohif/configure-viewer.test.cjs docker/ohif/configure-series-windowing.test.cjs docker/ohif/rispro-reporting/report-store.test.mjs
docker build -f docker/ohif/Dockerfile -t rispro-ohif:ios-reliability .
$env:OHIF_TEST_IMAGE='rispro-ohif:ios-reliability'
$env:OHIF_RESPONSIVE='1'
$env:OHIF_RELIABILITY='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
Remove-Item Env:OHIF_RELIABILITY
# Existing responsive checks:
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
Remove-Item Env:OHIF_RESPONSIVE
# Existing desktop native-reporting/MPR checks:
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

The harness prints its synthetic-only artifact directory and cleans its temporary
containers and DB rows/settings. Logs, baseline exception/black-image evidence,
source hashes and final results are retained locally under ignored
`test-results/ohif-ios-reliability/`. No shared Docker resources were pruned.
The copied `final-reliability/reliability-results.json` and
`final-responsive/responsive-results.json` contain the completed matrices;
`baseline-summary.json` and `exception-source-map.json` retain the defect evidence
and original-source comparison. Representative phone and desktop screenshots were
visually reviewed as well as checked for rendered image contrast.

## Physical Safari acceptance

On the affected real iPhone, verify the actual deployed bundle/version first.
Open the large CT, select an imaging series and change to sagittal, coronal and
axial. Confirm image detail and valid indices after each change, return to stack,
then select another CT series. Select both actual document series after MPR and
verify either their supported stack/document handler or a clear unsupported
notification; confirm CT still renders afterward. Repeat with the study's larger
series, rotate the device, and inspect Safari Web Inspector for shader/GL errors,
context loss and memory pressure. Verify the actual document SOP classes without
inferring them from series descriptions or warning badges.

## Rollback

Review `git diff` first. Because the task started clean, restoring only these five
tracked files reverts the implementation and harness integration:
`docker/ohif/Dockerfile`, `docker/ohif/configure-responsive.cjs`,
`docker/ohif/configure-responsive.test.cjs`,
`scripts/ohif-native-reporting-browser.mjs`, `scripts/ohif-responsive-browser.mjs`.
Remove only the four new compatibility/recovery patcher and test files and this
report. Do not reset unrelated work.

If later released with explicit authority, revert these source changes and
rebuild the previous viewer image through the approved release workflow. The
baseline local image was retained. No schema, clinical archive, saved report,
key image or persistent-volume rollback is required.
