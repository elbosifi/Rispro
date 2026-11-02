# OHIF authentication and rendering reliability

This local patch targets OHIF 3.12.6, Cornerstone3D 4.15.29 and VTK.js 34.15.1. The build rejects different Cornerstone/VTK versions. No dependency upgrade, migration, loading-profile change, production context-count change or deployment is included.

## Authentication

The previous controlled form submitted React state, which can differ from password-manager-populated DOM values. It also cleared the password before the login response. The form now submits native FormData, retains rejected credentials for correction, and clears the password after successful authentication or viewer-user validation.

Login, cookie round-trip and context renewal are separate stages. The client verifies the HttpOnly session cookie through authenticated refresh; it never reads or logs cookie contents. The backend distinguishes credential rejection, owner mismatch, revoked contexts, expired recovery windows and contexts without migration-242 snapshots. Rate limits use HTTP 429. Same-origin errors remain terminal to the affected operation.

A missing/retired UUID is terminal instead of repeatedly requesting the correct credentials. An authenticated existence check distinguishes it from another owner's UUID without returning that owner's session data. After a verified login-cookie round-trip, other tabs are notified even if this tab's subsequent context renewal fails; each tab still performs its own live authorization and revoked tabs remain terminal. Optional cross-tab messaging failures do not fail a valid local sign-in. Explicit logout retains its terminal reason even when an earlier request completes afterward.

Logout continues to revoke **all viewer contexts for the user**, including independent browser sessions. This existing policy is unchanged. A revoked UUID cannot renew or authorize images/reports. Ordinary RISpro login remains independent of that UUID. The old tab offers **Reopen study**, opening RISpro in a separate tab for a normal login, case selection, live authorization and a new context. **Review unsaved work** exposes the retained local work. There is no automatic navigation, reload or transfer of patient data between tabs.

## Rendering

Confirmed source defects include unconditional canvas dimension assignment during resize (which clears even an unchanged canvas), invalid-size viewports entering resize, a null VTK shader program reaching shader parameter calls, and incomplete cleanup of local actors after failed or superseded asynchronous multi-volume setup.

Browser regression also exposed a delayed stack scroll against a destroyed viewport. The pinned element-disabled listener is a plain function using the event target as `this`, so it does not reliably clear the viewport's timer. Renderer teardown now cancels that timer directly and invalidates pending selection/data work before disabling the old instance.

The dynamic-volume context-loss test additionally exposed cache-owned VTK texture handles surviving their original context. VTK 34.15.1 only clears those handles when its release API receives a render window. Recovery releases affected volume textures against the old window before destruction, invalidates their upload state, and re-uploads cached decoded frames. Dimension-group selection and its UI event are restored explicitly; no volume/image cache purge or transport retry is used.

The patch coalesces service resize work, skips disconnected/invalid-size viewports, avoids redundant dimension assignments and removes the second renderer resize. The existing camera/presentation restoration remains in place. Null shader compilation/binding now stops the render with a classified failure; the failed viewport is not marked rendered.

One page controller handles a shared rendering engine failure. It waits for context restoration where applicable and permits one automatic resource rebuild per episode, with a five-second cooldown. Manual retry is explicit. Recovery invalidates old continuations, snapshots selections and presentation, uses Cornerstone destroy/create/setViewports/setStack/setVolumes, and checks actual canvas pixels. It never invokes OHIF service.destroy(), purges the image cache, retries authentication, recreates the report store or signs a report.

The explicit 2D fallback is restricted to a single conventional CT/MR viewport in its acquisition plane, with a cached, non-dynamic volume, single-frame source objects and a verified current image in the original ordered imageIds. Dynamic/enhanced or ambiguous phase mappings are refused. No pixel conversion or quality reduction is performed. MPR layouts require explicit layout/series selection before this conservative fallback is available.

Diagnostics are bounded, in memory, and available with `window.risproRenderingDiagnostics()`. They contain failure class, CPU mode, pool count, dimensions, frame/actor/volume counts, cache bytes, estimated volume bytes, dimension-group numbers and original shader compiler/linker errors when available. They contain no image bytes, clinical text, patient identifiers or DICOM UIDs. Estimated volume bytes are not a measurement of GPU-process memory.

The Intel GPU exhaustion hypothesis is consistent with [OHIF #6190](https://github.com/OHIF/Viewers/issues/6190) and [#6010](https://github.com/OHIF/Viewers/issues/6010), but is not proven for this workstation. The original missing-pool trigger also remains unconfirmed: GPU operations require the pool established by GPU engine construction. Missing pool, rendering-mode mismatch and destroyed-engine operations are classified before pool access; no incomplete pool is fabricated. [#5653](https://github.com/OHIF/Viewers/issues/5653) documents related resize behavior. The shader guards are narrowly adapted from [VTK 36.1.0](https://github.com/Kitware/vtk-js/blob/v36.1.0/Sources/Rendering/OpenGL/VolumeMapper/index.js).

## Local validation commands

Run DB and browser journeys serially: they temporarily configure the disposable test DB and restore its settings. Never run against production.

```powershell
npm run agent:preflight
npm run db:test:up
npm run db:test:check
npm run test:db:one -- src/modules/reporting/workspace.integration.test.ts
node --test docker/ohif/configure-viewer.test.cjs docker/ohif/rispro-reporting/connection.test.mjs docker/ohif/rispro-reporting/image-recovery.test.mjs docker/ohif/rispro-reporting/report-store.test.mjs
npm run typecheck
npm run typecheck:frontend
npm run build:frontend
docker build -f docker/ohif/Dockerfile -t rispro-ohif:reliability-final .
$env:OHIF_TEST_IMAGE='rispro-ohif:reliability-final'
$env:OHIF_RENDER_RECOVERY='1'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

Clear that scenario flag before using `OHIF_STARTUP_SELECTION_ACCEPTANCE=1`, `OHIF_RESILIENCE_ACCEPTANCE=1`, `OHIF_RENDER_STRESS=1`, or `OHIF_LOADING_PROFILE_BENCHMARK=dynamic-mri`. Run Express and Native transports separately; Native uses only the disposable archive and a synthetic auth secret. Browser output identifies its artifact directory. A successful build or suppressed exception is not evidence of diagnostic pixels or Intel GPU stability.

`OHIF_AUTH_STAGE_ONLY=1` with resilience acceptance runs only authentication-stage and tab-isolation checks; omit it for the full two-minute outage journey. Native delivery requires a synthetic secret of 64 lowercase hexadecimal characters. Never reuse a production secret.

For the isolated pool-count comparison, build a separate experimental image. Upstream initialization resets a runtime override, and inherited Webpack caches treat installed dependencies as immutable; the experimental Dockerfile patches the pinned default in source and rebuilds without that cache. The browser asserts both configuration and actual engine count. The production Dockerfile/default remains seven.

```powershell
docker build --target builder -f docker/ohif/Dockerfile -t rispro-ohif:reliability-context-builder .
docker build -f docker/ohif/Dockerfile.context-pool-experiment -t rispro-ohif:reliability-context-two .
$env:OHIF_TEST_IMAGE='rispro-ohif:reliability-context-two'
$env:OHIF_RENDER_STRESS='1'
$env:OHIF_TEST_CONTEXT_COUNT='2'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

## Local results

All evidence below uses disposable/synthetic data. CI and the affected Intel workstation remain unrun. Shader failure is injected at the browser engine's VTK boundary; unit tests execute the pinned null-program compilation/binding guards directly. It is not a reproduction of Intel's original compiler/GPU-process crash.

| Check | Result |
| --- | --- |
| Focused Node renderer, connection, reporting, dynamic MRI and transport tests | PASS: 124 |
| Reporting/dictation React component tests | PASS: 17 |
| Workspace DB integration, including login/logout/recovery and retired contexts | PASS: 36 |
| Backend typecheck; frontend typecheck and production build | PASS |
| Agent contract and repository harnesses | PASS; existing report-only warnings |
| Pinned OHIF production build | PASS: `rispro-ohif:reliability-final` |
| Express and Native CT/MR session/network recovery | PASS, including autofill without change events, manual entry, original/wrong user, cookie-backed renewal, tab isolation and logout revocation |
| Final-image Express and Native authentication stages | PASS: successful login followed by renewal failure is identified separately; old logout reason, new-tab reentry and dirty text are retained |
| Deliberate two-minute outage | PASS: four failed image attempts, seven probes; recovered without an online event and retained dirty text |
| Ordinary/progressive startup selection | PASS: 12 scenarios, including delayed/failed first image and rapid A/B/C |
| CT/MR renderer acceptance | PASS: context loss/restoration, missing pool, shader failure, one failed automatic attempt, explicit safe stack fallback, zero dimensions, four-up/panel resize, orphan actor cleanup and stale scroll cancellation |
| Renderer state/transport isolation | PASS: cached image identity, annotations and unsaved findings retained; zero retained-image downloads and zero auth renewals |
| Native dynamic MRI browser regression | PASS: 35 checks, including selected phase and echo 2 through context restoration, exact synthetic pixels and refusal to flatten echo/phase data |

The unrelated DB failure was a fixture granting only `MR` while the seeded modality was `MRI`. The fixture now grants either supported alias and asserts a permission row exists. Production authorization was not weakened. The dynamic missing-phase fixture now uses permanent HTTP 404; a connection abort correctly enters sustained transport recovery and does not represent a permanently missing frame.

### Context-count comparison

Chromium 149.0.7827.55 used ANGLE/Vulkan **SwiftShader**, not the affected Intel driver. Each run used two 512×512×800 conventional MR series (400 MiB of source samples each), four reading sessions, 24 series changes, 12 MPR activations, MIP, explicit priors, key-image captures and teardown checks. Pool counts were asserted against both configuration and actual engines.

| Pool count | Result | Observed WebGL contexts, including probe | Median series switch | Decoded cache at final snapshots |
| --- | --- | --- | --- | --- |
| 7 | PASS: four sessions | 8 | 174 ms | 800.5–804 MiB |
| 2, experimental image only | PASS: four sessions | 3 | 183 ms | 800.5–804 MiB |

GPU-process memory was not measured. This small software-rendered comparison does not establish an Intel memory threshold, a performance winner or a reason to change production's seven-context default. The 2-context image is an experiment, not a deployment candidate. Two runs that overlapped shared disposable settings were excluded from final evidence and rerun serially.

## Intel UHD workstation procedure (manual, not yet executed)

Target reported by the user: Windows 11, Edge 156, Intel UHD device `0x4628`, driver `32.0.101.5972`, hardware WebGL enabled. These are reported observations, not locally verified hardware evidence.

1. Record Windows/Edge versions, Intel device ID and driver, `edge://gpu` renderer and reset/crash entries, monitor count/resolution and whether the session is local or MeshCentral. Keep this separate from software-rendered synthetic browser results.
2. Use approved test studies containing conventional CT/MR and the affected large mDixon acquisitions. Record dimensions, source frame count, phase/echo count and approximate volume bytes, without patient identifiers or full UIDs. Keep unsaved test findings, a caption, a pending capture and a measurement in the tab.
3. From a fresh authorized launch, select A then B then C before the first diagnostic image, and repeat ordinary/progressive initialization. Confirm the final selected series and diagnostic pixels. Repeat large-volume A/B switching ten times; verify both echo positions and every phase using known reference images.
4. Repeat single-stack, four-up and MPR layouts. Drag each panel boundary back and forth twenty times, resize/maximize/restore the browser ten times, temporarily hide/show the viewer and scroll to known slices. Check camera, window/level, slice, annotations and report state. Verify image detail visually, not only responsive scrolling or a rendered-status label.
5. Capture bounded rendering diagnostics immediately on the **first** failure and the original compiler error/context-loss order. Record whether every context was lost, whether restoration occurred, automatic attempt count and whether manual retry restored pixels without re-downloading cached frames. Do not export console output containing patient data.
6. Test a single conventional volume's explicit 2D fallback after a failed retry. Confirm the same source image and ordering. Verify dynamic/ambiguous phase datasets cannot silently flatten. If the GPU cannot recover, retain the old tab and unsaved work; reopen explicitly in a new tab.
7. Repeat study opening/MPR use/tab closure at least five times while recording Edge GPU-process memory before/after each cycle and after idle. Compare baseline and patched viewer using identical datasets, layouts and monitor configuration.
8. If the workstation administrator supports an isolated software-rendering diagnostic session, use a separate disposable Edge profile/process with ANGLE D3D11 WARP; verify the reported renderer in `edge://gpu` before comparison. Use [OHIF #3207](https://github.com/OHIF/Viewers/issues/3207) as diagnostic context. Do not change the normal profile, drivers, browser flags or persistent workstation settings automatically. Record slower performance separately; software success does not prove hardware stability.
9. Test normal expiry, manual login, password-manager autofill, wrong credentials, logout/login and fresh launch. Confirm the old revoked context stays denied, unsaved work remains in the old tab, and case-access removal remains terminal.

## Rollback

Before deployment, review or discard only this task's local diff and new files. After an explicitly authorized future deployment, rollback means rebuilding the prior reviewed source/image; no database rollback is required. Migration 242 remains required for recoverable contexts and is not changed. Pre-242 viewer tabs must reopen through normal authorization.
