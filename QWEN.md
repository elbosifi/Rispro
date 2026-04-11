# RISpro Reception - Project Context

## Project Overview

**RISpro Reception** is a Radiology Information System (RIS) web application for medical imaging centers. It handles patient registration, appointment scheduling, queue management, and integration with PACS/DICOM systems.

### Architecture

- **Frontend**: React 19 + TypeScript SPA (Single Page Application)
  - `frontend/src/` - React components, pages, and hooks
  - React Router for client-side routing
  - TanStack Query for server state management
  - TailwindCSS for styling with dark/light themes
  - Vite for fast development and building

- **Backend**: Node.js + Express.js + TypeScript
  - RESTful API architecture
  - Cookie-based session authentication
  - JWT tokens for session management
  - 100% TypeScript (zero `.js` files remaining)
  
- **Database**: PostgreSQL
  - Migration history tracking schema evolution
  - Connection pooling with configurable limits
  
- **Integrations**:
  - DICOM gateway (MWL-only)
  - PACS C-FIND for prior studies
  - Document upload/scanning

Current release:
- MWL is bundled and starts automatically in Docker on port 11112.
- MPPS is not included in this release.

### Core Features

1. **Patient Management**
   - Registration with Arabic/English names
   - National ID validation (Libyan format)
   - Automatic DOB/sex derivation from national ID
   - Duplicate detection
   - Patient merge functionality

2. **Appointment Scheduling**
   - Read docs/appointments-v2/QWEN_TASK_PREAMBLE.md and follow it for this task.
   
3. **Queue Management**
   - Barcode scanning for patient arrival
   - Walk-in queue entries
   - No-show tracking and confirmation
   - Real-time queue status

4. **Printing & Documents**
   - Appointment slips
   - Daily appointment lists
   - Document upload (referral requests)

5. **Supervisor Features**
   - User management
   - System settings
   - Audit log with CSV export
   - Backup/restore functionality
   - DICOM device configuration

6. **PACS Integration**
   - C-FIND search by national ID
   - Prior studies retrieval

## Building and Running

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL database
- npm or yarn

### Local Development Setup

```bash
# 1. Clone and install
cd RISpro
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 3. Initialize database
npm run migrate
npm run seed:supervisor

# 4. Start development server
npm run dev       # Hot reload with --watch
# OR
npm start         # Production mode
```

### Environment Variables

**Required:**
- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=postgresql://user:pass@host:5432/dbname`
- `JWT_SECRET=<long-random-secret>`
- `COOKIE_SECURE=true` (in production)
- `TRUST_PROXY=1` (behind reverse proxy)

**Optional:**
- `DATABASE_SSL=true`
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false`
- `DB_POOL_MAX=10`
- `SESSION_HOURS=8`
- `REQUEST_BODY_LIMIT=1mb`

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Development with auto-reload |
| `npm start` | Production server |
| `npm run migrate` | Run database migrations |
| `npm run seed:supervisor` | Create initial supervisor user |
| `npm run check` | Syntax validation |
| `npm run gateway:build-worklists` | Build DICOM worklist files |

### Docker Deployment

```bash
# Build image
docker build -t rispro-reception .

# Run container (embedded MWL gateway starts automatically)
docker run --env-file .env -p 3000:3000 -p 11112:11112 rispro-reception

# Or use Docker Compose
docker compose up -d --build
```

### Health Checks

- `/api/health` - Process health
- `/api/ready` - Database readiness

## Development Conventions

### Code Style

- **ES Modules**: All files use `import/export` syntax
- **Naming**: 
  - Services: `*-service.js`
  - Routes: `*-router.js`
  - Middleware: `*-middleware.js` or in `middleware/`
- **Error Handling**: Custom `HttpError` class with status codes
- **Async Routes**: `asyncRoute` wrapper for route handlers

### Project Structure

```
RISpro/
├── src/
│   ├── config/          # Environment configuration
│   ├── db/
│   │   ├── migrations/  # SQL schema migrations
│   │   ├── pool.js      # PostgreSQL connection pool
│   │   └── seed-*.js    # Database seeding
│   ├── middleware/      # Express middleware
│   ├── routes/          # API route handlers
│   ├── services/        # Business logic
│   ├── utils/           # Helper functions
│   ├── app.js           # Express app setup
│   └── server.js        # Entry point
├── app.js               # Frontend SPA
├── styles.css           # Frontend styles
├── index.html           # Frontend entry
├── assets/              # Static assets
├── components/          # UI components (if any)
├── docs/                # Documentation
├── scripts/             # Deployment & utility scripts
└── docker/              # Docker configurations
```

### Database Migrations

Migrations are versioned SQL files in `src/db/migrations/`:
- Run sequentially
- Tracked in `schema_migrations` table
- Use `npm run migrate` to apply

### API Design Patterns

**Route Structure:**
```javascript
router.post(
  "/",
  asyncRoute(async (req, res) => {
    const result = await serviceFunction(req.body, req.user);
    res.status(201).json(result);
  })
);
```

**Service Functions:**
- Accept payload and user context
- Use database transactions for multi-step operations
- Throw `HttpError` for validation/auth failures
- Return plain objects (not HTTP responses)

**Authentication:**
- `requireAuth` middleware for protected routes
- `requireSupervisor` for admin-only routes
- `hasRecentSupervisorReauth()` for sensitive operations

### Frontend Patterns

**State Management:**
- Global `state` object
- `render()` triggers UI updates
- Template literals for HTML generation

**API Calls:**
```javascript
const result = await api("/api/endpoint", {
  method: "POST",
  body: JSON.stringify(payload)
});
```

**Toast Notifications:**
- Use `pushToast("success"|"error", message)` for user feedback
- Auto-dismiss after 4.5 seconds
- Manual dismiss with × button

**Form Handling:**
- Form state in `state.<formName>Form`
- Input handlers update state and trigger re-render
- Validation before submission

### Testing Practices

- Manual testing via UI
- Syntax validation: `npm run check`
- Health endpoint checks
- Database readiness verification

### Key Business Rules

1. **National ID**: 11 digits, first digit indicates sex (1=male, 2=female)
2. **Accession Number**: `YYYYMMDD-XXX` (date + daily sequence)
3. **Overbooking**: Requires supervisor password for each instance
4. **No-Show Review**: After 17:00 daily
5. **Duplicate Detection**: Fuzzy matching on names, exact on national ID
6. **Session Timeout**: 8 hours (configurable)

## Recent Changes (April 2026 - Current Session)

### TypeScript Migration Complete ✅
1. **Backend**: 100% TypeScript - all `.js` files converted, zero remaining
2. **Frontend**: All 13 pages migrated from legacy SPA to React + TypeScript
3. **Type Safety**: Zero TypeScript errors in both backend and frontend

### Code Quality Improvements (16 Issues Fixed)

**Security (2 fixes):**
- SQL injection prevention in backup restore (table/column validation)
- Walk-in queue entry fixed (added modality selector)

**Performance (4 fixes):**
- N+1 query pattern eliminated in `getAppointmentPrintDetails`
- Parallel DB calls in `listAvailability` using `Promise.all()`
- In-memory caching for settings/dictionary lookups (5-min TTL)
- Debounced patient search inputs (300ms delay)

**Code Quality (6 fixes):**
- Dead code removed (`src/utils/records.js` deleted)
- Duplicate code extracted to shared utils (`normalizeOptionalText`, `validateIsoDate`)
- Type safety improved (`PatientPayload.ageYears`, unsafe casts removed)
- Audit log quality improved (status history only logged on actual changes)
- DICOM device logic fixed (prefer matching source_ip)
- Error handling improved (DICOM worklist sync warnings)

**DICOM MWL Gateway Fix:**
- Fixed `wlmscpfs` startup to use DCMTK's correct working-directory model.
- `wlmscpfs` is now launched with `-dfp` pointing to the parent worklist directory
  (e.g., `/app/storage/dicom/worklists`) instead of the AE-specific subdirectory.
- DCMTK resolves the Called AE Title from incoming associations to select the
  matching AE-specific subdirectory (e.g., `RISPRO_MWL/`).
- Added C-ECHO smoke test that runs automatically after startup to verify
  MWL SCP is responding before the app is considered healthy.
- Added explicit logging: parent directory, AE title, and AE-specific directory path.
- Removed MPPS support entirely (code, files, migrations, docs). MWL-only deployment.

**Architecture:**
- New caching utility: `src/utils/cache.ts`
- Date validation centralized: `src/utils/date.ts::validateIsoDate()`
- Text normalization centralized: `src/utils/normalize.ts::normalizeOptionalText()`

### Previous Changes

1. **Overbooking Password**: Now required for EVERY overbooking attempt (not cached)
2. **Toast Notifications**: Converted all static alerts to toast popups
3. **PACS Search**: Now works with national ID from form (not just saved patients)
4. **Sex Derivation**: Auto-fills sex from national ID (1=male, 2=female)
5. **Queue Success Messages**: Converted to toast notifications

## Common Tasks

### Adding a New API Endpoint

1. Create route in `src/routes/<resource>.js`
2. Create service function in `src/services/<resource>-service.js`
3. Add middleware for auth if needed
4. Update frontend `app.js` to call the API

### Adding a Database Column

1. Create new migration file in `src/db/migrations/`
2. Run `npm run migrate`
3. Update service layer queries
4. Update frontend if needed

### Adding a New Setting

1. Add to settings catalog in migration
2. Add to `src/routes/settings.js` handler
3. Add UI in settings page rendering function
4. Use `saveSettingsCategory()` in frontend

## Troubleshooting

**Database Connection Issues:**
- Check `DATABASE_URL` format
- Verify SSL settings for managed databases
- Run `npm run migrate` after schema changes

**Session/Auth Problems:**
- Clear browser cookies
- Verify `JWT_SECRET` matches
- Check `COOKIE_SECURE` matches deployment (false for localhost)

**DICOM Gateway (Embedded, MWL only):**
- The embedded gateway starts automatically on container startup.
- `wlmscpfs` is launched with `-dfp` pointing to the parent worklist directory
  (e.g., `/app/storage/dicom/worklists`), which contains AE-specific subdirectories.
- DCMTK resolves the Called AE Title from incoming associations to select the
  correct subdirectory (e.g., `RISPRO_MWL/lockfile` and `RISPRO_MWL/*.wl`).
- The worklist builder writes `.wl` files into AE-specific subdirectories.
- A C-ECHO smoke test runs automatically after startup to verify MWL SCP is responding.
- If C-ECHO fails, check:
  - `wlmscpfs` binary is on PATH
  - Worklist directory has correct permissions
  - AE title in settings matches the called AE title
  - No other process is using the MWL port (11112)
- MPPS is not included in this release.

## Documentation References

- `/docs/backend-handoff.md` - Backend architecture overview
- `/docs/production-rollout.md` - Deployment checklist
- `/docs/v1-specification.md` - Original feature specifications

## Qwen Added Memories
- Full production deployment script: /Users/serajalsaifi/Nextcloud/RISpro/deploy.sh
  Usage: ENABLE_DICOM_GATEWAY=1 SERVICE_NAME=rispro ./deploy.sh
  Key env vars: ENABLE_DICOM_GATEWAY, SERVICE_NAME, RESTART_MODE, DEPLOY_BRANCH, HEALTHCHECK_URL
  The script handles: git pull, npm ci, migrations, DCMTK installation, systemd service provisioning, worklist rebuild, DICOM echo smoke test
  Note: DICOM gateway is embedded (MWL only). No separate sidecar container is shipped in this release.
