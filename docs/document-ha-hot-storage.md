# Temporary document HA hot storage

RISpro keeps the ordinary filesystem document as the canonical long-term copy. For eligible Reception and Modality appointment documents, the backend also stores a temporary PostgreSQL `bytea` copy in `document_ha_blobs`.

## Scope

The HA copy is created only after the normal file has been written and the `documents` row is inserted, in the same database transaction whenever the caller supplies the transaction executor. Eligibility requires an appointment or V2 booking and is limited to these pairs:

- `appointment_request`: `manual_upload`, `naps2_webscan`, `scanner_app`, `request_scan_automation`
- `clinical_document`: `manual_upload`, `naps2_webscan`, `scanner_app`, `modality_scan_automation`

Incident attachments, comparison material, reports, SonicDICOM content, PACS/backup data, and complementary-recall documents are excluded.

The defaults are `ha_hot_storage_enabled=true` and `ha_hot_storage_retention_hours=48`. Retention settings are restricted to integer values from 24 through 168 hours.

## Reads and recovery

Document reads use the canonical filesystem path first. Only a genuine filesystem read failure triggers a PostgreSQL HA lookup. The document view route preserves its normal `sendFile` response and sends the verified HA bytes with the same MIME type and inline filename when the filesystem is unavailable. Request Scan previews, failed-file identity checks, and clinical-document export use the same logical content reader; filesystem-management operations continue to use real paths.

An approximately hourly in-process worker claims at most 50 due blobs using `FOR UPDATE SKIP LOCKED` and a short reconciliation lease. It verifies the HA bytes and then verifies the normal file is regular, inside an approved storage root, readable, correctly sized, and SHA-256 identical. Healthy files release only the HA row.

If the normal file is missing or corrupt, recovery writes to a staging path, verifies the staged bytes, atomically promotes them to the preferred network storage, verifies the final file, updates document metadata only after verification, verifies again, and then releases the HA row. If network recovery fails and local fallback is enabled, the same verified process uses local fallback. If all destinations fail, the HA row is retained and the document records the attempt and safe error for a later retry.

Deleting a document cascades to its HA row. There is no backfill and no change to PACS, Patroni, PostgreSQL, HAProxy, or etcd configuration.
