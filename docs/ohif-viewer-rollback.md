# OHIF Viewer Rollback

1. For the normal operational rollback, disable the database OHIF setting. This removes `Open Images` and blocks new launches while the container may remain running.
2. For an emergency infrastructure rollback, set `OHIF_INFRASTRUCTURE_DISABLED=true` and run the supported setup/update script; it writes `OHIF_ENABLED=false` and clears the OHIF Compose profile. Stop an already-running OHIF container with `docker compose stop ohif` if immediate removal is required.
3. Keep SonicDICOM, RadiAnt, reporting, booking, PACS, and QR workflows unchanged.
4. If native DICOMweb alone fails, explicitly switch to Orthanc gateway after its diagnostics pass; this is a strategy change, not automatic fallback.
5. If gateway mode fails, disable OHIF. Do not delete or modify source PACS data.
6. The new tables may remain dormant for audit/history. Dropping migration tables is not required for rollback.
7. The gateway remains a transparent proxy for RISpro even while OHIF is disabled. If the gateway container itself is the problem, temporarily publish app port 3000 only as an operator-controlled deployment rollback and restore the documented stack after diagnosis.

Rollback never deletes studies from OsiriX or Orthanc automatically and never removes the existing viewer/report paths. Migration 124 is additive: leave its columns in place during rollback; no schema reversal is required for safe recovery.

For the opt-in native Orthanc **transport**, use `risproDelivery=proxy` in the
existing authorized viewer URL to return to Express immediately. Disable
`OHIF_NATIVE_DELIVERY_ENABLED` in `.env` and apply it with the existing Compose
file list plus `up -d --no-deps app` for future launches. Existing native tabs
must switch to proxy and reload. The native gateway overlay may remain mounted;
the Express fallback uses the saved Authoritative Orthanc Basic credentials
independently. No database or archive changes are required. See the
[native pilot instructions](ohif-viewer-operations-runbook.md).
