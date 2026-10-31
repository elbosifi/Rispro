#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/docker-deployment-lib.sh"
test_root="$(mktemp -d)"
trap 'printf "[FAIL] Native deployment fixture failed at line %s\n" "$LINENO" >&2' ERR
trap 'rm -rf "$test_root"' EXIT
ENV_FILE="${test_root}/.env"
RISPRO_CONFIG_BACKUP_DIR="${test_root}/backups"

fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }
# Exercise initial setup's collector without interactive input or real services.
prompt() { printf '%s' "${2:-}"; }
prompt_hidden() { printf '%s' "${2:-}"; }
prompt_yes_no() {
  case "${2:-yes}" in yes|true) printf true ;; *) printf false ;; esac
}

for db in internal external; do
  for dicom in embedded orthanc_internal orthanc_external; do
    for mpps in disabled internal_bridge; do
      for state in fresh upgrade blank preserved disabled; do
        rm -f "$ENV_FILE"
        if [ "$state" != fresh ]; then
          cat > "$ENV_FILE" <<EOF_ENV
RISPRO_DB_MODE=${db}
RISPRO_DICOM_MODE=${dicom}
RISPRO_MPPS_MODE=${mpps}
DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5433/synthetic_test
JWT_SECRET=synthetic-deployment-test
EOF_ENV
        fi
        if [ "$state" = preserved ] || [ "$state" = disabled ]; then
          # Quoted values are valid Compose .env syntax and must also survive.
          printf 'OHIF_NATIVE_AUTH_SECRET="%064d"\n' 1 >> "$ENV_FILE"
        fi
        if [ "$state" = disabled ]; then
          printf 'OHIF_NATIVE_DELIVERY_ENABLED="false"\n' >> "$ENV_FILE"
        fi
        if [ "$state" = blank ]; then
          printf 'OHIF_NATIVE_AUTH_SECRET=\nOHIF_NATIVE_DELIVERY_ENABLED=\n' >> "$ENV_FILE"
        fi
        load_existing_config
        if [ "$state" = fresh ]; then
          CURRENT_DB_MODE="$db" CURRENT_DICOM_MODE="$dicom" CURRENT_MPPS_MODE="$mpps"
          collect_deployment_config >"${test_root}/collector.log" 2>&1
        else
          hydrate_deployment_config_from_current_env
        fi
        write_env_file >"${test_root}/writer.log" 2>&1 || {
          sed -E 's/[a-f0-9]{64}/[REDACTED]/g' "${test_root}/writer.log" >&2
          fail 'Native environment fixture could not be written'
        }
        enabled=true
        if [ "$state" = disabled ]; then enabled=false; fi
        secret="$(read_env_value OHIF_NATIVE_AUTH_SECRET)"
        [[ "$secret" =~ ^[a-f0-9]{64}$ ]] || fail 'Generated/preserved secret has invalid format'
        [ "$(stat -c '%a' "$ENV_FILE")" = 600 ] || fail 'Generated .env is not private'
        if [ "$state" = preserved ] || [ "$state" = disabled ]; then
          [ "$secret" = "$(printf '%064d' 1)" ] || fail 'An existing valid secret changed'
        fi
        [ "$(read_env_value OHIF_NATIVE_DELIVERY_ENABLED)" = "$enabled" ] || fail 'Delivery default/override changed'
        if grep -Fq "$secret" "${test_root}/writer.log" "${test_root}/collector.log" 2>/dev/null; then fail 'Secret leaked to deployment output'; fi
        # A second update must retain the exact generated secret too.
        load_existing_config
        hydrate_deployment_config_from_current_env
        write_env_file >"${test_root}/writer.log" 2>&1
        [ "$(read_env_value OHIF_NATIVE_AUTH_SECRET)" = "$secret" ] || fail 'Update rotated the gateway secret'
        build_compose_args
        expected=(-f docker-compose.yml)
        if [ "$db" = internal ]; then expected+=(-f docker-compose.internal-db.yml); fi
        if [ "$dicom" = orthanc_internal ]; then expected+=(-f docker-compose.orthanc-internal.yml); fi
        if [ "$mpps" = internal_bridge ]; then expected+=(-f docker-compose.mpps-bridge.yml); fi
        expected+=(-f docker-compose.ohif-native.yml)
        expected+=(-f docker-compose.https.yml)
        [ "${COMPOSE_FILES[*]}" = "${expected[*]}" ] || fail 'An existing deployment override was lost or reordered'
        # Real Compose merge/interpolation only: no build/up/exec, sockets, DB,
        # archive requests or production service access occurs in this test.
        docker compose --project-directory "$PROJECT_ROOT" --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" config --no-env-resolution --format json >"${test_root}/compose.json"
        COMPOSE_RESULT="${test_root}/compose.json" EXPECTED_ENABLED="$enabled" EXPECTED_DB="$db" EXPECTED_DICOM="$dicom" EXPECTED_MPPS="$mpps" node <<'EOF_NODE'
const assert = require('node:assert/strict');
const { services: s } = JSON.parse(require('node:fs').readFileSync(process.env.COMPOSE_RESULT, 'utf8'));
assert.equal(s.app.environment.OHIF_NATIVE_DELIVERY_ENABLED, process.env.EXPECTED_ENABLED);
assert.equal(s.app.environment.OHIF_NATIVE_AUTH_SECRET, s.gateway.environment.OHIF_NATIVE_AUTH_SECRET);
assert.ok(/^[a-f0-9]{64}$/.test(s.app.environment.OHIF_NATIVE_AUTH_SECRET));
assert.ok(s.gateway.volumes.some(v => v.target === '/etc/nginx/templates/native.conf.template' && v.read_only));
assert.equal(Boolean(s.postgres), process.env.EXPECTED_DB === 'internal');
assert.equal(Boolean(s.orthanc), process.env.EXPECTED_DICOM === 'orthanc_internal');
assert.equal(Boolean(s['mpps-bridge']), process.env.EXPECTED_MPPS === 'internal_bridge');
assert.equal(s.app.depends_on?.orthanc, undefined);
assert.equal(s['request-scan-worker'].depends_on?.orthanc, undefined);
assert.equal(s['request-scan-worker'].depends_on.app.condition, 'service_healthy');
assert.equal(s.gateway.depends_on.app.condition, 'service_healthy');
if (s.postgres) assert.equal(s.app.depends_on.postgres.condition, 'service_healthy');
for (const service of [s.app, s['request-scan-worker'], s.gateway, s.postgres, s.orthanc].filter(Boolean)) {
  assert.equal(service.restart, 'unless-stopped');
  assert.ok(service.healthcheck.test.length);
}
if (s.orthanc) {
  assert.deepEqual(s.orthanc.healthcheck.test, ['CMD', '/usr/local/bin/check-worklists-ready.sh', '--healthcheck']);
  assert.ok(s.orthanc.volumes.some(v => v.source.endsWith('orthanc-data') && v.target === '/var/lib/orthanc/db'));
  assert.ok(s.orthanc.volumes.some(v => v.source.endsWith('orthanc-worklists') && v.target === '/var/lib/orthanc/worklists'));
}
EOF_NODE
      done
      printf '[PASS] Native deployment: %s / %s / %s (fresh, upgrade, blank, preserved, disabled)\n' "$db" "$dicom" "$mpps"
    done
  done
done

# Older explicitly disabled installations may not have a gateway secret yet.
for disabled_value in false 0 no; do
  printf 'OHIF_NATIVE_DELIVERY_ENABLED=%s\n' "$disabled_value" > "$ENV_FILE"
  write_env_file >"${test_root}/writer.log" 2>&1
  [[ "$(read_env_value OHIF_NATIVE_AUTH_SECRET)" =~ ^[a-f0-9]{64}$ ]] || fail 'Disabled legacy upgrade did not provision its missing secret'
  [ "$(read_env_value OHIF_NATIVE_DELIVERY_ENABLED)" = "$disabled_value" ] || fail 'A legacy emergency disable was lost'
done
printf '[PASS] Legacy disables without a secret gain infrastructure while staying disabled\n'

# Preserve the database backup-access overlay when it is enabled too.
RISPRO_DB_MODE=internal RISPRO_DB_BACKUP_ACCESS_ENABLED=true
build_compose_args
[[ "${COMPOSE_FILES[*]}" == *docker-compose.database-backup-access.yml* ]] || fail 'Database backup overlay was removed'
[[ "${COMPOSE_FILES[*]}" == *docker-compose.ohif-native.yml* ]] || fail 'Native overlay is missing with database backup access'

# Invalid nonempty secrets must fail without modifying the existing .env.
printf 'OHIF_NATIVE_AUTH_SECRET=invalid-existing-secret\nOHIF_NATIVE_DELIVERY_ENABLED=false\n' > "$ENV_FILE"
cp "$ENV_FILE" "${test_root}/before.env"
if write_env_file >"${test_root}/invalid.log" 2>&1; then fail 'Invalid existing gateway secret was accepted'; fi
cmp -s "$ENV_FILE" "${test_root}/before.env" || fail 'Invalid existing secret was overwritten'
if grep -Fq 'invalid-existing-secret' "${test_root}/invalid.log"; then fail 'Invalid secret appeared in error output'; fi
printf '[PASS] Existing invalid secret fails closed without modification or disclosure\n'

# Verify summary status from the runtime app gate, including the full OHIF
# emergency gate. Mock only runtime commands; never start/restart a service.
fake_compose() {
  case "$*" in
    *'gateway sh -c'*) [ "${TEST_GATEWAY_READY:-true}" = true ] ;;
    *'app printenv OHIF_NATIVE_DELIVERY_ENABLED'*) printf '%s\n' "$TEST_NATIVE_GATE" ;;
    *) fail 'Unexpected runtime command in deployment summary' ;;
  esac
}
COMPOSE_CMD=(fake_compose)
TEST_NATIVE_GATE=true OHIF_ENABLED=true
print_deployment_summary 'Synthetic setup/update' >"${test_root}/summary.log"
grep -Fq 'Native OHIF infrastructure: installed' "${test_root}/summary.log" || fail 'Infrastructure status missing'
grep -Fq 'enabled for configured authoritative_orthanc' "${test_root}/summary.log" || fail 'Enabled delivery status missing'
TEST_NATIVE_GATE=false
print_deployment_summary 'Synthetic disabled update' >"${test_root}/summary.log"
grep -Fq 'disabled (server override' "${test_root}/summary.log" || fail 'Emergency override status missing'
TEST_NATIVE_GATE=true OHIF_ENABLED=false
print_deployment_summary 'Synthetic OHIF-disabled update' >"${test_root}/summary.log"
grep -Fq 'disabled (OHIF infrastructure gate)' "${test_root}/summary.log" || fail 'Full OHIF disable status missing'
TEST_GATEWAY_READY=false
if print_deployment_summary 'Not ready' >"${test_root}/summary.log" 2>&1; then fail 'Missing gateway route was reported installed'; fi
printf '[PASS] Setup/update summary reports installed/enabled/disabled and rejects an unready gateway\n'

for entrypoint in setup-docker.sh update-docker.sh; do
  grep -Fq 'source "${SCRIPT_DIR}/docker-deployment-lib.sh"' "${SCRIPT_DIR}/${entrypoint}" || fail 'Entrypoint no longer uses the shared deployment library'
  grep -q '^  *run_compose_preflight[[:space:]]*$' "${SCRIPT_DIR}/${entrypoint}" || fail 'Entrypoint bypasses native environment provisioning'
  grep -q 'print_deployment_summary ' "${SCRIPT_DIR}/${entrypoint}" || fail 'Entrypoint omits the deployment summary'
done
printf '[PASS] Both standard setup/update entrypoints use the tested shared provisioning and summary\n'
