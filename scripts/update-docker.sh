#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="NCCB Diagnostic Radiology"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./docker-deployment-lib.sh
source "${SCRIPT_DIR}/docker-deployment-lib.sh"
DEPLOY_COMMIT_SHA="unknown"
EXPECTED_SHA="${EXPECTED_SHA:-${RISPRO_EXPECTED_SHA:-}}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

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
    err 'Deployment requires a git repository so the expected commit can be verified.'
    exit 1
  fi

  if [[ ! "${EXPECTED_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    err 'EXPECTED_SHA must be a full 40-character commit SHA.'
    exit 1
  fi
  EXPECTED_SHA="$(printf '%s' "${EXPECTED_SHA}" | tr '[:upper:]' '[:lower:]')"

  log "Forcing repository to match expected commit ${EXPECTED_SHA}..."
  git reset --hard HEAD
  git clean -fd -e '/storage/sante-hl7-outbox/'
  git fetch origin "${DEPLOY_BRANCH}"
  git checkout --detach "${EXPECTED_SHA}"
  DEPLOY_COMMIT_SHA="$(git rev-parse HEAD)"
  if [ "${DEPLOY_COMMIT_SHA}" != "${EXPECTED_SHA}" ]; then
    err "Checked-out commit ${DEPLOY_COMMIT_SHA} does not match expected commit ${EXPECTED_SHA}."
    exit 1
  fi
  log "Checked out exact commit SHA: ${DEPLOY_COMMIT_SHA}"
  ok 'Git update completed.'
}

parse_deployment_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --expected-sha)
        if [ "$#" -lt 2 ]; then
          err '--expected-sha requires a full commit SHA.'
          exit 1
        fi
        EXPECTED_SHA="$2"
        shift 2
        ;;
      *)
        err "Unsupported deployment argument: $1"
        exit 1
        ;;
    esac
  done
}

build_and_restart() {
  cd "${PROJECT_ROOT}"
  log 'Building and restarting containers...'
  RISPRO_BUILD_COMMIT_SHA="${DEPLOY_COMMIT_SHA}" "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --build --force-recreate
  ok 'Containers rebuilt and restarted.'
  log "Built/recreated rispro-app for commit: ${DEPLOY_COMMIT_SHA}"
}

should_reconfigure() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --reconfigure|reconfigure)
        return 0
        ;;
    esac
  done
  return 1
}

main() {
  parse_deployment_args "$@"
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

  if should_reconfigure "$@"; then
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
  if ! wait_for_app_health; then
    if [ "${ALLOW_UNHEALTHY_DEPLOY:-0}" = "1" ]; then
      warn 'ALLOW_UNHEALTHY_DEPLOY=1: continuing despite failed application health check.'
    else
      err 'Deployment failed because RISpro did not become healthy. Set ALLOW_UNHEALTHY_DEPLOY=1 only for an intentional diagnostic deployment.'
      exit 1
    fi
  fi
  verify_app_build_sha
  log 'Migration diagnostics from rispro-app startup:'
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" logs --no-color app 2>/dev/null | grep -E 'Running database migrations|Applied migration:|Latest applied migration:|Migrations completed successfully' | tail -n 20 || warn 'Migration log lines were not available; inspect rispro-app logs.'
  print_deployment_summary 'Update complete.'
}

main "$@"
