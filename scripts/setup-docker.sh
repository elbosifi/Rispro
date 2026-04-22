#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./docker-deployment-lib.sh
source "${SCRIPT_DIR}/docker-deployment-lib.sh"

print_header() {
  printf '\n===================================================\n'
  printf '  RISpro Reception - Docker Setup\n'
  printf '===================================================\n'
}

check_prerequisites() {
  require_cmd docker
  detect_compose
  ok "Docker: $(docker --version 2>&1 | head -1)"
  ok "Compose: $(${COMPOSE_CMD[@]} version 2>&1 | head -1)"
}

bring_up_stack() {
  cd "${PROJECT_ROOT}"
  log "Building and starting Docker containers..."
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --build
}

main() {
  print_header
  check_prerequisites
  load_existing_config

  if [ -f "${ENV_FILE}" ]; then
    warn ".env already exists at ${ENV_FILE}"
    if [ "$(prompt_yes_no 'Reuse the current configuration and start the stack?' yes)" = "true" ]; then
      RISPRO_DB_MODE="${CURRENT_DB_MODE:-internal}"
      RISPRO_DICOM_MODE="${CURRENT_DICOM_MODE:-embedded}"
      RISPRO_MPPS_MODE="${CURRENT_MPPS_MODE:-disabled}"
      ORTHANC_TIMEOUT_SECONDS="${CURRENT_ORTHANC_TIMEOUT_SECONDS:-10}"
      ORTHANC_BASE_URL="${CURRENT_ORTHANC_BASE_URL:-}"
      ORTHANC_AUTH_ENABLED="${CURRENT_ORTHANC_AUTH_ENABLED:-false}"
      ORTHANC_USERNAME="${CURRENT_ORTHANC_USERNAME:-}"
      ORTHANC_PASSWORD="${CURRENT_ORTHANC_PASSWORD:-}"
      MPPS_AUTH_ENABLED="${CURRENT_MPPS_AUTH_ENABLED:-false}"
      MPPS_BRIDGE_PORT="${CURRENT_MPPS_BRIDGE_PORT:-11113}"
      MPPS_BRIDGE_AE_TITLE="${CURRENT_MPPS_BRIDGE_AE_TITLE:-RISPRO_MPPS}"
      MPPS_USERNAME="${CURRENT_MPPS_USERNAME:-}"
      MPPS_PASSWORD="${CURRENT_MPPS_PASSWORD:-}"
      run_compose_preflight
      bring_up_stack
      wait_for_internal_orthanc_worklists
      wait_for_app_health || true
      print_deployment_summary 'RISpro is running.'
      exit 0
    fi
  fi

  collect_deployment_config
  run_compose_preflight
  ok "Wrote ${ENV_FILE}"
  bring_up_stack
  wait_for_internal_orthanc_worklists
  wait_for_app_health || true
  print_deployment_summary 'RISpro is ready.'
}

main "$@"
