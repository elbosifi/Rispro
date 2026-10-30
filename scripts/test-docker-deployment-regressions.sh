#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

pass() {
  printf '[OK]   %s\n' "$*"
}

cd "${PROJECT_ROOT}"

runtime_base="$(awk '
  /^FROM node:22-bookworm-slim AS runtime-base$/ { in_runtime=1; next }
  /^FROM / && in_runtime { exit }
  in_runtime { print }
' Dockerfile)"

if grep -q 'RISPRO_BUILD_COMMIT_SHA' <<<"${runtime_base}"; then
  fail 'runtime-base still consumes RISPRO_BUILD_COMMIT_SHA before dependency installation'
fi
pass 'runtime-base has no commit-SHA cache input'

if ! grep -q 'RISPRO_BUILD_COMMIT_SHA: \${RISPRO_BUILD_COMMIT_SHA:-unknown}' docker-compose.yml; then
  fail 'Compose app service does not inject RISPRO_BUILD_COMMIT_SHA at runtime'
fi
if grep -A8 '^    build:' docker-compose.yml | grep -q 'RISPRO_BUILD_COMMIT_SHA'; then
  fail 'Compose still passes RISPRO_BUILD_COMMIT_SHA as a build argument'
fi
if grep -qE '^ARG[[:space:]]+RISPRO_BUILD_COMMIT_SHA' Dockerfile; then
  fail 'Dockerfile still declares RISPRO_BUILD_COMMIT_SHA as a build argument'
fi
if grep -q -- '--build-arg RISPRO_BUILD_COMMIT_SHA' scripts/update-docker.sh; then
  fail 'Update script still passes RISPRO_BUILD_COMMIT_SHA as a Docker build argument'
fi
pass 'Compose injects the commit SHA only into the app runtime environment'

for entrypoint in scripts/update-docker.sh scripts/setup-docker.sh; do
  grep -q 'build_and_start_services' "$entrypoint" || fail 'Deployment bypasses targeted service deployment'
  if grep -q 'up -d --build' "$entrypoint"; then
    fail 'Deployment still uses a blanket build/up'
  fi
done
grep -q 'BUILDX_NO_DEFAULT_ATTESTATIONS=1.*RISPRO_BUILD_COMMIT_SHA=' scripts/update-docker.sh || fail 'BuildKit default attestations are not disabled for deployment builds'
grep -q 'up -d --no-deps --force-recreate gateway' scripts/update-docker.sh || fail 'Targeted gateway recreation is missing'
pass 'Normal deployment uses Docker cache with targeted gateway recreation'

app_block="$(sed -n '/^  app:/,/^  request-scan-worker:/p' docker-compose.yml)"
worker_block="$(sed -n '/^  request-scan-worker:/,/^  ohif:/p' docker-compose.yml)"
printf '%s\n' "${app_block}" | grep -q '^    build:' || fail 'App no longer owns the RISpro build definition'
printf '%s\n' "${worker_block}" | grep -q '^    build:' && fail 'Request Scan worker still owns a build definition'
printf '%s\n' "${worker_block}" | grep -Fq 'image: ${RISPRO_APP_IMAGE:-rispro-app:local}' || fail 'Request Scan worker image reference changed'
printf '%s\n' "${worker_block}" | grep -Fq 'pull_policy: never' || fail 'Request Scan worker does not require the local image'
pass 'App builds the shared RISpro image exactly once for both runtime services'

ordering_text="$(sed -n '/^deploy_checked_out_commit()/,/^main()/p' scripts/update-docker.sh)"
preflight_line="$(printf '%s\n' "${ordering_text}" | grep -n 'run_compose_preflight' | head -n1 | cut -d: -f1)"
build_line="$(printf '%s\n' "${ordering_text}" | grep -n '^  build_and_restart$' | head -n1 | cut -d: -f1)"
orthanc_ready_line="$(printf '%s\n' "${ordering_text}" | grep -n 'report_internal_orthanc_worklists' | head -n1 | cut -d: -f1)"
app_health_line="$(printf '%s\n' "${ordering_text}" | grep -n 'if ! wait_for_app_health' | head -n1 | cut -d: -f1)"
gateway_line="$(printf '%s\n' "${ordering_text}" | grep -n '^  recreate_gateway$' | head -n1 | cut -d: -f1)"
test "${preflight_line}" -lt "${build_line}" \
  && test "${build_line}" -lt "${gateway_line}" \
  && test "${gateway_line}" -lt "${app_health_line}" \
  && test "${app_health_line}" -lt "${orthanc_ready_line}" \
  || fail 'MWL status must follow web startup, gateway recreation and app health'
if grep -q 'ORTHANC_READINESS_ALREADY_VERIFIED' scripts/docker-deployment-lib.sh; then
  fail 'Orthanc readiness still caches an earlier container check'
fi
pass 'Orthanc readiness is reported independently after web startup and health'

grep -q 'ORTHANC_CONFIG_CHANGED=1' scripts/docker-deployment-lib.sh || fail 'Orthanc config-change flag is missing'
grep -q 'up -d --no-build --no-deps --no-recreate orthanc' scripts/docker-deployment-lib.sh || fail 'Unchanged Orthanc container is not retained'
grep -q 'up -d --no-build --no-deps --force-recreate orthanc' scripts/docker-deployment-lib.sh || fail 'Targeted Orthanc recreation is missing'
pass 'Orthanc uses a separate targeted deployment path'

bash scripts/test-docker-startup-isolation.sh
bash scripts/test-docker-update-handoff.sh
bash scripts/test-docker-permissions.sh
node --test scripts/verify-ohif-app-config.test.mjs

grep -q '"StableAge": 10' scripts/docker-deployment-lib.sh || fail 'Internal Orthanc renderer is missing StableAge 10'
pass 'Internal Orthanc renderer sets StableAge to 10 seconds'

for target in production production-orthanc restore-validation; do
  grep -q "FROM runtime-base AS ${target}" Dockerfile || fail "missing runtime-base target ${target}"
done
pass 'production, production-orthanc, and restore-validation share the stable runtime base'

grep -q 'RUN npm run build && npm run verify:qz-bundle' Dockerfile || fail 'Frontend builder does not run the production build'
frontend_builder="$(sed -n '/^FROM node:22-bookworm-slim AS frontend-builder$/,/^FROM debian:bookworm-slim AS dcmtk-builder$/p' Dockerfile)"
printf '%s\n' "${frontend_builder}" | grep -Fxq 'COPY src/modules/gamma-knife/gamma-knife-types.ts /app/src/modules/gamma-knife/gamma-knife-types.ts' \
  || fail 'Frontend builder is missing the shared Gamma Knife contract'
pass 'Frontend builder includes the shared Gamma Knife contract'
production_frontend_copy_count="$(grep -c 'COPY --from=frontend-builder /app/dist-frontend ./dist-frontend/' Dockerfile)"
test "${production_frontend_copy_count}" -eq 2 || fail 'Production runtime targets do not both copy frontend-builder output'
pass 'Production and production-orthanc receive the Docker-built frontend bundle'

for ignored in 'storage/sante-hl7-outbox/' 'coverage/' 'frontend/coverage/' 'playwright-report/' 'test-results/' '*.tsbuildinfo'; do
  grep -Fxq "${ignored}" .dockerignore || fail "Missing safe Docker build-context exclusion: ${ignored}"
done
if grep -Fxq 'dist-frontend/' .dockerignore; then
  fail 'Docker build context incorrectly ignores restore-validation dist-frontend input'
fi
pass 'Safe runtime and test artifacts are excluded from Docker build context'

grep -q 'app.get("/legacy/styles.css", sendFrontendFile("styles.css"));' src/app.ts || fail 'Legacy CSS is still using a cacheable non-versioned response'
pass 'Legacy non-fingerprinted CSS is served without browser caching'

test_root="$(mktemp -d)"
cleanup() {
  rm -rf "${test_root}"
}
trap cleanup EXIT

node <<'EOF_ENV_MIGRATION'
const assert = require('node:assert/strict');
const { migrateLegacyDockerEnvValue } = require('./scripts/docker-env-default-migrations.cjs');
assert.equal(migrateLegacyDockerEnvValue('DICOM_REMAP_STAGING_MAX_FILES', '5000'), '10000');
assert.equal(migrateLegacyDockerEnvValue('DICOM_REMAP_STAGING_MAX_FILES', '7500'), '7500');
assert.equal(migrateLegacyDockerEnvValue('UNRELATED_SETTING', '5000'), '5000');
EOF_ENV_MIGRATION
pass 'Docker env merge upgrades only the legacy DICOM remap file-count default'

git -C "${test_root}" init -q
git -C "${test_root}" config user.email test@example.invalid
git -C "${test_root}" config user.name 'Deployment Regression Test'
mkdir -p "${test_root}/storage/sante-hl7-outbox"
printf 'pending\n' > "${test_root}/storage/sante-hl7-outbox/sentinel.hl7"
mkdir -p "${test_root}/storage/untracked-risk"
printf 'remove\n' > "${test_root}/storage/untracked-risk/remove-me"
printf 'baseline\n' > "${test_root}/README"
git -C "${test_root}" add README
git -C "${test_root}" commit -qm baseline

git -C "${test_root}" clean -fd -e 'storage/sante-hl7-outbox/' >/dev/null
test -f "${test_root}/storage/sante-hl7-outbox/sentinel.hl7" || fail 'git clean removed the Sante HL7 sentinel'
test ! -e "${test_root}/storage/untracked-risk" || fail 'simulated git clean did not remove an unprotected path'
pass 'protected Sante HL7 outbox survives the exact update clean operation'
