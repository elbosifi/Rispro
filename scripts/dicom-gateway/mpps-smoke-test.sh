#!/bin/sh
# =============================================================================
# RISpro MPPS Bridge Smoke Test (POSIX sh compatible)
# =============================================================================

set -e

MPPS_BRIDGE_HOST="${MPPS_BRIDGE_HOST:-127.0.0.1}"
MPPS_BRIDGE_PORT="${MPPS_BRIDGE_PORT:-11113}"
MPPS_ADMIN_PORT="${MPPS_ADMIN_PORT:-18080}"
MPPS_AUTH_ENABLED="${MPPS_AUTH_ENABLED:-false}"
MPPS_USERNAME="${MPPS_USERNAME:-}"
MPPS_PASSWORD="${MPPS_PASSWORD:-}"

pass() {
  printf '\033[0;32mPASS\033[0m %s\n' "$1"
}

fail() {
  printf '\033[0;31mFAIL\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33mWARN\033[0m %s\n' "$1"
}

http_get() {
  _url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "$_url"
    return $?
  fi
  wget -qO- "$_url"
}

echo "==================================================="
echo "RISpro MPPS Bridge Smoke Test"
echo "==================================================="
echo ""

echo "1. TCP reachability"
if python3 - <<EOF_PY >/dev/null 2>&1
import socket
s = socket.create_connection(("${MPPS_BRIDGE_HOST}", int("${MPPS_BRIDGE_PORT}")), 2)
s.close()
EOF_PY
then
  pass "MPPS bridge port is reachable at ${MPPS_BRIDGE_HOST}:${MPPS_BRIDGE_PORT}"
else
  fail "Could not connect to ${MPPS_BRIDGE_HOST}:${MPPS_BRIDGE_PORT}"
  exit 1
fi
echo ""

echo "2. Admin health endpoint"
if http_get "http://${MPPS_BRIDGE_HOST}:${MPPS_ADMIN_PORT}/healthz" >/dev/null 2>&1; then
  pass "Admin health endpoint responded at ${MPPS_BRIDGE_HOST}:${MPPS_ADMIN_PORT}/healthz"
else
  fail "Admin health endpoint did not respond"
  exit 1
fi
echo ""

echo "3. Optional events endpoint"
if [ "${MPPS_AUTH_ENABLED}" = "true" ]; then
  if [ -z "${MPPS_USERNAME}" ] || [ -z "${MPPS_PASSWORD}" ]; then
    fail "MPPS auth is enabled but username/password were not supplied to the smoke test"
    exit 1
  fi

  if command -v curl >/dev/null 2>&1; then
    if curl -fsS -u "${MPPS_USERNAME}:${MPPS_PASSWORD}" "http://${MPPS_BRIDGE_HOST}:${MPPS_ADMIN_PORT}/events" >/dev/null 2>&1; then
      pass "Authenticated /events endpoint responded"
    else
      fail "Authenticated /events endpoint did not respond"
      exit 1
    fi
  else
    warn "curl not found; skipping authenticated /events check"
  fi
else
  if http_get "http://${MPPS_BRIDGE_HOST}:${MPPS_ADMIN_PORT}/events" >/dev/null 2>&1; then
    pass "Unauthenticated /events endpoint responded"
  else
    fail "Unauthenticated /events endpoint did not respond"
    exit 1
  fi
fi
echo ""

echo "==================================================="
echo "MPPS smoke test complete"
echo "==================================================="
