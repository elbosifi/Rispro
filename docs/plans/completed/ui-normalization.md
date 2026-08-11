# Execution Plan: RISpro UI normalization

## Baseline

- Starting SHA: `98da640ffddb60c4b8878032c5193c31b9785d96`
- Starting branch: `main`, clean and exactly aligned with `origin/main`
- Goal branch: `codex/ui-normalization-goal`
- Repaired completion baseline: `6f88984f9a2b2d8d9af73720b9ae8b0382c758ce`; local `origin/main` was fetched and confirmed at this exact SHA before the Goal checkpoint was rebased.
- Baseline-only delta: `frontend/src/lib/i18n.test.ts` and `frontend/src/components/documents/document-preview-workspace.test.tsx`; neither file is part of the Goal diff.
- Baseline CI: Comprehensive CI and self-hosted CI were reported green for the exact repaired SHA before resumption. The two repaired tests also pass locally after synchronization.
- Contract/preflight: `npm run agent:contract` passed; `npm run agent:preflight` passed with `DOCKER_OK`.

## Preservation Contract

This goal changes implementation seams only. Routes, navigation, permissions, roles, requests, query keys, mutations, invalidation, validation, actions, keyboard behavior, state behavior, scheduling/appointment/registration/modality/PACS/printing/re-auth/audit behavior, page composition, information hierarchy, control order, modal geometry, responsive behavior, density, and scrolling ownership are invariants.

Any candidate that cannot retain its rendered element, attributes, classes, content, event handlers, and layout is not migrated in this goal. No behavior or layout defect is being fixed here.

## Canonical RISpro UI System

The canonical library is `frontend/src/components/shared/`, exported through its `index.ts`:

- Generic controls: `Button`, `Input`, `SearchInput`, `Textarea`, `Checkbox`, `Switch`
- Surfaces and structure: `Card`, composable `Table`, `Dialog` primitives, `Tabs`, `DisclosureSection`, `AnchoredMenu`
- Semantic presentation: `Badge`, `Alert`, `SectionLabel`
- Page states: `LoadingState`, `EmptyState`, `ErrorState`

Canonical styling lives in `frontend/src/index.css`: theme variables, control sizes, radius/shadow scales, `btn-*`, `input-premium`, card shells, state chips, alerts, and tabs. `frontend/src/components/common/` contains valid semantic controls such as `DateInput` and the label-owning `Select`; these are not a second design system.

## Inventory

### High-confidence duplicate seams

The following are generic raw elements already carrying the exact canonical CSS class and can be replaced by a shared primitive without changing emitted semantics or styling:

- Appointments V2: raw `input-premium` inputs in appointment creation, availability paging, supervisor override, and override approval.
- Registration: raw `input-premium` notification-title input.
- Modality Board: raw `input-premium` CD resend reason input.
- Appointments V2: raw `btn-*` buttons in success actions and availability pagination are candidates only if the final class set and measured geometry remain identical.

### Existing normalized usage

- Appointments V2 already uses shared `Alert`, `Badge`, `Button`, `Card`, `Dialog`, `Input`, and `SearchInput` across core creation, patient search, scheduling overrides, and policy administration.
- Registration already uses shared `Card`, `Button`, and `SearchInput`.
- Modality Board already uses shared `Badge`, `Button`, `Card`, `Checkbox`, and `Dialog`.
- Modality document ingestion already uses shared `LoadingState` and `ErrorState`.

The shared README's statement that major pages are fully migrated is therefore too broad: canonical usage is substantial, but deliberate raw controls and remaining exact duplicate seams coexist.

### Intentional exceptions

- Status-filter chips, availability date rows, patient-name links, segmented template/custom toggles, table-row actions, and disclosure headers are domain interaction controls, not generic buttons.
- Radio inputs remain native because `Checkbox` has different semantics.
- Native selects remain where the shared `common/Select` would add its own label/layout or where no geometry-neutral shared select exists.
- Modality Board's dense worklist and clinical acquisition tables keep their specialized fixed widths, sticky headers, column geometry, row behavior, and LTR/RTL handling; the generic shared `Table` defaults are not equivalent.
- Clinical/status colors remain local where they encode domain state rather than duplicate a general theme color.
- Content-specific dialogs keep their current widths and information hierarchy. Existing accessible shared `Dialog` use is retained; drawer-style override approval and other non-modal workspaces are not converted.
- `Textarea` is not substituted where its default minimum height would change current geometry.
- `SearchInput`'s internal native input and clear button, `DialogHeader`'s close button, `DisclosureSection`, and `AnchoredMenu` are canonical internals and are not debt.

## Repeated Styling and Token Findings

- The target surfaces predominantly use canonical variables/utilities (`border-border`, `bg-card`, `text-muted-foreground`, `input-premium`, `btn-*`).
- Domain palettes in worklist status rows and delivery history are intentional clinical/operational semantics.
- Equivalent hard-coded theme-value detection is not suitable for an automated rule without semantic CSS analysis; this remains documentation/review policy.
- Generic raw controls that explicitly opt into `btn-*` or `input-premium` are a high-confidence structural signal and are suitable for a baseline ratchet.

## Modal and Page-State Findings

- Shared `Dialog` owns body scroll locking, Escape dismissal, backdrop dismissal, initial focus, viewport-bounded height, and internal overflow.
- Appointments patient search, scheduling override request, publishing, and Modality CD delivery use the shared shell.
- Override approval's right-side drawer intentionally differs from a modal and remains a drawer.
- Registration's WhatsApp/notification overlays require parity characterization before any shell decision; they are not automatically migrated.
- Page-level loading/empty/error presentations differ where they are embedded inside dense operational tables/cards. They remain local unless the shared state component preserves containment and spacing exactly.

## Prioritized Migration Batches

1. Add concise repository UI rules and detailed guidance.
2. Add a structural ratchet for new generic raw `btn-*` / `input-premium` controls and new manual generic dialog shells, with a reviewed legacy baseline.
3. Appointments V2: replace only exact generic input/button seams; preserve specialized interaction controls.
4. Registration: replace the exact generic notification input seam; retain segmented controls, patient links, and current overlay geometry.
5. Modality Board: replace the exact generic CD reason input seam; retain dense tables, header chips, menus, and disclosure controls.
6. Run focused tests after each batch, then frontend typecheck/lint/build, relevant broader tests, browser parity, harness, and `git diff --check`.

## Required Parity Evidence

For each operational surface, record before/after evidence for the populated page and a relevant dialog/workspace at desktop and narrow/mobile width where practical. Compare element geometry, information hierarchy, spacing, action prominence, internal/page scrolling, and responsive behavior. Exercise loading/empty/error states through existing component tests where a deterministic browser state is not practical.

No screenshot baseline is accepted until it is captured from the disposable E2E stack. Missing browser binaries are installed at the repository-compatible Playwright version.

## Automated Versus Documentation-only Guardrails

- Automated: baseline-ratcheted structural counts for raw generic controls using canonical generic classes and manual generic dialog-shell markers; new debt fails the harness while existing reviewed exceptions remain visible.
- Documentation-only: semantic judgment for specialized controls, intentional domain colors, layout-equivalent token choices, and whether a local component is truly generic. These are intentionally not reduced to brittle source-text bans.

## Completion Ledger

| Item | Status | Evidence |
| --- | --- | --- |
| Repository and shared-system inspection | Complete | Baseline and inventory above |
| Before visual characterization | Complete | Disposable E2E captures at 1440x960 and 390x844; populated pages plus Modality workspace |
| Repository UI rules | Complete | `AGENTS.md`, detailed agent guidance, operating rules, shared README |
| Structural ratchet | Complete | `npm run harness:ui` passes against reviewed legacy totals/files |
| Appointments V2 normalization | Complete | 10 generic buttons and 13 generic inputs moved to shared primitives; 73 focused tests pass |
| Registration normalization | Complete | Notification title input moved to shared `Input`; 34 focused tests pass |
| Modality Board normalization | Complete | CD resend detail input moved to shared `Input`; 75 focused tests pass |
| Broad validation | Complete | 1,141/1,141 frontend tests and coverage pass; typecheck, lint, build, harness, 9/9 E2E, and 2/2 focused visual journeys pass |
| Final A-H audit | Complete | A/C/D/E present; B has no production CSS changes; F/G/H are none |
| Squash-apply to local `main` uncommitted | Ready | Apply only after confirming `main` remains exactly at the repaired baseline |

## Remaining Debt Classification

This ledger will be completed after the three operational surfaces are migrated:

- High-value next migration: manual modal shells already listed in the ratchet baseline, after each shell's keyboard/backdrop semantics and geometry are separately characterized.
- Low-risk later migration: remaining raw generic class-backed controls in Settings, PACS, Search, Worklist Monitor, and authentication, migrated in bounded page-level tasks.
- Intentional exception: specialized controls listed above.
- Leave alone: dense Modality/clinical tables, radio groups, segmented workflow controls, drawer workspaces, and any candidate whose shared substitution changes semantics, geometry, or complexity.

## Validation Checkpoint

- Focused Appointments V2: 73/73 tests passed.
- Focused Registration: 34/34 tests passed.
- Focused Modality: 75/75 tests passed.
- Repaired-baseline and accumulated focused matrix: 10 files, 195/195 tests passed, including the i18n catalog lock and document-preview timing repairs.
- Full frontend suite: 111 files, 1,141/1,141 tests passed.
- Frontend coverage: 111 files, 1,141/1,141 tests passed; statements 57.05% (12,045/21,111), branches 53.81% (13,080/24,304), functions 45.76% (3,462/7,565), lines 60.73% (10,608/17,465).
- Frontend typecheck, lint, production build, `npm run harness:all`, and `git diff --check` passed. The build retained the existing report-only large-chunk warning; harness retained existing report-only baseline warnings.
- Browser critical journeys: 9/9 Playwright tests passed against the disposable E2E database.
- Browser geometry: before/after visible generic-control metrics are identical on Appointments and Registration at 1440x960 and 390x844. Modality populated page/workspace captures are visually unchanged except live clock data.
- Post-synchronization visual review: 2/2 focused Playwright journeys passed with eight inspected captures covering Appointments populated/identity-dialog, Registration populated, and Modality populated/selected-workspace states at desktop and narrow widths. No geometry, information hierarchy, action prominence, scrolling, or responsive drift was found.

## Final Change Audit

- A — shared-component reuse: Appointments V2, Registration, and Modality generic controls now use canonical RISpro primitives.
- B — equivalent styling/token normalization: shared primitives preserve the existing `btn-*` and `input-premium` classes; no production CSS or theme values changed.
- C — duplicate UI removal: 10 raw generic buttons and 15 raw generic inputs were removed.
- D — UI regression guardrail: reviewed structural baseline ratchets prevent new generic primitive debt in new files and prevent total debt growth.
- E — repository/documentation rule: concise mandatory rule plus detailed guidance and shared-component contract added.
- F — behavior change: none.
- G — layout/UX change: none.
- H — uncertain: none.

## Rollback

All implementation occurs on the unpushed goal branch. Milestone commits may be used as local rollback points. Final application to `main` will be a squash without a commit; the goal branch remains as the rollback point until user review.
