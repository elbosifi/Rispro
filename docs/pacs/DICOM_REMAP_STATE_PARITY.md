# DICOM Remap State and Behavior-Parity Contract

This contract protects the behavior-preserving DICOM remap refactor. It does not authorize a durable-processing redesign, PACS routing change, endpoint change, or database migration.

## State transitions

| Current state | Allowed transition | Trigger | Protected evidence |
| --- | --- | --- | --- |
| `uploaded` | `processing` | Durable worker claims the job and lease | Single active lease; reclaim only after expiry |
| `processing` | `awaiting_confirmation` | Staged selection and replacement preview succeed | Exactly one selected source study; manifest hashes and UID plan persist |
| `processing` | `failed` | Validation, rewrite, Orthanc, or persistence failure | Stable error code/message and retained diagnostic evidence |
| `awaiting_confirmation` | `remapped` | Explicit confirmation matches staged replacement | Persisted UID plan reused; rewritten SOP set exactly matches expected set |
| `awaiting_confirmation` | `cancelled` | Authorized explicit cancellation | Terminal; staged/Orthanc cleanup follows current rules |
| `remapped` | `sending` | Async destination enqueue succeeds or is safely verified | Destination key and Orthanc job identity persist |
| `sending` | `sent` | Orthanc reports successful completion | Exact modified study is the one sent |
| `sending` | `failed` | Verified terminal send failure or stale ambiguous enqueue | Retry diagnostics and attempt count persist |
| `failed` | current retry/reset path | Authorized retry or reset | No silent UID-plan replacement or source-study substitution |

## Parity invariants

- Upload selection accepts the same file shapes, skips the same folder artifacts, and enforces existing file/count/byte limits.
- A filename, patient hint, or upload order never substitutes for the selected Study Instance UID.
- Staging manifests retain version, file index, size, SHA-256, parsed identity, accepted outcome, and selected-study evidence.
- UID rewriting reuses the persisted study/series/SOP plan across retries and lease recovery.
- Orthanc verification requires exact Study Instance UID and SOP Instance UID set equality; no count-only success.
- Lease renewal/reclaim, retry, cancel, reset, cleanup, and asynchronous send behavior remain unchanged.
- Public exports from `dicom-remap-service.ts` and all HTTP route contracts remain stable.
- `GET /api/pacs/remap/jobs/:jobId/recover-source` is a read-only failed-job export: owner access, retained private staging, manifest/hash/size validation, and confirmed selected-study membership are required before streaming pristine source bytes. It does not enter the Orthanc recovery state machine or alter job state.

## Required validation

- Service and route unit tests, including upload validation and explicit confirmation.
- `dicom-remap-durable-processing.integration.test.ts` for lease recovery, persisted UID reuse, manifest hashes, and exact SOP verification.
- `dicom-remap-async-send.integration.test.ts` for enqueue, retry, monitoring, failure, and asynchronous delivery.
- PACS remap frontend tests for one-study selection and confirmation behavior.
- No live Orthanc request is required; tests use the existing controlled Orthanc seam.
