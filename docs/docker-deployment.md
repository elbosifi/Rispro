# RISpro Reception - Docker Deployment Guide

## Quick Start

### Mode 1: All-in-One (Internal Database)

Single command to bring up complete RISpro stack:

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your settings (use default DATABASE_URL for internal DB)

# 2. Build and start
docker compose up -d --build

# 3. Verify startup
docker compose logs -f app
```

**What this deploys:**
- RISpro app (port 3000)
- Embedded DICOM MWL SCP (port 11112, AE: RISPRO_MWL)
- Embedded DICOM MPPS SCP (port 11113, AE: RISPRO_MPPS)
- PostgreSQL 16 database (port 5432, internal)
- Persistent volumes for app storage and database

### Mode 2: External Database

Use when you have an existing PostgreSQL server:

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://user:password@your-db-host:5432/rispro

# 2. Build and start (external-db profile skips postgres container)
docker compose --profile external-db up -d --build

# 3. Verify
docker compose --profile external-db logs -f app
```

## Startup Verification

### Check Application Logs

```bash
docker compose logs -f app
```

You should see:

```
========================================
  RISpro Reception - Startup Summary
========================================
  Backend:        http://localhost:3000
  Environment:    production
  Database:       postgres:5432/rispro

  DICOM Services:
    MWL SCP:        running (RISPRO_MWL @ 0.0.0.0:11112)
    MPPS SCP:       running (RISPRO_MPPS @ 0.0.0.0:11113)
    Worklist Bldr:  running
    MPPS Processor: running
    Worklist Dir:   /app/storage/dicom/worklists
========================================
```

### Run Smoke Tests

```bash
# Inside the container
docker compose exec app bash /app/scripts/dicom-gateway/smoke-test.sh
```

This validates:
- Backend health endpoint
- Database readiness
- DICOM C-ECHO to MWL SCP
- DICOM C-ECHO to MPPS SCP
- DCMTK tool availability
- DICOM directory health

### Manual DICOM Verification

```bash
# Test MWL SCP
docker compose exec app echoscu -v -aec RISPRO_MWL 127.0.0.1 11112

# Test MPPS SCP
docker compose exec app echoscu -v -aec RISPRO_MPPS 127.0.0.1 11113
```

## Architecture

### Embedded DICOM Gateway

The Docker image includes the complete DCMTK toolchain built from source:

- **wlmscpfs** - MWL SCP server (serves `.wl` files from AE-specific directories)
- **ppsscpfs** - MPPS SCP server (receives MPPS objects from modalities)
- **dump2dcm** - Converts DICOM dump files to proper DICOM format (worklist builder)
- **dcmdump** - Dumps DICOM file contents (MPPS processor)
- **echoscu** - DICOM C-ECHO client (verification/testing)
- **findscu** - DICOM C-FIND client (PACS queries)

All services start automatically inside the main app container - no separate gateway container needed.

### Worklist Directory Layout

```
/app/storage/dicom/worklists/
├── RISPRO_MWL/          # AE-specific subdirectory
│   ├── lockfile
│   └── *.wl files
└── RISPRO_MWL_2/        # Additional AE titles
    └── ...
```

### Persistent Volumes

- `rispro-storage` - Application uploads, DICOM worklists, MPPS inbox
- `postgres-data` - PostgreSQL database files (internal DB mode only)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `3000` | HTTP port for web app |
| `DATABASE_URL` | (see .env.example) | PostgreSQL connection string |
| `JWT_SECRET` | (required) | Secret for session tokens |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS proxy |
| `TRUST_PROXY` | `1` | Trust reverse proxy headers |

### DICOM Settings

DICOM gateway settings are stored in the database and can be changed via the Settings UI:

- AE titles (MWL and MPPS)
- Ports (default: 11112, 11113)
- Bind host
- Worklist directories

### Disabling Embedded Gateway

If you prefer to use an external DICOM gateway sidecar:

```env
# In .env
RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=1
```

Then use the legacy compose file:
```bash
docker compose -f docker-compose.dicom-gateway.yml up -d
```

## Maintenance

### Backup

```bash
# Database backup (internal DB)
docker compose exec postgres pg_dump -U rispro rispro > backup.sql

# Storage backup
docker compose exec app tar czf - -C /app/storage . > storage-backup.tar.gz
```

### Restart Services

```bash
# Full stack restart
docker compose restart

# App only
docker compose restart app

# Rebuild and restart
docker compose up -d --build
```

### View Logs

```bash
# All services
docker compose logs -f

# App only
docker compose logs -f app

# Database only
docker compose logs -f postgres
```

### Update

```bash
git pull
docker compose down
docker compose up -d --build
```

## Troubleshooting

### MWL/MPPS Not Starting

Check logs:
```bash
docker compose logs app | grep "DICOM"
```

Common issues:
- Port already in use (check with `docker compose ps`)
- Missing DCMTK binaries (should be built into image)
- Directory permissions (check with smoke test)

### Database Connection Failed

For internal DB:
```bash
docker compose logs postgres
docker compose exec postgres pg_isready -U rispro
```

For external DB:
```bash
# Verify connectivity from inside container
docker compose exec app bash -c "pg_isready -h your-db-host -p 5432"
```

### Run Smoke Test

```bash
docker compose exec app bash /app/scripts/dicom-gateway/smoke-test.sh
```

## Legacy: Separate DICOM Gateway Service

The old `docker-compose.dicom-gateway.yml` with a separate gateway container is still available but **not recommended** for new deployments. Use the embedded gateway instead.

To use the legacy setup:
```bash
docker compose -f docker-compose.dicom-gateway.yml up -d
```
