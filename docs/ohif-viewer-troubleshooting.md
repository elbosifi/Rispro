# OHIF Viewer Troubleshooting

| State | Meaning | Check |
| --- | --- | --- |
| OHIF Viewer is not configured | Environment or database gate is off, or no active source is selected | `.env`, Settings → OHIF Viewer, app restart |
| `not_found` | Exact accession returned no PatientID-safe study on the selected source | Accession formatting, selected node, OsiriX/Orthanc query |
| `ambiguous` | More than one equally safe candidate remains | PACS duplicate accession/identity metadata; do not bypass |
| source unavailable | DNS, TLS, auth, timeout, unsupported endpoint, or malformed response | Separate diagnostics and System Diagnostics request ID |
| QIDO succeeds, WADO fails | Search endpoint works but metadata/pixel retrieval does not | WADO-RS root, OsiriX feature support, auth/TLS, transfer syntax |
| retrieving | Orthanc C-MOVE is active or bounded priors are not local yet | Orthanc jobs, modality key, DICOM AE/firewall |
| retrieval failed/timed out | Orthanc did not receive the requested study within the configured bound | Remote AllowMove, Orthanc AE registration, source reachability |
| OHIF shell opens but images fail | Viewer cookie/session expired or DICOMweb response failed | Relaunch from RISpro; inspect `/ohif-dicomweb` status and request ID |

Never “fix” ambiguity by selecting the first PACS result. Never expose internal DICOMweb/Orthanc credentials in browser configuration. A failed native test does not authorize automatic fallback; select gateway mode explicitly.

Docker socket `EPERM` in agent preflight is an environment limitation, not a RISpro defect. Run compose/smoke checks on a host with Docker access and report them separately.
