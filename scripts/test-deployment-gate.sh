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

workflow='.github/workflows/deploy.yml'
grep -q 'commit_sha:' "$workflow" || fail 'deployment workflow does not require a commit_sha input'
grep -q 'listWorkflowRuns' "$workflow" || fail 'deployment workflow does not query workflow runs'
grep -q 'workflow_id: "self-hosted-ci.yml"' "$workflow" || fail 'deployment workflow does not target self-hosted CI'
grep -q 'run.head_sha.toLowerCase() === expectedSha' "$workflow" || fail 'deployment workflow does not compare the exact run SHA'
grep -q 'run.conclusion === "success"' "$workflow" || fail 'deployment workflow does not require a successful CI conclusion'
grep -q -- '--expected-sha ${DEPLOY_SHA}' "$workflow" || fail 'deployment workflow does not pass the expected SHA remotely'
grep -q '/api/ready' "$workflow" || fail 'deployment workflow has no post-deployment readiness check'
grep -q 'health.buildSha !== expectedSha' "$workflow" || fail 'deployment workflow does not verify the running build SHA'
grep -q 'test:deployment:smoke' "$workflow" || fail 'deployment workflow does not run the functional smoke gate'
grep -q 'cd /srv/rispro' "$workflow" || fail 'deployment smoke gate does not enter the deployed checkout'
grep -q 'RISPRO_SMOKE_BASE_URL="http://127.0.0.1:3000"' "$workflow" || fail 'deployment smoke gate does not use an explicit target URL'

readiness_line="$(grep -n '/api/ready' "$workflow" | tail -n 1 | cut -d: -f1)"
build_sha_line="$(grep -n 'health.buildSha !== expectedSha' "$workflow" | tail -n 1 | cut -d: -f1)"
smoke_line="$(grep -n '^      - name: Run post-deployment functional smoke gate$' "$workflow" | cut -d: -f1)"
[ -n "$readiness_line" ] || fail 'deployment workflow readiness line could not be located'
[ -n "$build_sha_line" ] || fail 'deployment workflow build-SHA line could not be located'
[ -n "$smoke_line" ] || fail 'deployment workflow smoke step could not be located'
if [ "$smoke_line" -le "$readiness_line" ] || [ "$smoke_line" -le "$build_sha_line" ]; then
  fail 'functional smoke gate is not ordered after readiness and exact build-SHA verification'
fi

smoke_block="$(sed -n "${smoke_line},\$p" "$workflow")"
grep -q 'set -euo pipefail' <<<"$smoke_block" || fail 'functional smoke step does not fail closed'
grep -q 'RISPRO_EXPECTED_COMMIT_SHA="$expected_sha"' <<<"$smoke_block" || fail 'functional smoke step does not receive the expected SHA'
if grep -Eq 'continue-on-error:[[:space:]]*true|\|\|[[:space:]]*true|[Ww][Aa][Rr][Nn][Ii][Nn][Gg]' <<<"$smoke_block"; then
  fail 'functional smoke step can ignore or downgrade a failure'
fi
pass 'deployment workflow contains ordered, exact-SHA, fail-closed functional smoke gates'

grep -q 'validate_expected_sha' deploy.sh || fail 'direct deployment script has no expected-SHA validation'
grep -q 'git checkout --detach "$EXPECTED_SHA"' deploy.sh || fail 'direct deployment script does not check out the expected SHA'
grep -q 'Checked-out commit' deploy.sh || fail 'direct deployment script does not verify checked-out SHA'
grep -q 'Application-reported build SHA verified' deploy.sh || fail 'direct deployment script does not verify the running build SHA'
grep -q 'git checkout --detach "${EXPECTED_SHA}"' scripts/update-docker.sh || fail 'Docker deployment script does not check out the expected SHA'
grep -q 'verify_app_build_sha' scripts/update-docker.sh || fail 'Docker deployment script does not verify the running build SHA'
pass 'repository deployment scripts enforce exact checkout and runtime SHA verification'

test_root="$(mktemp -d)"
server_pid=''
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$test_root"
}
trap cleanup EXIT

git -C "$test_root" init -q
git -C "$test_root" config user.email test@example.invalid
git -C "$test_root" config user.name 'Deployment Gate Test'
printf 'fixture\n' > "$test_root/README"
git -C "$test_root" add README
git -C "$test_root" commit -qm fixture
cp deploy.sh "$test_root/deploy.sh"
chmod +x "$test_root/deploy.sh"
printf 'DATABASE_URL=postgresql://test.invalid/rispro\n' > "$test_root/.env"
expected_sha="$(git -C "$test_root" rev-parse HEAD)"
bad_sha='0000000000000000000000000000000000000000'

if (
  cd "$test_root"
  SKIP_GIT_PULL=1 \
  RESTART_MODE=none \
  INSTALL_NATIVE_IMAGE_DEPS=0 \
  INSTALL_CMD=: \
  MIGRATE_CMD=: \
  EXPECTED_SHA="$bad_sha" \
  ./deploy.sh --expected-sha "$bad_sha"
) >/dev/null 2>&1; then
  fail 'deployment script accepted an unverified/mismatched SHA'
fi
pass 'mismatched SHA is rejected before deployment actions'

port_file="$test_root/port"
BUILD_SHA="$expected_sha" node --input-type=module >"$port_file" 2>/dev/null <<'NODE_SERVER' &
import http from "node:http";

const body = JSON.stringify({ ok: true, buildSha: process.env.BUILD_SHA });
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(body);
});
server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
NODE_SERVER
server_pid=$!

for _ in $(seq 1 50); do
  [ -s "$port_file" ] && break
  sleep 0.1
done
port="$(head -n 1 "$port_file")"
[ -n "$port" ] || fail 'test health server did not start'

(
  cd "$test_root"
  SKIP_GIT_PULL=1 \
  RESTART_MODE=none \
  INSTALL_NATIVE_IMAGE_DEPS=0 \
  INSTALL_CMD=: \
  MIGRATE_CMD=: \
  EXPECTED_SHA="$expected_sha" \
  HEALTHCHECK_URL="http://127.0.0.1:${port}/health" \
  READINESSCHECK_URL="http://127.0.0.1:${port}/ready" \
  BUILD_SHA_URL="http://127.0.0.1:${port}/health" \
  ./deploy.sh --expected-sha "$expected_sha"
) >/dev/null
grep -qx "RISPRO_BUILD_COMMIT_SHA=$expected_sha" "$test_root/.env" || fail 'deployment script did not persist the expected runtime build SHA'
pass 'matching SHA is checked out and passes health/build-SHA verification'
