# Authoritative Orthanc Operations

The main DICOM transfers table shows DICOM C-STORE operations rather than generic Orthanc jobs. Patient and study context is derived read-only from the transferred Orthanc resource when available; unresolved clinical context does not mean the transfer failed. Technical Orthanc information remains available in Details, and Retry still resubmits the individual failed Orthanc job.

RISpro exposes Authoritative Orthanc operational state at **Systems → Authoritative Orthanc** (`/systems/authoritative-orthanc`). This page monitors the primary archive, selected stable-series routes, Orthanc transfer jobs, study lookup, and the existing clinical-document export queue.

Configuration remains in **Settings → Authoritative Orthanc**. Enablement, URL, credentials, TLS verification, timeout, clinical-document auto-export, auto-routing, and destination selection must not be copied to the Operations page.

## Access and actions

| Role | View health, routes, jobs, exports; refresh; study lookup | C-ECHO; retry failed Orthanc jobs and exports | Synchronize routes; reconcile exports |
| --- | --- | --- | --- |
| Modality staff | Yes | No | No |
| Supervisor | Yes | Yes | No |
| Super admin | Yes | Yes | Yes |

Receptionist, doctor, and administrative roles have no default access. Backend role and page-access middleware enforce these boundaries even if a browser control is bypassed.

## Health states

- **Healthy:** Orthanc `/system` is reachable, selected managed routes exist with valid PACS configuration, required status sections are available, and no relevant DICOM Store job failed in the last 24 hours.
- **Degraded:** Orthanc is connected, but a selected route is missing or invalid, a relevant recent DICOM Store job failed, or an operational section such as jobs/statistics is unavailable.
- **Offline:** the core Orthanc connection is unreachable, timed out, or authentication failed.
- **Disabled:** the integration is disabled in Settings.

`Not tested` means no operator has run C-ECHO for that route since the current RISpro process started. It is not a failure and does not by itself degrade health. Normal 30-second polling never runs C-ECHO.

## Operator procedures

- **Test** sends one bounded C-ECHO through the expected managed `rispro_route_*` alias. **Test all** tests selected destinations with bounded concurrency and preserves each destination result when another fails.
- **Retry** is available only for an Orthanc job currently reported as `Failure`. RISpro uses Orthanc's supported job resubmit action; it does not cancel, pause, or delete jobs.
- **Synchronize routes** reuses the same reconciliation used when Authoritative Orthanc settings are saved. It creates or updates selected `rispro_route_*` aliases and removes obsolete RISpro-managed or legacy auto-route aliases. It never removes unrelated Orthanc modalities and does not change `OnStableSeries` behavior.
- **Study lookup** accepts exactly one StudyInstanceUID or Accession Number and returns normalized read-only study details. Ambiguous and not-found results require no mutation.
- Clinical-document **Retry** uses the existing export queue for failed or blocked rows. **Reconcile exports** uses the existing reconciliation service; no second job table or worker exists.

## Troubleshooting

- **Orthanc offline:** verify the server and network, then check the configured base URL and timeout in Settings.
- **Authentication failure:** verify the configured Orthanc username/password in Settings. Credentials are never displayed on Operations.
- **Managed route missing:** confirm the PACS destination is still selected and valid, then have a super admin run Synchronize routes.
- **C-ECHO failure:** verify the destination AET, host, port, firewall, and remote PACS availability in the PACS configuration. A successful REST connection does not imply DICOM reachability.
- **Failed C-STORE job:** inspect its sanitized error, correct the destination problem, then have a supervisor or super admin retry the eligible failed job.

The Operations page is deliberately not a generic Orthanc administrator. It cannot delete or modify DICOM resources, edit modalities or Lua/configuration, restart Orthanc, cancel/pause jobs, or send arbitrary studies. Unsupported emergency and server-level operations still require direct, authorized Orthanc administration.
