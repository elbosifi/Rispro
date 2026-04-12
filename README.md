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
- DICOM gateway for Modality Worklist (MWL)
- Appointments V2 — modular, rule-driven scheduling engine (backend-complete, frontend at `/v2/appointments`)

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
- MPPS support is not included in this release

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

## TypeScript Support

The backend is **100% native TypeScript** (zero `.js` files remaining in `src/`). The frontend is React + TypeScript via Vite.

### Running Type Checks

Backend:
```bash
npm run typecheck
```

Frontend:
```bash
cd frontend && npx tsc --noEmit
```

### Type Safety

- All backend source files are `.ts` with native TypeScript types
- Domain entities, API contracts, and DB interfaces are defined in `src/types/`
- The Appointments V2 module (`src/modules/appointments-v2/`) is fully typed end-to-end
- Frontend V2 types mirror backend DTOs for end-to-end type safety
- Strict mode is enabled in `tsconfig.json`

### Adding New Features

1. Define new types in the appropriate `src/types/*.ts` or co-located type file
2. Implement with native TypeScript syntax — no JSDoc needed
3. Run `npm run typecheck` to verify backend types
4. Run `cd frontend && npx tsc --noEmit` to verify frontend types

## Deployment

The recommended production deployment method is:

1. push updates to GitHub
2. let GitHub Actions validate the code
3. let the server run `/Users/seraj/Nextcloud/RISpro/deploy.sh`

This repository includes:

- `/Users/seraj/Nextcloud/RISpro/deploy.sh` for server deployment
- `/Users/seraj/Nextcloud/RISpro/.github/workflows/deploy.yml` for GitHub-based deployment automation

Setup details are in `/Users/seraj/Nextcloud/RISpro/docs/production-rollout.md`.

## DICOM MWL Gateway

This repository includes embedded MWL (Modality Worklist) support only:

- MWL source file generation inside `storage/dicom/worklist-source`
- DICOM device mapping in supervisor settings
- DCMTK `wlmscpfs` binary bundled in the Docker image
- Node worker to convert `.dump` worklist source files into `.wl` files
- Worklists are served from AE-specific subdirectories with a lockfile
- MWL startup is nearly zero-touch in Docker; only port `11112` is used for DICOM

Important:

- run `npm run migrate` before starting the app
- map each real modality device in Settings → DICOM Gateway before testing MWL
- MPPS is not included in this release
