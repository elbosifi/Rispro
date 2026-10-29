# Authenticated Authoritative Orthanc native delivery

Local implementation and synthetic acceptance on 2026-10-29. Native delivery
remains disabled by default. No production Orthanc, database or RISpro services
were accessed or changed, and no commit/push/deployment was performed.

The gateway uses `auth_request` and the existing RISpro authorization function,
then obtains its upstream origin and Basic credential privately from the saved
Authoritative Orthanc settings. Diagnostic bytes go directly from that archive
to Nginx. There is no Authorization plugin dependency or internal Orthanc target.

Activation, DevTools checks and immediate rollback are in the
[operations runbook](../../ohif-viewer-operations-runbook.md).

## Validation

The isolated harness enables Orthanc HTTP Basic authentication and generates
synthetic CT/MR studies. It runs the real RISpro backend and Nginx configuration,
with the native template rendered by the official image entrypoint. It uses
only the guarded disposable `rispro_test` database on localhost port 5433.

```powershell
npm run agent:preflight
npm run db:test:up
npm run db:test:check
$env:OHIF_NATIVE_DELIVERY_ENABLED='true'
$env:OHIF_NATIVE_AUTH_SECRET='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$env:OHIF_NATIVE_AUTH_ACCEPTANCE='1'
$env:OHIF_TEST_IMAGE='rispro-ohif:loading-profiles'
$env:OHIF_BENCH_REPEATS='3'
node --env-file=codex-db-test.env --import tsx scripts/ohif-native-reporting-browser.mjs
```

The all-`a` gateway secret and fixture Basic credentials are synthetic test values
only. Never use them on a VM. The harness restores its temporary settings and
removes its fixture containers/network. It does not modify internal Orthanc.

Focused DB authorization check (after disposable DB migration):

```powershell
$env:JWT_SECRET='test-secret'
node --env-file=codex-db-test.env --experimental-test-module-mocks --import tsx --test --test-concurrency=1 --test-name-pattern='authorizes native gateway requests' src/modules/doctor-portal/reporting-board.integration.test.ts
```

An unrelated existing schema check fails: `ohif-schema.integration.test.ts`
expects `UNIQUE (appointment_id)` on `native_reports`, while migration 236
deliberately replaces it with a partial unique index. This task does not change
that test or schema. The broader DB run stopped at that failure; full-suite CI
is not claimed. On this Windows host `db:test:required` exits without executing
its migration/test body, so `test:db:one` was used to obtain the actual result.
Sandbox `spawn EPERM` restrictions were rerun unchanged outside the sandbox.

Final validation results:

- PASS: 27 focused OHIF unit tests (raw paths, existing proxy scoping, runtime
  native/proxy selection, viewer sessions, adapters and UID validation).
- PASS: focused DB-backed native gateway authorization test, including wrong
  user, expiry/revocation, missing/wrong gateway secret, malformed paths, disabled
  native gate, internal Orthanc host rejection and unsupported HTTPS rejection.
- PASS: 42 synthetic transport/security checks and 12 browser timing samples.
  Authenticated metadata/frames/JPEG thumbnails, saved credential forwarding and
  rotation recovery, denied anonymous/expired/revoked/case-revoked requests,
  unauthorized UID/query, GET-only/admin restrictions and public endpoint denial
  were exercised. Credentials were absent from client responses and container
  logs. Native diagnostic frame payloads exactly matched the authenticated
  archive and proxy payloads; all six native samples had zero Express frame
  requests (proxy samples had 19-20).
- PASS: Chromium CT/MR diagnostic rendering, complete original-resolution
  images, wheel scrolling, series switching and reopening. Four additional native
  rendering checks passed at 390x844 and 768x1024, and the ordinary explicit
  `risproDelivery=proxy` URL rendered successfully. Desktop/phone/tablet
  screenshots were inspected. These are emulated Chromium layouts, not physical
  Safari results.
- PASS: actual template rendering and `nginx -t` in `nginx:1.27.5-alpine`;
  opt-in Compose configuration validation with `--no-env-resolution --quiet`.
- PASS: `npm run typecheck`, `npm run typecheck:frontend`,
  `npm run build:frontend`, `npm run agent:contract`, `npm run harness:all` and
  `git diff --check`. Existing harness and bundle-size warnings remain.
- FAIL (unrelated, unchanged): the schema assertion described above. Full DB
  suite, comprehensive CI and self-hosted deployment CI are not claimed passing.

The cached pinned OHIF `rispro-ohif:loading-profiles` viewer image was used with
the exact working-tree public config mounted, as in Compose. No viewer source or
loading algorithm changed, and no new OHIF image build was needed. Backend source
was mounted from the final working tree into the isolated backend image.

## Measurements and remaining checks

The transport comparison holds request limits, thumbnail negotiation, viewer
image, fixture data and prefetch constant. A test-only browser config interception
replaces only the WADO root for proxy samples. This measures transport separately
from the existing native/proxy loading-profile differences; application loading
concurrency and prefetch code are unchanged. Samples alternate order and reopen
the same study. Complete-series time means every original diagnostic image in
the initially selected series is present in the Cornerstone cache, not metadata
completion. Results and screenshots are saved to the printed artifact directory.

Final run artifact directory suffix: `rispro-native-reporting-Ug2DKT` under the
host temporary directory. It contains `authenticated-native-results.json` and
`authenticated-*.png`. Three samples per transport and modality; medians in ms:

| Transport / modality | First diagnostic pixels | Complete 16-slice series | Unloaded-series slice | Reopen study |
| --- | ---: | ---: | ---: | ---: |
| Express proxy CT | 1186.3 | 1576.2 | 127.8 | 639.9 |
| Native CT | 1093.6 | 1438.9 | 114.0 | 515.9 |
| Express proxy MR | 1132.6 | 1518.6 | 127.5 | 632.7 |
| Native MR | 1088.4 | 1436.5 | 111.3 | 506.7 |

CT frames were 256x256, MR 192x192, 16 bits, explicit little endian. Both tests
had two main series and an authorized prior; MR also included an enhanced
multiframe series. The table measures the initially displayed ordinary series.
The same settings were interaction 4, thumbnail 4, prefetch 1, rendered JPEG
thumbnails, a fresh browser context per launch and the same archive for both
transports. Reopen means browser reload in that context. Unloaded-series timing
includes the real thumbnail double-click/selection and first diagnostic render.
The archive/OS cache was not flushed. These small loopback fixtures and three
samples do not establish hospital throughput or large-series improvement.

Range/If-Range behavior matched direct authenticated Orthanc. This fixture's
frame endpoint returned 200 for the Range request, so actual archive support for
206 partial frame responses is not established by this run. Nginx forwards the
headers and retains upstream status/range response headers without forcing
partial content.

Hospital LAN performance and physical iPad/Safari acceptance remain operator
checks. HTTPS authoritative origins intentionally fail closed until gateway CA
verification is configured. HTTP Basic on the archive link retains the hospital's
existing trusted-network model. Range support is resource-dependent. Authorization
is checked for every new request; it cannot retract bytes already streaming.
Representative lossless compressed transfer syntaxes, MPR/MIP, annotation/key
image capture and reporting/dictation/sign/review browser journeys were not
rerun in this focused transport acceptance. Their implementation was unchanged;
they remain part of the hospital pilot/release acceptance, together with large
studies, concurrent readers, native/proxy rollback and actual LAN measurements.
