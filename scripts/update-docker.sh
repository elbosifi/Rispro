#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="RISpro Reception"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
FRONTEND_ENV_FILE="${PROJECT_ROOT}/frontend/.env"
FRONTEND_ENV_LOCAL_FILE="${PROJECT_ROOT}/frontend/.env.local"

log()  { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[OK]   %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }

DB_MODE=""
COMPOSE_FILES=()

cleanup() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    err "Update failed with exit code ${exit_code}."
  fi
}
trap cleanup EXIT

print_header() {
  printf '\n===================================================\n'
  printf '  %s - Docker Update\n' "${APP_NAME}"
  printf '===================================================\n\n'
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "Required command not found: $1"
    exit 1
  }
}

detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
  else
    err "Docker Compose not found. Install 'docker compose' plugin or 'docker-compose'."
    exit 1
  fi
}

format_command() {
  local out=""
  local part

  for part in "$@"; do
    out="${out}$(printf '%q ' "$part")"
  done

  printf '%s' "${out% }"
}

read_env_value() {
  local key="$1"
  local value=""
  if [ -f "${ENV_FILE}" ]; then
    value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d '=' -f2- || true)"
  fi
  printf '%s' "${value}"
}

normalize_db_mode() {
  local raw="${1:-}"
  raw="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]')"
  case "${raw}" in
    internal)
      printf '%s' "internal"
      ;;
    external)
      printf '%s' "external"
      ;;
    "")
      printf '%s' "external"
      ;;
    *)
      warn "Unrecognized DB mode '${raw}', defaulting to external."
      printf '%s' "external"
      ;;
  esac
}

check_env() {
  if [ ! -f "${ENV_FILE}" ]; then
    err "Missing .env file at ${ENV_FILE}"
    exit 1
  fi

  local db_mode
  db_mode="$(read_env_value "RISPRO_DB_MODE")"
  if [ -z "${db_mode}" ]; then
    db_mode="$(read_env_value "DATABASE_MODE")"
  fi
  DB_MODE="$(normalize_db_mode "${db_mode}")"

  if [ -z "${db_mode}" ]; then
    warn "Neither RISPRO_DB_MODE nor DATABASE_MODE found in .env"
  else
    ok "Database mode from .env: ${db_mode}"
  fi

  ok "Using compose mode: ${DB_MODE}"

  if [ -f "${FRONTEND_ENV_FILE}" ]; then
    ok "frontend/.env found: yes"
  else
    warn "frontend/.env found: no"
  fi

  if [ -f "${FRONTEND_ENV_LOCAL_FILE}" ]; then
    ok "frontend/.env.local found: yes"
  else
    warn "frontend/.env.local found: no"
  fi
}

build_compose_args() {
  case "${DB_MODE}" in
    internal)
      COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.internal-db.yml)
      ;;
    *)
      COMPOSE_FILES=(-f docker-compose.yml)
      ;;
  esac

  ok "Compose files selected: ${COMPOSE_FILES[*]}"
  ok "Selected compose command: $(format_command "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --build)"
}

check_git_repo() {
  cd "${PROJECT_ROOT}"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "Not a git repository. Skipping git update."
    return 0
  fi

  local current_branch
  current_branch="$(git branch --show-current)"

  if [ -z "${current_branch}" ]; then
    err "Could not determine current git branch."
    exit 1
  fi

  log "Forcing repository to match origin/${current_branch}..."
  git fetch origin "${current_branch}"
  git reset --hard HEAD
  git clean -fd
  git pull origin "${current_branch}"
  ok "Git update completed."
}

build_and_restart() {
  cd "${PROJECT_ROOT}"

  log "Building and restarting containers..."
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --build
  ok "Containers rebuilt and restarted."
}

wait_for_health() {
  cd "${PROJECT_ROOT}"

  log "Waiting for application to become healthy..."

  local container_id=""
  local attempts=30
  local i=1

  container_id="$("${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" ps -q app 2>/dev/null || true)"

  if [ -z "${container_id}" ]; then
    warn "Could not find app container to check health. Skipping health wait."
    return 0
  fi

  while [ "$i" -le "$attempts" ]; do
    local status=""
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"

    case "${status}" in
      healthy|running)
        ok "Application is healthy!"
        return 0
        ;;
      unhealthy|exited|dead)
        err "Application failed health check with status: ${status}"
        "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" logs --tail=100 app || true
        exit 1
        ;;
    esac

    sleep 2
    i=$((i + 1))
  done

  err "Timed out waiting for application health."
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" logs --tail=100 app || true
  exit 1
}

show_summary() {
  printf '\n===================================================\n'
  ok "Update complete!"
  printf '===================================================\n\n'
  printf '  Web UI:     http://localhost:3000\n'
  printf '  DICOM MWL:  127.0.0.1:11112 (AE: RISPRO_MWL)\n\n'
  printf '  Useful commands:\n'
  printf '    docker compose logs -f app         # View application logs\n'
  printf '    docker compose ps                  # List running containers\n'
  printf '    docker compose down                # Stop all containers\n\n'
}

main() {
  print_header
  require_cmd git
  require_cmd docker
  detect_compose
  check_env
  build_compose_args
  check_git_repo
  build_and_restart
  wait_for_health
  show_summary
}

main "$@"
