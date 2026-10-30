#!/usr/bin/env bash
# Offline regression: no Docker daemon, production services or real sleeps.
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/scripts" "$test_root/docker/orthanc/generated"
cp "$repo_root/scripts/docker-deployment-lib.sh" "$test_root/scripts/"
sed '$d' "$repo_root/scripts/update-docker.sh" > "$test_root/scripts/update-testable.sh"
cp "$repo_root/docker/orthanc/Dockerfile" "$repo_root/docker/orthanc/check-worklists-ready.sh" "$test_root/docker/orthanc/"
source "$test_root/scripts/update-testable.sh"
trap 'rm -rf "$test_root"' EXIT
trap 'printf "[FAIL] Startup isolation regression at line %s\n" "$LINENO" >&2' ERR
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
pass() { printf '[OK]   %s\n' "$*"; }
calls="$test_root/calls"

fingerprint() {
  (cd "$PROJECT_ROOT/docker/orthanc"; find . -path ./generated -prune -o -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
}
reset_fixture() {
  : > "$calls"
  RISPRO_DICOM_MODE=orthanc_internal RISPRO_MPPS_MODE=disabled OHIF_COMPOSE_PROFILES=''
  ORTHANC_CONFIG_CHANGED=0 ORTHANC_MWL_DEPLOYMENT_STATUS='not checked'
  test_image_id=orthanc-image test_container_image=orthanc-image test_built_inputs="$(fingerprint)"
  app_state=Created worker_state=Created gateway_state=Created orthanc_state=running
  now=0 ready_at=481 source_changed=0 fail_app_build=0 fail_gate=none
  DEPLOY_COMMIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  COMPOSE_CMD=(fake_compose) COMPOSE_FILES=()
}
docker() {
  case "$*" in
    'image inspect --format {{.Id}} rispro-orthanc-internal:26.4.0')
      [ -n "$test_image_id" ] || return 1
      printf '%s\n' "$test_image_id" ;;
    *'org.rispro.orthanc-build-inputs'*) printf '%s\n' "$test_built_inputs" ;;
    'inspect --format {{.Image}} rispro-orthanc') printf '%s\n' "$test_container_image" ;;
    *'rispro-app') printf 'RISPRO_BUILD_COMMIT_SHA=%040d\n' 1 ;;
    *) fail "Unexpected Docker command: $*" ;;
  esac
}
git() {
  [ "$1" = diff ] || fail "Unexpected Git command: $*"
  return "$source_changed"
}
sleep() { fail 'Web startup must not sleep waiting for Orthanc'; }
fake_compose() {
  printf '%s\n' "$*" >> "$calls"
  case "$*" in
    'config --images orthanc') printf 'rispro-orthanc-internal:26.4.0\n' ;;
    'build orthanc') test_image_id=updated-orthanc-image; test_built_inputs="$RISPRO_ORTHANC_BUILD_INPUTS" ;;
    build\ app*)
      [ "$BUILDX_NO_DEFAULT_ATTESTATIONS" = 1 ] || fail 'BuildKit deployment setting lost'
      [ "$RISPRO_BUILD_COMMIT_SHA" = "$DEPLOY_COMMIT_SHA" ] || fail 'Runtime SHA lost'
      [ "$fail_app_build" = 0 ] || return 1 ;;
    'up -d --no-build --no-deps --force-recreate orthanc')
      orthanc_state=running; test_container_image="$test_image_id" ;;
    'up -d --no-build --no-deps --no-recreate orthanc') orthanc_state=running ;;
    'up -d --no-build app request-scan-worker gateway'*)
      # PostgreSQL/bootstrap and app health precede worker and gateway startup.
      printf 'postgres healthy\nmigrations complete\n' >> "$calls"
      app_state=healthy worker_state=running gateway_state=running ;;
    'up -d --no-deps --force-recreate gateway') gateway_state=running ;;
    'exec -T orthanc /usr/local/bin/check-worklists-ready.sh') [ "$now" -ge "$ready_at" ] ;;
    'logs --no-color app') printf 'Migrations completed successfully\n' ;;
    *) fail "Unexpected Compose command: $*" ;;
  esac
}
assert_web_running() {
  [ "$app_state/$worker_state/$gateway_state" = healthy/running/running ] || fail 'Web services remain Created'
}

reset_fixture
build_and_restart > "$test_root/output"
assert_web_running
grep -qx 'build app' "$calls"
! grep -q 'build orthanc\|force-recreate orthanc' "$calls" || fail 'Unchanged Orthanc rebuilt/recreated'
report_internal_orthanc_worklists >> "$test_root/output"
[[ "$ORTHANC_MWL_DEPLOYMENT_STATUS" == pending/* ]] || fail 'Slow MWL reported ready'
now=480
report_internal_orthanc_worklists >> "$test_root/output"
[[ "$ORTHANC_MWL_DEPLOYMENT_STATUS" == pending/* ]] || fail 'MWL reported ready before 481 seconds'
assert_web_running
now=481
report_internal_orthanc_worklists >> "$test_root/output"
[ "$ORTHANC_MWL_DEPLOYMENT_STATUS" = ready ] || fail 'Recovered MWL not reported ready'
pass 'Web and worker start while Orthanc takes 481 seconds; MWL reports eventual readiness'

reset_fixture
ready_at=999999
ORTHANC_CONFIG_CHANGED=1
build_and_restart > "$test_root/output"
assert_web_running
grep -qx 'up -d --no-build --no-deps --force-recreate orthanc' "$calls"
! grep -q '^build orthanc$' "$calls" || fail 'Configuration-only change rebuilt Orthanc'
report_internal_orthanc_worklists >> "$test_root/output"
[[ "$ORTHANC_MWL_DEPLOYMENT_STATUS" == pending/* ]] || fail 'Unhealthy MWL reported ready'
pass 'Configuration-only change recreates Orthanc without rebuilding or blocking web startup'

reset_fixture
test_built_inputs=old-inputs
build_and_restart > "$test_root/output"
grep -qx 'build orthanc' "$calls"
grep -qx 'up -d --no-build --no-deps --force-recreate orthanc' "$calls"
assert_web_running
pass 'Changed Orthanc image inputs are built and deployed'

reset_fixture
test_container_image=old-image
build_and_restart > "$test_root/output"
! grep -q '^build orthanc$' "$calls" || fail 'Existing updated image was rebuilt'
grep -qx 'up -d --no-build --no-deps --force-recreate orthanc' "$calls"
pass 'An updated image is applied even with unchanged generated configuration'

reset_fixture
test_image_id='' test_container_image=''
build_and_restart > "$test_root/output"
grep -qx 'build orthanc' "$calls"
assert_web_running
pass 'Fresh installations build the missing Orthanc image'

# Legacy images have no build-input label. The prior deployed SHA decides reuse.
for changed in 0 1; do
  reset_fixture
  test_built_inputs='<no value>' source_changed="$changed"
  build_and_restart > "$test_root/output"
  if [ "$changed" = 0 ]; then
    ! grep -q '^build orthanc$' "$calls" || fail 'Unchanged legacy image was rebuilt'
  else
    grep -qx 'build orthanc' "$calls"
  fi
done
pass 'Legacy images are retained when the deployed SHA proves unchanged sources'

reset_fixture
orthanc_state=Created
printf 'runtime-only change\n' > "$PROJECT_ROOT/docker/orthanc/generated/orthanc.json"
build_and_restart > "$test_root/output"
[ "$orthanc_state" = running ] || fail 'Existing Created Orthanc was not started'
! grep -q '^build orthanc$' "$calls" || fail 'Generated runtime config changed the image fingerprint'
pass 'Created Orthanc is started without recreation; generated config is excluded from image inputs'

for mode in embedded orthanc_external; do
  reset_fixture
  RISPRO_DICOM_MODE="$mode" RISPRO_MPPS_MODE=internal_bridge OHIF_COMPOSE_PROFILES=ohif
  build_and_restart > "$test_root/output"
  grep -qx 'build app ohif mpps-bridge' "$calls"
  grep -qx 'up -d --no-build app request-scan-worker gateway ohif mpps-bridge' "$calls"
  ! grep -q orthanc "$calls" || fail 'Embedded/external mode touched Orthanc'
done
pass 'Required OHIF/MPPS builds remain targeted; external Orthanc is never touched'

# Exercise update orchestration while stubbing only external preflight/Git/HTTP.
reset_fixture
touch "$ENV_FILE"
require_cmd() { :; }
detect_compose() { :; }
load_existing_config() { :; }
check_git_repo() { :; }
hydrate_deployment_config_from_current_env() { :; }
run_compose_preflight() { :; }
wait_for_app_health() { assert_web_running; printf 'app health\n' >> "$calls"; [ "$fail_gate" != health ]; }
verify_app_build_sha() { printf 'build SHA\n' >> "$calls"; [ "$fail_gate" != sha ]; }
verify_qz_bootstrap_readiness() { printf 'QZ ready\n' >> "$calls"; [ "$fail_gate" != qz ]; }
verify_ohif_readiness() { printf 'OHIF ready\n' >> "$calls"; [ "$fail_gate" != ohif ]; }
ensure_teaching_anatomy_assets() { printf 'anatomy checked\n' >> "$calls"; }
print_deployment_summary() { printf '%s\n' "$ORTHANC_MWL_DEPLOYMENT_STATUS"; }
deploy_checked_out_commit > "$test_root/output"
assert_web_running
grep -q 'pending/unavailable' "$test_root/output"
for gate in 'app health' 'build SHA' 'QZ ready' 'OHIF ready' 'migrations complete' 'anatomy checked'; do
  grep -qx "$gate" "$calls" || fail "Update omitted $gate"
done
grep -qx 'up -d --no-deps --force-recreate gateway' "$calls"
pass 'Slow MWL does not skip gateway refresh, app health, SHA, QZ, migration diagnostics or assets'

# These expected failures must not emit the unexpected-error diagnostic.
trap - ERR
for gate in health sha qz ohif; do
  reset_fixture
  fail_gate="$gate"
  set +e
  (set -e; deploy_checked_out_commit; exit 99) > "$test_root/output" 2>&1
  result=$?
  set -e
  [ "$result" = 1 ] || fail "Failed $gate gate returned $result"
  ! grep -q 'anatomy checked' "$calls" || fail "Deployment continued after failed $gate gate"
done
pass 'App health, exact SHA and QZ failures still stop the update'

reset_fixture
fail_app_build=1
# Avoid running the function in an if-condition, which disables Bash errexit.
set +e
(set -e; build_and_restart; exit 99) > "$test_root/output" 2>&1
result=$?
set -e
[ "$result" = 1 ] || fail "Required app build failure returned $result"
! grep -q '^up ' "$calls" || fail 'Deployment continued after a required build failure'
pass 'Required image build failures still stop deployment'
