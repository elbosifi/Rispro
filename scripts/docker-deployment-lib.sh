#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
ORTHANC_CONFIG_DIR="${PROJECT_ROOT}/docker/orthanc/generated"
ORTHANC_CONFIG_FILE="${ORTHANC_CONFIG_DIR}/orthanc.json"
SANTE_HL7_HOST_OUTBOX_DIR="${PROJECT_ROOT}/storage/sante-hl7-outbox"
SANTE_HL7_CONTAINER_OUTBOX_DIR="/app/storage/sante-hl7-outbox"
# Keep deployment configuration backups outside the checkout: update-docker's
# git clean intentionally removes untracked repository files.
RISPRO_CONFIG_BACKUP_DIR="${RISPRO_CONFIG_BACKUP_DIR:-${PROJECT_ROOT}/../rispro-config-backups}"
ORTHANC_CONFIG_CHANGED=0

deploy_now_ms() {
  date +%s%3N
}

log_deploy_timing() {
  local phase="$1"
  local started_at="$2"
  log "[DEPLOY TIMING] ${phase}=$(( $(deploy_now_ms) - started_at ))ms"
}

windows_path_hint() {
  local value="$1"
  case "$value" in
    /[a-zA-Z]/*)
      local drive="${value:1:1}"
      local rest="${value:3}"
      printf '%s:\\%s' "$(printf '%s' "$drive" | tr '[:lower:]' '[:upper:]')" "$(printf '%s' "$rest" | sed 's|/|\\|g')"
      ;;
    /mnt/[a-zA-Z]/*)
      local drive="${value:5:1}"
      local rest="${value:7}"
      printf '%s:\\%s' "$(printf '%s' "$drive" | tr '[:lower:]' '[:upper:]')" "$(printf '%s' "$rest" | sed 's|/|\\|g')"
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

log()  { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[OK]   %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }

prompt() {
  local message="$1"
  local default_value="${2:-}"
  local response=""

  if [ -n "${default_value}" ]; then
    printf '%s [%s]: ' "$message" "$default_value" >&2
  else
    printf '%s: ' "$message" >&2
  fi

  read -r response || true
  if [ -z "${response}" ]; then
    printf '%s\n' "$default_value"
  else
    printf '%s\n' "$response"
  fi
}

prompt_hidden() {
  local message="$1"
  local default_value="${2:-}"
  local response=""

  printf '%s [press Enter to use current/default]: ' "$message" >&2
  stty -echo 2>/dev/null || true
  read -r response || true
  stty echo 2>/dev/null || true
  printf '\n' >&2

  if [ -z "${response}" ]; then
    printf '%s\n' "$default_value"
  else
    printf '%s\n' "$response"
  fi
}

prompt_yes_no() {
  local message="$1"
  local default_value="${2:-yes}"
  local suffix="Y/n"
  local response=""

  case "$(printf '%s' "$default_value" | tr '[:upper:]' '[:lower:]')" in
    no|n|false|0)
      suffix="y/N"
      default_value="no"
      ;;
    *)
      suffix="Y/n"
      default_value="yes"
      ;;
  esac

  printf '%s [%s]: ' "$message" "$suffix" >&2
  read -r response || true
  response="$(printf '%s' "${response:-$default_value}" | tr '[:upper:]' '[:lower:]')"

  case "$response" in
    y|yes|true|1) printf 'true\n' ;;
    n|no|false|0) printf 'false\n' ;;
    *) printf '%s\n' "$([ "$default_value" = "yes" ] && printf true || printf false)" ;;
  esac
}

random_hex() {
  openssl rand -hex 32 2>/dev/null || dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n'
}

url_encode() {
  printf '%s' "$1" | sed 's|@|%40|g; s|:|%3A|g; s|/|%2F|g; s|#|%23|g; s|?|%3F|g; s|&|%26|g; s|=|%3D|g; s|+|%2B|g; s| |%20|g'
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

read_env_value() {
  local key="$1"
  local value=""

  if [ -f "${ENV_FILE}" ]; then
    value="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n1 | cut -d '=' -f2- || true)"
  fi

  printf '%s' "${value}"
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
  local part=""
  for part in "$@"; do
    out+="$(printf '%q ' "$part")"
  done
  printf '%s' "${out% }"
}

normalize_db_mode() {
  case "$(printf '%s' "${1:-internal}" | tr '[:upper:]' '[:lower:]')" in
    internal|1) printf 'internal' ;;
    external|2) printf 'external' ;;
    *) printf 'internal' ;;
  esac
}

normalize_dicom_mode() {
  case "$(printf '%s' "${1:-embedded}" | tr '[:upper:]' '[:lower:]')" in
    embedded|1) printf 'embedded' ;;
    orthanc_internal|internal|2) printf 'orthanc_internal' ;;
    orthanc_external|external|3) printf 'orthanc_external' ;;
    *) printf 'embedded' ;;
  esac
}

normalize_mpps_mode() {
  case "$(printf '%s' "${1:-disabled}" | tr '[:upper:]' '[:lower:]')" in
    disabled|0|no|false|1) printf 'disabled' ;;
    internal_bridge|enabled|yes|true|2) printf 'internal_bridge' ;;
    *) printf 'disabled' ;;
  esac
}

extract_db_url_user() {
  printf '%s' "$1" | sed -n 's|.*://\([^:/]*\):.*|\1|p'
}

extract_db_url_host() {
  printf '%s' "$1" | sed -n 's|.*://[^@]*@\([^:/?]*\).*|\1|p'
}

extract_db_url_port() {
  printf '%s' "$1" | sed -n 's|.*://[^@]*@[^:/?]*:\([0-9][0-9]*\).*|\1|p'
}

extract_db_url_name() {
  printf '%s' "$1" | sed -n 's|.*/\([^/?]*\).*|\1|p'
}

load_existing_config() {
  CURRENT_DB_MODE="$(normalize_db_mode "$(read_env_value RISPRO_DB_MODE)")"
  CURRENT_DICOM_MODE="$(normalize_dicom_mode "$(read_env_value RISPRO_DICOM_MODE)")"
  CURRENT_MPPS_MODE="$(normalize_mpps_mode "$(read_env_value RISPRO_MPPS_MODE)")"

  CURRENT_DATABASE_URL="$(read_env_value DATABASE_URL)"
  CURRENT_DB_USER="$(read_env_value DB_USER)"
  CURRENT_DB_PASSWORD="$(read_env_value DB_PASSWORD)"
  CURRENT_DB_NAME="$(read_env_value DB_NAME)"
  CURRENT_ORTHANC_BASE_URL="$(read_env_value ORTHANC_BASE_URL)"
  CURRENT_ORTHANC_VERIFY_TLS="$(read_env_value ORTHANC_VERIFY_TLS)"
  CURRENT_ORTHANC_TIMEOUT_SECONDS="$(read_env_value ORTHANC_TIMEOUT_SECONDS)"
  CURRENT_ORTHANC_AUTH_ENABLED="$(read_env_value ORTHANC_AUTH_ENABLED)"
  CURRENT_ORTHANC_USERNAME="$(read_env_value ORTHANC_USERNAME)"
  CURRENT_ORTHANC_PASSWORD="$(read_env_value ORTHANC_PASSWORD)"
  CURRENT_MPPS_BRIDGE_PORT="$(read_env_value MPPS_BRIDGE_PORT)"
  CURRENT_MPPS_BRIDGE_AE_TITLE="$(read_env_value MPPS_BRIDGE_AE_TITLE)"
  CURRENT_MPPS_AUTH_ENABLED="$(read_env_value MPPS_AUTH_ENABLED)"
  CURRENT_MPPS_USERNAME="$(read_env_value MPPS_USERNAME)"
  CURRENT_MPPS_PASSWORD="$(read_env_value MPPS_PASSWORD)"
  CURRENT_JWT_SECRET="$(read_env_value JWT_SECRET)"
  CURRENT_APPOINTMENT_PUBLIC_TOKEN_SECRET="$(read_env_value APPOINTMENT_PUBLIC_TOKEN_SECRET)"
  CURRENT_APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS="$(read_env_value APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS)"
  CURRENT_APPOINTMENT_PUBLIC_CANCEL_USER_ID="$(read_env_value APPOINTMENT_PUBLIC_CANCEL_USER_ID)"
  CURRENT_PUBLIC_APP_BASE_URL="$(read_env_value PUBLIC_APP_BASE_URL)"
  CURRENT_QZ_TRUST_MODE="$(read_env_value QZ_TRUST_MODE)"
  CURRENT_QZ_ROOT_CERTIFICATE_HOST_FILE="$(read_env_value QZ_ROOT_CERTIFICATE_HOST_FILE)"
  CURRENT_QZ_CERTIFICATE_HOST_FILE="$(read_env_value QZ_CERTIFICATE_HOST_FILE)"
  CURRENT_QZ_PRIVATE_KEY_HOST_FILE="$(read_env_value QZ_PRIVATE_KEY_HOST_FILE)"
  CURRENT_OHIF_ENABLED="$(read_env_value OHIF_ENABLED)"
  CURRENT_OHIF_INFRASTRUCTURE_DISABLED="$(read_env_value OHIF_INFRASTRUCTURE_DISABLED)"
  CURRENT_OHIF_CACHE_CLEANUP_ENABLED="$(read_env_value OHIF_CACHE_CLEANUP_ENABLED)"
  CURRENT_OHIF_DICOMWEB_USERNAME="$(read_env_value OHIF_DICOMWEB_USERNAME)"
  CURRENT_OHIF_DICOMWEB_PASSWORD="$(read_env_value OHIF_DICOMWEB_PASSWORD)"
  CURRENT_OHIF_DICOMWEB_BEARER_TOKEN="$(read_env_value OHIF_DICOMWEB_BEARER_TOKEN)"
  CURRENT_SEED_SUPERVISOR_PASSWORD="$(read_env_value SEED_SUPERVISOR_PASSWORD)"
  CURRENT_SEED_SUPER_ADMIN_PASSWORD="$(read_env_value SEED_SUPER_ADMIN_PASSWORD)"
  CURRENT_DATABASE_SSL="$(read_env_value DATABASE_SSL)"
  CURRENT_DATABASE_SSL_REJECT_UNAUTHORIZED="$(read_env_value DATABASE_SSL_REJECT_UNAUTHORIZED)"
  CURRENT_RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="$(read_env_value RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY)"
  CURRENT_ORTHANC_MWL_ENABLED="$(read_env_value ORTHANC_MWL_ENABLED)"
  CURRENT_ORTHANC_MWL_SHADOW_MODE="$(read_env_value ORTHANC_MWL_SHADOW_MODE)"
  CURRENT_ORTHANC_WORKLIST_TARGET="$(read_env_value ORTHANC_WORKLIST_TARGET)"
  CURRENT_SANTE_HL7_ENABLED="$(read_env_value SANTE_HL7_ENABLED)"
  CURRENT_SANTE_HL7_OUTPUT_FOLDER_PATH="$(read_env_value SANTE_HL7_OUTPUT_FOLDER_PATH)"
  CURRENT_SANTE_HL7_ALLOWED_BASE_PATHS="$(read_env_value SANTE_HL7_ALLOWED_BASE_PATHS)"
  CURRENT_SANTE_HL7_HOST_OUTBOX_HINT="$(read_env_value SANTE_HL7_HOST_OUTBOX_HINT)"
  CURRENT_SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT="$(read_env_value SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT)"
  CURRENT_DB_HOST="$(extract_db_url_host "${CURRENT_DATABASE_URL}")"
  CURRENT_DB_PORT="$(extract_db_url_port "${CURRENT_DATABASE_URL}")"
  CURRENT_DB_NAME="${CURRENT_DB_NAME:-$(extract_db_url_name "${CURRENT_DATABASE_URL}")}"
  CURRENT_DB_USER="${CURRENT_DB_USER:-$(extract_db_url_user "${CURRENT_DATABASE_URL}")}"
}

hydrate_deployment_config_from_current_env() {
  RISPRO_DB_MODE="${CURRENT_DB_MODE:-internal}"
  RISPRO_DICOM_MODE="${CURRENT_DICOM_MODE:-embedded}"
  RISPRO_MPPS_MODE="${CURRENT_MPPS_MODE:-disabled}"

  DATABASE_URL="${CURRENT_DATABASE_URL:-}"
  DB_USER="${CURRENT_DB_USER:-}"
  DB_PASSWORD="${CURRENT_DB_PASSWORD:-}"
  DB_NAME="${CURRENT_DB_NAME:-}"
  DATABASE_SSL="${CURRENT_DATABASE_SSL:-false}"
  DATABASE_SSL_REJECT_UNAUTHORIZED="${CURRENT_DATABASE_SSL_REJECT_UNAUTHORIZED:-false}"

  JWT_SECRET="${CURRENT_JWT_SECRET:-$(random_hex)}"
  APPOINTMENT_PUBLIC_TOKEN_SECRET="${CURRENT_APPOINTMENT_PUBLIC_TOKEN_SECRET:-${JWT_SECRET}}"
  APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS="${CURRENT_APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS:-1209600}"
  APPOINTMENT_PUBLIC_CANCEL_USER_ID="${CURRENT_APPOINTMENT_PUBLIC_CANCEL_USER_ID:-1}"
  PUBLIC_APP_BASE_URL="${CURRENT_PUBLIC_APP_BASE_URL:-https://rispro.nccb.com.ly}"
  QZ_TRUST_MODE="${CURRENT_QZ_TRUST_MODE:-internal_ca}"
  QZ_ROOT_CERTIFICATE_HOST_FILE="${CURRENT_QZ_ROOT_CERTIFICATE_HOST_FILE:-./secrets/qz/identity/qz-root-ca.crt}"
  QZ_CERTIFICATE_HOST_FILE="${CURRENT_QZ_CERTIFICATE_HOST_FILE:-./secrets/qz/identity/qz-signing-certificate.pem}"
  QZ_PRIVATE_KEY_HOST_FILE="${CURRENT_QZ_PRIVATE_KEY_HOST_FILE:-./secrets/qz/identity/qz-signing-private-key.pem}"
  # Compose resolves every declared secret source even though qz_issued does not consume an internal root.
  # Point the unused root-secret slot at the public signing certificate so qz_issued never requires a root file.
  if [ "$QZ_TRUST_MODE" = "qz_issued" ]; then QZ_ROOT_CERTIFICATE_HOST_FILE="$QZ_CERTIFICATE_HOST_FILE"; fi
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
  SEED_SUPERVISOR_USERNAME="admin"
  SEED_SUPERVISOR_PASSWORD="${CURRENT_SEED_SUPERVISOR_PASSWORD:-admin}"
  SEED_SUPERVISOR_FULL_NAME="System Administrator"
  SEED_SUPER_ADMIN_USERNAME="superadmin"
  SEED_SUPER_ADMIN_PASSWORD="${CURRENT_SEED_SUPER_ADMIN_PASSWORD:-superadmin}"
  SEED_SUPER_ADMIN_FULL_NAME="Super Administrator"
  NODE_ENV="production"
  PORT="3000"
  TRUST_PROXY="1"
  COOKIE_NAME="rispro_session"
  COOKIE_SECURE="false"
  COOKIE_SAME_SITE="lax"
  SESSION_HOURS="8"
  SUPERVISOR_REAUTH_MINUTES="10"
  REQUEST_BODY_LIMIT="8mb"
  UPLOADS_DIR="storage/uploads"
  RISPRO_APP_IMAGE_TARGET="production"

  ORTHANC_MWL_SHADOW_MODE="${CURRENT_ORTHANC_MWL_SHADOW_MODE:-false}"
  ORTHANC_WORKLIST_TARGET="${CURRENT_ORTHANC_WORKLIST_TARGET:-}"
  ORTHANC_TIMEOUT_SECONDS="${CURRENT_ORTHANC_TIMEOUT_SECONDS:-10}"
  ORTHANC_BASE_URL="${CURRENT_ORTHANC_BASE_URL:-}"
  ORTHANC_VERIFY_TLS="${CURRENT_ORTHANC_VERIFY_TLS:-true}"
  ORTHANC_AUTH_ENABLED="false"
  ORTHANC_USERNAME=""
  ORTHANC_PASSWORD=""

  SANTE_HL7_ENABLED="${CURRENT_SANTE_HL7_ENABLED:-false}"
  SANTE_HL7_OUTPUT_FOLDER_PATH="${CURRENT_SANTE_HL7_OUTPUT_FOLDER_PATH:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
  SANTE_HL7_ALLOWED_BASE_PATHS="${CURRENT_SANTE_HL7_ALLOWED_BASE_PATHS:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
  SANTE_HL7_HOST_OUTBOX_HINT="${CURRENT_SANTE_HL7_HOST_OUTBOX_HINT:-$SANTE_HL7_HOST_OUTBOX_DIR}"
  SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT="${CURRENT_SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT:-$(windows_path_hint "$SANTE_HL7_HOST_OUTBOX_DIR")}"

  MPPS_BRIDGE_PORT="${CURRENT_MPPS_BRIDGE_PORT:-11113}"
  MPPS_BRIDGE_AE_TITLE="${CURRENT_MPPS_BRIDGE_AE_TITLE:-RISPRO_MPPS}"
  MPPS_AUTH_ENABLED="${CURRENT_MPPS_AUTH_ENABLED:-false}"
  MPPS_USERNAME="${CURRENT_MPPS_USERNAME:-}"
  MPPS_PASSWORD="${CURRENT_MPPS_PASSWORD:-}"

  case "$RISPRO_DB_MODE" in
    internal)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="${CURRENT_RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY:-0}"
      DB_USER="${DB_USER:-rispro}"
      DB_PASSWORD="${DB_PASSWORD:-$(random_hex)}"
      DB_NAME="${DB_NAME:-rispro}"
      DATABASE_URL="${DATABASE_URL:-postgresql://${DB_USER}:$(url_encode "$DB_PASSWORD")@postgres:5432/${DB_NAME}}"
      DATABASE_SSL="false"
      DATABASE_SSL_REJECT_UNAUTHORIZED="false"
      ;;
    external)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="${CURRENT_RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY:-0}"
      ;;
  esac

  case "$RISPRO_DICOM_MODE" in
    embedded)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="0"
      ORTHANC_MWL_ENABLED="${CURRENT_ORTHANC_MWL_ENABLED:-false}"
      ORTHANC_MWL_ENABLED="false"
      ORTHANC_BASE_URL=""
      ORTHANC_VERIFY_TLS="true"
      ORTHANC_AUTH_ENABLED="false"
      ORTHANC_USERNAME=""
      ORTHANC_PASSWORD=""
      RISPRO_APP_IMAGE_TARGET="production"
      ;;
    orthanc_internal)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="1"
      ORTHANC_MWL_ENABLED="${CURRENT_ORTHANC_MWL_ENABLED:-true}"
      ORTHANC_MWL_ENABLED="true"
      ORTHANC_BASE_URL="${ORTHANC_BASE_URL:-http://orthanc:8042}"
      ORTHANC_VERIFY_TLS="${ORTHANC_VERIFY_TLS:-false}"
      ORTHANC_AUTH_ENABLED="false"
      ORTHANC_USERNAME=""
      ORTHANC_PASSWORD=""
      RISPRO_APP_IMAGE_TARGET="production-orthanc"
      ;;
    orthanc_external)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="1"
      ORTHANC_MWL_ENABLED="${CURRENT_ORTHANC_MWL_ENABLED:-true}"
      ORTHANC_MWL_ENABLED="true"
      RISPRO_APP_IMAGE_TARGET="production-orthanc"
      ;;
  esac

  if [ "$RISPRO_MPPS_MODE" != "internal_bridge" ]; then
    MPPS_AUTH_ENABLED="false"
    MPPS_USERNAME=""
    MPPS_PASSWORD=""
  fi

  if [ "$MPPS_AUTH_ENABLED" != "true" ]; then
    MPPS_USERNAME=""
    MPPS_PASSWORD=""
  fi
}

collect_deployment_config() {
  local default_db_mode="${CURRENT_DB_MODE:-internal}"
  local default_dicom_mode="${CURRENT_DICOM_MODE:-embedded}"
  local default_mpps_mode="${CURRENT_MPPS_MODE:-disabled}"
  local db_choice=""
  local dicom_choice=""
  local enable_mpps="false"

  printf '\n' >&2
  printf 'Database mode:\n' >&2
  printf '  1) Internal PostgreSQL (default)\n' >&2
  printf '  2) External PostgreSQL\n' >&2
  db_choice="$(prompt 'Choose database mode' "$([ "$default_db_mode" = "external" ] && printf 2 || printf 1)")"
  RISPRO_DB_MODE="$(normalize_db_mode "$db_choice")"

  printf '\nDICOM mode:\n' >&2
  printf '  1) Embedded RISpro MWL (compatibility mode)\n' >&2
  printf '  2) Internal Orthanc\n' >&2
  printf '  3) External Orthanc\n' >&2
  case "$default_dicom_mode" in
    orthanc_internal) dicom_choice=2 ;;
    orthanc_external) dicom_choice=3 ;;
    *) dicom_choice=1 ;;
  esac
  dicom_choice="$(prompt 'Choose DICOM mode' "$dicom_choice")"
  RISPRO_DICOM_MODE="$(normalize_dicom_mode "$dicom_choice")"

  enable_mpps="$(prompt_yes_no 'Enable separate MPPS bridge service?' "$([ "$default_mpps_mode" = "internal_bridge" ] && printf yes || printf no)")"
  if [ "$enable_mpps" = "true" ]; then
    RISPRO_MPPS_MODE="internal_bridge"
  else
    RISPRO_MPPS_MODE="disabled"
  fi

  JWT_SECRET="${CURRENT_JWT_SECRET:-$(random_hex)}"
  APPOINTMENT_PUBLIC_TOKEN_SECRET="${CURRENT_APPOINTMENT_PUBLIC_TOKEN_SECRET:-${JWT_SECRET}}"
  APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS="${CURRENT_APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS:-1209600}"
  APPOINTMENT_PUBLIC_CANCEL_USER_ID="${CURRENT_APPOINTMENT_PUBLIC_CANCEL_USER_ID:-1}"
  PUBLIC_APP_BASE_URL="${CURRENT_PUBLIC_APP_BASE_URL:-https://rispro.nccb.com.ly}"
  QZ_TRUST_MODE="${CURRENT_QZ_TRUST_MODE:-internal_ca}"
  QZ_ROOT_CERTIFICATE_HOST_FILE="${CURRENT_QZ_ROOT_CERTIFICATE_HOST_FILE:-./secrets/qz/identity/qz-root-ca.crt}"
  QZ_CERTIFICATE_HOST_FILE="${CURRENT_QZ_CERTIFICATE_HOST_FILE:-./secrets/qz/identity/qz-signing-certificate.pem}"
  QZ_PRIVATE_KEY_HOST_FILE="${CURRENT_QZ_PRIVATE_KEY_HOST_FILE:-./secrets/qz/identity/qz-signing-private-key.pem}"
  if [ "$QZ_TRUST_MODE" = "qz_issued" ]; then QZ_ROOT_CERTIFICATE_HOST_FILE="$QZ_CERTIFICATE_HOST_FILE"; fi
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
  SEED_SUPERVISOR_USERNAME="admin"
  SEED_SUPERVISOR_PASSWORD="${CURRENT_SEED_SUPERVISOR_PASSWORD:-admin}"
  SEED_SUPERVISOR_FULL_NAME="System Administrator"
  SEED_SUPER_ADMIN_USERNAME="superadmin"
  SEED_SUPER_ADMIN_PASSWORD="${CURRENT_SEED_SUPER_ADMIN_PASSWORD:-superadmin}"
  SEED_SUPER_ADMIN_FULL_NAME="Super Administrator"
  NODE_ENV="production"
  PORT="3000"
  TRUST_PROXY="1"
  COOKIE_NAME="rispro_session"
  COOKIE_SECURE="false"
  COOKIE_SAME_SITE="lax"
  SESSION_HOURS="8"
  SUPERVISOR_REAUTH_MINUTES="10"
  REQUEST_BODY_LIMIT="8mb"
  UPLOADS_DIR="storage/uploads"
  RISPRO_APP_IMAGE_TARGET="production"
  ORTHANC_MWL_SHADOW_MODE="false"
  ORTHANC_WORKLIST_TARGET=""
  ORTHANC_TIMEOUT_SECONDS="${CURRENT_ORTHANC_TIMEOUT_SECONDS:-10}"
  MPPS_BRIDGE_PORT="${CURRENT_MPPS_BRIDGE_PORT:-11113}"
  MPPS_BRIDGE_AE_TITLE="${CURRENT_MPPS_BRIDGE_AE_TITLE:-RISPRO_MPPS}"
  MPPS_AUTH_ENABLED="${CURRENT_MPPS_AUTH_ENABLED:-false}"
  MPPS_USERNAME="${CURRENT_MPPS_USERNAME:-}"
  MPPS_PASSWORD="${CURRENT_MPPS_PASSWORD:-}"
  ORTHANC_AUTH_ENABLED="false"
  ORTHANC_USERNAME=""
  ORTHANC_PASSWORD=""
  SANTE_HL7_ENABLED="${CURRENT_SANTE_HL7_ENABLED:-false}"
  SANTE_HL7_OUTPUT_FOLDER_PATH="${CURRENT_SANTE_HL7_OUTPUT_FOLDER_PATH:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
  SANTE_HL7_ALLOWED_BASE_PATHS="${CURRENT_SANTE_HL7_ALLOWED_BASE_PATHS:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
  SANTE_HL7_HOST_OUTBOX_HINT="${CURRENT_SANTE_HL7_HOST_OUTBOX_HINT:-$SANTE_HL7_HOST_OUTBOX_DIR}"
  SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT="${CURRENT_SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT:-$(windows_path_hint "$SANTE_HL7_HOST_OUTBOX_DIR")}"

  if [ "$RISPRO_DB_MODE" = "internal" ]; then
    DB_USER="${CURRENT_DB_USER:-rispro}"
    DB_PASSWORD="${CURRENT_DB_PASSWORD:-QOYR0s1h/uI7wqZrzW0gjNfQY61VwA6ek0wXsUEx6So=}"
    DB_NAME="${CURRENT_DB_NAME:-rispro}"
    DATABASE_URL="postgresql://${DB_USER}:$(url_encode "$DB_PASSWORD")@postgres:5432/${DB_NAME}"
    DATABASE_SSL="false"
    DATABASE_SSL_REJECT_UNAUTHORIZED="false"
  else
    local ext_host="localhost"
    local ext_port="5432"
    local ext_name="rispro"
    local ext_user="rispro"
    local ext_password="${CURRENT_DB_PASSWORD:-QOYR0s1h/uI7wqZrzW0gjNfQY61VwA6ek0wXsUEx6So=}"

    ext_host="$(prompt 'External database host' "${CURRENT_DB_HOST:-localhost}")"
    ext_port="$(prompt 'External database port' "${CURRENT_DB_PORT:-5432}")"
    ext_name="$(prompt 'External database name' "${CURRENT_DB_NAME:-rispro}")"
    ext_user="$(prompt 'External database username' "${CURRENT_DB_USER:-rispro}")"
    ext_password="$(prompt_hidden 'External database password' "${CURRENT_DB_PASSWORD:-$ext_password}")"

    DB_USER="$ext_user"
    DB_PASSWORD="$ext_password"
    DB_NAME="$ext_name"
    DATABASE_URL="postgresql://${ext_user}:$(url_encode "$ext_password")@${ext_host}:${ext_port}/${ext_name}"
    DATABASE_SSL="$(prompt_yes_no 'Enable SSL for external database?' "$(printf '%s' "${CURRENT_DATABASE_SSL:-false}" | tr '[:upper:]' '[:lower:]')")"
    DATABASE_SSL_REJECT_UNAUTHORIZED="$(prompt_yes_no 'Reject unauthorized DB SSL certificates?' "$(printf '%s' "${CURRENT_DATABASE_SSL_REJECT_UNAUTHORIZED:-false}" | tr '[:upper:]' '[:lower:]')")"
  fi

  case "$RISPRO_DICOM_MODE" in
    embedded)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="0"
      ORTHANC_MWL_ENABLED="false"
      ORTHANC_BASE_URL=""
      ORTHANC_VERIFY_TLS="true"
      ORTHANC_AUTH_ENABLED="false"
      ORTHANC_USERNAME=""
      ORTHANC_PASSWORD=""
      RISPRO_APP_IMAGE_TARGET="production"
      ;;
    orthanc_internal)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="1"
      ORTHANC_MWL_ENABLED="true"
      ORTHANC_BASE_URL="http://orthanc:8042"
      ORTHANC_VERIFY_TLS="false"
      ORTHANC_AUTH_ENABLED="false"
      ORTHANC_USERNAME=""
      ORTHANC_PASSWORD=""
      RISPRO_APP_IMAGE_TARGET="production-orthanc"
      ;;
    orthanc_external)
      RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="1"
      ORTHANC_MWL_ENABLED="true"
      ORTHANC_BASE_URL="$(prompt 'External Orthanc base URL' "${CURRENT_ORTHANC_BASE_URL:-http://localhost:8042}")"
      ORTHANC_VERIFY_TLS="$(prompt_yes_no 'Verify TLS certificate for external Orthanc?' "$(printf '%s' "${CURRENT_ORTHANC_VERIFY_TLS:-true}" | tr '[:upper:]' '[:lower:]')")"
      ORTHANC_AUTH_ENABLED="$(prompt_yes_no 'Enable Orthanc HTTP auth?' "$(printf '%s' "${CURRENT_ORTHANC_AUTH_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')")"
      if [ "$ORTHANC_AUTH_ENABLED" = "true" ]; then
        ORTHANC_USERNAME="$(prompt 'Orthanc username' "${CURRENT_ORTHANC_USERNAME:-orthanc}")"
        ORTHANC_PASSWORD="$(prompt_hidden 'Orthanc password' "${CURRENT_ORTHANC_PASSWORD:-orthanc}")"
      else
        ORTHANC_USERNAME=""
        ORTHANC_PASSWORD=""
      fi
      RISPRO_APP_IMAGE_TARGET="production-orthanc"
      ;;
  esac

  if [ "$RISPRO_MPPS_MODE" = "internal_bridge" ]; then
    MPPS_BRIDGE_PORT="$(prompt 'MPPS bridge port' "${CURRENT_MPPS_BRIDGE_PORT:-11113}")"
    MPPS_BRIDGE_AE_TITLE="$(prompt 'MPPS bridge AE Title' "${CURRENT_MPPS_BRIDGE_AE_TITLE:-RISPRO_MPPS}")"
    MPPS_AUTH_ENABLED="$(prompt_yes_no 'Enable MPPS bridge admin auth?' "$(printf '%s' "${CURRENT_MPPS_AUTH_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')")"
    if [ "$MPPS_AUTH_ENABLED" = "true" ]; then
      MPPS_USERNAME="$(prompt 'MPPS bridge username' "${CURRENT_MPPS_USERNAME:-mpps}")"
      MPPS_PASSWORD="$(prompt_hidden 'MPPS bridge password' "${CURRENT_MPPS_PASSWORD:-mpps}")"
    else
      MPPS_USERNAME=""
      MPPS_PASSWORD=""
    fi
  else
    MPPS_USERNAME=""
    MPPS_PASSWORD=""
    MPPS_AUTH_ENABLED="false"
  fi
}

validate_positive_integer() {
  local value="$1"
  local name="$2"
  case "$value" in
    ''|*[!0-9]*) err "${name} must be a positive integer."; return 1 ;;
    0) err "${name} must be a positive integer."; return 1 ;;
    *) return 0 ;;
  esac
}

preflight_validate_env() {
  case "$RISPRO_DB_MODE" in internal|external) ;; *) err "Invalid RISPRO_DB_MODE: ${RISPRO_DB_MODE}"; return 1 ;; esac
  case "$RISPRO_DICOM_MODE" in embedded|orthanc_internal|orthanc_external) ;; *) err "Invalid RISPRO_DICOM_MODE: ${RISPRO_DICOM_MODE}"; return 1 ;; esac
  case "$RISPRO_MPPS_MODE" in disabled|internal_bridge) ;; *) err "Invalid RISPRO_MPPS_MODE: ${RISPRO_MPPS_MODE}"; return 1 ;; esac

  if [ "$RISPRO_DICOM_MODE" = "orthanc_external" ]; then
    case "$ORTHANC_BASE_URL" in
      http://*|https://*) ;;
      *) err "ORTHANC_BASE_URL must start with http:// or https:// for orthanc_external mode."; return 1 ;;
    esac
  fi

  validate_positive_integer "$ORTHANC_TIMEOUT_SECONDS" 'ORTHANC_TIMEOUT_SECONDS' || return 1
  SANTE_HL7_OUTPUT_FOLDER_PATH="${SANTE_HL7_OUTPUT_FOLDER_PATH:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
  SANTE_HL7_ALLOWED_BASE_PATHS="${SANTE_HL7_ALLOWED_BASE_PATHS:-$SANTE_HL7_CONTAINER_OUTBOX_DIR}"
  SANTE_HL7_HOST_OUTBOX_HINT="${SANTE_HL7_HOST_OUTBOX_HINT:-$SANTE_HL7_HOST_OUTBOX_DIR}"
  SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT="${SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT:-$(windows_path_hint "$SANTE_HL7_HOST_OUTBOX_DIR")}"

  if [ "$ORTHANC_AUTH_ENABLED" = "true" ]; then
    [ -n "$ORTHANC_USERNAME" ] || { err 'ORTHANC_USERNAME is required when ORTHANC_AUTH_ENABLED=true.'; return 1; }
    [ -n "$ORTHANC_PASSWORD" ] || { err 'ORTHANC_PASSWORD is required when ORTHANC_AUTH_ENABLED=true.'; return 1; }
  fi

  if [ "$RISPRO_MPPS_MODE" = "internal_bridge" ]; then
    validate_positive_integer "$MPPS_BRIDGE_PORT" 'MPPS_BRIDGE_PORT' || return 1
    [ -n "$MPPS_BRIDGE_AE_TITLE" ] || { err 'MPPS_BRIDGE_AE_TITLE is required when RISPRO_MPPS_MODE=internal_bridge.'; return 1; }
    if [ "$MPPS_AUTH_ENABLED" = "true" ]; then
      [ -n "$MPPS_USERNAME" ] || { err 'MPPS_USERNAME is required when MPPS_AUTH_ENABLED=true.'; return 1; }
      [ -n "$MPPS_PASSWORD" ] || { err 'MPPS_PASSWORD is required when MPPS_AUTH_ENABLED=true.'; return 1; }
    fi
  fi
}

write_env_file() {
  local env_dir generated temporary safety existing_key rendered_key
  env_dir="$(dirname "${ENV_FILE}")"
  generated="${env_dir}/.env.rispro-rendered.$$.tmp"
  temporary="${env_dir}/.env.rispro-merge.$$.tmp"
  safety="${RISPRO_CONFIG_BACKUP_DIR}/env.$(date -u '+%Y%m%dT%H%M%SZ').$$.bak"
  mkdir -p "${env_dir}" "${RISPRO_CONFIG_BACKUP_DIR}"
  chmod 700 "${RISPRO_CONFIG_BACKUP_DIR}"
  umask 077
  # Render only deployment-owned settings. The merge below preserves every
  # application-owned and future setting from the prior .env.
  cat > "${generated}" <<EOF_ENV
# =============================================================================
# NCCB Diagnostic Radiology - Auto-generated Configuration
# =============================================================================
# Generated by RISpro Docker deployment scripts on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# =============================================================================

# -- Node.js Environment --
NODE_ENV=${NODE_ENV}
PORT=${PORT}
TRUST_PROXY=${TRUST_PROXY}

# -- Deployment Modes --
COMPOSE_PROFILES=${OHIF_COMPOSE_PROFILES}
OHIF_INFRASTRUCTURE_DISABLED=${OHIF_INFRASTRUCTURE_DISABLED}
RISPRO_DB_MODE=${RISPRO_DB_MODE}
RISPRO_DICOM_MODE=${RISPRO_DICOM_MODE}
RISPRO_MPPS_MODE=${RISPRO_MPPS_MODE}
RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=${RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY}
RISPRO_APP_IMAGE_TARGET=${RISPRO_APP_IMAGE_TARGET}

# -- Database --
DATABASE_URL=${DATABASE_URL}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}
DATABASE_SSL=${DATABASE_SSL}
DATABASE_SSL_REJECT_UNAUTHORIZED=${DATABASE_SSL_REJECT_UNAUTHORIZED}

# -- Authentication --
JWT_SECRET=${JWT_SECRET}
APPOINTMENT_PUBLIC_TOKEN_SECRET=${APPOINTMENT_PUBLIC_TOKEN_SECRET}
APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS=${APPOINTMENT_PUBLIC_TOKEN_TTL_SECONDS}
APPOINTMENT_PUBLIC_CANCEL_USER_ID=${APPOINTMENT_PUBLIC_CANCEL_USER_ID}
PUBLIC_APP_BASE_URL=${PUBLIC_APP_BASE_URL}

# -- QZ Tray Printing --
QZ_TRUST_MODE=${QZ_TRUST_MODE}
QZ_ROOT_CERTIFICATE_HOST_FILE=${QZ_ROOT_CERTIFICATE_HOST_FILE}
QZ_CERTIFICATE_HOST_FILE=${QZ_CERTIFICATE_HOST_FILE}
QZ_PRIVATE_KEY_HOST_FILE=${QZ_PRIVATE_KEY_HOST_FILE}
QZ_ROOT_CERTIFICATE_FILE=/run/secrets/qz_root_certificate
QZ_CERTIFICATE_FILE=/run/secrets/qz_signing_certificate
QZ_PRIVATE_KEY_FILE=/run/secrets/qz_signing_private_key
QZ_INSTALLER_FILE=/var/lib/rispro/qz-bootstrap/qz-tray-2.2.6-x86_64.exe

# -- OHIF Viewer --
OHIF_ENABLED=${OHIF_ENABLED}
OHIF_PUBLIC_BASE_URL=${OHIF_PUBLIC_BASE_URL}
OHIF_DICOMWEB_PROXY_PATH=${OHIF_DICOMWEB_PROXY_PATH}
OHIF_CONTAINER_URL=${OHIF_CONTAINER_URL}
OHIF_CONTAINER_IMAGE=${OHIF_CONTAINER_IMAGE}
OHIF_VERSION=${OHIF_VERSION}
OHIF_SESSION_COOKIE_NAME=${OHIF_SESSION_COOKIE_NAME}
OHIF_LAUNCH_TOKEN_TTL_SECONDS=${OHIF_LAUNCH_TOKEN_TTL_SECONDS}
OHIF_RETRIEVAL_WORKER_INTERVAL_MS=${OHIF_RETRIEVAL_WORKER_INTERVAL_MS}
OHIF_CACHE_CLEANUP_ENABLED=${OHIF_CACHE_CLEANUP_ENABLED}
OHIF_DICOMWEB_USERNAME=${OHIF_DICOMWEB_USERNAME}
OHIF_DICOMWEB_PASSWORD=${OHIF_DICOMWEB_PASSWORD}
OHIF_DICOMWEB_BEARER_TOKEN=${OHIF_DICOMWEB_BEARER_TOKEN}

# -- Session Configuration --
COOKIE_NAME=${COOKIE_NAME}
COOKIE_SECURE=${COOKIE_SECURE}
COOKIE_SAME_SITE=${COOKIE_SAME_SITE}
SESSION_HOURS=${SESSION_HOURS}

# -- Supervisor Re-authentication --
SUPERVISOR_REAUTH_MINUTES=${SUPERVISOR_REAUTH_MINUTES}

# -- File Uploads --
REQUEST_BODY_LIMIT=${REQUEST_BODY_LIMIT}
UPLOADS_DIR=${UPLOADS_DIR}

# -- Initial Supervisor Account --
SEED_SUPERVISOR_USERNAME=${SEED_SUPERVISOR_USERNAME}
SEED_SUPERVISOR_PASSWORD=${SEED_SUPERVISOR_PASSWORD}
SEED_SUPERVISOR_FULL_NAME=${SEED_SUPERVISOR_FULL_NAME}
SEED_SUPER_ADMIN_USERNAME=${SEED_SUPER_ADMIN_USERNAME}
SEED_SUPER_ADMIN_PASSWORD=${SEED_SUPER_ADMIN_PASSWORD}
SEED_SUPER_ADMIN_FULL_NAME=${SEED_SUPER_ADMIN_FULL_NAME}

# -- Orthanc MWL Projection --
ORTHANC_MWL_ENABLED=${ORTHANC_MWL_ENABLED}
ORTHANC_MWL_SHADOW_MODE=${ORTHANC_MWL_SHADOW_MODE}
ORTHANC_BASE_URL=${ORTHANC_BASE_URL}
ORTHANC_VERIFY_TLS=${ORTHANC_VERIFY_TLS}
ORTHANC_TIMEOUT_SECONDS=${ORTHANC_TIMEOUT_SECONDS}
ORTHANC_AUTH_ENABLED=${ORTHANC_AUTH_ENABLED}
ORTHANC_USERNAME=${ORTHANC_USERNAME}
ORTHANC_PASSWORD=${ORTHANC_PASSWORD}
ORTHANC_WORKLIST_TARGET=${ORTHANC_WORKLIST_TARGET}

# -- Sante Worklist Server HL7 File-Drop --
# The deployment scripts create and bind-mount this host folder:
#   ${SANTE_HL7_HOST_OUTBOX_DIR}
# RISpro writes inside the container at:
#   ${SANTE_HL7_CONTAINER_OUTBOX_DIR}
SANTE_HL7_ENABLED=${SANTE_HL7_ENABLED}
SANTE_HL7_OUTPUT_FOLDER_PATH=${SANTE_HL7_OUTPUT_FOLDER_PATH}
SANTE_HL7_ALLOWED_BASE_PATHS=${SANTE_HL7_ALLOWED_BASE_PATHS}
SANTE_HL7_HOST_OUTBOX_HINT=${SANTE_HL7_HOST_OUTBOX_HINT}
SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT=${SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT}

# -- MPPS Bridge --
MPPS_BRIDGE_PORT=${MPPS_BRIDGE_PORT}
MPPS_BRIDGE_AE_TITLE=${MPPS_BRIDGE_AE_TITLE}
MPPS_AUTH_ENABLED=${MPPS_AUTH_ENABLED}
MPPS_USERNAME=${MPPS_USERNAME}
MPPS_PASSWORD=${MPPS_PASSWORD}
EOF_ENV

  # A previous installation key is immutable during deployment rendering. Use
  # fingerprints only; neither values nor complete environment content are
  # printed by this function.
  existing_key="$(read_env_value BACKUP_V3_MASTER_KEY)"
  if [ -f "${ENV_FILE}" ]; then
    cp -p "${ENV_FILE}" "${safety}"
    chmod 600 "${safety}"
  fi

  ENV_DEFAULT_MIGRATIONS="${PROJECT_ROOT}/scripts/docker-env-default-migrations.cjs" ENV_EXISTING="${ENV_FILE}" ENV_RENDERED="${generated}" ENV_OUTPUT="${temporary}" node <<'EOF_NODE'
const fs = require('fs');
const { migrateLegacyDockerEnvValue } = require(process.env.ENV_DEFAULT_MIGRATIONS);
const existingPath = process.env.ENV_EXISTING;
const renderedPath = process.env.ENV_RENDERED;
const outputPath = process.env.ENV_OUTPUT;
const keyPattern = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/;
const rendered = fs.readFileSync(renderedPath, 'utf8');
const existing = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, 'utf8') : '';
const owned = new Map();
for (const line of rendered.split(/\r?\n/)) {
  const match = line.match(keyPattern);
  if (match) owned.set(match[1], line.replace(/^\s*(?:export\s+)?/, ''));
}
const emitted = new Set();
const output = [];
for (const line of existing.split(/\r?\n/)) {
  const match = line.match(keyPattern);
  if (!match) { output.push(line); continue; }
  const key = match[1];
  if (emitted.has(key)) continue; // normalize duplicate active definitions
  emitted.add(key);
  const migratedValue = migrateLegacyDockerEnvValue(key, match[2]);
  output.push(owned.get(key) || (migratedValue !== match[2] ? `${key}=${migratedValue}` : line));
}
if (output.length && output.at(-1) !== '') output.push('');
for (const [key, line] of owned) if (!emitted.has(key)) output.push(line);
fs.writeFileSync(outputPath, `${output.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
const fd = fs.openSync(outputPath, 'r');
try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
EOF_NODE

  rendered_key="$(grep -E '^BACKUP_V3_MASTER_KEY=' "${temporary}" | tail -n1 | cut -d '=' -f2- || true)"
  if [ -n "${existing_key}" ] && { [ -z "${rendered_key}" ] || [ "${existing_key}" != "${rendered_key}" ]; }; then
    rm -f "${generated}" "${temporary}"
    err 'Deployment refused to remove or change the existing Backup V3 installation key.'
    return 1
  fi
  mv -f "${temporary}" "${ENV_FILE}"
  # Best-effort directory fsync is unsupported on some hosts/filesystems.
  node -e 'const fs=require("fs"); try { const fd=fs.openSync(process.argv[1],"r"); fs.fsyncSync(fd); fs.closeSync(fd); } catch {}' "${env_dir}" || true
  rm -f "${generated}"
}

render_orthanc_config() {
  mkdir -p "${ORTHANC_CONFIG_DIR}"
  ORTHANC_CONFIG_CHANGED=0

  if [ "$RISPRO_DICOM_MODE" != "orthanc_internal" ]; then
    rm -f "${ORTHANC_CONFIG_FILE}"
    return 0
  fi

  local auth_enabled_json='false'
  local users_block='{}'
  local orthanc_dicom_block=''
  local dicom_modalities_json='{}'
  local previous_hash=''
  local rendered_hash=''
  local temporary_config="${ORTHANC_CONFIG_FILE}.$$"

  if [ -f "${ORTHANC_CONFIG_FILE}" ]; then
    previous_hash="$(sha256sum "${ORTHANC_CONFIG_FILE}" | awk '{print $1}')"
  fi

  if command -v node >/dev/null 2>&1; then
    dicom_modalities_json="$(
      ORTHANC_CONFIG_FILE="${ORTHANC_CONFIG_FILE}" ORTHANC_USERNAME="${ORTHANC_USERNAME:-}" ORTHANC_PASSWORD="${ORTHANC_PASSWORD:-}" node <<'EOF_NODE' 2>/dev/null || printf '{}'
const fs = require('fs');
const baseUrl = 'http://127.0.0.1:8042';
const configFile = process.env.ORTHANC_CONFIG_FILE || '';
const username = process.env.ORTHANC_USERNAME || '';
const password = process.env.ORTHANC_PASSWORD || '';
const headers = username ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : {};
const compact = {};

function normalizeModality(config) {
  if (Array.isArray(config) && config.length >= 3) {
    const aet = String(config[0] || '').trim();
    const host = String(config[1] || '').trim();
    const port = Number(config[2]);
    return aet && host && Number.isInteger(port) && port > 0 && port <= 65535 ? [aet, host, port] : null;
  }
  if (config && typeof config === 'object') {
    const aet = config.AET || config.Aet || config.aet;
    const host = config.Host || config.host;
    const port = Number(config.Port ?? config.port);
    return aet && host && Number.isInteger(port) && port > 0 && port <= 65535 ? [aet, host, port] : null;
  }
  return null;
}

function remember(key, config) {
  if (!key || key === 'local') return;
  const normalized = normalizeModality(config);
  if (normalized) compact[key] = normalized;
}

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw new Error(`Orthanc ${path} failed: ${response.status}`);
  return await response.json();
}

try {
  if (configFile && fs.existsSync(configFile)) {
    const existing = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const existingModalities = existing && existing.DicomModalities;
    if (existingModalities && typeof existingModalities === 'object' && !Array.isArray(existingModalities)) {
      for (const [key, config] of Object.entries(existingModalities)) {
        remember(key, config);
      }
    }
  }
} catch {
}

(async () => {
  try {
    const keys = await readJson('/modalities');
    if (Array.isArray(keys)) {
      for (const key of keys) {
        if (!key || key === 'local') continue;
        const config = await readJson(`/modalities/${encodeURIComponent(key)}/configuration`);
        remember(key, config);
      }
    }
  } catch {
  }

  process.stdout.write(JSON.stringify(compact));
})();
EOF_NODE
    )"
  fi

  if [ -z "$dicom_modalities_json" ]; then
    dicom_modalities_json='{}'
  fi

  if [ "$RISPRO_DICOM_MODE" = "orthanc_internal" ]; then
    orthanc_dicom_block=$(cat <<EOF_DICOM
  "DicomModalities": ${dicom_modalities_json},
  "DicomCheckCalledAet": false,
  "DicomCheckModalityHost": false,
  "DicomAlwaysAllowEcho": true,
  "DicomAlwaysAllowStore": true,
  "DicomAlwaysAllowFind": true,
  "DicomAlwaysAllowFindWorklist": true,
  "DicomAlwaysAllowGet": true,
  "DicomAlwaysAllowMove": true,
EOF_DICOM
)
  elif [ "$ORTHANC_AUTH_ENABLED" = "true" ]; then
    auth_enabled_json='true'
    users_block="{\"$(json_escape "$ORTHANC_USERNAME")\": \"$(json_escape "$ORTHANC_PASSWORD")\"}"
  fi

  cat > "${temporary_config}" <<EOF_ORTHANC
{
  "Name": "RISpro Orthanc",
  "StorageDirectory": "/var/lib/orthanc/db",
  "IndexDirectory": "/var/lib/orthanc/db",
  "RemoteAccessAllowed": true,
  "AuthenticationEnabled": ${auth_enabled_json},
  "RegisteredUsers": ${users_block},
  "DicomServerEnabled": true,
  "DicomAet": "RISPRO_ORTHANC",
  "DicomPort": 4242,
  "DicomModalitiesInDatabase": true,
${orthanc_dicom_block}
  "HttpPort": 8042,
  "Plugins": ["/usr/share/orthanc/plugins/"],
  "DicomWeb": {
    "Enable": true,
    "Root": "/dicom-web/"
  },
  "Worklists": {
    "Enable": true,
    "Directory": "/var/lib/orthanc/worklists",
    "SaveInOrthancDatabase": false,
    "SetStudyInstanceUidIfMissing": true
  }
}
EOF_ORTHANC

  rendered_hash="$(sha256sum "${temporary_config}" | awk '{print $1}')"
  if [ "${previous_hash}" != "${rendered_hash}" ]; then
    ORTHANC_CONFIG_CHANGED=1
  fi
  mv -f "${temporary_config}" "${ORTHANC_CONFIG_FILE}"
}

recreate_internal_orthanc_if_changed() {
  if [ "$RISPRO_DICOM_MODE" != "orthanc_internal" ] || [ "${ORTHANC_CONFIG_CHANGED}" != "1" ]; then
    return 0
  fi

  log 'Rendered Orthanc configuration changed; recreating only the internal Orthanc service.'
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" up -d --no-deps --force-recreate orthanc
}

build_compose_args() {
  COMPOSE_FILES=(-f docker-compose.yml)

  if [ "$RISPRO_DB_MODE" = "internal" ]; then
    COMPOSE_FILES+=(-f docker-compose.internal-db.yml)
  fi

  if [ "$RISPRO_DICOM_MODE" = "orthanc_internal" ]; then
    COMPOSE_FILES+=(-f docker-compose.orthanc-internal.yml)
  fi

  if [ "$RISPRO_MPPS_MODE" = "internal_bridge" ]; then
    COMPOSE_FILES+=(-f docker-compose.mpps-bridge.yml)
  fi
}

prepare_qz_printing() {
  local trust_mode="${QZ_TRUST_MODE:-${CURRENT_QZ_TRUST_MODE:-internal_ca}}"
  if [ "$trust_mode" = "internal_ca" ]; then
    bash "${PROJECT_ROOT}/scripts/qz/generate-qz-signing-identity.sh"
  elif [ "$trust_mode" != "qz_issued" ]; then
    err 'QZ_TRUST_MODE must be internal_ca or qz_issued.'
    return 1
  fi
  bash "${PROJECT_ROOT}/scripts/qz/cache-qz-installer.sh"

  local configured_path resolved_path
  for configured_path in "$QZ_ROOT_CERTIFICATE_HOST_FILE" "$QZ_CERTIFICATE_HOST_FILE" "$QZ_PRIVATE_KEY_HOST_FILE"; do
    case "$configured_path" in
      /*) resolved_path="$configured_path" ;;
      *) resolved_path="${PROJECT_ROOT}/${configured_path#./}" ;;
    esac
    if [ ! -r "$resolved_path" ]; then
      err "Configured QZ runtime file is missing or unreadable: ${resolved_path}"
      return 1
    fi
  done
}

run_compose_preflight() {
  log "Running deployment preflight validation..."
  mkdir -p "${SANTE_HL7_HOST_OUTBOX_DIR}"
  preflight_validate_env
  prepare_qz_printing
  write_env_file
  render_orthanc_config
  build_compose_args
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" config >/dev/null
  ok "Deployment configuration is valid."
  ok "Sante HL7 host outbox folder is ready: ${SANTE_HL7_HOST_OUTBOX_DIR}"
}

verify_qz_bootstrap_readiness() {
  local base_url="${APP_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
  local manifest_url="${QZ_BOOTSTRAP_MANIFEST_URL:-${base_url%/api/health}/api/public/printing-bootstrap/manifest}"
  local response
  response="$(curl --fail --silent --show-error "$manifest_url")" || { err "QZ bootstrap manifest is unreachable: ${manifest_url}"; return 1; }
  node -e 'const value=JSON.parse(process.argv[1]); if(value.ready!==true) throw new Error(value.reason || "QZ bootstrap is not ready");' "$response" || { err 'QZ bootstrap manifest reported not ready.'; return 1; }
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" exec -T app sh -c 'test -r /run/secrets/qz_root_certificate && test -r /run/secrets/qz_signing_certificate && test -r /run/secrets/qz_signing_private_key && test -r /var/lib/rispro/qz-bootstrap/qz-tray-2.2.6-x86_64.exe' || { err 'RISpro app cannot read every mounted QZ runtime file.'; return 1; }
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" exec -T request-scan-worker sh -c 'test ! -e /run/secrets/qz_root_certificate && test ! -e /run/secrets/qz_signing_certificate && test ! -e /run/secrets/qz_signing_private_key && test ! -e /var/lib/rispro/qz-bootstrap' || { err 'Request Scan worker unexpectedly has QZ signing or installer access.'; return 1; }
  ok "QZ printing bootstrap is ready: ${manifest_url}"
}

wait_for_app_health() {
  local attempts="${APP_HEALTH_ATTEMPTS:-45}"
  local interval="${APP_HEALTH_INTERVAL_SECONDS:-2}"
  local attempt=1
  local health_url="${APP_HEALTH_URL:-http://127.0.0.1:3000/api/health}"

  log "Checking application health at ${health_url} (timeout $((attempts * interval))s, container rispro-app)..."
  while [ "$attempt" -le "$attempts" ]; do
    if command -v curl >/dev/null 2>&1 && curl -fsS "${health_url}" >/dev/null 2>&1; then
      ok "Application health check succeeded: ${health_url}"
      return 0
    fi
    sleep "${interval}"
    attempt=$((attempt + 1))
  done

  err "Application health check failed after $((attempts * interval))s: ${health_url} (container rispro-app)."
  return 1
}

verify_app_build_sha() {
  local expected_sha="${EXPECTED_SHA:-}"
  local health_url="${APP_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
  local health_json

  if [[ ! "$expected_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    err 'EXPECTED_SHA must be a full 40-character commit SHA before runtime verification.'
    return 1
  fi

  health_json="$(curl --fail --silent --show-error "$health_url")"
  node - "$expected_sha" "$health_json" <<'NODE_VERIFY'
const expectedSha = process.argv[2];
const health = JSON.parse(process.argv[3]);

if (health.ok !== true || health.buildSha !== expectedSha) {
  console.error(`Running build mismatch: expected ${expectedSha}, received ${JSON.stringify(health)}`);
  process.exit(1);
}

console.log(`Application-reported build SHA verified: ${expectedSha}`);
NODE_VERIFY
}

wait_for_internal_orthanc_worklists() {
  if [ "$RISPRO_DICOM_MODE" != "orthanc_internal" ]; then
    return 0
  fi

  local attempts=30
  local attempt=1

  log 'Waiting for internal Orthanc Worklists readiness...'
  while [ "$attempt" -le "$attempts" ]; do
    if "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" exec -T orthanc /usr/local/bin/check-worklists-ready.sh >/dev/null 2>&1; then
      ok 'Internal Orthanc Worklists plugin is ready.'
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done

  err 'Internal Orthanc Worklists readiness check failed.'
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" logs orthanc || true
  return 1
}

print_deployment_summary() {
  printf '\n===================================================\n'
  ok "$1"
  printf '===================================================\n\n'
  printf '  Web UI:          http://localhost:3000\n'
  printf '  DB Mode:         %s\n' "$RISPRO_DB_MODE"
  printf '  DICOM Mode:      %s\n' "$RISPRO_DICOM_MODE"
  printf '  MPPS Mode:       %s\n' "$RISPRO_MPPS_MODE"
  if [ "$OHIF_COMPOSE_PROFILES" = "ohif" ]; then
    printf '  OHIF container:  deployed\n'
  else
    printf '  OHIF container:  not deployed\n'
  fi
  if [ "$OHIF_INFRASTRUCTURE_DISABLED" = "true" ]; then
    printf '  OHIF infra gate: disabled (OHIF_INFRASTRUCTURE_DISABLED=true)\n'
  else
    printf '  OHIF infra gate: enabled (OHIF_INFRASTRUCTURE_DISABLED=false)\n'
  fi
  printf '  OHIF DB setting: determined in Settings → Integrations → OHIF Viewer\n'
  printf '  OHIF URL:        /ohif/\n'

  case "$RISPRO_DICOM_MODE" in
    embedded)
      printf '  Embedded MWL:    127.0.0.1:11112 (AE: RISPRO_MWL)\n'
      ;;
    orthanc_internal)
      printf '  Orthanc HTTP:    http://localhost:8042\n'
      printf '  Orthanc DICOM:   127.0.0.1:4242 (AE: RISPRO_ORTHANC)\n'
      ;;
    orthanc_external)
      printf '  Orthanc Target:  %s\n' "$ORTHANC_BASE_URL"
      ;;
  esac

  if [ "$RISPRO_MPPS_MODE" = "internal_bridge" ]; then
    printf '  MPPS Bridge:     127.0.0.1:%s (AE: %s)\n' "$MPPS_BRIDGE_PORT" "$MPPS_BRIDGE_AE_TITLE"
  fi

  printf '  Sante HL7 share: %s\n' "$SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT"
  printf '  Sante HL7 UI:    %s\n' "$SANTE_HL7_CONTAINER_OUTBOX_DIR"
  printf '  Sante note:      Share the Windows folder above with the Sante Worklist Server if needed.\n'

  printf '\n  Supervisor username: %s\n' "$SEED_SUPERVISOR_USERNAME"
  printf '  Supervisor password: %s\n\n' "$SEED_SUPERVISOR_PASSWORD"
  printf '  Super admin username: %s\n' "$SEED_SUPER_ADMIN_USERNAME"
  printf '  Super admin password: %s\n\n' "$SEED_SUPER_ADMIN_PASSWORD"
  printf '  Useful commands:\n'
  printf '    %s logs -f app\n' "$(format_command "${COMPOSE_CMD[@]}")"
  printf '    %s ps\n' "$(format_command "${COMPOSE_CMD[@]}")"
  printf '    %s down\n\n' "$(format_command "${COMPOSE_CMD[@]}")"
}
