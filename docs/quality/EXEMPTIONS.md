# Harness Exemptions

These are documented allowances for the initial harness. Prefer shrinking this list over time.

## Console Logging

Allowed for now:

- Appointments V2 shadow diff JSON-lines in `src/modules/appointments-v2/observability/shadow-diff.ts`.
- Server startup/shutdown summaries in `src/server.ts`.
- DICOM gateway process output wrappers in `src/services/dicom-gateway-service.ts`.
- CLI and maintenance scripts under `scripts/`.
- Tests that capture or mock console output.
- The shared logger implementation in `src/observability/logger.ts`.

New production logging should use `src/observability/logger.ts` unless a domain-specific follow-up documents why not.

## File Size

Large existing files are reported but not failed by `npm run harness:quality`. Do not expand large files unless the task is local to that file and extraction would be riskier than a narrow edit.

## `any`

The harness reports likely TypeScript `any` usage but does not fail initially. Prefer removing `any` only when the local type is clear and the change is in scope.
