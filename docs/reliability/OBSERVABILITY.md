# Observability

RISpro now has a minimal shared structured logger in `src/observability/logger.ts`.

## Goals

- Emit JSON records that agents and operators can search.
- Include event name, level, timestamp, and optional request/job/domain fields.
- Avoid PHI by default.
- Keep existing domain behavior unchanged until logs are migrated in focused follow-ups.

## PHI Rule

Do not log raw patient names, national IDs, MRNs, phone numbers, accession numbers, or free-text clinical notes. If a future task needs correlation, add an explicit redaction or hashing strategy and document it before logging the field.

## Recommended Shape

```ts
import { createLogger } from "../observability/logger.js";

const logger = createLogger({ domain: "appointments" });

logger.info("appointment_booking_created", {
  requestId,
  jobId,
  bookingStatus: "scheduled"
});
```

## Current State

- Existing Appointments V2 shadow diff logging remains in `src/modules/appointments-v2/observability/shadow-diff.ts`.
- Existing startup, DICOM gateway, worker, and script logging is not migrated in this pass.
- `npm run harness:quality` reports console logging so future agents can target small migrations.

## Migration Rules

1. Migrate one domain at a time.
2. Keep event names stable and machine-readable.
3. Keep fields small and non-PHI.
4. Add tests only where a logger wrapper changes behavior or event shape.
5. Document any temporary exception in `docs/quality/EXEMPTIONS.md`.
