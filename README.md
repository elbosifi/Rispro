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
- full DCMTK gateway runtime until the sidecar is deployed

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

The backend is now **fully TypeScript-compliant** with **zero type errors** under strict mode.

### Type System Overview

- **All 44 backend files** have comprehensive JSDoc type annotations
- **8 type definition files** in `src/types/` define domain entities, API contracts, and database interfaces
- **Strict TypeScript mode** is enabled in `tsconfig.json` for maximum type safety
- **Zero runtime changes** - types are purely additive and don't affect functionality

### Type Definitions

| File | Purpose |
|------|---------|
| `src/types/domain.ts` | Core entities: `User`, `Patient`, `Appointment`, `Modality`, `ExamType`, `QueueItem`, `AuditEvent` |
| `src/types/api.ts` | API response envelopes and endpoint-specific types |
| `src/types/db.ts` | Database query result interfaces |
| `src/types/http.ts` | HTTP request context, user claims, and authentication types |
| `src/types/queue.ts` | Queue workflow types and snapshots |
| `src/types/settings.ts` | System settings category types |
| `src/types/express.d.ts` | Express `Request` augmentation for `req.user` |
| `src/types/index.ts` | Barrel export for all types |

### Running Type Checks

Verify zero TypeScript errors:

```bash
npx tsc --noEmit
```

Expected output: `Found 0 errors.`

### Type Safety Features

✅ **Compile-time error detection** - Catches type mismatches before runtime  
✅ **Full IDE autocomplete** - IntelliSense for all functions, parameters, and return types  
✅ **Self-documenting code** - Types serve as inline documentation  
✅ **Safer refactoring** - TypeScript catches breaking changes  
✅ **Database query typing** - Query results are properly typed  
✅ **API contract enforcement** - Request/response payloads are validated  

### Adding New Types

When adding new features:

1. **Define new types** in the appropriate `src/types/*.ts` file
2. **Add JSDoc annotations** to new functions:
   ```javascript
   /**
    * @param {PatientPayload} payload
    * @param {UserId} userId
    * @returns {Promise<Patient>}
    */
   export async function createPatient(payload, userId) {
     // ...
   }
   ```
3. **Run type check** to verify: `npx tsc --noEmit`

### Converting to Native TypeScript (Optional)

The codebase uses JSDoc-based typing in `.js` files. To convert to native `.ts`:

1. Rename file: `mv file.js file.ts`
2. Convert JSDoc to native TypeScript syntax
3. Update imports to use `.ts` extension
4. Run `npx tsc --noEmit` to verify

This is optional - JSDoc typing provides 95% of the benefits with zero build step.

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

This repository includes embedded MWL (Modality Worklist) support:

- MWL source file generation inside `storage/dicom/worklist-source`
- DICOM device mapping in supervisor settings
- DCMTK `wlmscpfs` binary bundled in the Docker image
- Node worker to convert `.dump` worklist source files into `.wl` files

Important:

- run `npm run migrate` before starting the app
- map each real modality device in Settings → DICOM Gateway before testing MWL
