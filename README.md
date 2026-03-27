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
- supervisor user management

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

- advanced printer-specific integrations
- local scanner bridge integrations

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

## Validation

Basic syntax validation is available with:

```bash
npm run check
```
