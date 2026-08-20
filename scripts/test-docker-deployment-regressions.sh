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

grep -q 'up -d --build$' scripts/update-docker.sh || fail 'Normal deployment no longer offers the application build to Docker'
if grep -q 'up -d --build --force-recreate' scripts/update-docker.sh; then
  fail 'Normal deployment still uses blanket --force-recreate'
fi
grep -q 'up -d --no-deps --force-recreate gateway' scripts/update-docker.sh || fail 'Targeted gateway recreation is missing'
pass 'Normal deployment uses Docker cache with targeted gateway recreation'

grep -q 'ORTHANC_CONFIG_CHANGED=1' scripts/docker-deployment-lib.sh || fail 'Orthanc config-change flag is missing'
grep -q 'ORTHANC_CONFIG_CHANGED}" != "1"' scripts/docker-deployment-lib.sh || fail 'Unchanged Orthanc config does not bypass targeted recreation'
grep -q 'up -d --no-deps --force-recreate orthanc' scripts/docker-deployment-lib.sh || fail 'Targeted Orthanc recreation is missing'
pass 'Orthanc recreation is limited to rendered content changes'

for target in production production-orthanc restore-validation; do
  grep -q "FROM runtime-base AS ${target}" Dockerfile || fail "missing runtime-base target ${target}"
done
pass 'production, production-orthanc, and restore-validation share the stable runtime base'

grep -q 'RUN npm run build && npm run verify:qz-bundle' Dockerfile || fail 'Frontend builder does not run the production build'
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

git -C "${test_root}" clean -fd -e '/storage/sante-hl7-outbox/' >/dev/null
test -f "${test_root}/storage/sante-hl7-outbox/sentinel.hl7" || fail 'git clean removed the Sante HL7 sentinel'
test ! -e "${test_root}/storage/untracked-risk" || fail 'simulated git clean did not remove an unprotected path'
pass 'protected Sante HL7 outbox survives the exact update clean operation'
