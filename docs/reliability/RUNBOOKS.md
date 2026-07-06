# Reliability Runbooks

## Validation Failure

1. Re-run the failing command with capped output.
2. Determine whether the failure is from the current change, baseline repo state, or local environment.
3. Fix current-change failures immediately.
4. For baseline or environment failures, record exact command and error in the task summary or a failed-task plan.

## DB-Backed Tests

1. Run `npm run db:test:check`.
2. If it fails, use the classified cause and suggested fix from the command output.
3. Do not guess database credentials.
4. Do not use production `DATABASE_URL`.
5. Run only targeted DB tests after the check passes.

## DICOM / PACS / MWL Work

1. Keep Orthanc, PACS, MWL, and DICOM mutation orchestration server-side.
2. Validate route/service behavior before frontend behavior.
3. Avoid logging raw DICOM identifiers or patient fields.
4. Use docs under `docs/deployment-guide.md`, `docs/docker-deployment.md`, and domain docs before changing deployment assumptions.

## Reporting Board Work

1. Confirm whether the row is appointment-backed or comparison-backed.
2. Preserve assignment, filter, stats, saved-view, mobile, and print contracts.
3. Keep comparison requests out of appointment-only MWL/capacity/queue behavior.

## Observability Migration

1. Add or reuse an event name in `src/observability/events.ts` only if it is useful for search.
2. Use `src/observability/logger.ts`.
3. Verify fields contain no raw PHI.
4. Run `npm run harness:quality` to review remaining console output.
