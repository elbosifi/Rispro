# OHIF responsive viewer verification and DICOM series windowing

## Baseline and inspected implementation

The requested responsive implementation was already present in clean `main` at
`ce836ee287853f52885e09b6189b02167a6b8907`. `origin` was fetched and the ahead/behind
counts were `0/0`. This follow-up works on the explicitly requested local branch
`codex/ohif-ios-responsive-validation`. Changes remain uncommitted.

The [responsive implementation report](ohif-ios-responsive.md) describes the existing
build-time integration. It was inspected again against the actual pinned upstream
revision `2851f4349d586f475c279e34d2fdb1d0b56e2fc7` and the current Docker builder.
OHIF remains v3.12.6; Cornerstone core/tools remain 4.15.29.

Inspected source includes:

- The repository Dockerfile, configurators, reporting registration, app config,
  nginx config and browser-build verifier; reporting module, panel and CSS; and
  the synthetic reporting, responsive and rendering harnesses.
- Upstream `extensions/default/src/ViewerLayout/{index.tsx,ViewerHeader.tsx,ResizablePanelsHook.tsx}`,
  `Components/SidePanelWithServices.tsx`, `Toolbar/Toolbar.tsx` and
  `Panels/StudyBrowser/PanelStudyBrowser.tsx`.
- Upstream ui-next Header, SidePanel, StudyBrowser, Thumbnail and
  `components/Viewport/ViewportGrid.tsx`, plus app `components/ViewportGrid.tsx`.
- Upstream `OHIFCornerstoneViewport.tsx`, `CornerstoneViewportService.ts`,
  presentation stores, basic-mode tool groups and the installed Cornerstone
  StackViewport, StackScrollTool, ZoomTool and touch-tool selection API.

The desktop header absolutely positions the center toolbar; the existing compact
header avoids narrow-screen collisions by composing the original Toolbar with
filters. At 1280px and above the original Header renders unchanged. Phones use
Series, navigation, measurements, window/level and More; tablets additionally
expose zoom, pan and layout. More retains original commands and authorized RISpro
actions. Existing panels become drawers below 1024px; the landscape tablet study
sidebar stays available. Reporting overlays the image below 1280px.

The existing Cornerstone two-touch Zoom binding supports pinch and translation
inside one tool. One finger follows the selected primary tool. No new bindings or
gesture recognizer were needed. Mouse, keyboard and window-preset definitions are
unchanged. The existing viewport ResizeObserver and resize service retain the
viewport object and presentation through responsive changes.

Repeated rapid series-selection tests exposed one narrow touch issue: the
thumbnail loading placeholder could be replaced between touchend and the browser's
synthesized click. The trace recorded touchstart/end on that placeholder, its
subsequent removal, and no click. Keeping a stable decorative target alone did not
resolve all suppressed compatibility clicks. `responsive/thumbnailTouch.js` now
extends OHIF's existing thumbnail touch handler: a single stationary touch invokes
the original selection callback once; movement beyond 10px, multi-touch, cancellation
and embedded menu controls do not select. Only an accepted tap prevents the duplicate
compatibility click. A React ref retains this gesture state across thumbnail renders.
Native scrolling and desktop double-click/drag/drop stay in place. This is scoped to
the series list, where Cornerstone supplies no tap handler; diagnostic viewport
gestures remain entirely Cornerstone-owned. RISpro shared primitives were inspected;
this separate OHIF workspace continues using its existing ui-next components.

## Additional requested behavior

The user also requested that every opened series start with its DICOM window,
without automatic windowing. A synthetic series-revisit test reproduced the
previous behavior: edited series 2 reopened at range `25..954` rather than its
stored DICOM range `-30..869` (W900/L420). Initial series opening was already correct.
The cause was OHIF restoring the cached LUT presentation on revisiting that series.

`docker/ohif/configure-series-windowing.cjs` adds a guarded source patch to
`extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts`.
Before opening a different CT/MR stack, it takes the selected frame's first stored
DICOM WindowWidth/WindowCenter and VOI LUT function from Cornerstone metadata and
uses Cornerstone's existing range conversion. It replaces only the opening VOI
in a copied presentation; it does not mutate the stored presentation or inspect
pixels. Existing position, slice, invert, colormap and segmentation are preserved.
The patch is registered explicitly in the Dockerfile and configure-viewer entrypoint.
Unique anchors fail clearly on source drift or duplicate application.

Same-series updates, panel toggles and rotation retain the user's current VOI.
Full Dynamic and the existing presets remain explicit user actions. No automatic
pixel-range window command is added. MPR/volume setup is untouched.

For a series without usable DICOM VOI, there is no stored default to restore.
The patch leaves upstream display fallback unchanged, rather than inventing a
clinical window or preventing image rendering. PT and other non-CT/MR modalities
retain their existing behavior.

## Validation and evidence

Final synthetic CT responsive matrix: **12/12 PASS** on the final test image
`rispro-ohif:ios-responsive-window`, ID
`sha256:e235a7036d4780c1078897c87dfb91b41e3f09652fe1fbc67cfc69f204004bf4`.
Local artifacts are ignored under `test-results/`; no clinical data is used.

| Layout | Chromium | WebKit |
| --- | --- | --- |
| iPhone portrait 390x844 | PASS | PASS |
| iPhone landscape 844x390 | PASS | PASS |
| Small phone 375x667 | PASS | PASS |
| iPad portrait 768x1024 | PASS | PASS |
| iPad landscape 1024x768 | PASS | PASS |
| Desktop 1440x900 | PASS | PASS |

The checks verify first-image pixels; toolbar geometry and document overflow;
actual slice, zoom, pan and VOI changes; measurement activation; overflow reset
and maximizing; repeated series selection and stored DICOM defaults; reporting
text and pending-upload retention; native panels; unchanged viewport object,
series and non-default presentation after rotation; and no unexpected DICOM HTTP
failures, unhandled page exceptions or refetches from panels/rotation.

Additional completed checks:

- **22/22 PASS** focused responsive/source-patch, DICOM VOI and report-store tests.
- **13/13 PASS** existing runtime configuration, adapters, proxy authorization
  and viewer-session regressions.
- **PASS** final frontend typecheck and production build; OHIF Docker build and
  compiled ONNX/browser bootstrap verification. Existing build-size and
  Browserslist warnings remain.
- **PASS** agent contract, preflight, guarded disposable DB up/check and repository
  harness (existing report-only warnings). Sandbox subprocess restrictions were
  retried outside the sandbox with unchanged commands.

Focused MRI phone-portrait acceptance: **2/2 PASS** (Chromium and WebKit), including
distinct DICOM defaults and edited-series revisits. The existing desktop CT/MRI
native-reporting journey also **PASS**: annotated stack capture/retry, CT
coronal/sagittal/oblique/MIP capture, prior-source identity, enhanced multiframe MR,
saving, finalization, immutable signed reports and signed addenda. Reporting frame
reloads were **0** for both CT and MRI.

The ignored `test-results/ohif-responsive-current/index.html`
gallery packages 46 current CT screenshots, the JSON matrix, protected source
hashes and build/run logs, plus a subdirectory with focused MRI evidence. Primary
phone, tablet and desktop screenshots and representative reporting/overflow states
were visually inspected. The final native-reporting log is packaged there as
`native-reporting-regression.log`.

The responsive harness now uses distinct stored windows for its two synthetic
series and checks both initial opening and reopening after a real window/level
gesture. It also supports `OHIF_RESPONSIVE_MODALITY=MR` for focused MRI acceptance.
Dragging the series list is checked separately from tapping it, to ensure scrolling
cannot accidentally select the touched series.
The established non-responsive native-reporting fixture VOIs remain unchanged.

Reproduce serially with other disposable DB tests:

```powershell
npm run agent:preflight
npm run db:test:up
npm run db:test:check
node --test docker/ohif/configure-series-windowing.test.cjs docker/ohif/configure-responsive.test.cjs docker/ohif/configure-viewer.test.cjs docker/ohif/rispro-reporting/report-store.test.mjs
docker build -f docker/ohif/Dockerfile -t rispro-ohif:ios-responsive-window .
$env:OHIF_TEST_IMAGE='rispro-ohif:ios-responsive-window'
$env:OHIF_RESPONSIVE='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
# Focused MRI on both engines:
$env:OHIF_RESPONSIVE_CASE='phone-portrait'
$env:OHIF_RESPONSIVE_MODALITY='MR'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
Remove-Item Env:OHIF_RESPONSIVE_CASE,Env:OHIF_RESPONSIVE_MODALITY,Env:OHIF_RESPONSIVE
# Established desktop CT/MRI, capture, reporting and MPR regression:
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

The harness requires the already migrated disposable `rispro_test` database on
loopback port 5433. It checks that target before writing, restores its temporary
settings and synthetic rows, and removes only its own temporary containers.
Production services, PACS and real patient data are not used. Sandbox process
restrictions are retried outside the sandbox without dependency workarounds.

## Limits and preservation

Actual iPhone/iPad Safari, notches, dynamic browser bars, the physical on-screen
keyboard and physical gestures still require device acceptance. Chromium uses
native CDP touch sequences; Playwright WebKit uses DOM touch sequences through
Cornerstone listeners and checks actual viewport state. WebKit is not physical
Safari proof.

The built baseline and corrected builders have matching SHA-256 hashes for 16
protected files: tool groups, hotkeys, commands/presets, viewport component,
prefetch, image loader, initial diagnostic loading/cached-frame tracking, hanging
protocol, extension/dependency manifests, app config and reporting module/panel/
store/capture. Evidence is in `test-results/ohif-current-source-preservation.json`.
The viewport-service diff contains only the DICOM VOI selection described above;
its resize and request/loading paths are unchanged.

No DICOM rendering, decoding, transfer syntax, request concurrency, prefetch,
caching, DICOMweb security, launch authorization or saved-report logic changed.
No migration, version upgrade, production configuration change, commit, push,
merge or deployment occurred. Exact-commit CI has not run for this uncommitted work.

## Rollback

Review the diff, then restore only this follow-up's changes to
`docker/ohif/Dockerfile`, `docker/ohif/configure-viewer.cjs`,
`scripts/ohif-native-reporting-browser.mjs`, `scripts/ohif-responsive-browser.mjs`,
`docker/ohif/configure-responsive.cjs`, `docker/ohif/configure-responsive.test.cjs`
and the OHIF domain documentation. Remove only the new
`configure-series-windowing.cjs`, its test, `responsive/thumbnailTouch.js` and this report. This returns to
`ce836ee2`, retaining the responsive implementation already in that baseline.
Do not reset unrelated changes.

If later released with separate authorization, rebuild the previous source/image
through the approved deployment process. No database, image archive or saved
report rollback is required. The separate original responsive rollback remains
documented in the linked implementation report.
