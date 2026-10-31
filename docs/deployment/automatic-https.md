# Automatic HTTPS

Standard Docker setup/update installs Caddy 2.11.7 with the pinned community
[ACME-DNS module](https://github.com/caddy-dns/acmedns) and
[Cloudflare DNS module](https://github.com/caddy-dns/cloudflare). Caddy listens on port 443
and forwards to the existing Nginx gateway. HTTP port 3000 stays published and
working. **Redirect HTTP to HTTPS is disabled by default.** Activation does not
change the public application URL or external tunnel configuration.

## Administrator setup

1. Choose a DNS provider. For ACME-DNS, obtain the HTTPS server URL, username,
   password, subdomain and full domain from a trusted managed provider. For
   Cloudflare DNS, create a token scoped to the hostname's zone with **Zone →
   Zone → Read** and **Zone → DNS → Edit** permissions.
2. Open **Settings → Deployment & Application Identity → Automatic HTTPS** as a
   super administrator and complete password reauthentication. Initial credential
   entry requires verified HTTPS or the protected local bootstrap at
   `http://localhost:3001`. Port 3001 binds only to VM loopback. A remote
   administrator can use `ssh -L 3001:127.0.0.1:3001 <administrator>@<rispro-vm>`.
   Do not publish this bootstrap port through a public proxy.
3. Select the provider, enter its credentials and your hostname, leave
   **Redirect HTTP to HTTPS** unchecked, and select **Save Configuration**.
   Saved credential fields remain blank. A blank token retains the saved token;
   for ACME-DNS leave both username and password blank to retain the same account.
4. For ACME-DNS, create the **exact CNAME displayed by RISpro** and select
   **Check DNS** after propagation. For Cloudflare, no CNAME is needed; select
   **Test Connection** to check the token's zone read access. The DNS Edit
   permission is exercised during the actual challenge, not by this read-only test.
   When switching from ACME-DNS, coordinate any existing `_acme-challenge` CNAME
   with the DNS administrator: a delegation to the old provider can prevent
   Cloudflare from creating the challenge in its zone. Restore that delegation
   if rolling back to ACME-DNS.
5. Hospital DNS must resolve the configured hostname to the VM for LAN clients.
   Allow LAN TCP 443, outbound HTTPS to Let's Encrypt and the chosen provider,
   and public DNS access. Public inbound access is unnecessary for DNS-01.
6. Select **Activate HTTPS**. RISpro checks provider access and, for ACME-DNS, public CNAME delegation,
   applies its fixed Caddy template through a permissioned Unix socket, and
   verifies certificate trust, hostname and RISpro health by connecting directly
   to the internal Caddy service. It never follows public hostname resolution to
   the external tunnel. A failure restores the previous configuration. Staging
   certificates are never activated as trusted. Saved settings for each provider
   are retained when switching; activation changes the active provider only after
   gateway verification. If an existing certificate is reused, a successful zone
   read does not establish that DNS Edit will succeed at the next renewal.
7. Open the HTTPS settings link and sign in. HTTP sessions retain their existing
   cookie names and attributes. HTTPS session, reauthentication, passkey and
   viewer cookies use separate names with `Secure`, preserving HTTP sessions on
   the same hostname during testing.

## Direct LAN acceptance

Test from a LAN workstation, substituting the actual VM address:

```sh
curl --resolve rispro.nccb.com.ly:443:<RISPRO_LAN_IP> \
  --dump-header - https://rispro.nccb.com.ly/api/health
```

Do not disable certificate verification. Require a valid hostname/trust chain,
the expected RISpro health/build identity and `X-Rispro-Https-Gateway: caddy`.
The explicit address pin reaches the VM rather than Cloudflare. Verify login,
navigation, OHIF/native images, reporting, dictation, documents, large DICOM
transfers and VM/Docker restart on this direct HTTPS path. Separately confirm
that existing HTTP and remote sessions keep working.

## Optional cutover after acceptance

This patch does not perform a cutover or restrict port 3000.

1. Identify cloudflared's actual host/container and exact origin URL. Do not
   assume either from the public hostname. If it still uses HTTP port 3000,
   **leave redirects disabled** until its origin has been coordinated externally.
2. If moving the origin to HTTPS, use port 443 with the correct hostname for
   Host/SNI and normal certificate validation. Never disable TLS verification.
   Verify remote login, images, reporting, dictation and uploads before changing
   HTTP access policy. RISpro performs no tunnel or Cloudflare API changes.
3. If required, update the canonical public RISpro URL through the existing
   Deployment & Application Identity control after HTTPS acceptance.
4. Select **Redirect HTTP to HTTPS** and **Save Configuration** when ready.
   RISpro rechecks the active certificate/gateway before enabling redirects.
   Turning the option off restores ordinary HTTP access. The protected local
   bootstrap remains usable for recovery.
5. Restrict or remove port 3000 only in a separately authorized deployment/network
   cutover after confirming the tunnel topology:
   - Same-VM cloudflared retaining HTTP: bind port 3000 to `127.0.0.1` and verify
     its loopback origin before blocking LAN access.
   - Container cloudflared retaining HTTP: use its verified private Docker origin
     and remove the host publication only after confirming network membership.
   - Separate-host cloudflared retaining HTTP: allow port 3000 only from its
     verified source address in the VM firewall, blocking other LAN sources.
   - Tunnel moved to verified HTTPS: remove/deny port 3000 after direct LAN and
     remote acceptance pass.

A tunnel retaining HTTP needs its permitted origin path to remain available;
global redirects can create a loop. Exact firewall commands require the VM
firewall and tunnel source to be known. Standard deployment readiness uses the
protected loopback bootstrap independently of port 3000.

## Persistence and renewal

Configuration uses one existing `system_settings` record with encrypted account
credentials. Standard deployment generates a missing runtime encryption key in
`secrets/https/`, preserves existing keys and stops on invalid/conflicting keys.
Back up this restricted key with the settings database. Existing `.env` keys are
preserved without rotation. No routine backend configuration editing is needed.

Caddy reads mode-600 account files from a restricted persistent volume. Account
credentials are absent from HTTP responses, audit records and Docker environment
variables. A narrowly scoped account-update relay validates provider DNS, pins
public IP addresses and rejects redirects on every update, including renewal.
There is no arbitrary destination, command, Docker socket or public Caddy API.

Named volumes preserve certificates, ACME accounts and committed runtime
configuration. Caddy renews automatically while RISpro, provider access, outbound
DNS/HTTPS and delegation remain available. Interrupted activation restores the
last committed configuration on app restart, including the redirect preference.
Status verifies the served certificate; it does not claim a future renewal has
already succeeded.

Development uses Let's Encrypt staging. Synthetic certificates are confined to
disposable test containers; there is no self-signed or internal-CA fallback.
Local mocks do not prove real issuance/renewal, hospital DNS, physical devices or
production tunnel compatibility. Those require separate authorized acceptance.

## Local validation for the initial ACME-DNS patch

| Check | Result |
| --- | --- |
| Agent contract, environment preflight, disposable DB readiness | Passed; Docker available |
| Focused configuration, transport, viewer authorization and deployment identity tests | 13 passed |
| HTTPS DB integration (`npm run test:db:one -- src/modules/automatic-https/https-service.integration.test.ts`) | 5 passed, including encryption, authorization, rollback and restart recovery |
| Caddy build/module/syntax, Nginx syntax, Compose deployment modes, private reload/restart and key preservation (`scripts/https-deployment.test.mjs`) | 5 passed |
| Actual Caddy/Nginx TLS and browser smoke (`scripts/https-proxy-smoke.test.mjs`) | Passed; synthetic TLS, separate HTTP/HTTPS sessions, reversible redirects, WebSockets, dictation streaming, native/proxy frames, document and 80 MiB DICOM routing |
| Backend typecheck, frontend typecheck and production build | Passed |
| Focused frontend tests | 9 passed |
| Frontend lint | Passed; 9 existing warnings in unchanged files |
| Focused Playwright journeys | 7 passed: login/navigation, HTTPS settings desktop/mobile, dictation, report editor/signing, document attachment and viewer launch |
| Harness and existing Docker deployment regressions | Passed; shell permission checks ran in disposable Linux because Windows mounts do not implement Unix mode 600 |
| Real managed ACME-DNS / Let's Encrypt issuance and renewal, hospital LAN and production tunnel | Unverified; no provider account or production infrastructure used |

Viewer launch uses synthetic viewer content; routed image bytes use a synthetic
archive. These checks do not constitute clinical diagnostic-image acceptance.
Browser tests used disposable databases and pinned local hostname resolution to
reach Caddy directly. Required CI remains unrun because this task authorizes no
push or deployment.
