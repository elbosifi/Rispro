#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="RISpro Reception"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

log()  { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[OK]   %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }

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

read_env_value() {
  local key="$1"
  local value=""
  if [ -f "${ENV_FILE}" ]; then
    value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d '=' -f2- || true)"
  fi
  printf '%s' "${value}"
}

check_env() {
  if [ ! -f "${ENV_FILE}" ]; then
    err "Missing .env file at ${ENV_FILE}"
    exit 1
  fi

  # Read RISPRO_DB_MODE first, then fall back to DATABASE_MODE
  local db_mode
  db_mode="$(read_env_value "RISPRO_DB_MODE")"
  if [ -z "${db_mode}" ]; then
    db_mode="$(read_env_value "DATABASE_MODE")"
  fi

  if [ -z "${db_mode}" ]; then
    warn "Neither RISPRO_DB_MODE nor DATABASE_MODE found in .env"
  else
    ok "Database mode: ${db_mode}"
  fi
}

check_git_repo() {
  cd "${PROJECT_ROOT}"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "Not a git repository. Skipping git update."
    return 0
  fi

  # Check for local modifications, but ignore execute-bit-only changes on this script
  # (common when the file was committed without +x and later chmod +x locally)
  local porcelain_output
  porcelain_output="$(git status --porcelain)"

  if [ -n "${porcelain_output}" ]; then
    # Filter out mode-only changes on this script file
    local real_changes
    real_changes="$(echo "${porcelain_output}" | grep -vE '^ M\s+scripts/update-docker\.sh$' || true)"

    if [ -z "${real_changes}" ]; then
      warn "Only the execute bit changed on scripts/update-docker.sh — fixing automatically."
      return 0
    fi

    err "Git working tree has local changes:"
    echo "${porcelain_output}" | while IFS= read -r line; do
      err "  ${line}"
    done
    err ""
    err "Commit, stash, or discard them before running update."
    err "Run: git status"
    exit 1
  fi

  local current_branch
  current_branch="$(git branch --show-current)"

  if [ -z "${current_branch}" ]; then
    err "Could not determine current git branch."
    exit 1
  fi

  log "Fetching latest code from origin/${current_branch}..."
  git fetch origin "${current_branch}"

  local local_sha remote_sha
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "origin/${current_branch}")"

  if [ "${local_sha}" = "${remote_sha}" ]; then
    ok "Already up to date on ${current_branch}."
    return 0
  fi

  log "Pulling latest code..."
  git pull --rebase origin "${current_branch}"
  ok "Git update completed."
}

build_and_restart() {
  cd "${PROJECT_ROOT}"

  log "Building and restarting containers..."
  "${COMPOSE_CMD[@]}" up -d --build --remove-orphans
  ok "Containers rebuilt and restarted."
}

show_status() {
  cd "${PROJECT_ROOT}"

  printf '\n'
  log "Container status:"
  "${COMPOSE_CMD[@]}" ps || true

  printf '\n'
  log "Recent container logs:"
  "${COMPOSE_CMD[@]}" logs --tail=50 || true
}

main() {
  print_header

  require_cmd git
  require_cmd docker
  detect_compose
  check_env
  check_git_repo
  build_and_restart
  show_status

  printf '\n'
  ok "Update complete."
}

main "$@"