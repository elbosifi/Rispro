#!/bin/sh
# =============================================================================
# RISpro Docker Update - Pull latest code and restart
# =============================================================================
# Reuses existing .env. Does not prompt. Preserves volumes.
# =============================================================================

set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
APP_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)"
ENV_FILE="$APP_DIR/.env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() {
  printf '\n${CYAN}%s${NC}\n' "$1"
}

success() {
  printf '${GREEN}✓ %s${NC}\n' "$1"
}

warn() {
  printf '${YELLOW}⚠ %s${NC}\n' "$1"
}

error() {
  printf '${RED}✗ %s${NC}\n' "$1"
}

# Check prerequisites
check_env() {
  if [ ! -f "$ENV_FILE" ]; then
    error ".env file not found at: $ENV_FILE"
    error "Run ./scripts/setup-docker.sh first to configure."
    exit 1
  fi
}

# Detect compose command
detect_compose() {
  if command -v docker compose >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    error "Neither 'docker compose' nor 'docker-compose' found."
    exit 1
  fi
}

# Detect compose files in use
detect_compose_files() {
  # If the internal-db override exists and is referenced in the current stack,
  # use both files. Otherwise use the base file only.
  if [ -f "$APP_DIR/docker-compose.internal-db.yml" ]; then
    # Check if the internal-db stack is actually running
    if docker compose -f "$APP_DIR/docker-compose.yml" -f "$APP_DIR/docker-compose.internal-db.yml" ps 2>/dev/null | grep -q "rispro-db"; then
      echo "-f docker-compose.yml -f docker-compose.internal-db.yml"
      return
    fi
  fi
  echo "-f docker-compose.yml"
}

# Main
main() {
  echo ""
  echo "==================================================="
  echo "  RISpro Reception - Docker Update"
  echo "==================================================="
  echo ""

  check_env

  compose_cmd="$(detect_compose)"
  compose_files="$(detect_compose_files)"

  info "Updating code from git..."
  cd "$APP_DIR"
  if command -v git >/dev/null 2>&1; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git pull --rebase || warn "Git pull failed. Continuing with local changes."
    fi
  fi

  info "Building and restarting containers..."
  # shellcheck disable=SC2086
  eval "$compose_cmd $compose_files up -d --build"

  echo ""
  info "Waiting for application to become healthy..."
  attempt=0
  max_attempts=30
  while [ $attempt -lt $max_attempts ]; do
    attempt=$((attempt + 1))
    if wget -qO- "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
      success "Application is healthy!"
      break
    fi
    printf "  Waiting... (%d/%d)\n" "$attempt" "$max_attempts"
    sleep 2
  done

  if [ $attempt -ge $max_attempts ]; then
    warn "Application did not become healthy within expected time."
    warn "Check logs with: docker compose logs -f app"
    exit 1
  fi

  echo ""
  echo "==================================================="
  success "Update complete!"
  echo "==================================================="
  echo ""
  echo "  Web UI:     http://localhost:3000"
  echo "  DICOM MWL:  127.0.0.1:11112 (AE: RISPRO_MWL)"
  echo "  DICOM MPPS: 127.0.0.1:11113 (AE: RISPRO_MPPS)"
  echo ""
  echo "  Useful commands:"
  echo "    docker compose logs -f app        # View application logs"
  echo "    docker compose ps                  # List running containers"
  echo "    docker compose down                # Stop all containers"
  echo ""
}

main "$@"
