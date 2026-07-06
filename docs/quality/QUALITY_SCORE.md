# Quality Score

This is an initial harness-oriented snapshot, not a full audit.

| Area | Current Score | Notes |
| --- | --- | --- |
| Repository map | B | Root map, architecture doc, domain docs, and plan templates exist. |
| Appointments V2 guardrails | B | Strong docs/tests exist; keep legacy/V2 boundary explicit. |
| Doctor Portal / Reporting Board | C | Good focused tests exist; cache refresh, filter persistence, and E2E coverage need follow-up. |
| DICOM / PACS / MWL | C | Important server-side boundaries are documented; remap persistence and structured observability need work. |
| Observability | C | Shared logger foundation exists; existing logs are not migrated. |
| Frontend coverage | C | Focused Vitest coverage exists for many pages; critical journey E2E harness is still missing. |
| DB-backed coverage | C | DB test rules exist; local environment availability is a recurring gate. |

Update this file after meaningful harness, test, observability, or domain cleanup work.
