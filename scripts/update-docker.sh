#!/bin/sh
# =============================================================================
# RISpro Docker Update - Pull latest code and restart
# =============================================================================
# Reuses existing .env. Does not prompt. Preserves volumes.
# Reads RISPRO_DB_MODE from .env to choose compose files.
# =============================================================================

set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
APP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$APP_DIR/.env"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
info()  { printf '\n[INFO] %s\n' "$1"; }
ok()    { printf '[OK]   %s\n' "$1"; }
warn()  { printf '[WARN] %s\n' "$1"; }
err()   { printf '[ERROR] %s\n' "$1" >&2; }

# ---------------------------------------------------------------------------
# Compose detection
# ---------------------------------------------------------------------------
detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif docker-compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    err "Docker Compose is not installed or not in PATH."
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# HTTP check
# ---------------------------------------------------------------------------
check_http() {
  _url="$1"
  if curl -fsS "$_url" >/dev/null 2>&1; then
    return 0
  elif wget -qO- "$_url" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Read RISPRO_DB_MODE from .env
# ---------------------------------------------------------------------------
read_db_mode() {
  if [ ! -f "$ENV_FILE" ]; then
    err ".env file not found at: $ENV_FILE"
    err "Run ./scripts/setup-docker.sh first to configure."
    exit 1
  fi

  DB_MODE=""
  if grep -q '^RISPRO_DB_MODE=' "$ENV_FILE" 2>/dev/null; then
    DB_MODE="$(grep '^RISPRO_DB_MODE=' "$ENV_FILE" | head -1 | cut -d= -f2)"
  fi

  if [ -z "$DB_MODE" ]; then
    err "RISPRO_DB_MODE is missing from $ENV_FILE"
    err "The .env file may be from an older setup. Please rerun:"
    err "  ./scripts/setup-docker.sh"
    exit 1
  fi

  case "$DB_MODE" in
    internal|external) ;;
    *)
      err "Invalid RISPRO_DB_MODE='$DB_MODE' in .env (expected 'internal' or 'external')."
      exit 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo ""
  echo "==================================================="
  echo "  RISpro Reception - Docker Update"
  echo "==================================================="
  echo ""

  detect_compose
  read_db_mode

  ok "Database mode from .env: $DB_MODE"

  cd "$APP_DIR"

  # Pull latest code (non-blocking)
  info "Fetching latest code from git..."
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git pull --rebase 2>&1 || warn "Git pull failed. Continuing with local changes."
  else
    warn "Not a git repository. Skipping git pull."
  fi

  # Choose compose files
  case "$DB_MODE" in
    internal)
      _cf="-f docker-compose.yml -f docker-compose.internal-db.yml"
      ;;
    external)
      _cf="-f docker-compose.yml"
      ;;
  esac

  # Rebuild and restart (volumes preserved automatically)
  info "Building and restarting containers..."
  # shellcheck disable=SC2086
  $COMPOSE_CMD $_cf up -d --build

  echo ""
  info "Waiting for application to become healthy..."
  _attempt=0
  _max=45
  while [ "$_attempt" -lt "$_max" ]; do
    _attempt=$(( _attempt + 1 ))
    if check_http "http://127.0.0.1:3000/api/health"; then
      ok "Application is healthy!"
      break
    fi
    printf '  Waiting... (%d/%d)\n' "$_attempt" "$_max"
    sleep 2
  done

  if [ "$_attempt" -ge "$_max" ]; then
    err "Application did not become healthy within expected time."
    err "Check logs: $COMPOSE_CMD logs -f app"
    exit 1
  fi

  echo ""
  echo "==================================================="
  ok "Update complete!"
  echo "==================================================="
  echo ""
  echo "  Web UI:     http://localhost:3000"
  echo "  DICOM MWL:   127.0.0.1:11112 (AE: RISPRO_MWL)"
  echo ""
  echo "  Useful commands:"
  echo "    $COMPOSE_CMD logs -f app         # View application logs"
  echo "    $COMPOSE_CMD ps                   # List running containers"
  echo "    $COMPOSE_CMD down                 # Stop all containers"
  echo ""
}

main "$@"
