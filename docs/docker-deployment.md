# RISpro Reception - Docker Deployment Guide

## Quick Start

### First-Time Setup

Run the interactive setup script. It will ask whether to use an internal or external database, generate secure credentials, and start everything:

```bash
./scripts/setup-docker.sh
```

That's it. After the script finishes:

- **Web UI**: `http://localhost:3000`
- **DICOM MWL**: `127.0.0.1:11112` (AE: `RISPRO_MWL`)
- **DICOM MPPS**: `127.0.0.1:11113` (AE: `RISPRO_MPPS`)

### Updating to Latest Code

```bash
./scripts/update-docker.sh
```

This pulls the latest code, rebuilds, restarts containers, and verifies health. Existing `.env` and data volumes are preserved.

---

## Database Modes

### Mode 1: Internal PostgreSQL (Default, Easiest)

A PostgreSQL 16 container is started alongside the app. All data is managed by Docker volumes.

**Setup command:**
```bash
./scripts/setup-docker.sh
# Select option 1 when prompted
```

**Manual commands:**
```bash
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml up -d --build
```

**What this deploys:**

| Container | Purpose | Ports |
|-----------|---------|-------|
| `rispro-app` | RISpro app + embedded DICOM | 3000, 11112, 11113 |
| `rispro-db`  | PostgreSQL 16 | 5432 (internal only) |

### Mode 2: External PostgreSQL

Connect to an existing PostgreSQL server. No database container is started.

**Setup command:**
```bash
./scripts/setup-docker.sh
# Select option 2 when prompted, enter your DB details
```

**Manual setup:**
```bash
# 1. Create .env with your external DATABASE_URL
# 2. Start (no internal-db override file)
docker compose up -d --build
```

---

## DICOM Architecture

### Embedded Gateway (Default Design)

The RISpro app container includes the complete DCMTK toolchain and runs all DICOM services internally:

| Service | Binary | Purpose |
|---------|--------|---------|
| **MWL SCP** | `wlmscpfs` | Serves modality worklist files to modalities |
| **MPPS SCP** | `ppsscpfs` | Receives MPPS objects from modalities |
| **Worklist Builder** | Node.js worker | Generates `.wl` files from appointments |
| **MPPS Processor** | Node.js worker | Processes received MPPS files and updates appointments |

**No separate gateway container is needed.** Everything runs inside the single `rispro-app` container.

### Worklist Directory Layout

```
/app/storage/dicom/worklists/
├── RISPRO_MWL/          # AE-specific subdirectory
│   ├── lockfile
│   └── *.wl files
└── RISPRO_MWL_2/        # Additional AE titles if configured
    └── ...
```

### Persistent Volumes

| Volume | Contents |
|--------|----------|
| `rispro-storage` | DICOM worklists, MPPS inbox, uploads |
| `postgres-data` | PostgreSQL data (internal DB mode only) |

---

## Startup Flow

When the container starts, the entrypoint script (`docker/rispro/entrypoint.sh`) performs these steps automatically:

1. **Wait for PostgreSQL** — polls the database until it responds (up to 60 seconds)
2. **Run migrations** — `npm run migrate`
3. **Seed supervisor** — `npm run seed:supervisor` (idempotent)
4. **Start the app** — `npx tsx src/server.ts`

The app then:
- Seeds DICOM gateway defaults if missing
- Creates DICOM directories
- Rebuilds worklist sources
- Starts embedded MWL SCP (`wlmscpfs`)
- Starts embedded MPPS SCP (`ppsscpfs`) if available
- Starts worklist builder and MPPS processor workers

### Startup Summary Output

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

---

## Verification

### Check Logs

```bash
# Application logs (startup summary + ongoing)
docker compose logs -f app

# Database logs (internal DB mode)
docker compose logs -f postgres
```

### Health Check

```bash
curl http://localhost:3000/api/health
# => {"ok":true,"environment":"production"}

curl http://localhost:3000/api/ready
# => {"ok":true}
```

### DICOM Smoke Test

```bash
docker compose exec app sh /app/scripts/dicom-gateway/smoke-test.sh
```

This validates:
- Backend health and readiness
- DICOM C-ECHO to MWL SCP and MPPS SCP
- All 6 DCMTK tools availability
- DICOM directory health

### Manual DICOM Verification

```bash
# Test MWL SCP
docker compose exec app echoscu -v -aec RISPRO_MWL 127.0.0.1 11112

# Test MPPS SCP
docker compose exec app echoscu -v -aec RISPRO_MPPS 127.0.0.1 11113
```

---

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
| `DB_WAIT_RETRIES` | `30` | Max attempts to wait for PostgreSQL |
| `DB_WAIT_INTERVAL` | `2` | Seconds between retry attempts |

### DICOM Settings

DICOM gateway settings are stored in the database and managed via the **Settings → DICOM Gateway** UI:

- AE titles (MWL and MPPS)
- Ports (default: 11112, 11113)
- Bind host
- Worklist directories

### Disabling Embedded Gateway

If you prefer an external DICOM gateway sidecar:

```env
# In .env
RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=1
```

The app will skip starting embedded DICOM services. You can then use the legacy `docker-compose.dicom-gateway.yml` for a separate gateway container.

---

## Maintenance

### Backup

```bash
# Database backup (internal DB)
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml exec postgres \
  pg_dump -U rispro rispro > backup-$(date +%Y%m%d).sql

# Storage backup
docker compose exec app tar czf - -C /app/storage . > storage-backup-$(date +%Y%m%d).tar.gz
```

### Restart

```bash
# Full stack restart
docker compose restart

# App only
docker compose restart app

# Rebuild and restart
./scripts/update-docker.sh
```

### Stop

```bash
docker compose down
```

Volumes are preserved. Data survives container restarts.

### Full Cleanup

```bash
# Stop and remove everything including volumes
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml down -v

# Remove built images
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml rm -f
```

---

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose logs app

# Check if database is ready (internal DB)
docker compose exec postgres pg_isready -U rispro
```

### Database Connection Failed

For internal DB:
```bash
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml logs postgres
```

For external DB:
```bash
# Verify connectivity from inside the container
docker compose exec app bash -c "wget -qO- http://127.0.0.1:3000/api/ready || echo 'Not ready'"
```

### MWL/MPPS Not Responding

```bash
# Check DICOM service status in logs
docker compose logs app | grep "DICOM"

# Run smoke test
docker compose exec app sh /app/scripts/dicom-gateway/smoke-test.sh

# Verify processes are running
docker compose exec app ps aux | grep -E "wlmscpfs|ppsscpfs"
```

### Port Conflicts

If ports 3000, 11112, or 11113 are already in use:

```bash
# Check what's using the port
lsof -i :11112

# Or change the host port mapping in docker-compose.yml
# e.g., "21112:11112" to map host port 21112 to container port 11112
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                  Host Machine                    │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │        rispro-app (Debian bookworm)       │   │
│  │                                            │   │
│  │  ┌────────────────────────────────────┐   │   │
│  │  │  Node.js App (Express + React)     │   │   │
│  │  │  :3000  Web UI + REST API          │   │   │
│  │  └────────────────────────────────────┘   │   │
│  │                                            │   │
│  │  ┌────────────────────────────────────┐   │   │
│  │  │  DICOM Gateway (embedded)          │   │   │
│  │  │  :11112  MWL SCP (wlmscpfs)        │   │   │
│  │  │  :11113  MPPS SCP (ppsscpfs)       │   │   │
│  │  │  Workers: build-worklists,         │   │   │
│  │  │           process-mpps-inbox       │   │   │
│  │  └────────────────────────────────────┘   │   │
│  │                                            │   │
│  │  /app/storage/dicom/  (Docker volume)     │   │
│  │  /app/storage/uploads/ (Docker volume)    │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │  rispro-db (internal DB mode only)        │   │
│  │  PostgreSQL 16 :5432                      │   │
│  │  /var/lib/postgresql/data (Docker volume) │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Legacy: Separate DICOM Gateway Service

The old `docker-compose.dicom-gateway.yml` with a separate gateway container is still available but **not recommended** for new deployments. Use the embedded gateway instead.

To use the legacy setup:
```bash
docker compose -f docker-compose.dicom-gateway.yml up -d
```
