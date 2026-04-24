#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
ORTHANC_CONFIG_DIR="${PROJECT_ROOT}/docker/orthanc/generated"
ORTHANC_CONFIG_FILE="${ORTHANC_CONFIG_DIR}/orthanc.json"

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
  CURRENT_SEED_SUPERVISOR_PASSWORD="$(read_env_value SEED_SUPERVISOR_PASSWORD)"
  CURRENT_DATABASE_SSL="$(read_env_value DATABASE_SSL)"
  CURRENT_DATABASE_SSL_REJECT_UNAUTHORIZED="$(read_env_value DATABASE_SSL_REJECT_UNAUTHORIZED)"
  CURRENT_RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY="$(read_env_value RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY)"
  CURRENT_ORTHANC_MWL_ENABLED="$(read_env_value ORTHANC_MWL_ENABLED)"
  CURRENT_ORTHANC_MWL_SHADOW_MODE="$(read_env_value ORTHANC_MWL_SHADOW_MODE)"
  CURRENT_ORTHANC_WORKLIST_TARGET="$(read_env_value ORTHANC_WORKLIST_TARGET)"
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
  SEED_SUPERVISOR_USERNAME="admin"
  SEED_SUPERVISOR_PASSWORD="${CURRENT_SEED_SUPERVISOR_PASSWORD:-admin}"
  SEED_SUPERVISOR_FULL_NAME="System Administrator"
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
  SEED_SUPERVISOR_USERNAME="admin"
  SEED_SUPERVISOR_PASSWORD="${CURRENT_SEED_SUPERVISOR_PASSWORD:-admin}"
  SEED_SUPERVISOR_FULL_NAME="System Administrator"
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
  cat > "${ENV_FILE}" <<EOF_ENV
# =============================================================================
# RISpro Reception - Auto-generated Configuration
# =============================================================================
# Generated by RISpro Docker deployment scripts on $(date -u '+%Y-%m-%d %H:%M:%S UTC')
# =============================================================================

# -- Node.js Environment --
NODE_ENV=${NODE_ENV}
PORT=${PORT}
TRUST_PROXY=${TRUST_PROXY}

# -- Deployment Modes --
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

# -- MPPS Bridge --
MPPS_BRIDGE_PORT=${MPPS_BRIDGE_PORT}
MPPS_BRIDGE_AE_TITLE=${MPPS_BRIDGE_AE_TITLE}
MPPS_AUTH_ENABLED=${MPPS_AUTH_ENABLED}
MPPS_USERNAME=${MPPS_USERNAME}
MPPS_PASSWORD=${MPPS_PASSWORD}
EOF_ENV
}

render_orthanc_config() {
  mkdir -p "${ORTHANC_CONFIG_DIR}"

  if [ "$RISPRO_DICOM_MODE" != "orthanc_internal" ]; then
    rm -f "${ORTHANC_CONFIG_FILE}"
    return 0
  fi

  local auth_enabled_json='false'
  local users_block='{}'
  local orthanc_dicom_block=''

  if [ "$RISPRO_DICOM_MODE" = "orthanc_internal" ]; then
    orthanc_dicom_block=$'  "DicomModalities": {},\n  "DicomCheckCalledAet": false,\n  "DicomCheckModalityHost": false,\n  "DicomAlwaysAllowEcho": true,\n  "DicomAlwaysAllowStore": true,\n  "DicomAlwaysAllowFind": true,\n  "DicomAlwaysAllowFindWorklist": true,\n  "DicomAlwaysAllowGet": true,\n  "DicomAlwaysAllowMove": true,'
  elif [ "$ORTHANC_AUTH_ENABLED" = "true" ]; then
    auth_enabled_json='true'
    users_block="{\"$(json_escape "$ORTHANC_USERNAME")\": \"$(json_escape "$ORTHANC_PASSWORD")\"}"
  fi

  cat > "${ORTHANC_CONFIG_FILE}" <<EOF_ORTHANC
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
${orthanc_dicom_block}
  "HttpPort": 8042,
  "Plugins": ["/usr/share/orthanc/plugins/"],
  "Worklists": {
    "Enable": true,
    "Directory": "/var/lib/orthanc/worklists",
    "SaveInOrthancDatabase": false,
    "SetStudyInstanceUidIfMissing": true
  }
}
EOF_ORTHANC
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

run_compose_preflight() {
  log "Running deployment preflight validation..."
  preflight_validate_env
  write_env_file
  render_orthanc_config
  build_compose_args
  "${COMPOSE_CMD[@]}" "${COMPOSE_FILES[@]}" config >/dev/null
  ok "Deployment configuration is valid."
}

wait_for_app_health() {
  local attempts=45
  local attempt=1

  log 'Waiting for application health endpoint...'
  while [ "$attempt" -le "$attempts" ]; do
    if command -v curl >/dev/null 2>&1 && curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      ok 'Application is healthy.'
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done

  warn 'Application did not become healthy within the expected time window.'
  return 1
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

  printf '\n  Supervisor username: %s\n' "$SEED_SUPERVISOR_USERNAME"
  printf '  Supervisor password: %s\n\n' "$SEED_SUPERVISOR_PASSWORD"
  printf '  Useful commands:\n'
  printf '    %s logs -f app\n' "$(format_command "${COMPOSE_CMD[@]}")"
  printf '    %s ps\n' "$(format_command "${COMPOSE_CMD[@]}")"
  printf '    %s down\n\n' "$(format_command "${COMPOSE_CMD[@]}")"
}
