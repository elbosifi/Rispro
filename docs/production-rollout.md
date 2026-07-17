# Production Rollout Guide

This guide is for updating the live RISpro server safely.

## Before you start

Do these first:

1. Make a database backup from the live system.
2. Keep a copy of the current `.env` file from the server.
3. Make sure the live server has enough disk space for uploads in `storage/uploads`.

## Important notes

- Run `npm run seed:supervisor` only on the first installation, or if you intentionally want to create the supervisor account again.
- Run `npm run migrate` on every update.
- The new rollout includes a new migration: `007_integration_settings_defaults.sql`.

## Recommended deployment method

The best long-term setup for this project is:

1. push changes to GitHub
2. let GitHub Actions run validation
3. let the server run the single deployment script

This repository now includes:

- a server deployment script at `deploy.sh`
- a GitHub Actions workflow at `.github/workflows/deploy.yml`

The script is the real deployment logic. Every deployment now requires a full commit SHA
with a successful `RISpro self-hosted CI` run for that exact SHA. The GitHub workflow
checks that result before SSH and passes the SHA to the server script.

The workflow is currently named and scoped as the development target because
`192.9.101.250` is the configured development target. `/usr/local/sbin/deploy-rispro-production`
is the legacy name of the installed server-side entrypoint; it must accept and forward
`--expected-sha <SHA>` to the repository deployment script. If that host is intended to
be production instead, move the workflow to the `production` GitHub environment and rename
the target/host configuration together before enabling production use.

## First-time server setup for the script

On the production server:

1. clone the repository into the final app folder
2. place the real `.env` file in that folder
3. make sure Node.js 22 is installed
4. make sure the service already exists in `systemd` or `pm2`
5. make the script executable once:

```bash
chmod +x deploy.sh
```

### Example manual run with systemd

```bash
EXPECTED_SHA=<40-character-commit-sha> \
APP_DIR=/srv/rispro \
DEPLOY_BRANCH=main \
RESTART_MODE=systemd \
SERVICE_NAME=rispro \
HEALTHCHECK_URL=http://127.0.0.1:3000/api/health \
READINESSCHECK_URL=http://127.0.0.1:3000/api/ready \
./deploy.sh
```

### Example manual run with PM2

```bash
EXPECTED_SHA=<40-character-commit-sha> \
APP_DIR=/srv/rispro \
DEPLOY_BRANCH=main \
RESTART_MODE=pm2 \
PM2_NAME=rispro \
HEALTHCHECK_URL=http://127.0.0.1:3000/api/health \
READINESSCHECK_URL=http://127.0.0.1:3000/api/ready \
./deploy.sh
```

## GitHub Actions setup

In the GitHub repository, add these secrets:

- `DEPLOY_HOST`: your server IP or hostname
- `DEPLOY_USER`: the SSH username used for deployment
- `DEPLOY_SSH_KEY`: the private SSH key for that user

Add these GitHub Actions variables:

- `DEPLOY_APP_DIR`: full path of the app on the server, for example `/srv/rispro`
- `DEPLOY_BRANCH`: usually `main`
- `DEPLOY_PORT`: usually `22`
- `RESTART_MODE`: `systemd`, `pm2`, or `none`
- `DEPLOY_SERVICE_NAME`: the service name when using `systemd`
- `DEPLOY_PM2_NAME`: the process name when using `pm2`
- `DEPLOY_HEALTHCHECK_URL`: for example `http://127.0.0.1:3000/api/ready`

The manual GitHub Actions deployment input is `commit_sha`. It must identify a commit
that already has a successful self-hosted CI workflow run. The deployment checks both
`/api/health` (including its `buildSha`) and `/api/ready` after restart.

Optional variables:

- `DEPLOY_BACKUP_CMD`: command to run before install, for example a database backup command
- `DEPLOY_INSTALL_CMD`: defaults to `npm ci --omit=dev`
- `DEPLOY_MIGRATE_CMD`: defaults to `npm run migrate`
- `DEPLOY_POST_MIGRATE_CMD`: anything extra you want after migration
- `INSTALL_NATIVE_IMAGE_DEPS`: defaults to `1`; installs `libpng` and `libtiff` packages during deployment (set to `0` to disable)

## Recommended permissions for the server user

The deployment user should:

- have access to the app folder
- have permission to run `git`
- have permission to run Node.js and npm
- have permission to restart the service

If you use `systemd`, add a `sudoers` rule that allows restarting only the app service instead of giving wide `sudo` access.

## Option 1: Docker deployment

Use this if the production server runs the app as a Docker container.

### 1. Copy the new code to the server

Upload the updated project files to the server.

### 2. Keep the production `.env`

Make sure the server `.env` has real production values:

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=...`
- `JWT_SECRET=...`
- `COOKIE_SECURE=true`
- `TRUST_PROXY=1` if you use Nginx or another reverse proxy

### 3. Build the new image

```bash
docker build -t rispro-reception .
```

### 4. Run the database migration

If you run commands inside a temporary container:

```bash
docker run --rm --env-file .env rispro-reception npm run migrate
```

If this is the first installation only:

```bash
docker run --rm --env-file .env rispro-reception npm run seed:supervisor
```

### 5. Restart the app container

```bash
docker run --env-file .env -p 3000:3000 rispro-reception
```

If you already have a running container, stop the old one first and start the new one with the same `.env`.

### 6. Check health

Open:

- `/api/health`
- `/api/ready`

Both should return OK.

## Option 2: Direct Node.js deployment

Use this if the production server runs the app directly without Docker.

### 1. Copy the updated project files

Upload the new code to the server.

### 2. Install dependencies

```bash
npm install
```

### 3. Run the migration

```bash
npm run migrate
```

If this is the first installation only:

```bash
npm run seed:supervisor
```

### 4. Start or restart the service

If you use a process manager like `pm2` or `systemd`, restart the app there.

If you run it manually:

```bash
npm start
```

### 5. Check health

Open:

- `/api/health`
- `/api/ready`

## Recommended production order

Use this order every time:

1. backup database
2. upload code
3. confirm `.env`
4. run `npm run migrate`
5. restart app
6. open `/api/ready`
7. log in and test:
   - login
   - patient search
   - patient registration
   - appointment creation
   - queue page
   - settings page
   - print page

## Extra caution for this update

This update includes:

- modality staff workflow
- audit log viewer and export
- printer/scanner integration groundwork

So after deployment, check these specifically:

1. supervisor can open Settings after re-authentication
2. audit log appears in Settings
3. print page loads correctly
4. integration readiness panel appears on the print page
5. documents still upload correctly

## If something goes wrong

Use your backup first.

Rollback plan:

1. Identify the previous deployed commit SHA from deployment records.
2. Confirm that SHA has a successful self-hosted CI run.
3. Run the manual deployment workflow with that SHA as `commit_sha`.
4. Let the exact-SHA checkout, migration, restart, health, readiness, and build-SHA checks complete.
5. Restore the database backup only if the release included an incompatible migration or data change.
