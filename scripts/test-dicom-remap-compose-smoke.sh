#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="rispro-dicom-remap-smoke-${USER:-local}-$$"
PROJECT="$(printf '%s' "$PROJECT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rispro-dicom-remap-compose.XXXXXX")"
DOCKER_CONFIG="${TMP_DIR}/docker-config"
mkdir -p "$DOCKER_CONFIG"
printf '{"cliPluginsExtraDirs":["%s/.docker/cli-plugins"]}\n' "$HOME" > "${DOCKER_CONFIG}/config.json"
export DOCKER_CONFIG
ENV_FILE="${ROOT_DIR}/.env"
ENV_BACKUP="${TMP_DIR}/env.backup"
OVERRIDE_FILE="${TMP_DIR}/compose.override.yml"
HOST_PORT="${RISPRO_COMPOSE_SMOKE_PORT:-$((30000 + ($$ % 1000)))}"
DICOM_PORT="$((HOST_PORT + 1))"
HAVE_ENV=0

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_BACKUP"
  HAVE_ENV=1
fi

cleanup() {
  set +e
  docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.internal-db.yml -f "$OVERRIDE_FILE" down -v --remove-orphans >/dev/null 2>&1
  if [ "$HAVE_ENV" -eq 1 ]; then cp "$ENV_BACKUP" "$ENV_FILE"; else rm -f "$ENV_FILE"; fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
TRUST_PROXY=0
RISPRO_APP_IMAGE_TARGET=restore-validation
RISPRO_DB_MODE=internal
RISPRO_DICOM_MODE=embedded
RISPRO_MPPS_MODE=disabled
DATABASE_URL=postgresql://rispro:rispro_smoke_password@postgres:5432/rispro
DB_USER=rispro
DB_PASSWORD=rispro_smoke_password
DB_NAME=rispro
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
JWT_SECRET=rispro-compose-smoke-jwt-secret-0123456789
APPOINTMENT_PUBLIC_TOKEN_SECRET=rispro-compose-smoke-appointment-secret
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
REQUEST_BODY_LIMIT=75mb
DICOM_REMAP_STAGING_DIR=/app/storage/dicom/remap-staging
DICOM_REMAP_PROCESSING_WORKER_INTERVAL_MS=1000
DICOM_REMAP_PROCESSING_LEASE_SECONDS=30
DICOM_REMAP_PROCESSING_BATCH_SIZE=1
DICOM_REMAP_FAILED_STAGING_RETENTION_HOURS=1
RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=1
ORTHANC_MWL_ENABLED=false
ORTHANC_MWL_SHADOW_MODE=false
ORTHANC_AUTH_ENABLED=false
SANTE_HL7_ENABLED=false
NAPS2_WEBSCAN_ENABLED=false
WEB_PUSH_ENABLED=false
SEED_SUPERVISOR_USERNAME=smoke-admin
SEED_SUPERVISOR_PASSWORD=smoke-admin-password
SEED_SUPERVISOR_FULL_NAME=Compose Smoke Supervisor
SEED_SUPER_ADMIN_USERNAME=smoke-superadmin
SEED_SUPER_ADMIN_PASSWORD=smoke-superadmin-password
SEED_SUPER_ADMIN_FULL_NAME=Compose Smoke Super Administrator
EOF

cat > "$OVERRIDE_FILE" <<EOF
services:
  app:
    container_name: ${PROJECT}-app
    ports:
      - "${HOST_PORT}:3000"
      - "${DICOM_PORT}:11112"
  postgres:
    container_name: ${PROJECT}-postgres
EOF

COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.internal-db.yml -f "$OVERRIDE_FILE")

wait_for() {
  local description="$1"
  shift
  local attempt=0
  while [ "$attempt" -lt 90 ]; do
    if "$@" >/dev/null 2>&1; then
      echo "OK: ${description}"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  echo "FAIL: timed out waiting for ${description}" >&2
  "${COMPOSE[@]}" ps >&2 || true
  "${COMPOSE[@]}" logs --no-color --tail=120 >&2 || true
  return 1
}

echo "Building disposable Compose project ${PROJECT} on host port ${HOST_PORT}..."
"${COMPOSE[@]}" build app
"${COMPOSE[@]}" up -d postgres
wait_for "PostgreSQL health" "${COMPOSE[@]}" exec -T postgres pg_isready -U rispro -d rispro
"${COMPOSE[@]}" up -d app
wait_for "RISpro health endpoint" curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health"

MIGRATIONS="$("${COMPOSE[@]}" exec -T postgres psql -U rispro -d rispro -Atqc "select count(*) from schema_migrations where filename in ('119_dicom_remap_durable_processing.sql', '146_dicom_remap_staged_confirmation.sql')")"
[ "$MIGRATIONS" = "2" ] || { echo "FAIL: DICOM remap durable-staging migrations 119 and 146 are not present in the running database" >&2; exit 1; }
echo "OK: DICOM remap durable-staging migrations 119 and 146 are present"

"${COMPOSE[@]}" logs --no-color app | grep -q 'dicom_remap_processing_worker_started'
echo "OK: DICOM-remap processing worker startup logged"

"${COMPOSE[@]}" exec -T app sh -c 'test -d /app/storage/dicom/remap-staging && printf smoke-sentinel > /app/storage/dicom/remap-staging/.compose-smoke-sentinel'
echo "OK: private staging directory exists"
MOUNT_SOURCE="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Source}}{{end}}{{end}}' "${PROJECT}-app")"
case "$MOUNT_SOURCE" in
  *rispro-storage*) echo "OK: staging directory is on rispro-storage volume" ;;
  *) echo "FAIL: /app/storage is not backed by rispro-storage (${MOUNT_SOURCE})" >&2; exit 1 ;;
esac

"${COMPOSE[@]}" restart app
wait_for "health after app restart" curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health"
"${COMPOSE[@]}" exec -T app sh -c 'test "$(cat /app/storage/dicom/remap-staging/.compose-smoke-sentinel)" = smoke-sentinel'
echo "OK: staging sentinel survived app restart"

"${COMPOSE[@]}" up -d --force-recreate app
wait_for "health after app recreation" curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health"
"${COMPOSE[@]}" exec -T app sh -c 'test "$(cat /app/storage/dicom/remap-staging/.compose-smoke-sentinel)" = smoke-sentinel'
echo "OK: staging sentinel survived app recreation"
"${COMPOSE[@]}" logs --no-color app | grep -q 'dicom_remap_processing_worker_started'
echo "OK: processing worker restarted"

"${COMPOSE[@]}" stop -t 20 app
"${COMPOSE[@]}" logs --no-color app | grep -q 'Received SIGTERM'
echo "OK: application shutdown was graceful"

echo "PASS: disposable RISpro Compose DICOM-remap smoke test"
