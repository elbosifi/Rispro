#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/rispro-docker-modes.XXXXXX)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

log()  { printf '[INFO] %s\n' "$*"; }
ok()   { printf '[OK]   %s\n' "$*"; }
err()  { printf '[ERROR] %s\n' "$*" >&2; }

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

write_orthanc_config() {
  local output_path="$1"
  cat > "${output_path}" <<'EOF_ORTHANC'
{
  "Name": "RISpro Orthanc",
  "StorageDirectory": "/var/lib/orthanc/db",
  "IndexDirectory": "/var/lib/orthanc/db",
  "RemoteAccessAllowed": true,
  "AuthenticationEnabled": false,
  "RegisteredUsers": {},
  "DicomServerEnabled": true,
  "DicomAet": "RISPRO_ORTHANC",
  "DicomPort": 4242,
  "HttpPort": 8042,
  "Plugins": ["/usr/share/orthanc/plugins"],
  "Worklists": {
    "Enable": true
  }
}
EOF_ORTHANC
}

write_env_file() {
  local output_path="$1"
  local db_mode="$2"
  local dicom_mode="$3"
  local mpps_mode="$4"
  local disable_embedded="0"
  local orthanc_enabled="false"
  local orthanc_base_url=""
  local orthanc_verify_tls="true"

  if [ "${dicom_mode}" != "embedded" ]; then
    disable_embedded="1"
    orthanc_enabled="true"
  fi

  case "${dicom_mode}" in
    orthanc_internal)
      orthanc_base_url="http://orthanc:8042"
      orthanc_verify_tls="false"
      ;;
    orthanc_external)
      orthanc_base_url="http://external-orthanc:8042"
      ;;
  esac

  cat > "${output_path}" <<EOF_ENV
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
RISPRO_DB_MODE=${db_mode}
RISPRO_DICOM_MODE=${dicom_mode}
RISPRO_MPPS_MODE=${mpps_mode}
RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=${disable_embedded}
DATABASE_URL=postgresql://rispro:rispro@postgres:5432/rispro
DB_USER=rispro
DB_PASSWORD=rispro
DB_NAME=rispro
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
JWT_SECRET=test-secret-test-secret-test-secret
COOKIE_NAME=rispro_session
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
SESSION_HOURS=8
SUPERVISOR_REAUTH_MINUTES=10
REQUEST_BODY_LIMIT=8mb
UPLOADS_DIR=storage/uploads
SEED_SUPERVISOR_USERNAME=admin
SEED_SUPERVISOR_PASSWORD=admin
SEED_SUPERVISOR_FULL_NAME=System Administrator
ORTHANC_MWL_ENABLED=${orthanc_enabled}
ORTHANC_MWL_SHADOW_MODE=false
ORTHANC_BASE_URL=${orthanc_base_url}
ORTHANC_VERIFY_TLS=${orthanc_verify_tls}
ORTHANC_TIMEOUT_SECONDS=10
ORTHANC_AUTH_ENABLED=false
ORTHANC_USERNAME=
ORTHANC_PASSWORD=
ORTHANC_WORKLIST_TARGET=
MPPS_BRIDGE_PORT=11113
MPPS_BRIDGE_AE_TITLE=RISPRO_MPPS
MPPS_AUTH_ENABLED=false
MPPS_USERNAME=
MPPS_PASSWORD=
EOF_ENV
}

render_compose_config() {
  local name="$1"
  local env_file="$2"
  shift 2
  local compose_files=("$@")

  log "Validating ${name}..."
  "${COMPOSE_CMD[@]}" --env-file "${env_file}" "${compose_files[@]}" config >/dev/null
  ok "${name}"
}

main() {
  cd "${PROJECT_ROOT}"
  detect_compose

  mkdir -p "${TMP_DIR}/orthanc"
  write_orthanc_config "${TMP_DIR}/orthanc/orthanc.json"

  local embedded_env="${TMP_DIR}/embedded.env"
  local orthanc_internal_env="${TMP_DIR}/orthanc-internal.env"
  local orthanc_external_env="${TMP_DIR}/orthanc-external.env"
  local orthanc_internal_mpps_env="${TMP_DIR}/orthanc-internal-mpps.env"

  write_env_file "${embedded_env}" "internal" "embedded" "disabled"
  write_env_file "${orthanc_internal_env}" "internal" "orthanc_internal" "disabled"
  write_env_file "${orthanc_external_env}" "external" "orthanc_external" "disabled"
  write_env_file "${orthanc_internal_mpps_env}" "internal" "orthanc_internal" "internal_bridge"

  render_compose_config \
    "embedded + internal db" \
    "${embedded_env}" \
    -f docker-compose.yml -f docker-compose.internal-db.yml

  cp "${TMP_DIR}/orthanc/orthanc.json" "${PROJECT_ROOT}/docker/orthanc/generated/orthanc.json"
  render_compose_config \
    "internal orthanc + internal db" \
    "${orthanc_internal_env}" \
    -f docker-compose.yml -f docker-compose.internal-db.yml -f docker-compose.orthanc-internal.yml

  render_compose_config \
    "external orthanc + external db" \
    "${orthanc_external_env}" \
    -f docker-compose.yml

  render_compose_config \
    "internal orthanc + internal db + mpps bridge" \
    "${orthanc_internal_mpps_env}" \
    -f docker-compose.yml -f docker-compose.internal-db.yml -f docker-compose.orthanc-internal.yml -f docker-compose.mpps-bridge.yml

  ok "All Docker deployment mode combinations rendered successfully."
}

main "$@"
