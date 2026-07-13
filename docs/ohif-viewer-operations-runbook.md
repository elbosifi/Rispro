# OHIF Viewer Operations Runbook

## Deployment

1. Back up PostgreSQL and preserve the existing `.env`.
2. Pull/build the stack; migrations `123_ohif_viewer_integration.sql` and `124_ohif_viewer_hardening.sql` are applied by the app entrypoint.
3. Run the supported setup or update script. It automatically writes `OHIF_ENABLED=true` and `COMPOSE_PROFILES=ohif`, staging the container while the database OHIF setting remains disabled and the doctor action stays unavailable. Verify:
   - `curl -f http://localhost:3000/api/health`
   - `curl -f http://localhost:3000/ohif/`
   - `docker compose ps` reports app, gateway, and OHIF healthy.
4. Configure the independent PACS source and strategy in Settings.
5. Run each diagnostic and record exact outcomes. For OsiriX, use a known accession/UID and verify QIDO, WADO metadata, a real frame, and an authorized appointment full-launch preparation separately.
6. For gateway mode, confirm the selected Orthanc modality can C-ECHO and C-MOVE to the Orthanc AE; confirm `/dicom-web/studies` works inside the network.
7. Enable the database OHIF setting and verify `Open Images` for a controlled doctor/case. No `.env` or Docker change is required for ordinary enable/disable operations.
8. Confirm the current study, bounded priors, LAN access, domain access, audit entries, and no credentials in browser network responses.

## Monitoring

System Diagnostics shows the environment/database gates, selected source/strategy, last QIDO/WADO states, active retrievals, and recent retrieval failures. Audit Log and System Diagnostics remain separate. Use the HTTP `X-Request-Id` to correlate a failed launch with structured logs.

The deployment summary reports whether the OHIF container was deployed, the environment infrastructure gate, and `/ohif/`. It cannot determine the database operational setting without querying RISpro; check Settings → Integrations → OHIF Viewer or System Diagnostics. Use `OHIF_INFRASTRUCTURE_DISABLED=true` only for an emergency deployment rollback.

Inspect container logs with:

```bash
docker compose logs gateway ohif app
```

Gateway mode retains completed retrieval-job records for the configured cache period. `OHIF_CACHE_CLEANUP_ENABLED=false` is the default. When an operator explicitly enables it, the cleanup worker evicts only a persisted Orthanc study ID that was proven to appear after that retrieval's pre-C-MOVE cache snapshot, after retention expires and after all launch sessions for that UID expire. It never searches-and-deletes by StudyInstanceUID, deletes a pre-existing Orthanc study, or deletes a source-PACS study.

## Controlled Pilot

- Preserve SonicDICOM and RadiAnt actions.
- Start with selected doctors and known studies.
- Review `not_found`, ambiguity, source-unavailable, retrieval-failure, and timeout counts daily.
- Do not classify the integration as ready for general rollout until real OsiriX QIDO/WADO/frame, current/prior launch, LAN/domain, and authorization tests pass.
