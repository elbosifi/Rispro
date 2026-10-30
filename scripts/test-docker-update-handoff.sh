#!/usr/bin/env bash
# Only temporary Git repositories are reset/cleaned; Docker is stubbed.
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
real_git="$(command -v git)"
fixture="$test_root/checkout"
remote="$test_root/remote.git"
mkdir -p "$fixture/scripts" "$test_root/bin"
git init -q --bare "$remote"
git -C "$fixture" init -q
git -C "$fixture" config user.name 'Synthetic Deployment Test'
git -C "$fixture" config user.email test@example.invalid
git -C "$fixture" config core.autocrlf false
git -C "$fixture" remote add origin "$remote"
printf '.env\n' > "$fixture/.gitignore"
printf 'synthetic fixture\n' > "$fixture/.env"
for version in old new; do
  sed "/^deploy_checked_out_commit() {/a\  printf '%s\\\\n' '${version}-updater' >> \"\$HANDOFF_TRACE\"" "$repo_root/scripts/update-docker.sh" > "$fixture/scripts/update-docker.sh"
  cp "$repo_root/scripts/docker-deployment-lib.sh" "$fixture/scripts/"
  # Replace external deployment work; the actual updater and Git gate execute.
  cat >> "$fixture/scripts/docker-deployment-lib.sh" <<'EOF_STUBS'
require_cmd() { :; }
detect_compose() { COMPOSE_CMD=(fake_compose); COMPOSE_FILES=(); }
load_existing_config() { :; }
hydrate_deployment_config_from_current_env() { RISPRO_DICOM_MODE=embedded; }
collect_deployment_config() { printf 'reconfigure\n' >> "$HANDOFF_TRACE"; hydrate_deployment_config_from_current_env; }
run_compose_preflight() { printf 'preflight\n' >> "$HANDOFF_TRACE"; }
wait_for_app_health() { :; }
verify_app_build_sha() { :; }
verify_qz_bootstrap_readiness() { :; }
verify_ohif_readiness() { :; }
ensure_teaching_anatomy_assets() { :; }
print_deployment_summary() { printf 'summary\n' >> "$HANDOFF_TRACE"; }
fake_compose() { printf 'Migrations completed successfully\n'; }
EOF_STUBS
  printf '\nbuild_and_start_services() { printf "%%s\\n" "%s-library" >> "$HANDOFF_TRACE"; }\n' "$version" >> "$fixture/scripts/docker-deployment-lib.sh"
  git -C "$fixture" add .
  git -C "$fixture" commit -qm "$version fixture"
  if [ "$version" = old ]; then old_sha="$(git -C "$fixture" rev-parse HEAD)"; fi
done
git -C "$fixture" branch -M main
git -C "$fixture" push -qu origin main
new_sha="$(git -C "$fixture" rev-parse HEAD)"
cat > "$test_root/bin/git" <<'EOF_GIT'
#!/usr/bin/env bash
case "$1" in reset|clean|fetch|checkout) printf '%s\n' "$1" >> "$HANDOFF_TRACE" ;; esac
exec "$HANDOFF_REAL_GIT" "$@"
EOF_GIT
chmod +x "$test_root/bin/git"
for mode in manual explicit compatibility reconfigure uppercase; do
  git -C "$fixture" checkout -q --detach "$old_sha"
  trace="$test_root/$mode.trace"
  : > "$trace"
  (
    cd "$fixture"
    unset EXPECTED_SHA RISPRO_EXPECTED_SHA
    export HANDOFF_REAL_GIT="$real_git" HANDOFF_TRACE="$trace" PATH="$test_root/bin:$PATH"
    case "$mode" in
      manual) bash scripts/update-docker.sh ;;
      explicit) bash scripts/update-docker.sh --expected-sha "$new_sha" ;;
      compatibility) RISPRO_EXPECTED_SHA="$new_sha" bash scripts/update-docker.sh ;;
      reconfigure) bash scripts/update-docker.sh --expected-sha "$new_sha" --reconfigure ;;
      uppercase) bash scripts/update-docker.sh --expected-sha "$(printf '%s' "$new_sha" | tr '[:lower:]' '[:upper:]')" ;;
    esac
  ) > "$test_root/$mode.log" 2>&1 || { cat "$test_root/$mode.log" >&2; fail "$mode handoff failed"; }
  for action in reset clean fetch checkout preflight new-updater new-library summary; do
    [ "$(grep -cx "$action" "$trace")" = 1 ] || fail "$mode did not run $action exactly once"
  done
  ! grep -q '^old-' "$trace" || fail "$mode ran stale functions after checkout"
  if [ "$mode" = reconfigure ]; then grep -qx reconfigure "$trace" || fail 'Reconfigure flag lost in handoff'; fi
done
printf '[PASS] Git checkout hands off once to new updater/library functions in all five invocation modes\n'

: > "$trace"
if HANDOFF_REAL_GIT="$real_git" HANDOFF_TRACE="$trace" PATH="$test_root/bin:$PATH" \
  bash "$fixture/scripts/update-docker.sh" --deploy-checked-out 0000000000000000000000000000000000000000 > "$test_root/mismatch.log" 2>&1; then
  fail 'Post-checkout phase accepted a different HEAD'
fi
[ ! -s "$trace" ] || fail 'Rejected post-checkout phase ran destructive setup or deployment'
printf '[PASS] Post-checkout SHA mismatch fails before Git mutation or deployment\n'
