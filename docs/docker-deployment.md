# NCCB Diagnostic Radiology - Docker Deployment Guide

## Quick Start

### First-Time Setup

Run the interactive setup script. It asks for database mode, DICOM mode, and whether to enable the separate MPPS bridge, then generates the required configuration and starts everything:

```bash
./scripts/setup-docker.sh
```

Press Enter at every prompt to accept all defaults for a zero-touch install.

After the script finishes, the summary shows the active deployment endpoints for the selected mode.

The supervisor credentials are printed at the end of setup.

### Updating to an exact CI-verified commit

```bash
./scripts/update-docker.sh --expected-sha <40-character-commit-sha>
```

The update reuses the current `.env` deployment settings by default, checks out exactly
the supplied commit, validates the stack, rebuilds, restarts containers, and verifies
health plus the application-reported build SHA. Volumes are preserved. The deployed
commit SHA is injected into the running app through Compose and is intentionally not
baked into the early Docker dependency layers, so changing commits does not rebuild
unchanged OS or npm dependency layers.

If you want to change deployment settings during an update, run:

```bash
./scripts/update-docker.sh --expected-sha <40-character-commit-sha> --reconfigure
```

The update script now force-syncs the working tree before checking out the expected SHA:

```bash
git reset --hard HEAD
git clean -fd -e '/storage/sante-hl7-outbox/'
git fetch origin main
git checkout --detach <expected-sha>
```

That means any local tracked changes or untracked files in the repository will be discarded during update, except the persistent Sante HL7 outbox. `storage/sante-hl7-outbox/` is runtime data bind-mounted into the app and must retain pending files across normal updates, reconfigure updates, rebuilds, and container recreation.

---

## Deployment Modes

The deployment scripts write the selected modes into `.env` and choose compose overrides automatically.

| Variable | Supported Values | Purpose |
|----------|------------------|---------|
| `RISPRO_DB_MODE` | `internal`, `external` | Database source |
| `RISPRO_DICOM_MODE` | `embedded`, `orthanc_internal`, `orthanc_external` | MWL / DICOM target mode |
| `RISPRO_MPPS_MODE` | `disabled`, `internal_bridge` | Whether to deploy the separate MPPS bridge |

### Database Modes

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
| `rispro-app` | RISpro app | 3000, 11112 in embedded mode | `rispro-storage` |
| `rispro-gateway` | Same-domain HTTP gateway | 3000 | none |
| `rispro-ohif` | Pinned OHIF Viewer | internal 80 | none |
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

### Compose Override Selection

The scripts choose overrides automatically, but the manual mapping is:

| Mode Choice | Compose Files |
|------------|---------------|
| Internal DB | `docker-compose.yml` + `docker-compose.internal-db.yml` |
| Internal Orthanc | add `docker-compose.orthanc-internal.yml` |
| Internal MPPS bridge | add `docker-compose.mpps-bridge.yml` |

---

## DICOM Architecture

### Mode 1: Embedded RISpro MWL

This is the compatibility/default path. The RISpro app container includes the source-built DCMTK toolchain and runs the MWL gateway internally.

### Mode 2: Internal Orthanc

The deployment scripts add an `orthanc` container automatically, generate its config at `docker/orthanc/generated/orthanc.json`, disable the embedded RISpro MWL listener, and point RISpro at `http://orthanc:8042`.

The internal Orthanc image is now pinned through [docker/orthanc/Dockerfile](../docker/orthanc/Dockerfile), which builds from `orthancteam/orthanc:26.4.0`. The Orthanc Team image explicitly documents that its default `26.4.0` image includes the Worklists plugin, which makes it a safer MWL target than the old unpinned `jodogne/orthanc-plugins:latest` setup.

| Container | Purpose | Ports |
|-----------|---------|-------|
| `rispro-orthanc` | Internal Orthanc MWL / DICOM target | 8042, 4242 |

Authentication is off by default. Internal Orthanc now generates a permissive MWL runtime config so unknown modality AEs can query worklists without being listed in `DicomModalities`.

The generated internal Orthanc config now sets:
- `Plugins=["/usr/share/orthanc/plugins/"]`
- `Worklists.Enable=true`
- `Worklists.Directory=/var/lib/orthanc/worklists`

The deployment also mounts a dedicated `orthanc-worklists` volume at `/var/lib/orthanc/worklists`.

Before RISpro considers the stack healthy, the internal Orthanc deployment now verifies:
- the plugin binary exists at `/usr/share/orthanc/plugins/libOrthancWorklists.so`
- the generated config contains the required Worklists settings
- the configured worklist directory exists
- the runtime `/worklists` route responds without `404` or `405`

This readiness probe lives in [docker/orthanc/check-worklists-ready.sh](../docker/orthanc/check-worklists-ready.sh), is wired into the Orthanc container healthcheck, and is also run explicitly by setup/update after `docker compose up -d --build`.

### Mode 3: External Orthanc

No Orthanc container is deployed. The scripts only ask for the minimum external connection settings:

- `ORTHANC_BASE_URL`
- optional TLS verification choice
- optional HTTP auth toggle

RISpro remains the source of truth in all three modes.

### Optional MPPS Bridge

When `RISPRO_MPPS_MODE=internal_bridge`, Docker Compose adds a separate `mpps-bridge` container. It is implemented in Python with `pynetdicom` and `pydicom`, listens as an MPPS SCP, and stores received `N-CREATE` / `N-SET` payloads under the shared storage volume.

| Container | Purpose | Ports |
|-----------|---------|-------|
| `rispro-mpps-bridge` | Separate MPPS SCP bridge | `MPPS_BRIDGE_PORT` (default `11113`) |

Authentication is off by default. If explicitly enabled, the bridge protects its optional admin `/events` endpoint with HTTP Basic auth. DICOM associations remain zero-touch.

### Embedded Gateway (Compatibility Design)

The RISpro app container includes a source-built DCMTK toolchain from the official OFFIS 3.6.9 release tarball, verified by SHA256 during image build, and runs the MWL gateway internally:

| Service | Binary | Purpose |
|---------|--------|---------|
| **MWL SCP** | `wlmscpfs` | Serves modality worklist files to modalities |
| **Worklist Builder** | Node.js worker | Generates `.wl` files from appointments |

The final image bundles the MWL DCMTK binary needed for this build, so `wlmscpfs` is available without a separate gateway container when `RISPRO_DICOM_MODE=embedded`.

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
| `orthanc-data` | Orthanc data (internal Orthanc mode only) |
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
- Starts embedded MWL SCP (`wlmscpfs`) only in `embedded` mode
- Starts the worklist builder worker when embedded MWL is active
- Starts the Orthanc MWL worker when Orthanc projection is enabled

### Startup Summary Output

```
========================================
  NCCB Diagnostic Radiology - Startup Summary
========================================
  Backend:        http://localhost:3000
  Environment:    production
  Database:       postgres:5432/rispro

  DICOM Services:
    MWL SCP:        running (RISPRO_MWL @ 0.0.0.0:11112)
    Worklist Bldr:  running
    Worklist Dir:   /app/storage/dicom/worklists

  Orthanc MWL:
    Mode:           enabled_primary_mode
    Base URL:       http://orthanc:8042

  MPPS Bridge:
    AE Title:       RISPRO_MPPS
    Port:           11113
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
- DICOM C-ECHO to the embedded MWL SCP when embedded mode is active
- Required MWL DCMTK tools availability
- DICOM directory health

### MPPS Smoke Test

When `RISPRO_MPPS_MODE=internal_bridge`:

```bash
docker compose exec mpps-bridge sh /app/scripts/dicom-gateway/mpps-smoke-test.sh
```

This validates:
- TCP reachability on the MPPS SCP port
- the bridge admin health endpoint
- the `/events` endpoint with or without optional auth

### Deployment Mode Matrix Validation

To verify the supported compose combinations without bringing containers up:

```bash
./scripts/validate-docker-modes.sh
```

This renders compose config for:
- embedded MWL + internal DB
- internal Orthanc + internal DB
- external Orthanc + external DB
- internal Orthanc + internal DB + MPPS bridge

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
| `RISPRO_DICOM_MODE` | (written by setup) | `embedded`, `orthanc_internal`, or `orthanc_external` |
| `RISPRO_MPPS_MODE` | (written by setup) | `disabled` or `internal_bridge` |
| `DATABASE_SSL` | `false` | Must be `false` for internal Docker PostgreSQL. Set `true` only if your external server requires it. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` | Whether to reject self-signed SSL certificates. |
| `JWT_SECRET` | (required) | Secret for session tokens |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS proxy |
| `TRUST_PROXY` | `1` | Trust reverse proxy headers |
| `DB_WAIT_RETRIES` | `30` | Max attempts to wait for PostgreSQL |
| `DB_WAIT_INTERVAL` | `2` | Seconds between retry attempts |

### Orthanc / MPPS Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORTHANC_BASE_URL` | blank or auto-generated | Orthanc HTTP base URL |
| `ORTHANC_VERIFY_TLS` | `true` | Whether RISpro verifies Orthanc TLS certificates |
| `ORTHANC_TIMEOUT_SECONDS` | `10` | Orthanc request timeout |
| `ORTHANC_AUTH_ENABLED` | `false` | Prompt for Orthanc credentials only when true |
| `ORTHANC_USERNAME` | blank | Optional Orthanc username |
| `ORTHANC_PASSWORD` | blank | Optional Orthanc password |
| `MPPS_BRIDGE_PORT` | `11113` | MPPS SCP listening port |
| `MPPS_BRIDGE_AE_TITLE` | `RISPRO_MPPS` | MPPS SCP AE Title |
| `MPPS_AUTH_ENABLED` | `false` | Protect bridge admin endpoint with Basic auth |
| `MPPS_USERNAME` | blank | Optional bridge admin username |
| `MPPS_PASSWORD` | blank | Optional bridge admin password |

### OHIF Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OHIF_ENABLED` | `true` | Written by supported setup/update scripts while OHIF infrastructure is deployed; it is not the routine clinical control |
| `COMPOSE_PROFILES` | `ohif` | Written by supported setup/update scripts so the OHIF container and same-domain route are deployed |
| `OHIF_INFRASTRUCTURE_DISABLED` | `false` | Emergency deployment override; set to `true` only to omit OHIF infrastructure on the next supported setup/update run |
| `OHIF_PUBLIC_BASE_URL` | `/ohif` | Same-domain viewer path |
| `OHIF_DICOMWEB_PROXY_PATH` | `/ohif-dicomweb` | RISpro-authenticated DICOMweb proxy path |
| `OHIF_CONTAINER_IMAGE` | `rispro-ohif:v3.12.6` | Explicit pinned image name |
| `OHIF_VERSION` | `v3.12.6` | Official OHIF source release used for the subpath build |
| `OHIF_LAUNCH_TOKEN_TTL_SECONDS` | `600` | Short-lived viewer token lifetime |
| `OHIF_CACHE_CLEANUP_ENABLED` | `false` | Enables deletion only for proven OHIF-owned Orthanc cache IDs |
| `OHIF_DICOMWEB_USERNAME` | blank | Optional native upstream username; reference this variable name in Settings |
| `OHIF_DICOMWEB_PASSWORD` | blank | Optional native upstream password; reference this variable name in Settings |
| `OHIF_DICOMWEB_BEARER_TOKEN` | blank | Optional native bearer token; reference this variable name in Settings |

The gateway keeps `/` on RISpro, `/ohif/` on the OHIF container, and `/ohif-dicomweb/` on the protected RISpro proxy. Imaging responses are streamed with proxy buffering disabled and bounded timeouts. Do not point the public reverse proxy directly at Orthanc or OsiriX.

Supported `scripts/setup-docker.sh` and `scripts/update-docker.sh` seed `COMPOSE_PROFILES=ohif` and `OHIF_ENABLED=true` automatically. The database-backed Settings → Integrations → OHIF Viewer setting remains disabled by default for a new installation and is the routine operational control for doctor launch access. The shell cannot determine that database setting; its deployment summary reports the infrastructure state and `/ohif/` URL. To perform an emergency infrastructure rollback, set `OHIF_INFRASTRUCTURE_DISABLED=true` before a supported setup/update run; do not use it for ordinary enable/disable operations.

### Preflight Validation

Before startup, the setup/update scripts validate:

- deployment mode combinations
- required Orthanc URL/auth fields for external/internal Orthanc modes
- required MPPS bridge values when enabled
- compose rendering with the selected override set

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

### OHIF Won't Load Images

```bash
docker compose ps
docker compose logs gateway ohif app
curl -f http://localhost:3000/ohif/
```

If the shell loads but images do not, relaunch from the Reporting Board and use the request ID in System Diagnostics. A direct `/ohif-dicomweb/` request without an active scoped session is expected to return 401/403.

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
