# Deployment Functional Smoke Gate

`npm run test:deployment:smoke` is a fast, read-only post-deployment gate. It targets an already-running RISpro instance; it never starts a local stack and it does not replace the Playwright E2E suite. Playwright exercises browser journeys on disposable infrastructure. This gate proves that the restarted deployed service, its frontend assets, and its controlled API failure behavior are operational.

## Required configuration

The target is deliberately never inferred. Supply both values:

```bash
RISPRO_SMOKE_BASE_URL=https://rispro.example.invalid \
RISPRO_EXPECTED_COMMIT_SHA=<40-character-commit-sha> \
npm run test:deployment:smoke
```

HTTPS is required. Only `localhost`, `127.0.0.1`, and `::1` may use HTTP, which is how the deployment workflow safely tests the service through its SSH connection. Requests use a five-second timeout by default. Readiness retries at most three times, with a 500 ms delay; both values are bounded and can be adjusted with `RISPRO_SMOKE_TIMEOUT_MS`, `RISPRO_SMOKE_READINESS_RETRIES`, and `RISPRO_SMOKE_READINESS_DELAY_MS`.

URLs containing embedded usernames or passwords are rejected. If a deployment overrides RISpro's default `COOKIE_NAME`, pass the corresponding name through `RISPRO_SMOKE_SESSION_COOKIE_NAME`; the default is `rispro_session`.

## Checks and output

The gate checks:

- `GET /api/health` returns HTTP 200 and the structured `{ ok, environment, buildSha }` response.
- `GET /api/ready` returns HTTP 200 and `{ ok: true }`, with the bounded startup retry window.
- the `buildSha` from `/api/health` equals `RISPRO_EXPECTED_COMMIT_SHA` after allowing only surrounding whitespace and case differences; internal whitespace and any non-SHA content fail.
- the frontend root is HTML and its first-party JavaScript and CSS assets are present.
- `GET /api/public/appointments/cancel-preview` without a cancellation token returns its expected controlled `400` JSON response with `error.details.code = "missing_token"`, never a 5xx. HTML, malformed JSON, redirects, unexpected 2xx responses, and other error shapes fail. The request stops before any patient lookup.

Output is one attributable category per result, such as `PASS HEALTH`, `PASS FRONTEND_ASSETS`, `FAIL READINESS_DATABASE`, `FAIL BUILD_SHA_MISMATCH`, or `FAIL PUBLIC_ENDPOINT_5XX`. The runner does not print passwords, cookies, tokens, complete response headers, or response bodies.

## Optional authenticated smoke

Authentication is disabled unless all of these are supplied through deployment secrets:

```bash
RISPRO_SMOKE_AUTH_ENABLED=true
RISPRO_SMOKE_USERNAME=<dedicated-least-privileged-account>
RISPRO_SMOKE_PASSWORD=<secret>
```

When enabled, the runner uses `POST /api/auth/login`, identifies the primary session cookie by name rather than `Set-Cookie` response order, and never prints its value. It reads `GET /api/settings/appointment_slip` and checks `{ settings: [] | [...] }`, then calls `POST /api/auth/logout`. Logout must clear the named session cookie with an empty value plus either a syntactically valid past HTTP cookie date in `Expires` or exact `Max-Age=0`, even when another cookie appears first. Parseable arbitrary strings such as `Expires=0` are not accepted. The runner resends the original session cookie to `/api/auth/me` and requires 401, proving server-side invalidation rather than only client-side cookie clearing. It does not use a supervisor account, patient data, appointments, or any mutating business endpoint.

The current deployment workflow deliberately runs unauthenticated mode (`RISPRO_SMOKE_AUTH_ENABLED=false`) until a dedicated smoke account is provisioned in deployment secrets. That authenticated check is pending, not passing. Do not create an account automatically. Note that successful application login records the existing security audit event; use a dedicated non-clinical smoke identity only after operations approves that audit behavior.

## Deployment integration and safety

The manual deployment workflow invokes the smoke gate from the deployed `/srv/rispro` checkout only after the existing container/service restart, readiness, and exact runtime build-SHA checks have passed. Those safeguards remain separate and unchanged. A smoke failure fails deployment validation; it does not claim rollback succeeded and it does not trigger an automatic rollback.

Live deployment validation remains pending until the next controlled deployment; local mock results do not claim production readiness.

The gate must remain read-only with respect to clinical and operational domain data: do not create synthetic appointments, alter patient records, send DICOM/PACS/MWL traffic, or trigger email, push, or WhatsApp actions. Do not point it at a URL unless that target is explicitly supplied.

## Local mock validation and troubleshooting

Run the deterministic mock-server coverage without a database or deployed target:

```bash
npm run test:deployment:smoke:unit
```

It covers successful checks, health failure, readiness exhaustion, SHA mismatch, missing frontend assets, public 5xx behavior, authentication failure without secret output, protected-read unauthorized behavior, and a transient readiness delay. For a live failure, use the emitted `FAIL` category to inspect the deployed service or gateway; do not turn persistent failures into warnings.
