# Mobile Operations Widget

## Task

Implement a privacy-safe aggregate mobile API, revocable device credentials, protected Settings management, and a Scriptable iPhone widget. Preserve appointment, queue, PACS and reporting behavior.

## Git workflow

Selected workflow: `goal-local`

Explicitly authorized Git operations:
- Branch: `codex/mobile-operations-widget-goal`, starting from clean main at `108b749c519bda42c047f565c687b5b78c17f273`.
- Commit: local milestone/reference commits on the temporary branch only.
- Push: prohibited.
- Pull request: prohibited.
- Merge: after validation, squash-apply to unchanged local main without committing.
- Deploy: prohibited.

## Inspection

- Statistics includes voided bookings in total counts; no soft-delete filter exists.
- Exact waiting duration uses `waiting_started_at`; Queue arrival age is a different metric.
- Shared supervisor re-auth and existing Settings navigation remain authoritative.

## Plan

- Bounded `mobile-widget` backend module and dedicated token migration.
- Child Settings section using shared primitives and English/Arabic catalogs.
- Scriptable source, deterministic shim checks, setup/security guide.
- DB lifecycle/privacy tests, component tests, real browser lifecycle and responsive/RTL screenshots, then regression checks.
- Stop on unrelated failures, main divergence, or unsafe database target.

## Result

Complete implementation is locally squash-applied to `main` as uncommitted review changes. Focused feature validation passes, including DB (6/6), Settings/i18n (21/21), Scriptable (15/15), and Chromium E2E (1/1). The broad frontend suite has two pre-existing failures, reproduced unchanged on clean `main`; see the [execution record](docs/plans/active/mobile-operations-widget.md). No push, PR, or deployment was performed.
