#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=./docker-deployment-lib.sh
source "${SCRIPT_DIR}/docker-deployment-lib.sh"

print_header() {
  printf '\n===================================================\n'
  printf '  NCCB Diagnostic Radiology - Docker Setup\n'
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
      SANTE_HL7_ENABLED="${CURRENT_SANTE_HL7_ENABLED:-false}"
      SANTE_HL7_OUTPUT_FOLDER_PATH="${CURRENT_SANTE_HL7_OUTPUT_FOLDER_PATH:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
      SANTE_HL7_ALLOWED_BASE_PATHS="${CURRENT_SANTE_HL7_ALLOWED_BASE_PATHS:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
      SANTE_HL7_HOST_OUTBOX_HINT="${CURRENT_SANTE_HL7_HOST_OUTBOX_HINT:-$SANTE_HL7_HOST_OUTBOX_DIR}"
      SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT="${CURRENT_SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT:-$(windows_path_hint "$SANTE_HL7_HOST_OUTBOX_DIR")}"
      MPPS_AUTH_ENABLED="${CURRENT_MPPS_AUTH_ENABLED:-false}"
      MPPS_BRIDGE_PORT="${CURRENT_MPPS_BRIDGE_PORT:-11113}"
      MPPS_BRIDGE_AE_TITLE="${CURRENT_MPPS_BRIDGE_AE_TITLE:-RISPRO_MPPS}"
      MPPS_USERNAME="${CURRENT_MPPS_USERNAME:-}"
      MPPS_PASSWORD="${CURRENT_MPPS_PASSWORD:-}"
      OHIF_INFRASTRUCTURE_DISABLED="${CURRENT_OHIF_INFRASTRUCTURE_DISABLED:-false}"
      OHIF_ENABLED="true"
      OHIF_PUBLIC_BASE_URL="/ohif"
      OHIF_DICOMWEB_PROXY_PATH="/ohif-dicomweb"
      OHIF_CONTAINER_URL="http://ohif:80"
      OHIF_CONTAINER_IMAGE="rispro-ohif:v3.12.6"
      OHIF_VERSION="v3.12.6"
      OHIF_SESSION_COOKIE_NAME="rispro_ohif_session"
      OHIF_LAUNCH_TOKEN_TTL_SECONDS="600"
      OHIF_RETRIEVAL_WORKER_INTERVAL_MS="5000"
      OHIF_CACHE_CLEANUP_ENABLED="${CURRENT_OHIF_CACHE_CLEANUP_ENABLED:-false}"
      OHIF_DICOMWEB_USERNAME="${CURRENT_OHIF_DICOMWEB_USERNAME:-}"
      OHIF_DICOMWEB_PASSWORD="${CURRENT_OHIF_DICOMWEB_PASSWORD:-}"
      OHIF_DICOMWEB_BEARER_TOKEN="${CURRENT_OHIF_DICOMWEB_BEARER_TOKEN:-}"
      if [ "$OHIF_INFRASTRUCTURE_DISABLED" = "true" ]; then
        OHIF_ENABLED="false"
        OHIF_COMPOSE_PROFILES=""
      else
        OHIF_COMPOSE_PROFILES="ohif"
      fi
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
