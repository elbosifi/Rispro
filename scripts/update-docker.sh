#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="NCCB Diagnostic Radiology"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./docker-deployment-lib.sh
source "${SCRIPT_DIR}/docker-deployment-lib.sh"

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

check_git_repo() {
  cd "${PROJECT_ROOT}"

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn 'Not a git repository. Skipping git update.'
    return 0
  fi

  local current_branch=""
  current_branch="$(git branch --show-current)"

  if [ -z "${current_branch}" ]; then
    err 'Could not determine current git branch.'
    exit 1
  fi

  log "Forcing repository to match origin/${current_branch}..."
  git reset --hard HEAD
  git clean -fd
  git fetch origin "${current_branch}"
  git pull
  ok 'Git update completed.'
}

build_and_restart() {
  cd "${PROJECT_ROOT}"
  log 'Building and restarting containers...'
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --build --force-recreate
  ok 'Containers rebuilt and restarted.'
}

should_reconfigure() {
  case "${1:-}" in
    --reconfigure|reconfigure)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

main() {
  print_header
  require_cmd git
  require_cmd docker
  detect_compose

  if [ ! -f "${ENV_FILE}" ]; then
    err "Missing .env file at ${ENV_FILE}. Run ./scripts/setup-docker.sh first."
    exit 1
  fi

  load_existing_config
  check_git_repo
  load_existing_config

  if should_reconfigure "${1:-}"; then
    warn 'Reconfigure mode enabled. Prompting for deployment settings.'
    collect_deployment_config
  else
    log 'Reusing existing deployment configuration from .env'
    hydrate_deployment_config_from_current_env
  fi

  run_compose_preflight
  ok "Updated ${ENV_FILE}"
  build_and_restart
  wait_for_internal_orthanc_worklists
  wait_for_app_health || true
  print_deployment_summary 'Update complete.'
}

main "$@"
