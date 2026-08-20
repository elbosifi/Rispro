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

  if [ -n "${EXPECTED_SHA}" ]; then
    if [[ ! "${EXPECTED_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
      err 'EXPECTED_SHA must be a full 40-character commit SHA.'
      exit 1
    fi
    EXPECTED_SHA="$(printf '%s' "${EXPECTED_SHA}" | tr '[:upper:]' '[:lower:]')"
  fi

  warn "This update runs 'git reset --hard HEAD' and 'git clean -fd -e storage/sante-hl7-outbox/' before deployment; local tracked and untracked repository changes will be discarded, except the persistent Sante HL7 outbox."
  git reset --hard HEAD
  git clean -fd -e 'storage/sante-hl7-outbox/'

  if [ -z "${EXPECTED_SHA}" ]; then
    log "Manual update mode: fetching origin/${DEPLOY_BRANCH} to resolve the deployment commit..."
    if ! git fetch origin "${DEPLOY_BRANCH}"; then
      err "Could not fetch origin/${DEPLOY_BRANCH}; manual update cannot continue."
      exit 1
    fi
    if ! EXPECTED_SHA="$(git rev-parse --verify "origin/${DEPLOY_BRANCH}^{commit}")"; then
      err "Could not resolve origin/${DEPLOY_BRANCH} to a commit SHA; manual update cannot continue."
      exit 1
    fi
    log "Manual update will deploy branch origin/${DEPLOY_BRANCH} at resolved SHA ${EXPECTED_SHA}."
    warn 'Manual mode does not itself prove CI is green; confirm the resolved SHA has the required successful CI before deploying.'
  else
    log "Exact-SHA update mode: deploying expected commit ${EXPECTED_SHA}."
    if ! git fetch origin "${DEPLOY_BRANCH}"; then
      err "Could not fetch origin/${DEPLOY_BRANCH}; exact-SHA update cannot continue."
      exit 1
    fi
  fi

  if [[ ! "${EXPECTED_SHA}" =~ ^[0-9a-fA-F]{40}$ ]]; then
    err 'Resolved EXPECTED_SHA must be a full 40-character commit SHA.'
    exit 1
  fi
  EXPECTED_SHA="$(printf '%s' "${EXPECTED_SHA}" | tr '[:upper:]' '[:lower:]')"

  log "Forcing repository to match expected commit ${EXPECTED_SHA}..."
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
  RISPRO_BUILD_COMMIT_SHA="${DEPLOY_COMMIT_SHA}" "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --build
  ok 'Containers rebuilt and restarted.'
  log "Built/recreated rispro-app for commit: ${DEPLOY_COMMIT_SHA}"
}

recreate_gateway() {
  cd "${PROJECT_ROOT}"
  log 'Recreating the lightweight gateway to refresh its app upstream.'
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --no-deps --force-recreate gateway
  ok 'Gateway recreated.'
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
  git_update_started_at="$(deploy_now_ms)"
  check_git_repo
  log_deploy_timing 'git_update' "${git_update_started_at}"
  load_existing_config

  if should_reconfigure "$@"; then
    warn 'Reconfigure mode enabled. Prompting for deployment settings.'
    collect_deployment_config
  else
    log 'Reusing existing deployment configuration from .env'
    hydrate_deployment_config_from_current_env
  fi

  deployment_preflight_started_at="$(deploy_now_ms)"
  run_compose_preflight
  log_deploy_timing 'deployment_preflight' "${deployment_preflight_started_at}"
  ok "Updated ${ENV_FILE}"
  orthanc_recreate_started_at="$(deploy_now_ms)"
  recreate_internal_orthanc_if_changed
  log_deploy_timing 'targeted_orthanc_recreation' "${orthanc_recreate_started_at}"
  docker_build_started_at="$(deploy_now_ms)"
  build_and_restart
  log_deploy_timing 'docker_build_and_up' "${docker_build_started_at}"
  orthanc_readiness_started_at="$(deploy_now_ms)"
  wait_for_internal_orthanc_worklists
  log_deploy_timing 'orthanc_readiness' "${orthanc_readiness_started_at}"
  gateway_recreate_started_at="$(deploy_now_ms)"
  recreate_gateway
  log_deploy_timing 'gateway_recreate' "${gateway_recreate_started_at}"
  app_health_started_at="$(deploy_now_ms)"
  if ! wait_for_app_health; then
    if [ "${ALLOW_UNHEALTHY_DEPLOY:-0}" = "1" ]; then
      warn 'ALLOW_UNHEALTHY_DEPLOY=1: continuing despite failed application health check.'
    else
      log_deploy_timing 'app_health' "${app_health_started_at}"
      err 'Deployment failed because RISpro did not become healthy. Set ALLOW_UNHEALTHY_DEPLOY=1 only for an intentional diagnostic deployment.'
      exit 1
    fi
  fi
  log_deploy_timing 'app_health' "${app_health_started_at}"
  build_sha_started_at="$(deploy_now_ms)"
  if ! verify_app_build_sha; then
    log_deploy_timing 'build_sha_verification' "${build_sha_started_at}"
    exit 1
  fi
  log_deploy_timing 'build_sha_verification' "${build_sha_started_at}"
  qz_started_at="$(deploy_now_ms)"
  if ! verify_qz_bootstrap_readiness; then
    log_deploy_timing 'qz_readiness' "${qz_started_at}"
    exit 1
  fi
  log_deploy_timing 'qz_readiness' "${qz_started_at}"
  log 'Migration diagnostics from rispro-app startup:'
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" logs --no-color app 2>/dev/null | grep -E 'Running database migrations|Applied migration:|Latest applied migration:|Migrations completed successfully' | tail -n 20 || warn 'Migration log lines were not available; inspect rispro-app logs.'
  print_deployment_summary 'Update complete.'
}

main "$@"
