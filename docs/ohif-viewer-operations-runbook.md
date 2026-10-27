# OHIF Viewer Operations Runbook

## Deployment

1. Back up PostgreSQL and preserve the existing `.env`.
2. Pull/build the stack; migrations `123_ohif_viewer_integration.sql` and `124_ohif_viewer_hardening.sql` are applied by the app entrypoint.
3. Run the supported setup or update script. It automatically writes `OHIF_ENABLED=true` and `COMPOSE_PROFILES=ohif`, staging the container while the database OHIF setting remains disabled and the doctor action stays unavailable. Verify:
   - `curl -f http://localhost:3000/api/health`
   - `curl -f http://localhost:3000/ohif/`
   - `docker compose ps` reports app, gateway, and OHIF healthy.
4. Configure the OHIF source and strategy in Settings. For Authoritative Orthanc, enable/configure the existing Authoritative Orthanc connection and its `/dicom-web` plugin, then select **Authoritative Orthanc** in OHIF Viewer. No PACS node or remote-modality key is required; current studies and automatic priors are read directly from the archive. Run REST, DICOMweb, accession, metadata, frame, and full-launch diagnostics before pilot use. Missing studies return not-found without retrieval or another-source fallback.
5. Run each diagnostic and record exact outcomes. For OsiriX, use a known accession/UID and verify QIDO, WADO metadata, a real frame, and an authorized appointment full-launch preparation separately.
6. For gateway mode, confirm the selected Orthanc modality can C-ECHO and C-MOVE to the Orthanc AE; confirm `/dicom-web/studies` works inside the network.
7. Enable the database OHIF setting and verify `Open Images` for a controlled doctor/case. No `.env` or Docker change is required for ordinary enable/disable operations.
8. Confirm the current study, bounded priors, LAN access, domain access, audit entries, and no credentials in browser network responses.

## Native Orthanc delivery pilot (disabled by default)

`OHIF_NATIVE_DELIVERY_ENABLED=false` is the default. Native delivery is separate
from the existing `authoritative_orthanc` source strategy. It changes transport
only: launch, case authorization, study selection, reporting and the Express
fallback retain their existing authority.

Before a future approved pilot, load the official Authorization and DICOMweb
plugins on the **private** authoritative archive. Merge the
[authorization example](../docker/ohif/orthanc-authorization.example.json) into
its configuration, replacing the callback password with the same secret as
`OHIF_NATIVE_AUTH_SECRET` on RISpro. Built-in Orthanc Basic authentication is
replaced by the Authorization plugin; authentication is not disabled. Existing
archive Basic credentials are checked by the callback's service-user profile.
The browser receives neither those credentials nor the callback secret.

Mount [native-location.conf](../docker/ohif/native-location.conf) read-only at
`/etc/nginx/ohif-native/native.conf` in the gateway, adapting its internal
upstream to that same authoritative archive. The ordinary stack does not mount
this file. Expose only the GET-only native study path; administrative REST and
STOW access must remain private. DICOMweb internally performs `POST /tools/find`,
so the plugin callback accepts that study lookup; nginx remains the boundary
that prevents browser writes.

Only after archive/plugin and target-environment testing should an operator
enable `OHIF_NATIVE_DELIVERY_ENABLED=true`. New authorized launches then select
native WADO metadata, JPEG thumbnails and unchanged diagnostic frames. Exact-study
discovery remains available through the scoped Express proxy. Authentication,
case access, active user/auth version, exact study allowlist, expiration and
revocation are checked by the existing RISpro code. The official plugin caches
decisions for **one second**; revocation takes effect within that bound, and a
grant is never issued past login/session expiry. Responses are private/no-store.

For immediate transport rollback, set `risproDelivery=proxy` on the existing
authorized viewer URL. For subsequent launches, turn off the native environment
gate and restart the app. Retain the callback secret/profile service while the
archive Authorization plugin remains configured, so existing backend Basic
operations and the Express fallback keep working. No study deletion, migration
rollback or change to reporting is involved.

Local synthetic acceptance and measurements are recorded in the
[native delivery results](plans/completed/ohif-native-delivery-results.md).
Hospital LAN latency, actual iPad/Safari, production routing and
production plugin configuration remain operator validation tasks. This work does
not activate the production pathway.

## Monitoring

System Diagnostics shows the environment/database gates, selected source/strategy, last QIDO/WADO states, active retrievals, and recent retrieval failures. Audit Log and System Diagnostics remain separate. Use the HTTP `X-Request-Id` to correlate a failed launch with structured logs.

The deployment summary reports whether the OHIF container was deployed, the environment infrastructure gate, and `/ohif/`. It cannot determine the database operational setting without querying RISpro; check Settings → Integrations → OHIF Viewer or System Diagnostics. Use `OHIF_INFRASTRUCTURE_DISABLED=true` only for an emergency deployment rollback.

Inspect container logs with:

```bash
docker compose logs gateway ohif app
```

Authoritative Orthanc mode never creates retrieval jobs or deletes archived images. Its credentials remain server-side and its viewer requests retain normal RISpro authentication and exact-study session scope.

Gateway mode retains completed retrieval-job records for the configured cache period. `OHIF_CACHE_CLEANUP_ENABLED=false` is the default. When an operator explicitly enables it, the cleanup worker evicts only a persisted Orthanc study ID that was proven to appear after that retrieval's pre-C-MOVE cache snapshot, after retention expires and after all launch sessions for that UID expire. It never searches-and-deletes by StudyInstanceUID, deletes a pre-existing Orthanc study, or deletes a source-PACS study.

## Controlled Pilot

- Preserve SonicDICOM and RadiAnt actions.
- Start with selected doctors and known studies.
- Review `not_found`, ambiguity, source-unavailable, retrieval-failure, and timeout counts daily.
- Do not classify the integration as ready for general rollout until real OsiriX QIDO/WADO/frame, current/prior launch, LAN/domain, and authorization tests pass.
