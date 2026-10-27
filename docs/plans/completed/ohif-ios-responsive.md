# OHIF iPhone and iPad responsive viewer

## Scope and baseline

Local, uncommitted work on `codex/ohif-ios-responsive`, based on clean `main`
`5b24cd46b5ea767eeb288978000f2cbc7974a12b`. Origin was fetched and ahead/behind
was `0/0`. No production services, patient data, PACS, migrations, dependency
upgrades, commits, pushes or deployments are part of this task.

The actual `v3.12.6` source was cloned and matched the cached Docker builder at
`2851f4349d586f475c279e34d2fdb1d0b56e2fc7`. An older temporary inspection copy
had a different revision and was not used as the patch baseline. Cornerstone
core/tools remain `4.15.29`.

## Inspected assembly and cause

- `extensions/default/src/ViewerLayout/index.tsx` mounts `ViewerHeader`, the
  original resizable left/right `SidePanelWithServices` components and one stable
  `ViewportGridComp`. Its workspace has a desktop `100vh - 52px` height.
- `ViewerLayout/ViewerHeader.tsx` supplies the primary and secondary `Toolbar`,
  NCCB white-label logo, patient information, undo/redo and settings to `Header`.
- `platform/ui-next/src/components/Header/Header.tsx` absolutely positions the
  center toolbar independently of the logo and right controls. This causes
  collisions when the screen becomes narrow.
- `extensions/default/src/Toolbar/Toolbar.tsx` and core `useToolbar.tsx` resolve
  components, evaluators and commands through `toolbarService`. The basic mode's
  `toolbarSections` supplies primary actions, `MeasurementTools` and `MoreTools`.
  `StackScroll` is already registered in `MoreTools`.
- `SidePanelWithServices` and `ViewerLayout/ResizablePanelsHook.tsx` own panel
  selection, reopening, collapse APIs and pixel widths. `SidePanel` mounts its
  selected content only while open. RISpro's external report store intentionally
  survives that existing unmount behavior.
- `Panels/StudyBrowser/PanelStudyBrowser.tsx` supplies the existing thumbnail
  double-click selection callback. The measurement-tracking browser delegates
  to it. `Thumbnail` also has a touchend shortcut, which cannot distinguish a
  tap from scrolling and would duplicate the new native click selection.
- `platform/app/src/components/ViewportGrid.tsx`, ui-next `ViewportGrid.tsx` and
  `extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx` keep viewport
  identities stable. The latter already observes real element dimension changes
  and calls `cornerstoneViewportService.resize()`. That service preserves the
  presentation while resizing. No replacement resize/render loop is needed.
- `modes/basic/src/initToolGroups.ts`, RISpro's `configureUsability()` and the
  installed Cornerstone tools source were inspected. Cornerstone's
  `getActiveToolForTouchEvent` maps one finger to the current primary mouse tool.
  `StackScrollTool.touchDragCallback` supports stack navigation. `ZoomTool`'s
  existing two-touch binding has `pinchToZoom: true` and `pan: true`, combining
  pinch and translation in a single tool without conflicting pan bindings.
- The existing Dockerfile, registration/customization scripts, app config,
  nginx config, browser-build verifier, reporting module/panel/CSS/store and
  synthetic native-reporting/performance/rendering harnesses were inspected.

## Implementation

`configure-responsive.cjs` applies exact, unique source anchors and fails clearly
if the pinned integration changes. `configure-viewer.cjs` invokes it after the
existing usability/loading customizations. Docker explicitly copies the new
patcher and the three files in `docker/ohif/responsive/`.

The patched upstream files are `extensions/default/src/ViewerLayout/index.tsx`,
`ViewerLayout/ViewerHeader.tsx`, `Toolbar/Toolbar.tsx`,
`Panels/StudyBrowser/PanelStudyBrowser.tsx`,
`platform/ui-next/src/components/Thumbnail/Thumbnail.tsx` and
`platform/app/public/html-templates/index.html`. New presentation code is copied
to `extensions/default/src/RisproResponsive/{ResponsiveHeader.tsx,useResponsivePanels.ts,responsive.css}`.
The RISpro reporting extension's `src/index.tsx` has the narrow drawer-opening
adjustment described below. Its panel, report store and capture implementation
are preserved.

At widths **1280px and above**, `ResponsiveHeader` renders OHIF's original
`Header` with its original children and props. Responsive CSS is inactive.
Desktop mouse and keyboard bindings are unchanged.

Below **1280px**, the header uses two compact rows: bounded NCCB branding,
patient information, the authorized Report action and settings; then Series,
stack navigation, essential diagnostic tools and More. Phone widths below
768px, and narrow landscape screens below 1024px with height at most 500px,
prioritize stack navigation, measurements and window/level. Tablets additionally
show zoom, pan and layout selection. More contains the remaining original tools,
Add Key Image when registered, undo/redo, secondary actions, native panel access
and Maximize image/Show header. No commands, tool definitions or authorization
evaluators are duplicated. OHIF's own icon-presentation provider is retained.

Below **1024px**, both existing panels become overlay drawers and start closed.
Crossing into this width closes them once; browser-bar movement does not close
them. At landscape-tablet widths, the study sidebar retains its normal behavior;
the right panel overlays the image rather than shrinking it. Opening reporting
or a native right panel closes the left drawer on narrow screens. Closing panels
uses their original controls, state and collapse APIs.

On coarse-pointer devices, a native single thumbnail click invokes the existing
series-selection callback. The old touchend shortcut is bypassed on those devices
so scrolling a browser list does not select a series and a tap does not select
twice. Desktop double-click and drag-and-drop remain unchanged. Successful
narrow-screen selection closes the drawer; failure leaves it accessible.

Controls have minimum 44px touch targets. Nested menus scroll within their
available screen height. Compact tooltips cannot intercept another control.
Only diagnostic viewport elements receive `touch-action: none`; report fields
and other forms retain ordinary touch behavior. No gesture recognizer or new
tool binding was added. Measurements and window/level still activate explicitly
through existing OHIF commands; the existing selected primary tool handles one
finger, and the existing Zoom tool handles two fingers.

The layout uses dynamic viewport sizing and safe-area padding. A coalesced
`visualViewport` listener also accounts for the iOS keyboard at scale 1 without
interfering with browser zoom. OHIF's original ResizeObserver and rendering
engine perform real viewport resizes. Ordinary responsive changes do not replace
the grid or viewport components. Maximizing hides the compact context row; it
uses the available browser area and does not depend on iPhone Fullscreen API
support.

Report layout changes are scoped CSS: scrollable panel content, non-shrinking
form sections, 16px fields and a non-sticky identity block on compact screens.
`ReportPanel.tsx`, `report-store.js`, capture code, autosave, signing dialogs and
saved-report behavior are unchanged. The reporting module's only change is to
close the left drawer when opening reporting on narrow screens. The separate OHIF
build uses its existing ui-next primitives; RISpro frontend shared components
were inspected but cannot be imported into this separate upstream workspace.

## Validation

Status: local implementation, functional validation and screenshot review
complete. Physical Safari acceptance and future exact-commit CI remain unverified.

Completed:

- Responsive matrix: **12/12 PASS**, including all six configurations in both
  Chromium and WebKit. State checks verify actual scrolling, zoom, pan and VOI;
  measurement activation; overflow reset/maximizing; series and reporting
  selection; native panel access; unsaved text and pending-upload retention;
  zero unexpected DICOM HTTP failures or unhandled page exceptions; stable image
  grid width when reporting overlays open; and no refetches of existing DICOM
  responses during panel changes or rotation. The same viewport object survives
  rotation with its selected image and non-default presentation intact.
- Existing native-reporting Chromium browser journey: **PASS** for CT and MRI,
  annotated stack captures and upload retry, CT coronal/sagittal/oblique/MIP
  capture, prior-source identity, enhanced multiframe MRI, saving, finalization,
  immutable signed reports and signed addenda. Reporting-triggered frame reloads
  were **0** for both CT and MRI. This suite uses the unchanged desktop header at
  1600px and also captures its existing 1024px resize checkpoint.

- Focused source-patch, loading/windowing and report-store tests: **19/19 PASS**.
- Existing OHIF runtime config, adapter, proxy authorization and viewer-session
  tests: **13/13 PASS**.
- Repository agent contract, preflight and harness: **PASS** (existing report-only
  harness warnings). Docker is available; guarded disposable DB up/check passed.
- Frontend typecheck and production build after the final viewer application
  edits: **PASS**. Sandbox Vite/Node/Docker restrictions were rerun unchanged
  outside the sandbox. No dependency workaround was applied.
- Repository OHIF Docker build and compiled ONNX/browser bootstrap verification:
  **PASS**, with existing upstream build-size/Browserslist warnings.
- Actual pinned-source comparison: responsive integration preserves ten protected
  source files byte-for-byte: tool groups, hotkeys, Cornerstone commands, viewport
  component, resize service, prefetch, image loader, RISpro loading/progress,
  hanging protocols and Cornerstone dependency manifest. Hash evidence is kept in
  ignored local `test-results/ohif-responsive-preservation.json`.

The tested local image is `rispro-ohif:ios-responsive`, ID
`sha256:96ca87db44f249d62a76100b67de3b34f768185e67c2ec2b4f889cd767b273c9`.
The ignored `test-results/ohif-responsive/index.html` gallery packages 46
synthetic screenshots: primary layouts, series browsers, reporting and compact
overflow menus in both engines. The same directory contains the JSON matrix,
protected source hashes, OHIF build log and existing native-reporting run log.

| Viewport | Chromium | WebKit |
| --- | --- | --- |
| iPhone portrait 390x844 | PASS | PASS |
| iPhone landscape 844x390 | PASS | PASS |
| Small phone 375x667 | PASS | PASS |
| iPad portrait 768x1024 | PASS | PASS |
| iPad landscape 1024x768 | PASS | PASS |
| Desktop 1440x900 | PASS | PASS |

The responsive harness reuses the existing synthetic CT/MRI fixture setup, real
RISpro launch security, guarded `rispro_test` DB and isolated loopback Orthanc/OHIF
containers. Its matrix uses synthetic CT, six viewport configurations and fresh
Chromium/WebKit device contexts: 390x844, 844x390, 375x667, 768x1024, 1024x768 and
1440x900. Mobile profiles enable touch and device pixel ratios, not just width
changes. It checks rendered pixel variation and actual slice index, zoom, pan and
VOI; original measurement activation; toolbar bounds; overflow execution; study
and reporting drawers; non-default presentation retention; viewport identity;
report text and pending-upload retention; and duplicate DICOM requests.

Chromium uses native CDP multi-touch injection. Playwright does not expose a
WebKit multi-touch injection API; WebKit gesture checks dispatch DOM touch
sequences through Cornerstone's actual event listeners and inspect resulting
viewport state. These are synthetic tests, not physical Safari gesture proof.

Reproduction (PowerShell, run serially with other DB tests):

```powershell
npm run agent:preflight
npm run db:test:up
npm run db:test:check
node --test docker/ohif/configure-responsive.test.cjs docker/ohif/configure-viewer.test.cjs docker/ohif/rispro-reporting/report-store.test.mjs
docker build -f docker/ohif/Dockerfile -t rispro-ohif:ios-responsive .
$env:OHIF_TEST_IMAGE='rispro-ohif:ios-responsive'
$env:OHIF_RESPONSIVE='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
# Existing desktop CT/MRI/reporting/MPR regression:
Remove-Item Env:OHIF_RESPONSIVE
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

The existing harness requires a migrated disposable DB and cached/pulled
`orthancteam/orthanc:26.4.0` and `nginx:1.27.5-alpine` images. It restores settings,
removes its synthetic rows/temporary containers and preserves an already-running
test PostgreSQL container. Its printed artifact directory contains synthetic-only
screenshots and diagnostics. If sandbox restrictions prevent execution, rerun the
unchanged command outside the sandbox. Do not use production connection settings.

## Limits and manual acceptance

Actual iPhone/iPad Safari, physical gestures, notches, browser bars and the real
on-screen keyboard remain unverified. Playwright WebKit does not replace that
acceptance. A physical-device pass should rotate during a non-default image
presentation, open/close series and reporting, edit with the keyboard visible,
check safe areas, and retry a pending synthetic key image. Browser zoom is enabled;
diagnostic touch suppression remains limited to image elements. The desktop
header breakpoint is 1280px; narrower desktop windows intentionally use the compact
presentation while retaining their original mouse/keyboard bindings.

No performance optimization or claim about clinical image-loading speed is made.
No DICOM rendering, request concurrency, transfer syntax, decoder, authorization,
launch-session, first-image readiness, cached-frame monitoring, prefetch, caching,
window presets, hanging protocols or MPR logic was changed. CI for an uncommitted
tree has not run. No merge/deployment approval is implied.

## Rollback

Before commit, review `git diff` and restore only this task's modified files:
`docker/ohif/Dockerfile`, `docker/ohif/configure-viewer.cjs`,
`docker/ohif/rispro-reporting/src/index.tsx`,
`scripts/ohif-native-reporting-browser.mjs` and the OHIF domain documentation.
Remove only this task's new `configure-responsive.cjs`,
`configure-responsive.test.cjs`, `docker/ohif/responsive/`,
`scripts/ohif-responsive-browser.mjs` and this report. Do not reset unrelated work.

If later released with explicit authority, revert those source changes and rebuild
the previous viewer image through the approved deployment workflow. No schema,
archive-data, saved-report or storage rollback is necessary. Temporary test images
and ignored screenshots can be retained for review; do not prune shared Docker
resources.
