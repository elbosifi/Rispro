# NAPS2 Scanner Sharing deployment and acceptance

RISpro uses browser-to-NAPS2 eSCL scanning. Manual PDF/JPEG/PNG upload remains
available. The Scanner Companion and Node Scanner Bridge are rollback code only;
the normal UI and integration status expose NAPS2. No new application, service,
Node runtime, NAPS2 installer, or certificate is delivered by scanner setup.

## Administrator configuration — through RISpro

Open **Settings > Documents & Uploads > Appointment request scanning**.
Enable NAPS2, confirm the **RISpro HTTP address** (the approved hospital IPv4
address, including any nondefault port), and **Save document settings**. Saving
uses the existing supervisor re-authentication and audit flow. No environment
variable, configuration file, migration or server restart is required.

When opened over an HTTP IPv4 address, the form proposes that address visibly.
Only the administrator's protected Save action approves it. The download uses
the saved, strictly validated origin, never Host, Forwarded or query parameters.
No hospital IP is hard-coded. Paths, credentials, queries and wildcards are rejected.

For a normal local scanner, leave **Advanced shared scanner settings** closed
and its fields empty. This selects automatic local HTTP discovery. Global
enablement does not prove workstation connectivity. Endpoint precedence is saved
workstation override, explicit saved system endpoint, then local discovery.
An explicit endpoint never falls back to another scanner. Saved UI values,
including disabled/empty values, override legacy NAPS2 environment defaults.

CSP allows exact HTTP origins for `127.0.0.1` and `localhost` on ports 9801–9850.
Saving a system scanner endpoint approves its exact origin automatically;
additional workstation scanner origins can be approved in the collapsed
Advanced section. Permissions are loaded at server startup and refreshed after
a successful settings transaction; response headers do not read the DB.
Reload affected workstation pages after changing approvals to get the new CSP.
No LAN wildcard or QZ rule is introduced or changed.

If the address is missing, the download button directs the administrator to
Settings. It checks HTTP status, content type and script framing before saving;
errors remain visible on the workstation page. Discard a JSON error saved by an
older version as `.cmd`. These checks detect error responses, not HTTP tampering.

## Operator setup

1. Install official NAPS2. Select the scanner, enable Scanner Sharing and the
   installed release's supported background-sharing/start-at-login options.
2. Open RISpro > Workstation printing and scanning > NAPS2. Download
   `RISpro-NAPS2-Setup.cmd` and run it as administrator. A normal double-click
   requests UAC elevation if needed. When Repair finds the insecure-origin
   exception missing, review its warning and exact RISpro HTTP origin, then
   type `YES` to approve that one policy. UAC approval alone does not approve
   the compatibility exception. If declined or noninteractive, setup leaves
   that policy unchanged and reports Action required. No further payload is
   downloaded.

Download: authenticated `GET /api/scanner-bootstrap/windows-setup`.
Workstation roles can download it independently of QZ readiness. For a saved
workstation override, the link selects an endpoint only from the server CSP
origin list; arbitrary endpoint/query script content is rejected. The fixed
attachment uses `application/octet-stream`, `Cache-Control: no-store` and
`X-Content-Type-Options: nosniff`.

The self-contained batch uses built-in Windows PowerShell and:

- Requires Windows 10/11; detects NAPS2 in Program Files (64/32-bit), per-user
  Programs, registered installation locations, or the running application's
  directory. Ambiguous installations or a missing real installation-level
  `appsettings.xml` require administrative action.
  Versions before 7.5.2 lack the required browser CORS flag and are rejected
  before XML changes; setup never updates them automatically.
- Parses XML with DTDs disabled. Rejects conflicting security policies and
  `NoScannerSharing=true`. Before changes, creates a timestamped, byte-for-byte
  `.bak` beside the XML; preserves unrelated elements/comments, ensures exactly
  one `EsclSecurityPolicy=ServerAllowAnyOrigin`, and replaces the file atomically
  after checking that it has not changed concurrently. Correct XML is untouched.
- Reads the installed `msedge.exe` ProductVersion as a four-part Windows
  version. It does not use the Edge Update version. Missing, malformed and
  pre-77 versions fail safely without writing browser policies.
- Configures only policies supported by the detected Edge version, using the
  exact validated RISpro HTTP origin from the downloaded setup:

  | Edge version | Policies configured |
  | --- | --- |
  | Below 77 | Unsupported; no policy writes |
  | 77–139 | `OverrideSecurityRestrictionsOnInsecureOrigin` |
  | 140–145 | Above, plus `LocalNetworkAccessAllowedForUrls` |
  | 146+ | Above, plus `LoopbackNetworkAllowedForUrls` |

  These minimum versions describe policy support only; they do not prove
  browser-to-scanner or physical scanner compatibility. `HostRepair` does not
  add the insecure-origin exception; use Repair for its explicit approval.
  Each policy uses an unused numbered REG_SZ value, preserves unrelated
  entries, verifies registry readback, and does not add wildcard origins. The
  insecure-origin policy is added only after explicit administrator approval.
  A newly installed policy requires closing and reopening Edge; policy reload
  alone does not activate the insecure-origin exception. Setup never terminates
  Edge or NAPS2. Repeat Repair does not request another restart when all
  applicable policies are already installed.
- Checks machine and loaded user Edge policy locations for higher-priority
  blocking policies. Conflicts are reported and preserved. On domain/MDM-managed
  devices, missing entries are reported by exact policy name for central
  administrator configuration; local setup never fills centrally managed
  policy lists. Effective cloud/domain/profile policy still needs verification
  in `edge://policy`.
- Probes the configured endpoint, or all 50 documented HTTP loopback ports with
  one bounded asynchronous deadline, validates eSCL capabilities/PDF or JPEG
  support and checks the CORS origin header. This is an HTTP/CORS check only; it
  cannot prove Edge-to-NAPS2 access, browser Test Connection, or physical
  scanning.
- Creates logs at `%ProgramData%\RISpro\NAPS2Setup\setup-<timestamp>.log` and
  exits with `0` Setup ready — browser verification required, `2` Action
  required, or `1` Failed, with separate readiness states. A zero exit is not
  operational scanner acceptance.

Run `RISpro-NAPS2-Setup.cmd Diagnose` for read-only, noninteractive checks
without XML, policy or firewall changes (diagnostic logs are still written).
`Repair` is the default and is safe to repeat. Administrator access is required
for complete machine-policy checks.

After first-time policy installation, close and reopen Edge without forcing
other applications closed. Visit `edge://policy`, select **Reload policies**
for diagnosis, and verify the exact origin and each applicable policy's status.
The reload is not a substitute for restarting Edge after
`OverrideSecurityRestrictionsOnInsecureOrigin` was added. Then open RISpro,
run **Test Connection** (capabilities only; no paper movement), and explicitly
run **Test Scan** with synthetic paper. The CMD setup never reports either
browser acceptance or a successful physical scan.

**Supported automation limit:** application-level NAPS2 changes need NAPS2 to
reload them. Setup never terminates or restarts a running NAPS2 process because
it could interrupt a scan, including a scan started outside RISpro. If the
running HTTP server still lacks CORS after XML repair, setup reports Action
required: finish scans, exit/reopen NAPS2, then rerun setup. It cannot honestly
promise an unconditional two-step first run while NAPS2 is already running.
Missing background/start-at-login support in the installed release also requires
administrator action; setup does not manufacture a service or scheduled task.

## Shared scanner host and scanner clients

Use the approved scanner host's direct IPv4 HTTP origin and its actual sticky
NAPS2 port (9801–9850), not an assumed port 9801. Configure the system endpoint
in Settings > Documents & Uploads > Advanced shared scanner settings before
downloading setup, then reload RISpro. Normal Repair on a remote scanner
client configures Edge and tests the remote host; it does not edit a local NAPS2
installation or open an inbound port.

In that same Advanced section, save **Approved scanner client addresses** as
approved IPv4 client addresses or restricted CIDRs (/16–/32). On the
**scanner host only**, run the same
file as `RISpro-NAPS2-Setup.cmd HostRepair`. It confirms that the configured
scanner IP belongs to this machine and creates only a Domain/Private inbound
TCP rule for the responding exact port and approved source list. Missing
approval, a different existing rule or policy denial is reported, never
replaced. Existing unrelated firewall rules are preserved. Normal local
loopback setup creates no firewall rule; scanner clients need none.

## Connection, scanning and attachment

Test connection only reads ScannerCapabilities. Automatic discovery prioritizes
the previously confirmed local endpoint, then port 9801, with at most eight
concurrent probes and a 6.5-second overall budget. Explicit endpoint failures
remain explicit. A generic HTTP 200/HTML page is not a compatible scanner.

The scan DPI selector offers 150, 200, 300, 400 and 600 DPI. RISpro sends the
selected resolution unchanged; a scanner that rejects it reports the existing
unsupported-settings error.

Source modes are Feeder, Flatbed, Duplex and Auto (Feeder preferred). Auto is
best-effort rather than true hardware-level feeder detection. NAPS2 8.3.2 does
not reliably reveal whether the feeder contains paper through its eSCL
ScannerStatus API. RISpro switches from Feeder to Flatbed only when NAPS2
returns the recognized `DeviceFeederEmptyException` in structured ErrorDetails
before returning any document. Other scanner errors stop the scan. Actual
hardware behavior requires Windows acceptance testing.

Test scan physically scans test paper with the saved DPI, source, duplex and
color preferences. It reports real page counts and the physical source used,
including multipage PDFs, and never uploads or links a test document. Clinical Scan Paper retains the existing
patient/appointment preparation, document authorization, upload and audit APIs.
PDF segments stay PDFs; JPEG pages become PDFs. Multiple returned PDF segments
are uploaded individually in order. Failed uploads remain retryable without
rescanning. Closing/reloading the page loses in-memory failed uploads.

A connection success proves capabilities access only. A successful scan proves
paper acquisition; an attachment success requires the existing upload API to
return a linked document. Scan jobs are deleted on success/failure where
supported; cleanup failures do not erase a successful result. Busy jobs,
unsupported settings, HTTP failures, timeouts and inaccessible Location headers
have specific messages. A browser network error cannot distinguish offline,
CORS, CSP, firewall and Edge LNA restrictions; messages list the relevant checks.

## Security limits of HTTP

This file is self-contained, not cryptographically authenticated by HTTP.
An active hospital-LAN attacker can replace both the application and downloaded
administrator script. Base64 is only data encoding. A hash delivered through
the same HTTP connection would not solve this. Distribute/verify through a
separately authenticated hospital channel if active-network tampering is in
scope. Do not describe this deployment as cryptographically secure.

NAPS2's required `ServerAllowAnyOrigin` permits CORS from any website reaching
the scanner. The exact Edge exception and RISpro CSP are not scanner-side
origin authentication. Keep scanner hosts on the approved hospital network and
restrict remote firewall sources. The insecure-origin exception does not enable
HTTPS and does not encrypt RISpro HTTP traffic or scan content on the LAN. HTTPS
is the preferred long-term design.
Setup embeds no credentials, tokens, patient data or arbitrary remote commands.

Policy references: [Edge OverrideSecurityRestrictionsOnInsecureOrigin](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/overridesecurityrestrictionsoninsecureorigin),
[Edge LocalNetworkAccessAllowedForUrls](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/localnetworkaccessallowedforurls),
[Edge LoopbackNetworkAllowedForUrls](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/loopbacknetworkallowedforurls),
[loopback blocking precedence](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/loopbacknetworkblockedforurls),
[NAPS2 sharing/ports](https://www.naps2.com/doc/scanner-sharing),
[NAPS2 application configuration](https://www.naps2.com/doc/org-use).

## Acceptance on one working and one previously failing workstation

Repeat this sequence on both Windows 10/11 workstations in current Edge:

1. Record Windows, Edge and NAPS2 versions, scanner model/driver, RISpro HTTP
   origin, prior failure and intended local/shared endpoint. Use synthetic paper.
2. Complete the two operator steps above. Retain the setup log and XML backup.
   For an Action required result, resolve the named cause; do not call it Ready.
   Check the exact origin and effective policy status in `edge://policy`.
3. Open Workstation Setup. Confirm global enablement and effective endpoint.
   Test connection: no paper movement. Test scan: scan synthetic single-page
   paper, then a multipage feeder stack; verify page counts and no patient upload.
4. In a disposable test patient's correct appointment, Scan Paper and verify
   the returned document(s), page counts, patient and appointment linkage. Force
   a temporary upload failure, then retry without moving paper again. Also
   manually upload a PDF/image and confirm its linkage.
5. Complete three consecutive physical scans and confirm the scanner is released.
   Close the main NAPS2 window with background sharing enabled; scan again.
   Restart Windows, log in and repeat connection + physical scan.
6. Rerun Repair and Diagnose. Verify no duplicate XML/policy/firewall entries,
   no unnecessary XML rewrite, and preserved unrelated configuration.
7. Test missing NAPS2, disabled sharing, disconnected scanner, incorrect endpoint,
   busy scanner and an enterprise blocking policy. Confirm actionable messages
   and manual-upload availability. Restore the approved configuration.
8. For a shared host, repeat from an approved client and a disallowed source;
   inspect the exact TCP port/source firewall rule on the host and verify no
   inbound rule appeared on the client.

Portable automated setup tests: `node --test scripts/naps2/naps2-setup.test.mjs`
(set `RISPRO_TEST_PWSH` if needed). They use temporary XML and simulated registry/
firewall commands, not live machine policy. Real UAC, Windows PowerShell 5.1,
enterprise Edge precedence, scanner hardware, background operation and restart
persistence remain manual acceptance requirements.
