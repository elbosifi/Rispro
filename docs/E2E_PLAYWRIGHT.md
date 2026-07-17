# Playwright critical journeys

RISpro browser E2E uses the real Vite frontend, backend, and an isolated Docker PostgreSQL container. It never targets a local or production database.

Run it locally:

```sh
npm run e2e:db:up
npm run test:e2e
npm run e2e:db:down
```

The reset command requires `RISPRO_E2E=1`, a loopback/test database URL, and rejects production-oriented database variables. The suite uses one Chromium worker and records traces on retry plus screenshots/videos on failure.

Covered journeys: login and route access, patient identity/duplicate warnings, appointment creation, deferred total-capacity override approval, queue check-in, and the public mobile Reporting Board saved view.
