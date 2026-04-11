
---

## 3) `docs/appointments-v2/DECISIONS.md`

```md
# Appointments V2 Decisions

This file is append-only.
Do not rewrite old decisions.
Add new decisions below with a new ID.

---

## D001 — Legacy appointments module is frozen

Status: accepted

Decision:
The legacy appointments and scheduling module is frozen and kept only as reference during Appointments V2 development.

Rules:
- no new scheduling features in legacy
- no architectural cleanup inside legacy
- only critical containment fixes are allowed if explicitly requested

Reason:
The legacy module is too monolithic and fragile for continued extension.

---

## D002 — Appointments V2 is built in parallel inside the same repo

Status: accepted

Decision:
Appointments V2 is implemented in parallel inside the same repository and deployment, not as a separate app or service.

Rules:
- backend lives under `src/modules/appointments-v2/`
- frontend lives under `frontend/src/v2/appointments/`
- legacy stays mounted until V2 is validated

Reason:
This is safer, simpler for auth/session reuse, and easier for staged cutover.

---

## D003 — Multi-agent development is a first-class constraint

Status: accepted

Decision:
The architecture and task plan must optimize for multiple AI coding agents working in parallel.

Rules:
- one primary implementer agent per stage or sub-scope
- one secondary bug-fix and hardening agent reviews
- file ownership boundaries must be explicit
- shared files should be touched only by the assigned owner for that stage

Reason:
This reduces merge conflicts and keeps agent prompts narrow and reliable.

---

## D004 — Scheduling logic must not be ad hoc

Status: accepted

Decision:
Appointments V2 must not use ad hoc scheduling logic spread across UI assumptions or random service branches.

Rules:
- scheduling decisions must come from explicit backend rule evaluation
- all rule outcomes must follow fixed precedence
- UI must consume decision output, not invent booking truth

Reason:
This is the core lesson from the legacy system.

---

## D005 — Backend is authoritative for booking state

Status: accepted

Decision:
Frontend must not infer scheduling or booking status from missing fields.

Rules:
Every scheduling response must include:
- status
- overrideRequired
- reasonCodes
- capacity summary
- policy version reference

Reason:
This prevents the class of UI bugs seen in legacy availability rendering.

---

## D006 — Configuration saves are authoritative

Status: accepted

Decision:
Appointments V2 scheduling configuration saves are authoritative at the draft snapshot level.

Rules:
- omitted rules are removed or deactivated in the saved draft
- published versions are immutable
- only one version per policy set may be published at a time

Reason:
This prevents stale rules from remaining silently active.

---

## D007 — Policy versioning is mandatory

Status: accepted

Decision:
All V2 scheduling rules belong to a policy version.

Rules:
- booking and evaluation reference the active published version
- bookings record the policy version used
- publishing is explicit and auditable

Reason:
This makes decisions reproducible and safer to debug.

---

## D008 — Rule precedence is fixed

Status: accepted

Decision:
Appointments V2 uses this precedence:

1. integrity checks
2. hard blocks
3. exam/service eligibility
4. category capacity
5. special quota
6. override policy
7. in-transaction final re-check

No stage may alter this order unless a new decision is explicitly approved.

---

## D009 — Backend-first delivery

Status: accepted

Decision:
Appointments V2 is delivered backend-first.

Rules:
- scaffold
- schema
- pure decision engine
- availability
- transactional booking
- admin policy versioning
- frontend
- validation
- cutover

Reason:
This gives the frontend a stable contract and reduces rework.

---

## D010 — Shadow mode is required before booking cutover

Status: accepted

Decision:
Before V2 becomes authoritative for booking, it must support a shadow mode that compares legacy outcomes with V2 outcomes.

Rules:
- shadow mode logs diffs
- no user-visible behavior change in shadow mode
- booking cutover requires acceptable diff quality

Reason:
This is the safest way to validate parity and intentional differences.

---

## D011 — V2 routes mount under /api/v2 with three sub-trees

Status: accepted

Decision:
All Appointments V2 endpoints are mounted under a single `/api/v2` prefix in the Express app, with three sub-trees:
- `/api/v2/appointments` — booking CRUD (POST, PUT, POST /:id/cancel)
- `/api/v2/scheduling` — decision and availability (POST /evaluate, GET /availability, GET /suggestions)
- `/api/v2/scheduling/admin` — policy versioning (GET /policy, POST /policy/draft, PUT /policy/draft/:id, POST /policy/draft/:id/publish)

The evaluate endpoint is wired as a POST with a JSON body (not query params) to avoid URL length limits and to support future extension fields.

Reason:
This keeps V2 routes clearly separated from legacy `/api/appointments` and makes the module boundary obvious in logs, middleware, and testing.

---

## D012 — V2 tables are additive, schema-isolated, and FK-safe

Status: accepted

Decision:
All V2 data tables live under the `appointments_v2` schema namespace. The migration is purely additive — it never alters, renames, or drops any legacy column or table. V2 tables reference legacy tables (`patients`, `modalities`, `exam_types`, `reporting_priorities`, `users`) via foreign keys, which is safe because those tables are read-only from V2's perspective and V2 owns no legacy rows.

Concurrency control uses `appointments_v2.bucket_mutex` with `SELECT ... FOR UPDATE` (row-level locking inside transactions) rather than PostgreSQL advisory locks. This keeps locking scoped to V2's own rows and avoids cross-system lock contention.

Rules:
- All V2 SQL must prefix tables with `appointments_v2.`
- No V2 migration may `ALTER TABLE` on any non-V2 table
- Foreign keys to legacy tables use `ON DELETE RESTRICT` for referential integrity
- Bucket mutex uses composite PK on `(modality_id, booking_date, case_category)`

Reason:
Schema isolation prevents accidental legacy interference. Row-level locking is simpler to reason about than advisory locks and works naturally with the `withTransaction()` utility.

---

## D013 — Decision evaluator is pure (side-effect-free)

Status: accepted

Decision:
The core `pureEvaluate()` function accepts all rule data via a `RuleEvaluationContext` input object and returns a `BookingDecision`. It performs zero DB calls, zero mutations, and zero I/O. All DB loading is done by a separate orchestration layer (to be implemented in Stage 5).

Rules:
- `pureEvaluate()` must never import from `db/pool.js` or any repository module
- The `RuleEvaluationContext` is the only data shape the evaluator consumes
- Date-rule matching is also pure — no external state
- All 7 D008 precedence steps are implemented within `pureEvaluate()` itself
- The legacy `evaluateBookingDecision()` stub will eventually call the orchestration layer, which loads context and delegates to `pureEvaluate()`

Reason:
A pure evaluator is trivially testable (no mocks needed), deterministic, and safe to use in shadow-mode diffing (D010). It also enables offline policy simulation and admin impact preview without touching the database.

---

## D014 — Availability service separates rule loading from evaluation

Status: accepted

Decision:
The `getAvailability()` service loads the published policy and all rule data once, then iterates over the date range calling `pureEvaluate()` per day with only the date-specific booked count changing. This avoids redundant DB queries while keeping the pure evaluator as the single source of decision truth.

The `evaluateWithDb()` function is the orchestration layer for single-date evaluation (used by POST /evaluate). It acquires a pool connection, loads context, and delegates to `pureEvaluate()`. The connection is released in a `finally` block.

Rules:
- `getAvailability()` loads rules once, not per day
- `evaluateWithDb()` and `getAvailability()` each manage their own pool connection
- Read-only queries do not use transactions
- The evaluate endpoint route calls `evaluateBookingDecision()` (which wraps `evaluateWithDb()`)
- The availability endpoint route calls `getAvailability()`

Reason:
Separating rule loading from evaluation enables both efficient date-range queries and clean single-date evaluation without duplicating DB loading logic.

---

## D015 — Booking writes use lock → re-evaluate → write pattern

Status: accepted

Decision:
All V2 booking mutations (create, reschedule) follow this exact pattern inside a transaction:
1. Acquire bucket mutex lock (`SELECT ... FOR UPDATE` on `appointments_v2.bucket_mutex`)
2. Load all rules for the target date
3. Re-evaluate the booking decision via `pureEvaluate()` (in-transaction re-check)
4. If blocked without override permission → throw `SchedulingError`
5. If override required → validate supervisor credentials via `authenticateSupervisor()`
6. Insert/update the booking
7. Record override audit event if applicable

Capacity is implicitly released for cancellations: all capacity queries use `WHERE status <> 'cancelled'`, so cancelling a booking automatically frees capacity without explicit counter management.

Rules:
- `createBooking()` uses `withTransaction()` — BEGIN → lock → evaluate → write → COMMIT
- `cancelBooking()` uses `withTransaction()` — BEGIN → find → update status → COMMIT
- `rescheduleBooking()` uses `withTransaction()` — BEGIN → find → lock (new date) → re-evaluate → update → COMMIT
- `releaseCapacity()` is a documented no-op (capacity is implicit)
- Override audit events are recorded inside the same transaction as the booking write
- Supervisor authentication checks `role = 'supervisor'` and `is_active = true`

Reason:
The lock → re-evaluate → write pattern prevents race conditions where two agents simultaneously book the last available slot. By acquiring the bucket mutex before evaluation and committing only after a successful re-check, V2 guarantees capacity is never exceeded.

---

## D016 — Policy versioning lifecycle is draft → validate → publish → archive

Status: accepted

Decision:
V2 scheduling policies follow a strict lifecycle:
1. **Draft creation**: A new draft is created from the currently published version (copying its config hash) or from scratch if no published version exists. Only one draft per policy set is allowed at a time (enforced by service-level check).
2. **Draft save**: The draft config snapshot can be authoritatively replaced. Each save recalculates the SHA-256 config hash (D006: omitted rules are implicitly deactivated).
3. **Validation**: Before publishing, the draft is validated — version must exist, must be draft, must have a config hash. Warnings are issued for zero daily limits, zero special quotas, or empty rule sets.
4. **Publish**: The draft is published and all previously published versions for the same policy set are automatically archived (partial unique index on `policy_versions(policy_set_id) WHERE status = 'published'` enforces single published at DB level too).
5. **Preview**: Before publishing, admins can preview the diff (added/removed/modified rules) between draft and published.

Rules:
- `createPolicyDraft()` throws 409 if a draft already exists
- `savePolicyDraft()` throws 409 if the version is not a draft
- `publishPolicy()` validates before publishing; throws 400 if validation fails
- Publishing archives old published versions (they are never deleted)
- Config hash is recalculated on every save — published versions are immutable (hash cannot change)

Reason:
This lifecycle prevents accidental overwrites, ensures config integrity via hashing, and provides a safe preview mechanism so admins know the impact before publishing.

---

## D017 — Shadow mode is non-intrusive and gated

Status: accepted

Decision:
Shadow mode (D010) compares legacy scheduling outcomes with V2 decisions and logs structured diffs without changing user-visible behavior. It is gated behind the `SHADOW_MODE_ENABLED` environment variable (default: false).

Rules:
- `runAvailabilityWithShadow()` accepts legacy results as input and always returns them unchanged
- If shadow mode is disabled, it's a pass-through with zero overhead
- If shadow mode fails (DB error, no published policy, etc.), it logs the error but returns legacy results — shadow must never break the user experience
- Diff entries are logged as JSON-lines to stdout for easy parsing by observability systems
- Each diff entry is classified as `match`, `v2_stricter`, or `v2_looser`
- `v2_stricter` = V2 blocks what legacy allowed (potential regression)
- `v2_looser` = V2 allows what legacy blocked (potential risk)
- Summary includes total count, match count, mismatch count, and mismatch rate

Reason:
Shadow mode must be safe to enable in production without any risk to users. The gating allows gradual rollout, and the non-intrusive design ensures legacy behavior is never affected even if V2 evaluation fails.

---

## D018 — V2 frontend uses TanStack Query with explicit types

Status: accepted

Decision:
The V2 frontend module (`frontend/src/v2/appointments/`) uses TanStack Query for all data fetching. Each V2 endpoint has a dedicated hook (`useV2Availability`, `useV2Evaluate`, etc.) with typed query keys for cache invalidation. Types mirror the backend DTOs exactly to ensure end-to-end type safety.

Rules:
- All V2 API calls go through TanStack Query hooks — no direct `fetch()` in components
- Query keys include all filter parameters to ensure correct cache isolation
- Availability queries have 30s stale time (data doesn't change frequently)
- Lookups (modalities, exam types) have 5-minute stale time (rarely change)
- Booking mutations invalidate availability cache after success
- Types mirror backend DTOs — any change to backend DTOs must be reflected in frontend types
- Components render explicit status from the decision — no inference from missing fields (D005)

Reason:
TanStack Query provides caching, deduplication, and automatic refetching without manual state management. Typed query keys prevent cache collisions when multiple filter combinations are active.