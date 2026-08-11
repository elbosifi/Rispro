# Reporting Board Behavior-Parity Contract

This contract protects the behavior-preserving Reporting Board refactor. It does not authorize endpoint, permission, schema, audit, or workflow changes.

## Surface parity matrix

| Capability | Desktop | Mobile saved view | Print | Protected behavior |
| --- | --- | --- | --- | --- |
| Appointment cases | Full filters, pagination, assignments, status, report state | Saved-view scope plus permitted narrowing and quick tabs | Current filtered rows | Same eligibility, exclusion reason, priority pinning, and sort tie-breaks |
| Comparison requests | Unified with appointment cases | Included only when the saved view permits comparisons | Included in current filtered output | Identity remains `comparisonRequestId`; appointment-only actions stay unavailable |
| Saved views | Create, update, rotate, revoke | Token-scoped read and permitted actions | N/A | Token scope cannot be broadened by request filters |
| Assignment | Single, selected, next-case, scheduled jobs, undo | Claim/reassign/unassign only when token and actor allow | N/A | Doctor modality authorization and final-report exclusions remain backend-authoritative |
| Notifications and push | Inbox, read/dismiss, subscription, test | Token subscription/status/test | N/A | Subscription ownership, token authorization, and persisted delivery state remain unchanged |
| Output | Desktop presentation | Mobile presentation and counters | Print-specific presentation | Labels, report-required state, filters, and case identity remain equivalent |

## Cache invalidation contract

- Case mutations invalidate Reporting Board cases, stats, worklists, assignment jobs, and notification keys used by the initiating surface.
- Saved-view mutations invalidate saved-view lists and the affected token view without broadening token scope.
- Manual-final, discontinue, assign, reassign, unassign, and bulk actions retain their existing invalidation keys and refetch behavior.
- Desktop and mobile cache keys remain distinct where their authorization or filters differ.

## Required parity assertions

- Permission: receptionist access remains denied; doctor, supervisor, and super-admin scope remains unchanged.
- Filters: date cutoff, report-required, report status, modality, doctor, category, priority, urgent/stat, assignment, source, query, pagination, sort direction, and urgent pinning retain current defaults and narrowing behavior.
- Assignment: final or otherwise ineligible cases retain the same exclusion reasons; comparison and appointment identities cannot be interchanged.
- Presentation: desktop, mobile, and print preserve current labels, counts, quick tabs, and visible rows for the same effective scope.
- Audit and persistence: saved-view, assignment-job, notification, manual-final, and push records retain their existing repository writes and audit calls.

## Validation evidence

- Backend unit: `src/modules/doctor-portal/reporting-board.test.ts`
- Required DB parity: `src/modules/doctor-portal/reporting-board.integration.test.ts`
- Frontend desktop/mobile/print tests under `frontend/src/pages/doctor/` and `frontend/src/pages/print/`
- Browser: saved-view mobile journey remains required when visible behavior is touched.
