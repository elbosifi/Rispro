# OHIF Viewer Rollback

1. Disable the database OHIF setting, set `OHIF_ENABLED=false`, and clear `COMPOSE_PROFILES`, then restart RISpro. This removes `Open Images` and blocks new launches.
2. Stop the already-running optional container with `docker compose stop ohif`; clearing a profile prevents future deployment but is not relied on to stop an existing container.
3. Keep SonicDICOM, RadiAnt, reporting, booking, PACS, and QR workflows unchanged.
4. If native DICOMweb alone fails, explicitly switch to Orthanc gateway after its diagnostics pass; this is a strategy change, not automatic fallback.
5. If gateway mode fails, disable OHIF. Do not delete or modify source PACS data.
6. The new tables may remain dormant for audit/history. Dropping migration tables is not required for rollback.
7. The gateway remains a transparent proxy for RISpro even while OHIF is disabled. If the gateway container itself is the problem, temporarily publish app port 3000 only as an operator-controlled deployment rollback and restore the documented stack after diagnosis.

Rollback never deletes studies from OsiriX or Orthanc automatically and never removes the existing viewer/report paths. Migration 124 is additive: leave its columns in place during rollback; no schema reversal is required for safe recovery.
