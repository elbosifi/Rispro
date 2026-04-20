# RISpro Reception - Deployment Guide

## Prerequisites

- **PostgreSQL 14+** database
- **Node.js 20+** (for bare metal) OR **Docker** (for containerized)
- **npm** package manager

## Option 1: Docker Deployment (Recommended)

### 1. Prepare Environment

```bash
cp .env.example .env
# Edit .env with your actual values:
# - DATABASE_URL
# - JWT_SECRET (min 32 chars)
# - SEED_SUPERVISOR_PASSWORD
```

### 2. Build and Run

```bash
docker build -t rispro-reception .
docker run --env-file .env -p 3000:3000 rispro-reception
```

### 3. Initialize Database

```bash
# Run migrations
docker run --env-file .env rispro-reception npx tsx src/db/migrate.ts

# Seed initial supervisor account
docker run --env-file .env rispro-reception npx tsx src/db/seed-supervisor.ts
```

### 4. Verify

```bash
curl http://localhost:3000/api/health
# Expected: {"ok":true,"environment":"production"}
```

## Option 2: Bare Metal Deployment

### 1. Install Dependencies

Install required native image libraries first (`libpng` and `libtiff`):

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y libpng-dev libtiff-dev
```

```bash
npm ci --omit=dev
```

### 2. Build Frontend

```bash
cd frontend
npm ci
npm run build
cd ..
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 4. Initialize Database

```bash
npx tsx src/db/migrate.ts
npx tsx src/db/seed-supervisor.ts
```

### 5. Start Server

```bash
npm start
# Server listens on http://localhost:3000
```

## Option 3: Docker Compose (With PostgreSQL)

Create `docker-compose.yml`:

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: rispro
      POSTGRES_USER: rispro
      POSTGRES_PASSWORD: ${DB_PASSWORD:-ChangeMe123}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rispro"]
      interval: 10s
      timeout: 5s
      retries: 5

  rispro:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://rispro:${DB_PASSWORD:-ChangeMe123}@postgres:5432/rispro
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

Run:

```bash
docker compose up -d
```

## Configuration Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `NODE_ENV` | ✅ | Environment mode | `production` |
| `PORT` | ✅ | HTTP port | `3000` |
| `DATABASE_URL` | ✅ | PostgreSQL connection string | - |
| `JWT_SECRET` | ✅ | JWT signing secret (min 32 chars) | - |
| `COOKIE_SECURE` | ✅ | HTTPS-only cookies | `true` (prod) |
| `DATABASE_SSL` | | Enable DB SSL | `true` (prod) |
| `DB_POOL_MAX` | | Max DB connections | `10` |
| `SESSION_HOURS` | | Session timeout | `8` |
| `TRUST_PROXY` | | Behind reverse proxy? | `1` |

### Orthanc MWL Sync (V2 Source of Truth)

RISpro remains authoritative for bookings/scheduling. Orthanc MWL is a synchronized projection.

Required when enabled:
- `ORTHANC_MWL_ENABLED=true`
- `ORTHANC_BASE_URL=http://<orthanc-host>:8042`

Optional:
- `ORTHANC_MWL_SHADOW_MODE=true`
- `ORTHANC_USERNAME=<user>`
- `ORTHANC_PASSWORD=<password>`
- `ORTHANC_TIMEOUT_SECONDS=10`
- `ORTHANC_VERIFY_TLS=true`
- `ORTHANC_WORKLIST_TARGET=<AE_TITLE>`

Recommended rollout:
1. Enable shadow mode first (`ORTHANC_MWL_ENABLED=true`, `ORTHANC_MWL_SHADOW_MODE=true`).
2. Keep embedded MWL active while validating Orthanc projection.
3. Run reconciliation dry-run over active booking windows.
4. Apply reconciliation repair only after reviewing drift.
5. Cut modalities over to Orthanc MWL.
6. Optionally disable embedded MWL (`RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=1`).

Reconciliation CLI:

```bash
npm run gateway:reconcile-orthanc-mwl -- --date-from 2026-04-01 --date-to 2026-04-30
npm run gateway:reconcile-orthanc-mwl -- --date-from 2026-04-01 --date-to 2026-04-30 --apply
```

Supervisor API endpoints:
- `GET /api/dicom/orthanc-sync/summary`
- `POST /api/dicom/orthanc-sync/reconcile`
  - body: `{ "dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD", "apply": false, "limit": 5000 }`

## Post-Deployment Checklist

- [ ] Access `http://your-server:3000`
- [ ] Login with supervisor credentials
- [ ] Verify database connection (no errors on dashboard)
- [ ] Create first receptionist user
- [ ] Configure modalities and exam types in Settings
- [ ] Test patient registration flow
- [ ] Test appointment creation
- [ ] Verify print functionality

## Troubleshooting

### Server Won't Start

```bash
# Check logs
docker logs rispro-reception

# Verify DB connectivity
npx tsx -e "import('./src/db/pool.js').then(m => m.pingDatabase().then(() => console.log('DB OK')))"
```

### DICOM Native Module Error

The `dicom-dimse-native` module requires native C++ compilation. If unavailable:
- PACS search and DICOM gateway features will fail gracefully
- All other features (patients, appointments, queue, print) work normally
- To enable: `npm rebuild dicom-dimse-native` (requires Python + build tools)

### Database Migration Errors

```bash
# Reset migrations (WARNING: deletes all data)
npx tsx src/db/migrate.js --reset

# Check migration status
psql $DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY filename;"
```

## Backup and Restore

### Backup
1. Navigate to Settings → Backup/Restore
2. Click "Download Backup"
3. Save JSON file securely

### Restore
1. Navigate to Settings → Backup/Restore
2. Upload backup JSON file
3. Confirm restoration (WARNING: overwrites all existing data)

## Security Considerations

- ✅ `COOKIE_SECURE=true` in production
- ✅ `DATABASE_SSL=true` for managed databases
- ✅ `TRUST_PROXY=1` behind reverse proxy
- ✅ Strong `JWT_SECRET` (min 32 random characters)
- ✅ Change default supervisor password after first login
- ✅ Regular database backups
- ✅ HTTPS termination at reverse proxy (nginx, Caddy, etc.)

## Monitoring

Health check endpoints:
- `GET /api/health` - Application health
- `GET /api/ready` - Database readiness

Example monitoring script:

```bash
#!/bin/bash
while true; do
  curl -sf http://localhost:3000/api/health || echo "HEALTH CHECK FAILED"
  sleep 30
done
```
