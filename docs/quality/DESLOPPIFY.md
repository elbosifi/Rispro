# Desloppify Guide

Use this for small cleanup passes that improve future agent reliability without changing product behavior.

## Default Loop

1. Pick one domain or one mechanical smell.
2. Inspect the current route/service/page/test boundary.
3. Write down the smallest safe invariant.
4. Add or update a focused harness check, test, or doc.
5. Make the narrow cleanup.
6. Run the cheapest useful validation.
7. Move larger ideas to [FOLLOW_UP_BACKLOG.md](FOLLOW_UP_BACKLOG.md).

## Good Cleanup Targets

- Stale doc paths and broken links.
- Route/service naming drift.
- Large files with unclear ownership.
- `any` in production TypeScript where the local type is obvious.
- Console logging that should become structured observability.
- Repeated test setup that hides the intent of a domain behavior.

## Avoid

- Broad business-logic refactors.
- UI redesign during cleanup.
- Frontend-only masking for backend authority problems.
- Renaming files or routes without compatibility planning.
- Adding new abstractions for a single call site.
