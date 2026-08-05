# NAPS2 Scanner Sharing deployment

RISpro scans appointment documents directly from the browser to NAPS2 Scanner
Sharing over eSCL. The legacy RISpro Scanner Bridge and Scanner Companion remain
available only for rollback; they are not required for this workflow.

On the scanner workstation, enable NAPS2 Scanner Sharing and configure
`<EsclSecurityPolicy>ServerAllowAnyOrigin</EsclSecurityPolicy>` in NAPS2
`appsettings.xml`. Restart NAPS2 after changing that file and keep NAPS2 running
or use its supported startup configuration.

For a local scanner, configure `http://127.0.0.1:9801` in Settings > Documents &
Uploads. For a shared scanner, use a stable scanner-host IP address or DNS name
and port, for example `http://scanner-workstation:9801`. Allow that eSCL port in
Windows Firewall only for the required hospital subnet. NCCB's current
`192.9.101.0/24` network is documented here only; it is not application logic.

RISpro currently runs over HTTP. Managed Edge workstations can require Local
Network Access policy for browser access to a LAN scanner. The NAPS2 host must
allow RISpro browser origins. The global scanner origin can be provided through
`NAPS2_WEBSCAN_ENDPOINT`; additional browser-workstation override origins must
be listed as exact comma-separated HTTP/HTTPS origins in
`NAPS2_WEBSCAN_ALLOWED_ORIGINS` so the server can include them in `connect-src`.
RISpro does not accept wildcards, URL paths, or arbitrary dynamic origins.

When RISpro is served over HTTPS, remote scanners must also use HTTPS with a
certificate trusted by the browser; otherwise mixed-content rules block the
request. CSP approval does not replace NAPS2 CORS configuration, browser Local
Network Access permission or policy, certificate trust, DNS/routing, or the
scanner-host firewall rule.

Manual PDF/image upload remains available if NAPS2, the network, CORS, CSP, or
browser policy is unavailable.
