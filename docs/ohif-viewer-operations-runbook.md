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

## Native Orthanc delivery in prepared deployments

Base installations default to proxy. Deploying `docker-compose.ohif-native.yml`
with its required gateway secret enables native automatically, unless
`OHIF_NATIVE_DELIVERY_ENABLED=false` is explicitly set. Native delivery is separate
from the existing `authoritative_orthanc` source strategy. It changes transport
only: launch, case authorization, study selection, reporting and the Express
fallback retain their existing authority.

Use the existing authenticated Authoritative Orthanc and its DICOMweb plugin.
**Do not install the Authorization plugin, change Basic authentication, or change
Orthanc configuration.** The historical plugin results describe the
previous transport and are not deployment instructions for this pathway.

Browser GET requests to `/ohif-native/context/<context>/studies/<UID>/...` invoke
Nginx `auth_request`. Its internal subrequest calls `/api/ohif/native/authorize`
with the RISpro login cookie, complete original URI/method and a gateway secret.
RISpro checks the live login/auth version, context ownership, case permissions,
study allowlist, expiry and revocation using `authorizeViewerDicomWebRequest`.
It validates the complete raw study path, including series/instance UIDs and
frame lists; administrative paths, traversal and writes are rejected. There is
no authorization cache. Revocation affects subsequent requests; an already
authorized transfer can finish.

Only a successful, gateway-authenticated subrequest receives private headers
containing the saved authoritative origin, Basic credential and validated path.
Nginx consumes these internally, then streams metadata, multipart frames and
rendered thumbnails from that archive directly. The public gateway blocks the
credential endpoint and the subrequest location is internal. Direct backend API
clients without the independent gateway secret receive 403, including logged-in
supervisors. Browser headers cannot override the upstream credential. Cookies,
gateway tokens and browser Authorization headers are not sent to Orthanc.
Responses are private/no-store; native access logging is off. Keep debug/header
logging off, and never publish `nginx -T`, container environment dumps or `.env`.

The origin and `rispro_service` credentials come from Settings, without a second
archive credential configuration. In this hospital the origin must remain
`http://192.9.101.170:8042`; **never use `orthanc:8042`**, the reconciliation
archive. This transport supports HTTP origins with Basic authentication. HTTPS
origins fail closed pending an explicit gateway CA/trust configuration; the
Express fallback retains its existing HTTP/HTTPS behavior. The gateway-to-archive
HTTP link carries Basic credentials and medical data on the existing trusted
hospital network. Protect that link and Docker gateway/app network access.

Diagnostic frames are not transcoded or recompressed by the gateway. `Accept`,
`Range`, and `If-Range` reach Orthanc, and multipart Content-Type/boundaries,
Content-Range and Accept-Ranges are retained. Range support remains an Orthanc
resource capability; a resource that ignores Range may return its full 200 body.
Upstream redirects are blocked. Authorization failures remain 401/403;
authorization-service faults fail closed. Exact-study discovery stays on the
scoped Express proxy. Viewer controls, reporting, loading limits and prefetch
code are unchanged. Native failure does not silently choose another archive;
use the explicit proxy rollback below.

### Operator activation on `/opt/Rispro` (requires release approval)

1. Finish code review and the required CI/release gates for the exact release.
   Back up `.env` and record the VM's current Compose file list. Preserve every
   existing override (especially the database/internal Orthanc overrides).
2. Install the reviewed source at `/opt/Rispro`. Keep
   `OHIF_NATIVE_DELIVERY_ENABLED=false` initially. Confirm the authoritative
   Settings origin and already-saved `rispro_service` account; do not edit either
   Orthanc service or production database data for this transport change.
3. Generate a separate gateway secret with `openssl rand -hex 32` and put it in
   `/opt/Rispro/.env` as `OHIF_NATIVE_AUTH_SECRET=<64 lowercase hex characters>`.
   Restrict `.env` to the operator (`chmod 600 .env`). This is a gateway secret,
   not a second Orthanc password. Do not paste it into tickets or logs.
4. Append `docker-compose.ohif-native.yml` to the **existing** Compose file list.
   For a VM using only the base file, the commands below apply. If it uses other
   overrides, insert their `-f` arguments after the base file in every command:

   ```bash
   cd /opt/Rispro
   docker compose -f docker-compose.yml -f docker-compose.ohif-native.yml build app
   docker compose -f docker-compose.yml -f docker-compose.ohif-native.yml up -d --no-deps app gateway
   docker compose -f docker-compose.yml -f docker-compose.ohif-native.yml exec -T gateway test -s /etc/nginx/ohif-native/native.conf
   docker compose -f docker-compose.yml -f docker-compose.ohif-native.yml exec -T gateway nginx -t
   ```

   The official Nginx entrypoint substitutes only the gateway secret into the
   native template, in a private tmpfs directory. No Orthanc credential is put
   in the template or container environment. Persist the added Compose file in
   the VM's normal startup/update command so future recreations retain it.
5. Verify `/api/health`, `/ohif/`, and ordinary proxy viewing while native remains
   off. Verify public `/_ohif-native-authorize` and
   `/api/ohif/native/authorize` return 404. In the approved pilot window,
   remove the staging `OHIF_NATIVE_DELIVERY_ENABLED=false` entry from `.env`
   (including any exported shell override), then apply the overlay default to
   the web app:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.ohif-native.yml up -d --no-deps app
   ```

   Do not use `restart` to apply changed environment values. No Orthanc restart,
   migration rollback or auto-routing change is needed. Do not run commands
   that recreate the internal Orthanc or the whole stack.
   Existing deployments carrying an explicit `false` retain proxy delivery until
   that override is removed. No Settings or doctor-facing delivery selection is
   needed; other access strategies retain their existing transport.
6. Open a fresh authorized case. In browser DevTools Network, filter `frames`,
   `metadata` and `rendered`. WADO URLs must start with the RISpro origin plus
   `/ohif-native/context/<context>/studies/<UID>/...`, with successful multipart
   frames/JSON metadata/JPEG thumbnails. QIDO discovery can use
   `/ohif-dicomweb/context/...`. No browser request should go to the Orthanc
   origin or contain an Orthanc Authorization header. Check an unauthorized
   study and signed-out request fail, then test CT/MR scrolling and priors.

### Immediate rollback

For each open viewer, replace `risproDelivery=native` in its URL with
`risproDelivery=proxy` and reload. This works without a service restart and uses
the same authorized context. For subsequent launches, set
`OHIF_NATIVE_DELIVERY_ENABLED=false` in `/opt/Rispro/.env`, then run the same
Compose command above with `up -d --no-deps app`. Existing native URLs then fail
closed, so switch/reload any remaining tabs. The optional gateway overlay can
stay mounted; removing it is not needed for immediate rollback. Leave the saved
Orthanc credentials, reporting state and both Orthanc servers unchanged.

### Local acceptance and remaining hospital checks

See [authenticated native results](plans/completed/ohif-authenticated-native-delivery.md)
for exact local commands, measurements and limitations. Before hospital rollout,
repeat on the actual gateway-to-authoritative LAN path with operator-approved
test studies: CT/MR first pixels/full series/unloaded slice/reopen timing,
lossless compressed syntaxes, MPR/MIP, key images/annotations, drafts/sign/review,
dictation, authorized priors, physical iPad/Safari, session expiry/revocation,
credential rotation, gateway/app recreation and immediate proxy rollback.

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
