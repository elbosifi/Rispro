# Appointments V2 Architecture

## Purpose

Appointments V2 replaces the current legacy appointments and scheduling implementation with a modular, backend-first system designed for safe parallel work by multiple AI coding agents.

The old appointments module remains frozen and reference-only.

## Core architectural decisions

1. Legacy appointments and scheduling code is frozen.
2. Appointments V2 is built in parallel inside the same repository.
3. Backend comes first.
4. Scheduling decisions are explicit and backend-owned.
5. No ad hoc scheduling logic is allowed in UI or random service branches.
6. Configuration saves are authoritative.
7. Booking re-checks eligibility and capacity inside the transaction before commit.
8. Frontend renders explicit states only and must not infer booking truth from missing fields.

## Module root

All new backend work goes under:

`src/modules/appointments-v2/`

All new frontend work goes under:

`frontend/src/v2/appointments/`

## Backend folder structure

```text
src/modules/appointments-v2/
  index.ts

  api/
    routes/
      appointments-v2-routes.ts
      scheduling-v2-routes.ts
      admin-scheduling-v2-routes.ts
    dto/
      appointment.dto.ts
      scheduling.dto.ts
      admin-scheduling.dto.ts
    mappers/
      appointment.mapper.ts
      scheduling.mapper.ts

  catalog/
    services/
      modality-catalog.service.ts
      exam-type-catalog.service.ts
    repositories/
      modality-catalog.repo.ts
      exam-type-catalog.repo.ts

  scheduler/
    services/
      availability.service.ts
      suggestion.service.ts
      slot-generation.service.ts
    repositories/
      schedule.repo.ts
      slot.repo.ts
      capacity.repo.ts
    models/
      schedule.ts
      slot.ts

  rules/
    services/
      evaluate-booking-decision.ts
      compile-policy.ts
      validate-policy.ts
    repositories/
      policy-version.repo.ts
      policy-rules.repo.ts
    models/
      booking-decision.ts
      rule-types.ts
      policy-snapshot.ts

  booking/
    services/
      create-booking.service.ts
      reschedule-booking.service.ts
      cancel-booking.service.ts
      list-bookings.service.ts
    repositories/
      booking.repo.ts
      bucket-mutex.repo.ts
      override-audit.repo.ts
    models/
      booking.ts

  admin/
    services/
      create-policy-draft.service.ts
      save-policy-draft.service.ts
      publish-policy.service.ts
      preview-policy-impact.service.ts
    repositories/
      admin-policy.repo.ts

  shared/
    errors/
      scheduling-error.ts
    types/
      common.ts
    utils/
      dates.ts
      hashing.ts
      transactions.ts

  tests/
    unit/
    integration/