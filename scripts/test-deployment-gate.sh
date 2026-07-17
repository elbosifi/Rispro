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
pass 'deployment workflow contains the exact-SHA CI, remote, health, and runtime gates'

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
