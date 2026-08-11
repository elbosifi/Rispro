# Modernization Baseline

Baseline SHA: `3d782b3fffcce1cfe4477516ad25bf0f5e448341`

This snapshot records structural debt for the behavior-preserving modernization effort. Existing findings remain report-only unless a pass explicitly removes them; unrelated warnings must not become blanket CI failures.

## Starting Inventory

- 40 TypeScript/TSX files at or above 1,000 lines.
- Largest production files: Settings page (5,539), DICOM remap service (5,128), frontend API hooks (4,094), translations (4,088), Reporting Board page/repository/service, and PACS remap page.
- 23 legacy route filenames and 56 service-directory filenames outside current naming conventions.
- 15 files with likely `any` usage, 42 production files with console calls requiring review, and one TODO/FIXME/HACK marker.
- One tracked unreferenced backup file.
- Proven unused frontend packages: `@dnd-kit/sortable`, `@dnd-kit/utilities`, and `purgecss`; `@dnd-kit/core` remains active.
- Backend strict-unused checking reports existing unused imports, parameters, types, and private helpers; standard backend and frontend typechecks pass.

## Protected Compatibility Paths

- Legacy scheduling and appointment runtime behavior remains frozen but available.
- Legacy Access Viewer, backup v2, embedded MWL, and diagnostic SonicDICOM modes remain available.
- `@/lib/i18n` and `@/lib/api-hooks` remain stable facades.
- Existing route aggregator allowlist entries remain valid.
- Active OHIF integration files are outside this modernization effort.

## Parity Evidence Required Before High-Risk Extraction

### Reporting Board

- Appointment-backed and comparison-request rows retain distinct domain semantics.
- Desktop, mobile saved view, and print filters use the same documented contract.
- Assignment, bulk assignment, unassignment, saved-view, notification, and permission behavior stays stable.
- Cache invalidation and foreground/background refresh ownership is documented and tested.

### DICOM Remap

- State transitions and retry/cancel rules are documented from current code.
- Staging hashes, manifests, leases, one-selected-study enforcement, and persisted UID plans remain authoritative.
- Orthanc verification retains exact SOP UID set equality and server-only access.
- PACS sending remains durable and asynchronous; no live Orthanc request is part of refactor validation.

## Baseline Commands

- `npm run agent:contract`
- `npm run harness:all`
- `npm run typecheck`
- `npm run typecheck:frontend`
- Domain-focused tests and builds recorded in the active execution plan.

## Ratchet Policy

- Do not add new large cross-domain modules or new production `any`/console debt.
- Lower a hotspot baseline only after the corresponding extraction passes its parity checks.
- Keep intentional exceptions explicit in `docs/quality/EXEMPTIONS.md`.

## Completed-Pass Delta

- Deleted 10 individually reachability-verified files and removed 3 unused frontend packages.
- Reduced the executable Settings owner from 5,539 to 280 lines, the API compatibility facade from 4,094 to 12 lines, and the i18n compatibility facade from 4,088 to 33 lines.
- Split the translation data into fixed-hash Arabic and English catalogs with 1,998 keys each.
- Reduced Reporting Board service ownership from 2,143 to 2,087 lines by extracting pure metrics; documented the remaining UI/repository/service seams before further movement.
- Reduced DICOM remap service ownership from 5,128 to 5,105 lines by extracting public types and pure validation; documented the remaining stateful seams before further movement.
- Strict backend unused checking was reduced to two findings in the separately scoped active OHIF integration. Standard typechecks remain clean.
- Final report-only harness snapshot: 41 files at or above 1,000 lines, 15 files with likely `any`, 42 production files with console calls, one TODO marker, 23 route naming exceptions, and 56 service-directory naming exceptions. The coarse large-file count is one higher because executable mega-files became language catalogs and domain-local clients; the named cross-domain hotspots and ownership boundaries, rather than the aggregate count alone, are the ratchet targets.
- Generated DICOM worklist artifacts created by DB/E2E validation were removed before the final contract check.
