# Complete Application UI Polish Goal

## Task

Polish the remaining active frontend screens using the committed five-screen visual language. Preserve clinical workflows, backend authority, permissions, integration behavior, actions, and practical information density. Track the inventory, evidence, validation, decisions, and milestones in [application-ui-polish.md](docs/plans/active/application-ui-polish.md).

## Git workflow

- Temporary local branch: `codex/application-ui-polish-goal`
- Starting `main` SHA: `50514e038eaf1e8792b89864b3b2854fc27dfccd`
- No push, pull request, or deployment.
- After required validation, squash-apply onto unchanged local `main`, leave review changes uncommitted, and retain the temporary branch.

## Constraints

- Reuse existing shared primitives and theme tokens; keep changes localized.
- Use synthetic data and keep screenshots outside tracked application source.
- No backend logic, schema, scheduling, patient identity, reporting calculation, auth, audit, or integration changes.
- Each batch requires browser evidence and targeted tests; verify desktop/mobile and relevant RTL states.
- After the final frontend edit, run both frontend typecheck and production build on the final tree.
- Report blocked or unrun checks accurately; do not squash-apply if required validation fails.
