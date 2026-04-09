#!/usr/bin/env bash
# =============================================================================
# RISpro Docker Entrypoint
# =============================================================================
# Waits for PostgreSQL, runs migrations, seeds supervisor, then starts the app.
# =============================================================================

set -euo pipefail

# Configuration
DB_URL="${DATABASE_URL:-}"
MAX_RETRIES="${DB_WAIT_RETRIES:-30}"
RETRY_INTERVAL="${DB_WAIT_INTERVAL:-2}"

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

# ---------------------------------------------------------------------------
# Extract host and port from DATABASE_URL
# Expected format: postgresql://user:pass@host:port/dbname
# ---------------------------------------------------------------------------
extract_db_host() {
  local url="$1"
  echo "$url" | sed -n 's|.*://[^:]*:[^@]*@\([^:]*\).*|\1|p'
}

extract_db_port() {
  local url="$1"
  echo "$url" | sed -n 's|.*://[^:]*:[^@]*@[^:]*:\([0-9]*\).*|\1|p'
}

extract_db_name() {
  local url="$1"
  echo "$url" | sed -n 's|.*/\(.*\)|\1|p'
}

# ---------------------------------------------------------------------------
# Wait for PostgreSQL
# ---------------------------------------------------------------------------
wait_for_postgres() {
  if [ -z "$DB_URL" ]; then
    log "ERROR: DATABASE_URL is not set. Cannot start."
    exit 1
  fi

  local host port dbname
  host="$(extract_db_host "$DB_URL")"
  port="$(extract_db_port "$DB_URL")"
  dbname="$(extract_db_name "$DB_URL")"

  # Default port if not specified
  port="${port:-5432}"

  log "Waiting for PostgreSQL at ${host}:${port}/${dbname}..."

  local attempt=0
  while [ $attempt -lt "$MAX_RETRIES" ]; do
    attempt=$((attempt + 1))

    # Try to connect using node (since pg_isready may not be available)
    if node --input-type=module -e "
      import pg from 'pg';
      const { Pool } = pg;
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 2000
      });
      try {
        await pool.query('SELECT 1');
        await pool.end();
        process.exit(0);
      } catch {
        await pool.end();
        process.exit(1);
      }
    " 2>/dev/null; then
      log "PostgreSQL is ready at ${host}:${port}/${dbname}"
      return 0
    fi

    log "Attempt ${attempt}/${MAX_RETRIES}: PostgreSQL not ready yet. Retrying in ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
  done

  log "ERROR: PostgreSQL did not become ready after ${MAX_RETRIES} attempts."
  exit 1
}

# ---------------------------------------------------------------------------
# Run migrations
# ---------------------------------------------------------------------------
run_migrations() {
  log "Running database migrations..."
  if npm run migrate; then
    log "Migrations completed successfully."
  else
    log "ERROR: Database migrations failed."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Seed supervisor account (idempotent)
# ---------------------------------------------------------------------------
seed_supervisor() {
  log "Seeding supervisor account (if missing)..."
  if npm run seed:supervisor 2>&1; then
    log "Supervisor account seeded."
  else
    log "WARNING: Supervisor seeding skipped (may already exist or credentials missing)."
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "========================================"
log "  RISpro Docker Entrypoint"
log "========================================"

wait_for_postgres
run_migrations
seed_supervisor

log "Starting application..."
log "========================================"

# Execute the CMD passed to the entrypoint
exec "$@"
