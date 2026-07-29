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

ci_workflow='.github/workflows/ci.yml'
workflow='.github/workflows/deploy.yml'
auto_workflow='.github/workflows/auto-deploy-development.yml'
health_workflow='.github/workflows/development-health.yml'
grep -q '^  pull_request:$' "$ci_workflow" || fail 'comprehensive CI workflow does not run for pull requests'
grep -q '^  push:$' "$ci_workflow" || fail 'comprehensive CI workflow does not run for pushes'
grep -q '^      - main$' "$ci_workflow" || fail 'comprehensive CI workflow push trigger is not restricted to main'
pass 'comprehensive CI workflow covers pull requests and direct main pushes'

grep -q 'commit_sha:' "$workflow" || fail 'deployment workflow does not require a commit_sha input'
grep -q '^run-name: Deploy RISpro development \${{ inputs.commit_sha }}$' "$workflow" || fail 'deployment workflow does not use deterministic exact-SHA run name'
grep -q 'listWorkflowRuns' "$workflow" || fail 'deployment workflow does not query workflow runs'
grep -q 'workflow_id: "ci.yml"' "$workflow" || fail 'deployment workflow does not target comprehensive CI'
grep -q 'workflow_id: "self-hosted-ci.yml"' "$workflow" || fail 'deployment workflow does not target self-hosted CI'
grep -q 'run.head_sha.toLowerCase() === expectedSha' "$workflow" || fail 'deployment workflow does not compare the exact run SHA'
grep -q 'run.conclusion === "success"' "$workflow" || fail 'deployment workflow does not require a successful CI conclusion'
grep -q 'No successful RISpro comprehensive CI run exists' "$workflow" || fail 'deployment workflow does not fail when comprehensive CI is absent'
grep -q 'No successful RISpro self-hosted CI run exists' "$workflow" || fail 'deployment workflow does not fail when self-hosted CI is absent'
grep -q -- '--expected-sha ${DEPLOY_SHA}' "$workflow" || fail 'deployment workflow does not pass the expected SHA remotely'
grep -q 'Check whether requested build is already deployed' "$workflow" || fail 'deployment workflow has no idempotency precheck'
grep -q 'already_deployed=true' "$workflow" || fail 'deployment workflow does not record matching deployed SHA'
grep -q "steps.deployed-check.outputs.already_deployed != 'true'" "$workflow" || fail 'deployment workflow does not skip only the deploy command for matching SHA'
grep -q '/api/ready' "$workflow" || fail 'deployment workflow has no post-deployment readiness check'
grep -q 'health.buildSha !== expectedSha' "$workflow" || fail 'deployment workflow does not verify the running build SHA'
grep -q 'test:deployment:smoke' "$workflow" || fail 'deployment workflow does not run the functional smoke gate'
if grep -q 'cd /srv/rispro' "$workflow"; then
  fail 'deployment smoke gate hardcodes the legacy application directory'
fi
grep -q 'DEPLOY_APP_DIR: \${{ vars.DEPLOY_APP_DIR }}' "$workflow" || fail 'deployment smoke gate does not read the DEPLOY_APP_DIR Actions variable'
grep -q ': "\${DEPLOY_APP_DIR:?DEPLOY_APP_DIR GitHub Actions variable is required}"' "$workflow" || fail 'deployment smoke gate does not require a non-empty DEPLOY_APP_DIR'
grep -q 'bash -s -- "\${DEPLOY_SHA}" "\${RISPRO_SMOKE_AUTH_ENABLED}" "\${DEPLOY_APP_DIR}"' "$workflow" || fail 'deployment smoke gate does not pass DEPLOY_APP_DIR to the remote shell'
grep -q 'app_dir="\$3"' "$workflow" || fail 'deployment smoke gate does not read the remote application directory argument'
grep -q '\[ ! -d "\$app_dir" \]' "$workflow" || fail 'deployment smoke gate does not validate the remote application directory'
grep -q 'cd "\$app_dir"' "$workflow" || fail 'deployment smoke gate does not enter the configured application directory'
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

grep -q "needs.deploy.result == 'failure'" "$workflow" || fail 'deployment workflow does not report failed deployments'
grep -q 'actions: read' "$workflow" || fail 'deployment failure report does not read Actions jobs'
grep -q 'issues: write' "$workflow" || fail 'deployment failure report cannot create issues'
grep -q 'deployment-report' "$workflow" || fail 'deployment failure report does not use the shared reporter'
pass 'deployment workflow reports and recovers exact-SHA failures'

grep -q '^name: Auto Deploy RISpro Development$' "$auto_workflow" || fail 'automatic controller workflow is missing'
grep -q 'RISpro self-hosted CI' "$auto_workflow" || fail 'automatic controller does not observe self-hosted CI'
grep -q 'group: rispro-auto-deploy-\${{ github.event.workflow_run.head_sha }}' "$auto_workflow" || fail 'automatic controller is not SHA-concurrent'
grep -q 'actions: write' "$auto_workflow" || fail 'automatic controller cannot dispatch deployment'
grep -q 'development-automation.mjs controller' "$auto_workflow" || fail 'automatic controller does not run exact-SHA decision logic'
pass 'automatic controller has exact-SHA workflow gates'

grep -q '^name: RISpro Development Health$' "$health_workflow" || fail 'development health workflow is missing'
grep -q 'cron: "\*/15 \* \* \* \*"' "$health_workflow" || fail 'development health workflow is not scheduled approximately every 15 minutes'
grep -q 'StrictHostKeyChecking=yes' "$health_workflow" || fail 'development health workflow weakens SSH host checking'
grep -q '/api/health' "$health_workflow" || fail 'development health workflow does not check health'
grep -q '/api/ready' "$health_workflow" || fail 'development health workflow does not check readiness'
grep -q 'health-report' "$health_workflow" || fail 'development health workflow does not report failures'
pass 'development health monitor has safe HTTP checks and reporting'

grep -q 'validate_expected_sha' deploy.sh || fail 'direct deployment script has no expected-SHA validation'
grep -q 'git checkout --detach "$EXPECTED_SHA"' deploy.sh || fail 'direct deployment script does not check out the expected SHA'
grep -q 'Checked-out commit' deploy.sh || fail 'direct deployment script does not verify checked-out SHA'
grep -q 'Application-reported build SHA verified' deploy.sh || fail 'direct deployment script does not verify the running build SHA'
grep -q 'git checkout --detach "${EXPECTED_SHA}"' scripts/update-docker.sh || fail 'Docker deployment script does not check out the expected SHA'
grep -q 'verify_app_build_sha' scripts/update-docker.sh || fail 'Docker deployment script does not verify the running build SHA'
grep -q 'Manual mode does not itself prove CI is green' scripts/update-docker.sh || fail 'Docker deployment script does not warn that manual mode is not CI proof'
grep -q 'git rev-parse --verify "origin/${DEPLOY_BRANCH}^{commit}"' scripts/update-docker.sh || fail 'Docker deployment script does not resolve the manual branch to an exact SHA'
grep -q "git reset --hard HEAD" scripts/update-docker.sh || fail 'Docker deployment script does not disclose its hard reset'
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

docker_fixture="$test_root/docker-update-fixture"
docker_remote="$test_root/docker-update-remote.git"
git init -q --bare "$docker_remote"
git clone -q "$docker_remote" "$docker_fixture"
git -C "$docker_fixture" config user.email test@example.invalid
git -C "$docker_fixture" config user.name 'Docker Update Gate Test'
printf 'first fixture\n' > "$docker_fixture/README"
git -C "$docker_fixture" add README
git -C "$docker_fixture" commit -qm first-fixture
git -C "$docker_fixture" branch -M main
git -C "$docker_fixture" push -qu origin main
mkdir -p "$docker_fixture/scripts"
cp scripts/update-docker.sh scripts/docker-deployment-lib.sh "$docker_fixture/scripts/"
# Load the deployment helpers without invoking main; these checks exercise only the git gate.
sed '$d' "$docker_fixture/scripts/update-docker.sh" > "$docker_fixture/scripts/update-docker-testable.sh"
git -C "$docker_fixture" add scripts
git -C "$docker_fixture" commit -qm docker-update-gate-fixture
git -C "$docker_fixture" push -qu origin main
docker_expected_sha="$(git -C "$docker_fixture" rev-parse HEAD)"

manual_output="$(
  cd "$docker_fixture"
  unset EXPECTED_SHA RISPRO_EXPECTED_SHA
  DEPLOY_BRANCH=main
  source ./scripts/update-docker-testable.sh
  check_git_repo
)"
grep -Fq "origin/main at resolved SHA ${docker_expected_sha}" <<<"$manual_output" || fail 'manual Docker update did not resolve origin/main to its full SHA'
grep -Fq 'Manual mode does not itself prove CI is green' <<<"$manual_output" || fail 'manual Docker update did not warn that CI status remains unproven'
pass 'Docker update manual mode resolves origin/main to an exact SHA'

explicit_output="$(
  cd "$docker_fixture"
  DEPLOY_BRANCH=main
  source ./scripts/update-docker-testable.sh
  parse_deployment_args --expected-sha "$docker_expected_sha"
  check_git_repo
)"
grep -Fq "Exact-SHA update mode: deploying expected commit ${docker_expected_sha}" <<<"$explicit_output" || fail 'Docker update explicit SHA mode did not retain the exact-SHA contract'
pass 'Docker update explicit SHA mode retains exact-SHA checkout'

compatibility_output="$(
  cd "$docker_fixture"
  unset EXPECTED_SHA
  export RISPRO_EXPECTED_SHA="$docker_expected_sha"
  DEPLOY_BRANCH=main
  source ./scripts/update-docker-testable.sh
  check_git_repo
)"
grep -Fq "Exact-SHA update mode: deploying expected commit ${docker_expected_sha}" <<<"$compatibility_output" || fail 'Docker update did not preserve RISPRO_EXPECTED_SHA compatibility'
pass 'Docker update preserves RISPRO_EXPECTED_SHA compatibility'

if (
  cd "$docker_fixture"
  DEPLOY_BRANCH=main
  source ./scripts/update-docker-testable.sh
  parse_deployment_args --expected-sha not-a-sha
  check_git_repo
) >/dev/null 2>&1; then
  fail 'Docker update accepted a malformed explicit SHA'
fi
pass 'Docker update rejects malformed explicit SHA values'

if (
  cd "$docker_fixture"
  unset EXPECTED_SHA RISPRO_EXPECTED_SHA
  DEPLOY_BRANCH=missing-branch
  source ./scripts/update-docker-testable.sh
  check_git_repo
) >/dev/null 2>&1; then
  fail 'Docker update accepted an unresolvable manual remote branch'
fi
pass 'Docker update rejects an unresolvable manual remote branch'

git_wrapper_dir="$test_root/git-wrapper"
mkdir -p "$git_wrapper_dir"
real_git="$(command -v git)"
cat > "$git_wrapper_dir/git" <<'GIT_WRAPPER'
#!/usr/bin/env bash
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  printf '%040d\n' 0
  exit 0
fi
exec "$RISPRO_REAL_GIT" "$@"
GIT_WRAPPER
chmod +x "$git_wrapper_dir/git"
if (
  cd "$docker_fixture"
  PATH="$git_wrapper_dir:$PATH" RISPRO_REAL_GIT="$real_git" EXPECTED_SHA="$docker_expected_sha" DEPLOY_BRANCH=main \
    bash -c 'source ./scripts/update-docker-testable.sh; check_git_repo'
) >/dev/null 2>&1; then
  fail 'Docker update accepted a checked-out SHA mismatch'
fi
pass 'Docker update rejects a checked-out SHA mismatch'

grep -q -- '--expected-sha ${DEPLOY_SHA}' "$workflow" || fail 'automated deployment caller no longer passes an exact SHA'
pass 'automated deployment caller continues to pass an exact SHA'
