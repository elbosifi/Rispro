#!/bin/sh
# =============================================================================
# RISpro MPPS Bridge Smoke Test (POSIX sh compatible)
# =============================================================================

set -e

MPPS_BRIDGE_HOST="${MPPS_BRIDGE_HOST:-127.0.0.1}"
MPPS_BRIDGE_PORT="${MPPS_BRIDGE_PORT:-11113}"
MPPS_BRIDGE_AE_TITLE="${MPPS_BRIDGE_AE_TITLE:-RISPRO_MPPS}"
MPPS_ADMIN_PORT="${MPPS_ADMIN_PORT:-18080}"
MPPS_AUTH_ENABLED="${MPPS_AUTH_ENABLED:-false}"
MPPS_USERNAME="${MPPS_USERNAME:-}"
MPPS_PASSWORD="${MPPS_PASSWORD:-}"
HEALTHCHECK_ONLY=false

if [ "${1:-}" = "--healthcheck" ]; then
  HEALTHCHECK_ONLY=true
fi

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
  if command -v wget >/dev/null 2>&1; then
    wget -qO- "$_url"
    return $?
  fi
  "$(python_command)" - "$_url" <<'EOF_PY'
import sys
from urllib.request import urlopen

with urlopen(sys.argv[1], timeout=5) as response:
    sys.stdout.buffer.write(response.read())
EOF_PY
}

python_command() {
  if command -v python >/dev/null 2>&1; then
    printf '%s' python
  else
    printf '%s' python3
  fi
}

dicom_echo() {
  "$(python_command)" - "${MPPS_BRIDGE_HOST}" "${MPPS_BRIDGE_PORT}" "${MPPS_BRIDGE_AE_TITLE}" <<'EOF_PY'
import sys
from pynetdicom import AE
from pynetdicom.sop_class import Verification

host, port, called_ae = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ae = AE(ae_title="RISPRO_MPPS_HC")
ae.add_requested_context(Verification)
assoc = ae.associate(host, port, ae_title=called_ae)
if not assoc.is_established:
    raise SystemExit(1)
try:
    status = assoc.send_c_echo()
    raise SystemExit(0 if status is not None and int(status.Status) == 0x0000 else 1)
finally:
    assoc.release()
EOF_PY
}

if [ "${HEALTHCHECK_ONLY}" = false ]; then
  echo "==================================================="
  echo "RISpro MPPS Bridge Smoke Test"
  echo "==================================================="
  echo ""
fi

if http_get "http://${MPPS_BRIDGE_HOST}:${MPPS_ADMIN_PORT}/healthz" >/dev/null 2>&1; then
  pass "Admin health endpoint responded at ${MPPS_BRIDGE_HOST}:${MPPS_ADMIN_PORT}/healthz"
else
  fail "Admin health endpoint did not respond"
  exit 1
fi

if dicom_echo >/dev/null 2>&1; then
  pass "DICOM C-ECHO succeeded at ${MPPS_BRIDGE_HOST}:${MPPS_BRIDGE_PORT} (${MPPS_BRIDGE_AE_TITLE})"
else
  fail "DICOM C-ECHO failed at ${MPPS_BRIDGE_HOST}:${MPPS_BRIDGE_PORT} (${MPPS_BRIDGE_AE_TITLE})"
  exit 1
fi

if [ "${HEALTHCHECK_ONLY}" = true ]; then
  exit 0
fi

echo ""
echo "Optional events endpoint"
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
