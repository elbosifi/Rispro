#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${1:-${PROJECT_ROOT}/docker/reverse-proxy/nginx.conf}"

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

pass() {
  printf '[OK]   %s\n' "$*"
}

[[ -f "${CONFIG_FILE}" ]] || fail "missing Nginx configuration: ${CONFIG_FILE}"

grep -Eq '^[[:space:]]*resolver[[:space:]]+127\.0\.0\.11([[:space:]]|;)' "${CONFIG_FILE}" \
  || fail "gateway must use Docker embedded DNS resolver"
pass "Docker embedded DNS resolver is configured"

grep -Eq '^[[:space:]]*zone[[:space:]]+rispro_app[[:space:]]+[0-9]+[kKmM];' "${CONFIG_FILE}" \
  || fail "rispro_app upstream must use a shared-memory zone"
pass "rispro_app upstream has a shared-memory zone"

grep -Eq '^[[:space:]]*server[[:space:]]+app:3000[[:space:]]+resolve;' "${CONFIG_FILE}" \
  || fail "app upstream must be dynamically re-resolved"
pass "app upstream is configured with resolve"
