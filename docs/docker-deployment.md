# RISpro Reception - Docker Deployment Guide

## Quick Start

### First-Time Setup

Run the interactive setup script. It asks whether to use an internal or external database, generates secure credentials, and starts everything:

```bash
./scripts/setup-docker.sh
```

Press Enter at every prompt to accept all defaults for a zero-touch install.

After the script finishes:

- **Web UI**: `http://localhost:3000`
- **DICOM MWL**: `127.0.0.1:11112` (AE: `RISPRO_MWL`)
- **Note**: This release is MWL-only. MPPS is not included.

The supervisor credentials are printed at the end of setup.

### Updating to Latest Code

```bash
./scripts/update-docker.sh
```

This reads `RISPRO_DB_MODE` from the existing `.env`, pulls the latest code, rebuilds, restarts containers, and verifies health. No prompts. Volumes are preserved.

The update script now force-syncs the working tree before pulling:

```bash
git reset --hard HEAD
git clean -fd
git pull origin <current-branch>
```

That means any local tracked changes or untracked files in the repository will be discarded during update.

---

## Database Modes

The setup mode is stored in `.env` as `RISPRO_DB_MODE`. The update script reads this value and picks the correct compose files automatically.

### Mode 1: Internal PostgreSQL (Default)

A PostgreSQL 16 container is started alongside the app. Data is stored in the `postgres-data` Docker volume, managed entirely by Docker.

**Setup:**
```bash
./scripts/setup-docker.sh
# Press Enter at the mode prompt (default: 1 = internal)
```

**Manual commands:**
```bash
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml up -d --build
```

**What this deploys:**

| Container | Purpose | Ports | Volume |
|-----------|---------|-------|--------|
| `rispro-app` | RISpro app + embedded DICOM (MWL only) | 3000, 11112 | `rispro-storage` |
| `rispro-db`  | PostgreSQL 16 | 5432 (internal only) | `postgres-data` |

> **Note:** Internal Docker PostgreSQL does not support SSL. The setup script writes `DATABASE_SSL=false` and `DATABASE_SSL_REJECT_UNAUTHORIZED=false` automatically.

### Mode 2: External PostgreSQL

Connect to an existing PostgreSQL server. Docker never creates, manages, or deletes this database.

**Setup:**
```bash
./scripts/setup-docker.sh
# Select 2 when prompted, then enter DB details (or press Enter for defaults)
```

**Manual setup:**
```bash
# 1. Create .env with RISPRO_DB_MODE=external and your DATABASE_URL
# 2. Start (base file only, no internal-db override)
docker compose -f docker-compose.yml up -d --build
```

---

## DICOM Architecture

### Embedded Gateway (Default Design)

The RISpro app container includes a source-built DCMTK toolchain from the official OFFIS 3.6.9 release tarball, verified by SHA256 during image build, and runs the MWL gateway internally:

| Service | Binary | Purpose |
|---------|--------|---------|
| **MWL SCP** | `wlmscpfs` | Serves modality worklist files to modalities |
| **Worklist Builder** | Node.js worker | Generates `.wl` files from appointments |

The final image bundles the MWL DCMTK binary needed for this build, so `wlmscpfs` is available without a separate gateway container. MPPS is intentionally omitted from this release.

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
| `rispro-storage` | DICOM worklists, uploads |
| `postgres-data` | PostgreSQL data (internal DB mode only). Never removed by update scripts. |

---

## Startup Flow

When the container starts, the entrypoint script (`docker/rispro/entrypoint.sh`) performs these steps automatically:

1. **Wait for PostgreSQL** — polls the database until it responds (up to 60 seconds, configurable)
2. **Run migrations** — `npm run migrate` (runs via `tsx`, installed at build time)
3. **Seed supervisor** — `npm run seed:supervisor` (idempotent, safe to rerun)
4. **Start the app** — `npx tsx src/server.ts`

The app then:
- Seeds DICOM gateway defaults if missing
- Creates DICOM directories
- Rebuilds worklist sources
- Starts embedded MWL SCP (`wlmscpfs`)
- Starts the worklist builder worker

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
    Worklist Bldr:  running
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
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml logs -f postgres
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
- DICOM C-ECHO to the MWL SCP
- Required MWL DCMTK tools availability
- DICOM directory health

### Manual DICOM Verification

```bash
# Test MWL SCP
docker compose exec app echoscu -v -aec RISPRO_MWL 127.0.0.1 11112
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `3000` | HTTP port for web app |
| `DATABASE_URL` | (see .env.example) | PostgreSQL connection string |
| `RISPRO_DB_MODE` | (written by setup) | `internal` or `external` — used by update script |
| `DATABASE_SSL` | `false` | Must be `false` for internal Docker PostgreSQL. Set `true` only if your external server requires it. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` | Whether to reject self-signed SSL certificates. |
| `JWT_SECRET` | (required) | Secret for session tokens |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS proxy |
| `TRUST_PROXY` | `1` | Trust reverse proxy headers |
| `DB_WAIT_RETRIES` | `30` | Max attempts to wait for PostgreSQL |
| `DB_WAIT_INTERVAL` | `2` | Seconds between retry attempts |

### DICOM Settings

DICOM gateway settings are stored in the database and managed via the **Settings → DICOM Gateway** UI:

- AE title and port for MWL
- Bind host
- Worklist directories

### Disabling Embedded Gateway

If you prefer to disable the embedded DICOM gateway:

```env
# In .env
RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=1
```

The app will skip starting embedded DICOM services. This repository no longer ships a separate gateway container, and the released build remains MWL-only.

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
# Stop and remove everything including volumes (internal DB mode)
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml down -v

# Remove built images
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml rm -f
```

> **Warning:** `down -v` permanently deletes the `postgres-data` volume. External PostgreSQL data is never affected by Docker Compose.

---

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose logs app

# Check if database is ready (internal DB)
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml exec postgres pg_isready -U rispro
```

### Database Connection Failed

For internal DB:
```bash
docker compose -f docker-compose.yml -f docker-compose.internal-db.yml logs postgres
```

For external DB:
```bash
# Verify connectivity from inside the container
docker compose exec app wget -qO- http://127.0.0.1:3000/api/ready || echo "Not ready"
```

### MWL Not Responding

```bash
# Check DICOM service status in logs
docker compose logs app | grep "DICOM"

# Run smoke test
docker compose exec app sh /app/scripts/dicom-gateway/smoke-test.sh

# Verify processes are running
docker compose exec app ps aux | grep -E "wlmscpfs|build-worklists"
```

### Port Conflicts

If ports 3000 or 11112 are already in use:

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
│  │  │  Workers: build-worklists           │   │   │
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

The old `docker-compose.dicom-gateway.yml` with a separate gateway container has been removed.
The embedded MWL gateway is the only supported deployment model.
