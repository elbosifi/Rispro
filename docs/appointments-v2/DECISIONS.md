
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