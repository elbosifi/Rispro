# OHIF Viewer Integration

## Purpose

OHIF Viewer is a separate, same-domain image viewer for authorized Doctor Portal Reporting Board appointment cases. RISpro remains authoritative for authentication, case visibility, accession resolution, PACS-source selection, audit, and short-lived launch sessions.

## Topology

```text
Doctor browser
  -> /api/doctor/reporting-board/cases/:id/viewer-launch
  -> /api/ohif/launch/:one-time-token
  -> /ohif/viewer?StudyInstanceUIDs=...
  -> /ohif-dicomweb/ (RISpro-authenticated, session-scoped proxy)
       -> selected native DICOMweb PACS
       or -> Authoritative Orthanc /dicom-web primary archive
       or -> Orthanc /dicom-web temporary cache
                -> bounded DIMSE retrieval from selected PACS
```

OHIF is built from the pinned `v3.12.6` source release with `PUBLIC_URL=/ohif/`. The browser never receives native PACS or Orthanc credentials. `/ohif-dicomweb/` rejects unrestricted QIDO and permits only exact StudyInstanceUIDs stored in the active hashed launch session.

## Configuration

1. Run the supported setup/update deployment; it deploys OHIF infrastructure while the database setting remains disabled by default.
2. Deploy and confirm `rispro-gateway`, `rispro-app`, and `rispro-ohif` health.
3. Open Settings → Integrations → OHIF Viewer after supervisor re-authentication.
4. Select the OHIF access strategy. Native DICOMweb and retrieval gateway require an active PACS node independent of the general default PACS; Authoritative Orthanc does not require a PACS node.
5. Choose exactly one strategy:
   - Authoritative Orthanc: reuse Settings → Authoritative Orthanc enablement, URL, credentials, TLS verification, and timeout. Enable its DICOMweb plugin at `/dicom-web`. Read current studies and bounded automatic priors directly from the primary archive; no C-MOVE, fallback, or cache deletion occurs.
   - Native DICOMweb: enter real base/QIDO/WADO roots and environment credential references.
   - Orthanc retrieval gateway: reuse RISpro Orthanc settings and enter the Orthanc remote-modality key for the selected PACS.
6. Record the installed OsiriX MD version and whether its DICOMweb server is enabled.
7. Run C-ECHO, QIDO, WADO metadata/frame, Orthanc REST, Orthanc DICOMweb, and authorized full-launch diagnostics separately.
8. Keep `OHIF_CACHE_CLEANUP_ENABLED=false` until cache ownership validation is complete.
9. Enable the database setting after source validation. No `.env` edit or Docker restart is required for routine operational enablement.

Do not store a username, password, or bearer token in the settings fields. Store environment-variable names such as `OHIF_DICOMWEB_PASSWORD`; put the actual secret only in `.env` or the deployment secret manager.

## Accession Resolution and Priors

- RISpro queries the selected source by exact accession.
- PatientID must agree when both systems provide it. Patient name is never sufficient.
- Modality and study-date proximity are supporting evidence only.
- Equal best candidates return `ambiguous`; RISpro never silently chooses the first result.
- Successful mappings are persisted per appointment and source, then re-verified before reuse.
- Priors require exact PatientID, precede the current study date, exclude the current UID, prefer the same modality, and are bounded (default five).
- Gateway mode retrieves the bounded current/prior set only. Orthanc is not archive authority.
- Before each C-MOVE, RISpro snapshots exact Orthanc study IDs for that StudyInstanceUID. It records ownership only when exactly one new ID appears after retrieval. Cleanup is disabled by default and, when explicitly enabled, deletes only that persisted owned ID—never every matching UID and never a source-PACS resource.

## OsiriX MD Verification

Repository defaults prove only the legacy DIMSE assumption (`OSIRIXR` and port 103 in old migrations). Before native mode, an administrator must verify the actual installed OsiriX MD version, QIDO response, WADO-RS metadata, an instance/frame response, authentication, TLS, and CORS. QIDO success does not prove WADO works. If native DICOMweb is incomplete, select Orthanc gateway explicitly; RISpro never silently changes strategies or searches another PACS node.

## Security and Audit

- Reporting Board authorization is re-evaluated server-side for every launch.
- Launch tokens and viewer-session cookie secrets are separate 256-bit random values stored only as SHA-256 hashes. A launch token is exchanged once before its short deadline. The exchanged HttpOnly `/ohif-dicomweb` viewer session receives a fresh lifetime of `SESSION_HOURS` (default eight hours); every request also requires a valid RISpro login, and revoked or expired viewer sessions are rejected.
- Browser requests cannot choose an upstream URL and cannot search the PACS by PatientID/name.
- Generic OHIF study-list browsing is disabled because the proxy permits only launch-session StudyInstanceUIDs.
- Credentials, authorization headers, complete metadata, patient names, PatientIDs, and accession values are excluded from OHIF structured logs and diagnostic summaries.
- Settings changes, diagnostics, resolution, retrieval, ready/failed launches, and proxy denials are audited.

## Image Delivery

An opt-in native Orthanc transport is available behind
`OHIF_NATIVE_DELIVERY_ENABLED=false` (the default). Its GET-only nginx route
streams WADO metadata, JPEG thumbnails and lossless diagnostic frames directly
from the private authoritative archive. The official Authorization plugin calls
RISpro's existing login/case/session checks and exact study allowlist, caching
decisions for one second without exceeding login/session expiry. Current/prior
discovery and the original Express transport remain available. The native
thumbnail branch uses Orthanc's rendered endpoint through OHIF's existing
bounded image-load pool; it does not add a generator or persistent image cache.
The ordinary proxy still uses its established thumbnail path. See the
[native pilot and rollback instructions](../../ohif-viewer-operations-runbook.md).

Native pixel transfers do not add HTTP gzip: the local identity/gzip experiments
found higher complete-frame latency with gzip for uncompressed, RLE, JPEG
lossless, JPEG-LS and JPEG2000 fixtures. Stored compressed frame bytes and decoded
pixels were identical. Reassess this transport choice with synthetic studies on
the target LAN; startup assets retain their existing gzip compression and the
viewer build now uses production minification.

The viewer's iPhone/iPad presentation is customized at source-build time, keeping
the original desktop header at widths of 1280px and above. Compact layouts reuse
OHIF's toolbar commands and panels, provide touch series selection and use the
existing Cornerstone gestures and resize service. See the
[responsive implementation and validation](../../plans/completed/ohif-ios-responsive.md)
for breakpoints, synthetic browser evidence, physical Safari limitations and rollback.
The [responsive verification and series windowing follow-up](../../plans/completed/ohif-ios-responsive-windowing.md)
records current-baseline checks and restoration of stored DICOM window/level when
opening a different CT/MR stack, including revisits.

The gateway applies lossless HTTP gzip compression to `/ohif-dicomweb/` responses when the browser accepts gzip. The browser restores the exact original pixel bytes before OHIF decodes them. Multipart boundary headers are preserved; partial-range responses retain their original byte ranges. Image responses remain private and are not stored in a shared cache.

The proxy retains four interaction requests, one thumbnail, and one prefetch. Native delivery uses four interaction requests, four thumbnails, and one prefetch, selected from isolated synthetic measurements. Hospital LAN verification remains pending.

The OHIF origin compresses JavaScript, CSS, WASM, SVG and JSON startup assets with gzip level 1. A disconnected DICOMweb response aborts its upstream request while preserving the archive timeout and exact-study session checks. Normal completed responses keep their existing behavior.

See the [phase-2 performance assessment](../../plans/completed/ohif-performance-phase-2.md) for synthetic measurements, thumbnail compatibility findings, reproduction, and rollback. Focused synthetic validation passed in Chromium and WebKit; real LAN/public HTTPS, actual Safari and future exact-commit CI remain unverified. Existing unrelated CI failures still prevent deployment gating.

Compression savings depend on the source transfer syntax. Already compressed images can have little additional reduction. This does not introduce a lower-resolution preview or a full-quality toggle; that requires separate OHIF loading behavior and archive capability validation. Investigate a slow first image using the frame request's time to first byte, download duration, transferred bytes, and the viewport render timing.

## Known Limits

- The doctor QR worklist remains a permanent public-token read surface with optional authentication. It does not receive `Open Images`; mandatory-auth QR launch needs a separate product/security task.
- No automatic multi-PACS fallback exists.
- Native RISpro reporting, annotated key-image capture, signing and addenda retain their existing integration. This work adds no DICOM SR/KOS export.
- Real OsiriX, LAN, domain/TLS, and image-frame behavior must be validated in the target hospital environment.

See [OHIF operations runbook](../../ohif-viewer-operations-runbook.md), [troubleshooting](../../ohif-viewer-troubleshooting.md), and [rollback](../../ohif-viewer-rollback.md).
