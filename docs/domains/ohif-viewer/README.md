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
       or -> Orthanc /dicom-web temporary cache
                -> bounded DIMSE retrieval from selected PACS
```

OHIF is built from the pinned `v3.12.6` source release with `PUBLIC_URL=/ohif/`. The browser never receives native PACS or Orthanc credentials. `/ohif-dicomweb/` rejects unrestricted QIDO and permits only exact StudyInstanceUIDs stored in the active hashed launch session.

## Configuration

1. Keep `OHIF_ENABLED=false` during installation.
2. Deploy and confirm `rispro-gateway`, `rispro-app`, and `rispro-ohif` health.
3. Open Settings → Integrations → OHIF Viewer after supervisor re-authentication.
4. Select an active `OHIF image source`; this is independent of the general default PACS.
5. Choose exactly one strategy:
   - Native DICOMweb: enter real base/QIDO/WADO roots and environment credential references.
   - Orthanc retrieval gateway: reuse RISpro Orthanc settings and enter the Orthanc remote-modality key for the selected PACS.
6. Record the installed OsiriX MD version and whether its DICOMweb server is enabled.
7. Run C-ECHO, QIDO, WADO metadata/frame, Orthanc REST, Orthanc DICOMweb, and authorized full-launch diagnostics separately.
8. Keep `OHIF_CACHE_CLEANUP_ENABLED=false` until cache ownership validation is complete.
8. Enable the database setting, then set `OHIF_ENABLED=true` and `COMPOSE_PROFILES=ohif` and restart the stack.

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
- Launch tokens and viewer-session cookie secrets are separate 256-bit random values stored only as SHA-256 hashes. A launch token is exchanged once, while its scoped HttpOnly `/ohif-dicomweb` viewer session remains valid until expiry.
- Browser requests cannot choose an upstream URL and cannot search the PACS by PatientID/name.
- Generic OHIF study-list browsing is disabled because the proxy permits only launch-session StudyInstanceUIDs.
- Credentials, authorization headers, complete metadata, patient names, PatientIDs, and accession values are excluded from OHIF structured logs and diagnostic summaries.
- Settings changes, diagnostics, resolution, retrieval, ready/failed launches, and proxy denials are audited.

## Known Limits

- The doctor QR worklist remains a permanent public-token read surface with optional authentication. It does not receive `Open Images`; mandatory-auth QR launch needs a separate product/security task.
- No automatic multi-PACS fallback exists.
- No key-image, screenshot, measurement, DICOM SR/KOS, report text, signing, or report-finalization integration is included.
- Real OsiriX, LAN, domain/TLS, and image-frame behavior must be validated in the target hospital environment.

See [OHIF operations runbook](../../ohif-viewer-operations-runbook.md), [troubleshooting](../../ohif-viewer-troubleshooting.md), and [rollback](../../ohif-viewer-rollback.md).
