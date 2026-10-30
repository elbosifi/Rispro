#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo_root/scripts/docker-deployment-lib.sh"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
umask 022
original_umask="$(umask)"
ENV_FILE="$test_root/.env"
RISPRO_CONFIG_BACKUP_DIR="$test_root/backups"
printf 'OHIF_NATIVE_AUTH_SECRET=invalid-test-secret\n' > "$ENV_FILE"
load_existing_config
hydrate_deployment_config_from_current_env
if write_env_file > "$test_root/writer.log" 2>&1; then fail 'Invalid secret was accepted'; fi
[ "$(umask)" = "$original_umask" ] || fail 'Failed environment writer leaked umask'

DB_BACKUP_ACCESS_CONFIG_DIR="$test_root/backup-access"
DB_BACKUP_ACCESS_HBA_FILE="$DB_BACKUP_ACCESS_CONFIG_DIR/pg_hba.conf"
DB_BACKUP_ACCESS_COMPOSE_FILE="$DB_BACKUP_ACCESS_CONFIG_DIR/compose.yml"
RISPRO_DB_MODE=internal RISPRO_DB_BACKUP_ACCESS_ENABLED=true
RISPRO_DB_BACKUP_BIND_IP=127.0.0.1 RISPRO_DB_BACKUP_PORT=5432 RISPRO_DB_BACKUP_ALLOWED_IPS=127.0.0.1
render_db_backup_access_config
[ "$(umask)" = "$original_umask" ] || fail 'Backup renderer leaked umask'
[ "$(stat -c '%a' "$DB_BACKUP_ACCESS_COMPOSE_FILE")" = 600 ] || fail 'Backup overlay is not private'
[ "$(stat -c '%a' "$DB_BACKUP_ACCESS_HBA_FILE")" = 644 ] || fail 'PostgreSQL cannot read its HBA file'

# Do not query any Orthanc instance while checking generated config permissions.
(
  node() { printf '{}'; }
  ORTHANC_CONFIG_DIR="$test_root/orthanc"
  ORTHANC_CONFIG_FILE="$ORTHANC_CONFIG_DIR/orthanc.json"
  RISPRO_DICOM_MODE=orthanc_internal
  render_orthanc_config
  [ "$ORTHANC_CONFIG_CHANGED" = 1 ] || fail 'Orthanc config change flag was lost'
  [ "$(stat -c '%a' "$ORTHANC_CONFIG_FILE")" = 600 ] || fail 'Generated Orthanc config is not private'
  [ "$(umask)" = "$original_umask" ] || fail 'Orthanc renderer leaked umask'
)

# Repair an existing 600 bind mount, even when the caller deliberately uses 077.
PROJECT_ROOT="$test_root"
mkdir -p "$PROJECT_ROOT/docker/ohif"
cp "$repo_root/docker/ohif/app-config.js" "$PROJECT_ROOT/docker/ohif/app-config.js"
chmod 600 "$PROJECT_ROOT/docker/ohif/app-config.js"
OHIF_COMPOSE_PROFILES=ohif
umask 077
prepare_ohif_public_config
[ "$(stat -c '%a' "$PROJECT_ROOT/docker/ohif/app-config.js")" = 644 ] || fail 'Public OHIF config is not readable'
[ "$(umask)" = 0077 ] || fail 'Public permission repair changed the caller umask'
[ "$(stat -c '%a' "$DB_BACKUP_ACCESS_COMPOSE_FILE")" = 600 ] || fail 'Public repair broadened secret permissions'
OHIF_COMPOSE_PROFILES=''
chmod 600 "$PROJECT_ROOT/docker/ohif/app-config.js"
prepare_ohif_public_config
verify_ohif_readiness
[ "$(stat -c '%a' "$PROJECT_ROOT/docker/ohif/app-config.js")" = 600 ] || fail 'Disabled OHIF deployment changed public files'
printf '[PASS] Restrictive umasks stay local on failure; public config is repaired without broadening secrets\n'

PROJECT_ROOT="$repo_root"
umask 022
printf 'JWT_SECRET=synthetic-existing-secret\n' > "$ENV_FILE"
write_env_file > "$test_root/writer.log" 2>&1 || { cat "$test_root/writer.log" >&2; fail 'Environment fixture could not be written'; }
[ "$(umask)" = "$original_umask" ] || fail 'Successful environment writer leaked umask'
[ "$(stat -c '%a' "$ENV_FILE")" = 600 ] || fail 'Environment file is not private'
for backup in "$RISPRO_CONFIG_BACKUP_DIR/"*.bak; do
  [ "$(stat -c '%a' "$backup")" = 600 ] || fail 'Environment backup is not private'
done
printf 'public fixture\n' > "$test_root/new-public.js"
[ "$(stat -c '%a' "$test_root/new-public.js")" = 644 ] || fail 'Subsequent public file inherited a restrictive umask'
printf '[PASS] Environment and backups stay private; successful rendering preserves the caller umask\n'
