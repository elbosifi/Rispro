# Execution Plan: Teaching Anatomy multi-atlas module

## Problem

Teaching Anatomy currently has one SPL Liver Atlas route, one CT-only manifest and renderer, one manifest-whitelisted asset directory, and a liver-only deployment provisioner. The goal is a Teaching-owned catalog and reusable radiology atlas engine that can safely expose independently validated regional datasets and a whole-body 3D navigator.

## Scope

- Generalize the file-based atlas catalog, V1/V2 manifest validation, authenticated Teaching asset routes, and atlas-specific availability.
- Preserve `/teaching/anatomy/liver` while adding `/teaching/anatomy/atlas/:atlasId` and data-driven region, organ, system, search, and source/license views.
- Refactor the current CT stack and Three.js liver view into reusable modality-neutral cross-section, structure-browser, and anatomy viewers; keep geometry-based plane synchronization and selected overlay behavior.
- Independently inspect official upstream archives, record locked source versions, hashes, byte sizes, licensing, attribution, and spatial validation, and normalize only datasets that pass those checks.
- Generalize secure setup/update provisioning so one optional atlas failure never prevents RISpro deployment; keep all data under the existing storage volume.
- Add focused backend/frontend/provisioner tests, supported browser journeys, domain documentation, and a task report.
- Do not add a database migration or change any clinical or non-Anatomy workflow.

## Files Likely to Touch

- `src/modules/teaching/anatomy/`
- `src/modules/teaching/api/teaching-routes.ts`
- `src/modules/teaching/tests/anatomy-atlas.test.ts`
- `frontend/src/teaching/anatomy/`
- `frontend/src/teaching/api/teaching-api.ts`
- `frontend/src/teaching/pages/teaching-anatomy-index-page.tsx`
- `frontend/src/teaching/pages/teaching-liver-anatomy-page.tsx`
- `frontend/src/teaching/teaching-application.tsx`
- `frontend/src/teaching/tests/teaching-anatomy-pages.test.tsx`
- `e2e/specs/teaching-anatomy.spec.ts`
- `scripts/teaching-anatomy/`
- `scripts/docker-deployment-lib.sh`, `scripts/setup-docker.sh`, `scripts/update-docker.sh`, `Dockerfile`
- `docs/teaching-anatomy.md`, `docs/domains/teaching/README.md`, and this plan

## Explicit Non-Goals

- No changes to clinical workflows, patient data, clinical DICOM, PACS, OHIF, Orthanc, appointments, reporting, or Q-bank behavior.
- No database schema changes, deployment, push, or commit.
- No unverified anatomical links between different source coordinate spaces.
- No source asset is marked ready until image/segmentation/mesh geometry and structure mapping have been validated.
- No licensing terms are inferred from a mirror when the official source provides different terms.

## Acceptance Criteria

- Existing Liver route and Segment VIII behavior continue to work through the generic engine.
- One authenticated atlas catalog drives all browse/search indexes and lists readiness, provenance, attribution, license, and modality.
- Generic manifest validation reads installed V1 liver data and supports V2 CT/MRI datasets with safe atlas IDs and manifest-declared assets.
- Generic atlas route loads only that atlas; browser resources are disposed on navigation.
- Cross-section display uses dataset-specific modality configuration and physical volume transforms; 3D plane follows the active native/MPR plane where supported.
- Setup/update provisioning is noninteractive, pinned, HTTPS-only, checksum-verified, staged, atomic, idempotent, observable, isolated per atlas, and stored in existing persistent storage.
- Official source packages are either independently converted and spatially validated or clearly marked unavailable/pending with an evidence-backed reason.
- Sources/licenses are visible in Teaching Anatomy, and every imported atlas includes machine-readable provenance and preserved notices.
- Focused tests, applicable quality gates, supported Chromium journeys, and visual checks are run and reported accurately.

## Validation Commands

- `npm run agent:contract`
- `npm run agent:preflight`
- Focused Teaching Anatomy frontend/backend/provisioner tests and supported Chromium E2E journeys
- `npm run typecheck`, `npm run typecheck:frontend`, `npm run build:frontend`, `npm run lint:frontend`
- `npm run harness:structure`, `npm run harness:all`, and `bash scripts/validate-docker-modes.sh`
- `git diff --check`

## Rollback Considerations

Atlas assets stay in the existing `/app/storage` volume, each atlas activates independently, and failed upgrades retain the previous valid atlas. Code remains uncommitted on local `main` for review. Reverting the code does not delete provisioned storage; runtime routes must ignore undeclared/unavailable catalog entries.

## Execution Notes

- Initial repository state was clean local `main`, fetched and aligned with `origin/main`. The work is left uncommitted; no push, deployment, database migration, or clinical workflow change was made.
- The Castle Mountain Mulrecon Color source ZIP was inspected (SHA-256 `A2DF22A32843639A7F767E1B200B6092469635B5F6D970B1542AFBE70C607F4E`). It contains a monolithic viewer and bundled dependencies but no license or redistribution notice. Its viewer and loader were not reused; RISpro keeps its existing Three.js anatomy renderer.
- Open Anatomy regional archives carry the 3D Slicer Part B license. It grants royalty-free, nonexclusive use, reproduction, modification, display, and distribution (including proprietary-program integration), requires the full terms and applicable source notices to accompany copies, requires modified versions to be identified, and describes the source as research-purpose material with clinical use neither recommended nor advised. Open Anatomy describes its project as both research and educational and identifies teaching use cases. RISpro exposes these packages only in Teaching as nonclinical educational references and preserves the license and attribution notices.
- Fully acquired and pinned Open Anatomy archives are abdomen CT (34,861,066 bytes; 94 source surfaces checked; 105 hierarchy entries), head/neck CT (31,612,667 bytes; 59 surfaces; 67 entries), and knee MRI (80,934,412 bytes; 48 surfaces; 59 entries). The knee label map was nearest-neighbor resampled from its declared LPS affine to the MRI grid; every label was preserved and all 48 meshes passed the image-space checks. Package sizes and SHA-256 pins are in `scripts/teaching-anatomy/open-atlas-sources.lock.json`.
- BodyParts3D 4.0 PART-OF is pinned at 64,888,505 bytes and licensed CC BY 4.0. Its official names and hierarchy metadata map all 1,258 OBJ files; the manifest contains 2,072 searchable structures. Required attribution is preserved verbatim in the manifest, source catalog, installed notice, and documentation. The source identifies this as an adult-male model, kept at its published coordinates and separate from regional CT/MRI.
- Brain and inner-ear archive downloads ended incomplete after repeated transport retries; the listed thorax package returned HTTP 404; PROSTATEx has not passed acquisition and spatial validation. These sources remain pending and are not served as available data. The 3D Slicer license includes a broad research-purpose and no-clinical-use notice, which is shown with attribution in the source/license page.
- Implementation keeps the current RISpro Three.js renderer and generalizes its manifests, authenticated asset routes, CT/MRI axial-coronal-sagittal reslicing, hierarchy/search, provenance UI, and optional pinned provisioning. Large hierarchies start collapsed and large meshes load only on selection. All atlas binaries remain outside the repository in persistent runtime storage.
- Validation passed: `npm run agent:contract`; `npm run agent:preflight` (`DOCKER_OK`); backend `npm run typecheck`; focused backend anatomy tests (7/7); focused frontend anatomy tests (12/12); focused provisioning/VTK tests (12/12); frontend typecheck and production build; frontend lint; both Teaching Anatomy Chromium journeys (2/2), including 390px mobile overflow check; `npm run harness:structure`; `npm run harness:all`; all five Docker compose modes via `bash scripts/validate-docker-modes.sh`; Docker deployment and database-backup regression scripts via installed Git Bash; and `git diff --check`. The disposable E2E database was stopped after browser validation.
- The frontend build passed with Vite's report-only large-chunk warning. Frontend lint passed with eight existing warnings in unrelated files; repository harnesses retained report-only baseline warnings. The `npm run test:docker:deployment` wrapper could not start because WSL Bash is absent, while its two underlying regression scripts passed via installed Git Bash. No test result is claimed from the earlier in-sandbox `spawn EPERM` attempt; the unchanged provisioning suite passed outside the sandbox (12/12).
