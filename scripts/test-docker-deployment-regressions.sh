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
pass 'Compose injects the commit SHA only into the app runtime environment'

for target in production production-orthanc restore-validation; do
  grep -q "FROM runtime-base AS ${target}" Dockerfile || fail "missing runtime-base target ${target}"
done
pass 'production, production-orthanc, and restore-validation share the stable runtime base'

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
