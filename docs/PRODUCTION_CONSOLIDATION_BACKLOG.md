# RISpro Production Consolidation Backlog

This is the durable checklist for balancing two competing priorities:

1. fixing operational feature boards and workflow defects;
2. steadily improving production readiness and consolidation.

## Operating rule

- Keep one major functional task active at a time.
- Use spare Codex quota for one small consolidation item.
- Each item should be independently reviewable and testable.
- Do not combine unrelated consolidation items in one Codex session.
- Mark an item complete only after the relevant validation passes.

## Recommended quota split

- 70%: active operational defects and high-value workflow fixes.
- 30%: production consolidation.
- During a production incident or safety-critical defect: temporarily use 100% for the defect.
- When no urgent functional defect is active: reverse the split and focus on consolidation.

## Active functional workstreams

These are intentionally tracked at workstream level. Break each into narrow tasks before implementation.

- [ ] Fertility board: inspect current behavior and define exact defects.
- [ ] Fertility board: fix highest-severity backend/data defect.
- [ ] Fertility board: fix highest-severity frontend/workflow defect.
- [ ] Fertility board: add targeted regression coverage.
- [ ] Doctor support board: inspect current behavior and define exact defects.
- [ ] Doctor support board: fix highest-severity backend/data defect.
- [ ] Doctor support board: fix highest-severity frontend/workflow defect.
- [ ] Doctor support board: add targeted regression coverage.
- [ ] Doctor protocoling board: inspect current behavior and define exact defects.
- [ ] Doctor protocoling board: fix highest-severity backend/data defect.
- [ ] Doctor protocoling board: fix highest-severity frontend/workflow defect.
- [ ] Doctor protocoling board: add targeted regression coverage.

# Production consolidation tracks

## Track A — Release regression gate

### XS tasks

- [ ] Add frontend Vitest execution to CI without changing deployment behavior.
- [ ] Add frontend ESLint execution to CI.
- [ ] Confirm CI reports test failure separately from environment/preflight failure.
- [ ] Add one public-route authorization regression test to the mandatory gate.
- [ ] Add one DICOM/PACS worker-state regression test to the mandatory gate.
- [ ] Add one doctor-worklist regression test to the mandatory gate.

### S tasks

- [ ] Define the minimum mandatory test matrix by module in documentation.
- [ ] Add a post-deployment health smoke check that verifies the deployed commit SHA.
- [ ] Add a route smoke test for receptionist, supervisor, and non-supervisor entry points.
- [ ] Add a migration-status check to deployment validation.

### M tasks

- [ ] Replace the scheduling-only DB gate with a documented critical-module DB gate.
- [ ] Add a production smoke suite covering login, appointment creation, print/details, and one reporting-board read path.

## Track B — Observability and operations

### XS tasks

- [ ] Expose current build commit and deployment time on an authenticated admin endpoint.
- [ ] Add a worker heartbeat field for one asynchronous worker.
- [ ] Add structured failure logging with correlation ID to one worker.
- [ ] Add retry-count visibility for DICOM remap jobs.
- [ ] Add last reconciliation result for doctor worklists.
- [ ] Add last reconciliation result for Orthanc MWL.
- [ ] Add last successful backup timestamp to an admin-readable source.

### S tasks

- [ ] Create a shared operational job-state contract: pending, running, succeeded, retrying, failed, dead.
- [ ] Add an admin API summary for failed jobs by subsystem.
- [ ] Add an admin UI card for application version, DB status, and worker health.
- [ ] Add an admin UI table for failed asynchronous jobs with retry action where safe.

### M tasks

- [ ] Create the first production operations dashboard combining app, DB, PACS/MWL, worker, and backup health.
- [ ] Standardize correlation IDs across API request, background job, and audit records.

## Track C — Backup and disaster recovery

### XS tasks

- [ ] Document current backup location, retention, and ownership.
- [ ] Add backup script exit-code logging.
- [ ] Add backup file-size validation to reject zero-byte or implausibly small dumps.
- [ ] Record the most recent successful backup timestamp.
- [ ] Document the exact restore command for a disposable database.

### S tasks

- [ ] Copy backups automatically to a second host or encrypted remote storage.
- [ ] Add a scheduled restore test into a disposable PostgreSQL instance.
- [ ] Document RPO and RTO targets for RISpro.
- [ ] Create a recovery checklist covering DB, environment configuration, persistent files, and DICOM-related state.

### M tasks

- [ ] Perform and document one complete disaster-recovery rehearsal.
- [ ] Automate periodic restore verification and retain the verification result.

## Track D — Frontend design-system consolidation

### XS tasks

- [ ] Inventory hardcoded colors in one high-use page.
- [ ] Inventory duplicated button styles in one module.
- [ ] Create one canonical loading state component.
- [ ] Create one canonical error state component with retry support.
- [ ] Create one canonical empty state component.
- [ ] Standardize blocked/restricted/full status badges in appointment UI.
- [ ] Standardize page title and action-row spacing on one workflow.

### S tasks

- [ ] Define canonical Button variants and migrate one module.
- [ ] Define canonical Card/Panel variants and migrate one module.
- [ ] Define canonical Table shell and migrate one board.
- [ ] Define canonical operational status styles.
- [ ] Normalize form control heights and validation states in one workflow.

### M tasks

- [ ] Consolidate appointment create/availability/success components.
- [ ] Consolidate board page shells across fertility, doctor support, and protocoling.
- [ ] Remove unused legacy UI components after route and workflow verification.

## Track E — Security and authorization assurance

### XS tasks

- [ ] List all public routes and their token/authentication model.
- [ ] Add one expired-token test to each critical public flow missing it.
- [ ] Add one role-denial test for each high-risk admin route missing it.
- [ ] Verify secrets are excluded from structured logs for one external integration.
- [ ] Add dependency audit reporting to CI without automatically blocking deployment initially.

### S tasks

- [ ] Create an authorization matrix for receptionist, doctor, supervisor, and super admin.
- [ ] Add mandatory authorization regression tests for critical routes.
- [ ] Add rate-limit verification for public QR/report/notification endpoints.

### M tasks

- [ ] Perform a focused security review of public token flows and external-system credentials.

## Track F — Architecture and duplicate-path retirement

### XS tasks

- [ ] List duplicate legacy/V2/V3 routes still reachable.
- [ ] Identify one unused compatibility component and prove it is unreferenced.
- [ ] Document the authoritative implementation for appointment creation.
- [ ] Document the authoritative implementation for reporting worklists.
- [ ] Document the authoritative implementation for MWL publishing.

### S tasks

- [ ] Remove one verified-unused duplicate route.
- [ ] Remove one verified-unused duplicate component set.
- [ ] Add architecture documentation for asynchronous workers and reconciliation jobs.

### M tasks

- [ ] Complete retirement of an obsolete appointment workflow after production verification.
- [ ] Separate one high-risk worker into a clearer module boundary with explicit state and tests.

# Suggested next-task picker

When extra quota is available, choose using this order:

1. Any production incident or patient/workflow safety defect.
2. Any broken fertility, doctor support, or doctor protocoling workflow used in daily work.
3. The smallest unchecked P0/P1 consolidation item.
4. The smallest unchecked item in Track A.
5. The smallest unchecked item in Track B.
6. Backup/restore, security, frontend consolidation, then architecture cleanup.

Default first consolidation task:

- [ ] Add frontend Vitest execution to CI as a separate mandatory job or step, while keeping failures clearly attributable and avoiding unrelated code changes.

Why this is first:

- frontend tests already exist;
- production deployment currently builds the frontend but does not run the full frontend test suite;
- it is narrow, reversible, and gives immediate regression protection.

# Completion record

When checking an item, append:

- date;
- commit or PR;
- validation performed;
- any remaining limitation.

Example:

```text
- Completed: 2026-07-12
- PR: #123
- Validation: frontend Vitest suite passed in CI
- Limitation: browser E2E smoke coverage remains separate
```

# Baseline assessment

Initial production maturity baseline:

- Operational stability: 8.0/10
- Backend engineering: 8.3/10
- Frontend engineering: 7.2/10
- Deployment/DevOps: 7.8/10
- Overall RIS maturity: 7.9/10

Re-score only after a meaningful group of checklist items is completed, not after every individual task.
