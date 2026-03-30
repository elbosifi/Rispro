# RISpro Reception

RISpro Reception is now a real Node.js + PostgreSQL web app for the currently implemented workflows:

- real username/password login with cookie-based sessions
- patient registration saved to PostgreSQL
- patient search from PostgreSQL
- appointment creation with live modality availability
- queue scanning, walk-in queue, and no-show confirmation
- printing daily lists and slips from live appointments
- document uploads saved on the server with metadata in PostgreSQL
- patient editing and duplicate merge after confirmation
- appointment editing, rescheduling, and cancellation
- supervisor re-authentication for settings and admin tools
- backup download and restore upload from the browser
- modality staff role with a completion worklist
- supervisor user management
- supervisor audit log viewer with filters and CSV export inside settings
- printer and scanner groundwork with browser-print profiles and scan preparation
- DICOM gateway groundwork for Modality Worklist and MPPS sidecar integration

The old prototype-only browser login and fake local data have been removed from the main production flow.

## What is production-ready now

- Express server with health and readiness endpoints
- PostgreSQL connection checks during startup
- migration tracking with `schema_migrations`
- secure production cookie settings through environment variables
- login rate limiting
- production security headers
- graceful shutdown handling
- Dockerfile for container deployment

## Current scope

This deployment intentionally hides unfinished modules instead of showing screens that are not backed by real APIs yet.

Not enabled yet:

- direct printer bridge execution
- local scanner bridge execution
- full DCMTK gateway runtime until the sidecar is deployed

## Local run

1. Copy `.env.example` to `.env`
2. Fill in real production-safe values
3. Run `npm install`
4. Run `npm run migrate`
5. Run `npm run seed:supervisor`
6. Run `npm start`

## Production environment variables

Required:

- `NODE_ENV=production`
- `PORT`
- `DATABASE_URL`
- `JWT_SECRET`
- `COOKIE_SECURE=true`
- `TRUST_PROXY=1` when running behind a reverse proxy

Useful:

- `DATABASE_SSL=true`
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` for managed databases that use public certificates differently
- `DB_POOL_MAX=10`
- `COOKIE_SAME_SITE=lax`
- `SESSION_HOURS=8`
- `REQUEST_BODY_LIMIT=1mb`

## Health checks

- `/api/health` for process-level health
- `/api/ready` for database readiness

## Docker deployment

Build:

```bash
docker build -t rispro-reception .
```

Run:

```bash
docker run --env-file .env -p 3000:3000 rispro-reception
```

## Recommended production checklist

- use a managed PostgreSQL database
- set a long random `JWT_SECRET`
- set a strong `SEED_SUPERVISOR_PASSWORD` before seeding
- terminate HTTPS at your load balancer or proxy
- make sure `COOKIE_SECURE=true`
- make sure `TRUST_PROXY` matches your deployment setup
- run `npm run migrate` during deployment before starting the app
- verify `/api/ready` returns `{ "ok": true }`

Detailed rollout steps are in `/Users/seraj/Nextcloud/RISpro/docs/production-rollout.md`.

## Validation

Basic syntax validation is available with:

```bash
npm run check
```

## Deployment

The recommended production deployment method is:

1. push updates to GitHub
2. let GitHub Actions validate the code
3. let the server run `/Users/seraj/Nextcloud/RISpro/scripts/deploy.sh`

This repository includes:

- `/Users/seraj/Nextcloud/RISpro/scripts/deploy.sh` for server deployment
- `/Users/seraj/Nextcloud/RISpro/.github/workflows/deploy.yml` for GitHub-based deployment automation

Setup details are in `/Users/seraj/Nextcloud/RISpro/docs/production-rollout.md`.

## DICOM gateway sidecar

This repository now includes first-phase support for:

- MWL source file generation inside `storage/dicom/worklist-source`
- MPPS callback handling at `POST /api/integrations/dicom/mpps-event`
- DICOM device mapping in supervisor settings
- DCMTK sidecar runtime files in `/Users/seraj/Nextcloud/RISpro/scripts/dicom-gateway`

The included sidecar stack uses:

- `wlmscpfs` for Modality Worklist
- `ppsscpfs` for MPPS
- a small Node worker to convert `.dump` worklist source files into `.wl` files
- a small Node worker to parse incoming MPPS files and post them back to RISpro

Local sidecar compose file:

```bash
docker compose -f docker-compose.dicom-gateway.yml up --build
```

Important:

- keep the DICOM callback secret aligned between RISpro settings and the sidecar environment
- run `npm run migrate` before starting the updated app
- map each real modality device in Settings -> DICOM gateway before testing MWL or MPPS
