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

1. stop the new app version
2. restore the previous code
3. restore the database backup if needed
4. start the previous version again
