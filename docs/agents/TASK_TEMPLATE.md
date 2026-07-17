# Task Template

Copy this shape into `CURRENT_TASK.md` for non-trivial work.

## Task

- One sentence:
- Scope:
- Out of scope:

## Git workflow

Select exactly one:

- `regular-local`: work directly on local `main`; leave changes uncommitted for manual review.
- `goal-local`: use a temporary local branch, then squash-apply to local `main` without committing.
- `pull-request`: create or use a branch, commit, push, and open or update a pull request.
- `deployment`: explicitly authorized deployment workflow.

Selected workflow: `<regular-local | goal-local | pull-request | deployment>`

Explicitly authorized Git operations:
- Branch:
- Commit:
- Push:
- Pull request:
- Merge:
- Deploy:

Stop conditions:
- If the selected workflow is absent or ambiguous, stop before changing Git state.
- No Git operation may be inferred merely because a task is large or CI would be useful.

## Inspection

- Files checked:
- Current behavior:
- Root cause:

## Plan

- Minimal change:
- Targeted tests:
- Stop conditions:

## Result

- Files changed:
- Validation run:
- Blockers or skipped checks:
