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

## Authority Boundaries

- Scheduling, booking, override, quota, and audit decisions are backend-authoritative.
- Frontend code may display state and collect input, but must not invent scheduling truth.
- Appointments V2 boundaries remain in the Appointments V2 docs.
- DICOM, Orthanc, PACS, MWL, and scanner integration authority stays server-side.

## Database Rules

- Use the portable Docker PostgreSQL test flow for DB-backed validation.
- Run `npm run db:test:up` and `npm run db:test:check` before DB tests.
- Use `codex-db-test.env` for DB test credentials.
- Never ask for a local PostgreSQL admin password.
- Never touch production DBs during agent validation.

## Generated Files

- Generated DICOM worklist source files under `storage/dicom/worklist-source/` are side effects.
- Do not commit new or changed generated worklist-source files unless the task explicitly intends that.

## Windows and Mac Handoff

1. Commit or create a patch before switching machines.
2. On the new machine, run `git pull` or apply the patch.
3. Run `npm run agent:preflight` before tests.
4. Run `npm run db:test:up` and `npm run db:test:check` before DB tests.
5. Run targeted DB tests with `npm run test:db:one -- <test-file>`.
