#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./docker-deployment-lib.sh
source "${SCRIPT_DIR}/docker-deployment-lib.sh"

test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

assert_rejects() {
  if validate_db_backup_allowed_ips "$1" >/dev/null 2>&1; then
    fail "Whitelist unexpectedly accepted: $1"
  fi
}

assert_compose_file_absent() {
  local unexpected="$1"
  if printf '%s\n' "${COMPOSE_FILES[@]}" | grep -Fq "$unexpected"; then
    fail "Compose arguments unexpectedly include: ${unexpected}"
  fi
}

assert_no_generated_backup_config() {
  [ ! -e "$DB_BACKUP_ACCESS_HBA_FILE" ] || fail 'External mode generated a backup-access HBA file'
  [ ! -e "$DB_BACKUP_ACCESS_COMPOSE_FILE" ] || fail 'External mode generated a backup-access Compose override'
}

validate_db_backup_allowed_ips '192.9.101.162' || fail 'Individual IPv4 address was rejected'
validate_db_backup_allowed_ips '192.9.101.162/32,10.20.0.0/16' || fail 'Valid IPv4 CIDR list was rejected'
assert_rejects '192.9.101.999'
assert_rejects '192.9.101.162/33'
assert_rejects '192.9.101.162,'
assert_rejects '0.0.0.0'
assert_rejects '0.0.0.0/0'

ip() {
  printf '2: eth0    inet 192.9.101.252/24 brd 192.9.101.255 scope global eth0\n'
}

RISPRO_DB_MODE=internal
RISPRO_DICOM_MODE=embedded
RISPRO_MPPS_MODE=disabled
RISPRO_DB_BACKUP_ACCESS_ENABLED=true
RISPRO_DB_BACKUP_BIND_IP=192.9.101.252
RISPRO_DB_BACKUP_PORT=5432
RISPRO_DB_BACKUP_ALLOWED_IPS='192.9.101.162,192.9.101.163/32'
validate_db_backup_access || fail 'Valid database backup access configuration was rejected'

RISPRO_DB_BACKUP_PORT=65536
if validate_db_backup_access >/dev/null 2>&1; then fail 'Out-of-range backup port was accepted'; fi
RISPRO_DB_BACKUP_PORT=5432
RISPRO_DB_BACKUP_BIND_IP=192.9.101.999
if validate_db_backup_access >/dev/null 2>&1; then fail 'Malformed bind IP was accepted'; fi
RISPRO_DB_BACKUP_BIND_IP=192.9.101.252
RISPRO_DB_BACKUP_ALLOWED_IPS=
if validate_db_backup_access >/dev/null 2>&1; then fail 'Enabled backup access without a whitelist was accepted'; fi
RISPRO_DB_BACKUP_ALLOWED_IPS='192.9.101.162,192.9.101.163/32'

DB_BACKUP_ACCESS_CONFIG_DIR="${test_root}/generated"
DB_BACKUP_ACCESS_HBA_FILE="${DB_BACKUP_ACCESS_CONFIG_DIR}/pg_hba.conf"
DB_BACKUP_ACCESS_COMPOSE_FILE="${DB_BACKUP_ACCESS_CONFIG_DIR}/docker-compose.database-backup-access.yml"
render_db_backup_access_config
grep -Fq '192.9.101.252:5432:5432' "$DB_BACKUP_ACCESS_COMPOSE_FILE" || fail 'Generated Compose bind is incorrect'
grep -Fq 'host all all 192.9.101.162/32 scram-sha-256' "$DB_BACKUP_ACCESS_HBA_FILE" || fail 'Individual whitelist address was not normalized to /32'
grep -Fq 'host all all 192.9.101.163/32 scram-sha-256' "$DB_BACKUP_ACCESS_HBA_FILE" || fail 'CIDR whitelist entry is missing'
grep -Fq 'host all all 0.0.0.0/0 reject' "$DB_BACKUP_ACCESS_HBA_FILE" || fail 'IPv4 reject-all HBA rule is missing'

cat > "${test_root}/compose-base.yml" <<'EOF_COMPOSE'
services:
  app:
    image: busybox:latest
  request-scan-worker:
    image: busybox:latest
networks:
  rispro-network:
    driver: bridge
EOF_COMPOSE
docker compose \
  -f "${test_root}/compose-base.yml" \
  -f "${PROJECT_ROOT}/docker-compose.internal-db.yml" \
  -f "$DB_BACKUP_ACCESS_COMPOSE_FILE" \
  config >/dev/null || fail 'Generated database backup Compose override did not render'

build_compose_args
printf '%s\n' "${COMPOSE_FILES[@]}" | grep -Fq 'docker-compose.database-backup-access.yml' || fail 'Enabled backup override was not added to Compose arguments'

# Internal mode with backup access disabled must keep PostgreSQL unpublished.
RISPRO_DB_BACKUP_ACCESS_ENABLED=false
RISPRO_DB_BACKUP_BIND_IP=
RISPRO_DB_BACKUP_PORT=5432
RISPRO_DB_BACKUP_ALLOWED_IPS=
validate_db_backup_access || fail 'Disabled internal backup access was rejected'
build_compose_args
assert_compose_file_absent 'docker-compose.database-backup-access.yml'

# External mode must ignore every internal PostgreSQL backup-access setting.
rm -rf "$DB_BACKUP_ACCESS_CONFIG_DIR"
RISPRO_DB_MODE=external
RISPRO_DB_BACKUP_ACCESS_ENABLED=false
validate_db_backup_access || fail 'External mode with disabled backup access was rejected'
render_db_backup_access_config || fail 'External mode failed while ignoring disabled backup access'
assert_no_generated_backup_config
build_compose_args
assert_compose_file_absent 'docker-compose.internal-db.yml'
assert_compose_file_absent 'docker-compose.database-backup-access.yml'

RISPRO_DB_BACKUP_ACCESS_ENABLED=true
RISPRO_DB_BACKUP_BIND_IP=192.9.101.252
RISPRO_DB_BACKUP_PORT=5432
RISPRO_DB_BACKUP_ALLOWED_IPS=192.9.101.162
validate_db_backup_access || fail 'External mode did not ignore otherwise-valid internal backup settings'
render_db_backup_access_config || fail 'External mode failed while ignoring otherwise-valid internal backup settings'
assert_no_generated_backup_config
build_compose_args
assert_compose_file_absent 'docker-compose.internal-db.yml'
assert_compose_file_absent 'docker-compose.database-backup-access.yml'

RISPRO_DB_BACKUP_ACCESS_ENABLED=true
unset RISPRO_DB_BACKUP_BIND_IP RISPRO_DB_BACKUP_PORT RISPRO_DB_BACKUP_ALLOWED_IPS
validate_db_backup_access || fail 'External mode did not ignore missing internal backup settings'
render_db_backup_access_config || fail 'External mode failed while ignoring missing internal backup settings'
assert_no_generated_backup_config
build_compose_args
assert_compose_file_absent 'docker-compose.internal-db.yml'
assert_compose_file_absent 'docker-compose.database-backup-access.yml'

ENV_FILE="${test_root}/.env"
RISPRO_CONFIG_BACKUP_DIR="${test_root}/backups"
cat > "$ENV_FILE" <<'EOF_ENV'
RISPRO_DB_MODE=internal
RISPRO_DICOM_MODE=embedded
RISPRO_MPPS_MODE=disabled
DATABASE_URL=postgresql://rispro:test@postgres:5432/rispro
DB_USER=rispro
DB_PASSWORD=test
DB_NAME=rispro
RISPRO_DB_BACKUP_ACCESS_ENABLED=true
RISPRO_DB_BACKUP_BIND_IP=192.9.101.252
RISPRO_DB_BACKUP_PORT=5432
RISPRO_DB_BACKUP_ALLOWED_IPS=192.9.101.162
EOF_ENV
load_existing_config
hydrate_deployment_config_from_current_env
[ "$RISPRO_DB_BACKUP_ACCESS_ENABLED" = "true" ] || fail 'Update hydration did not preserve the enabled setting'
[ "$RISPRO_DB_BACKUP_BIND_IP" = "192.9.101.252" ] || fail 'Update hydration did not preserve the bind IP'
[ "$RISPRO_DB_BACKUP_ALLOWED_IPS" = "192.9.101.162" ] || fail 'Update hydration did not preserve the whitelist'
grep -Fq 'RISPRO_DB_BACKUP_ACCESS_ENABLED=${RISPRO_DB_BACKUP_ACCESS_ENABLED}' "${SCRIPT_DIR}/docker-deployment-lib.sh" || fail 'Env renderer does not own the enabled setting'
grep -Fq 'RISPRO_DB_BACKUP_ALLOWED_IPS=${RISPRO_DB_BACKUP_ALLOWED_IPS}' "${SCRIPT_DIR}/docker-deployment-lib.sh" || fail 'Env renderer does not own the whitelist setting'

printf '[PASS] Database backup access deployment configuration\n'
