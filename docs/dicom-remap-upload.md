# DICOM Remap Upload Transport

RISPro uses `POST /api/pacs/remap/jobs/upload-multipart` for the default DICOM remap upload flow. The browser sends `multipart/form-data` to RISPro, and RISPro stages files on disk before forwarding accepted DICOM instances to Orthanc `/instances`.

Deployment proxy requirements for large CT/MR studies:

- Allow request bodies large enough for the largest expected study, or disable proxy body buffering limits for this route.
- Use long proxy read/send timeouts. A 1000+ instance study can take several minutes depending on workstation, network, and Orthanc storage speed.
- For Nginx-style proxies, configure values equivalent to:
  - `client_max_body_size` large enough for the study size, for example `20g`.
  - `proxy_request_buffering off` for `/api/pacs/remap/jobs/upload-multipart` when streaming through the proxy is desired.
  - `proxy_read_timeout` and `proxy_send_timeout` at least `600s`.

Orthanc must remain server-side only. Browsers should upload to RISPro, not directly to Orthanc.
