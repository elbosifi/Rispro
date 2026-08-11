# RISpro Operating Rules

These rules keep agent work small, verifiable, and safe for a production radiology system.

## Mandatory Workflow

1. Work one task only. Do not add opportunistic cleanup.
2. Inspect before patching. Read the relevant code and docs, then state the current behavior and likely cause.
3. Make the smallest maintainable change that solves the request.
4. Keep product behavior unchanged unless the task explicitly asks for behavior change.
5. Do not redesign UI or refactor business logic for a guardrail, docs, or validation task.
6. Run the most targeted test first. Expand only when the touched surface justifies it.
7. Stop at the first unrelated failure and report the exact command and failure.
8. Do not claim skipped, blocked, or failing checks as passing.
9. For UI work, inspect and reuse the RISpro shared primitives and existing design tokens when their semantics fit. Normalization must preserve product behavior and established layout; document genuinely specialized exceptions and verify relevant desktop/mobile states in a browser.

## Authority Boundaries

- Scheduling, booking, override, quota, and audit decisions are backend-authoritative.
- Frontend code may display state and collect input, but must not invent scheduling truth.
- Appointments V2 boundaries remain in the Appointments V2 docs.
- DICOM, Orthanc, PACS, MWL, and scanner integration authority stays server-side.

## Database Rules

- Run cheap relevant local checks first for DB-affecting work. For migrations, SQL, repositories, DB-backed services, booking/override persistence, or DB integration tests, run `npm run agent:preflight` first.
- When preflight reports `DOCKER_OK`, run `npm run db:test:up` even if `db:test:check` initially reports localhost port `5433` unreachable, then run `npm run db:test:check` and every relevant focused DB test. Prefer `npm run db:test:required -- <test-file> [additional-test-files...]` to enforce this sequence.
- Do not delegate solely because localhost was initially unreachable. Delegation is allowed only for explicit `DOCKER_NOT_INSTALLED`, `DOCKER_DAEMON_NOT_RUNNING`, `DOCKER_EXECUTION_BLOCKED_BY_ENVIRONMENT`, or `DOCKER_CREDENTIAL_HELPER_BROKEN` preflight classifications, or after one documented `db:test:up` failure. Do not troubleshoot, install, or provision Docker beyond that attempt solely to run the full suite unless the task concerns the environment.
- Use `codex-db-test.env` for DB test credentials.
- Never ask for a local PostgreSQL admin password.
- Never touch production DBs during agent validation.

## Generated Files

- Generated DICOM worklist source files under `storage/dicom/worklist-source/` are side effects.
- Do not commit new or changed generated worklist-source files unless the task explicitly intends that.

## Windows and Mac Handoff

1. Commit or create a patch before switching machines.
2. On the new machine, run `git pull` or apply the patch.
3. Run cheap relevant local checks.
4. For DB-affecting work, run `npm run agent:preflight`; if it reports `DOCKER_OK`, run `npm run db:test:required -- <test-file> [additional-test-files...]`.
5. Delegate only under an explicit permitted Docker classification or after one documented `db:test:up` failure, and report required CI status accurately.

## Authorized Push Follow-up

When commit and push are explicitly authorized, record the pushed full SHA and run `npm run ci:inspect -- --sha <SHA>`. The read-only inspection must show the exact-headSha `CI` and `RISpro self-hosted CI` runs, including failed logs. Do not claim completion if either workflow is missing, pending, cancelled, or failed; do not rerun or patch before diagnosing the first actionable failure.
