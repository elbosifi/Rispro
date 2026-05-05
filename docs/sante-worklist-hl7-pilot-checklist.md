# Sante Worklist Server HL7 File-Drop Pilot Checklist

RISpro remains the source of truth for patients, appointments, accession numbers, scheduling, rescheduling, cancellation, and audit. The Sante Worklist Server integration is a parallel HL7 file-drop publisher for Sante's folder import workflow.

## Scope

- First-pass transport is file-drop only.
- RISpro writes ORM^O01 `.hl7` or `.txt` files to a backend-visible folder.
- Internal RISpro MWL and Orthanc/current MWL behavior remain active.
- Sante imports the files and exposes worklist entries to scanners through DICOM MWL C-FIND.
- RISpro infers import state from file disappearance, `.DON/.don`, or `.ERR/.err`.

## Backend Path Setup

- Mount the Sante import folder or share into the RISpro backend/container.
- Ensure the mount path is inside `SANTE_HL7_ALLOWED_BASE_PATHS`.
- Default allowed base path is `storage/sante-hl7-output`.
- Configure the UI output folder path as the backend/container path, not a browser or workstation path.
- Use Settings -> Sante Worklist Server -> Test Folder Access before enabling shadow mode.

## Pilot Steps

1. Apply database migrations.
2. Confirm `SANTE_HL7_ALLOWED_BASE_PATHS` includes the backend-visible mounted folder.
3. Open Settings -> Sante Worklist Server.
4. Set mode to `shadow`.
5. Keep internal MWL active.
6. Set output folder path and file extension to match Sante import settings.
7. Run Test Folder Access.
8. Send Synthetic Test HL7 and confirm Sante imports or marks it as expected.
9. Create a non-critical test appointment and confirm RISpro queues/writes an HL7 file.
10. Reschedule the test appointment and verify `XO` message behavior.
11. Cancel the test appointment and verify `CA` message behavior.
12. Check Recent Failures and Reconciliation before considering wider rollout.

## PHI And Logging

- Outbox rows store operational metadata and `payload_hash`.
- Full HL7 payload text is not stored in the database.
- Logs should not include patient name, DOB, national ID, or full message bodies.
- Synthetic test-file action uses synthetic test data by default.

## Rollback

- Set Settings -> Sante Worklist Server -> Enabled to Disabled.
- Internal RISpro MWL and Orthanc/current MWL remain available.
- Existing Sante files already dropped into the import folder are controlled by Sante import behavior.

