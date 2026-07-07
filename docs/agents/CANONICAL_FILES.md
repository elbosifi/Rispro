# Canonical Files

## Agent Rules

- `AGENTS.md`: mandatory operating rules and repo map
- `docs/agents/RISPRO_OPERATING_RULES.md`: detailed practical rules
- `docs/agents/ENVIRONMENT_PREFLIGHT.md`: environment handoff and preflight rules
- `docs/agents/TASK_TEMPLATE.md`: task note template
- `docs/agents/VALIDATION_RULES.md`: validation rules and DB test commands
- `docs/agents/CANONICAL_FILES.md`: this file
- `CURRENT_TASK.md`: short current-task scratch template

## Enforceable Scripts

- `scripts/dev/preflight-env.mjs`: environment preflight
- `scripts/dev/test-one-db.mjs`: targeted one-file DB test runner
- `scripts/harness/check-agent-contract.mjs`: agent contract check

## Existing Source of Truth

- `docs/agents.md`: detailed repo and Appointments V2 agent rules
- `docs/CODEX_DB_TESTING.md`: disposable DB workflow
- `scripts/db-test-container.js`: Docker test DB manager
- `scripts/check-db-test.js`: DB test connection checker

## Generated DICOM Worklist Sources

Existing tracked files under `storage/dicom/worklist-source/` are historical repository content. New or changed generated files in that directory should not be committed unless the task explicitly intends to update generated worklist-source artifacts.
