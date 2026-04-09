#!/bin/sh
# =============================================================================
# RISpro DICOM Gateway Smoke Test (POSIX sh compatible)
# =============================================================================
# Validates that embedded DICOM services are running and responding.
# Usage: ./scripts/dicom-gateway/smoke-test.sh
# =============================================================================

set -e

# Configuration (read from environment or defaults)
MWL_AE_TITLE="${DICOM_MWL_AE_TITLE:-RISPRO_MWL}"
MWL_PORT="${DICOM_MWL_PORT:-11112}"
BACKEND_URL="${RISPRO_BASE_URL:-http://127.0.0.1:3000}"

pass() {
  printf '\033[0;32m✓ PASS\033[0m %s\n' "$1"
}

fail() {
  printf '\033[0;31m✗ FAIL\033[0m %s\n' "$1"
}

warn() {
  printf '\033[1;33m⚠ WARN\033[0m %s\n' "$1"
}

info() {
  printf '  INFO: %s\n' "$1"
}

echo "==================================================="
echo "RISpro DICOM Gateway Smoke Test"
echo "==================================================="
echo ""

# -------------------------------------------------------------------
# 1. Backend Health Check
# -------------------------------------------------------------------
echo "1. Backend Health Check"
if wget -qO- "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
  pass "Backend is healthy at ${BACKEND_URL}/api/health"
else
  fail "Backend health check failed at ${BACKEND_URL}/api/health"
  exit 1
fi
echo ""

# -------------------------------------------------------------------
# 2. Backend Readiness Check
# -------------------------------------------------------------------
echo "2. Backend Readiness Check"
if wget -qO- "${BACKEND_URL}/api/ready" >/dev/null 2>&1; then
  pass "Database connection is ready"
else
  fail "Database connection is not ready"
  exit 1
fi
echo ""

# -------------------------------------------------------------------
# 3. DICOM C-ECHO to MWL SCP
# -------------------------------------------------------------------
echo "3. DICOM C-ECHO to MWL SCP (${MWL_AE_TITLE}@127.0.0.1:${MWL_PORT})"
if command -v echoscu >/dev/null 2>&1; then
  if echoscu -v -aec "${MWL_AE_TITLE}" 127.0.0.1 "${MWL_PORT}" >/dev/null 2>&1; then
    pass "MWL SCP responded to C-ECHO"
  else
    fail "MWL SCP did not respond to C-ECHO"
    warn "Check if wlmscpfs is running: ps aux | grep wlmscpfs"
  fi
else
  warn "echoscu not found. Install DCMTK to run DICOM tests."
fi
echo ""

# -------------------------------------------------------------------
# 4. DICOM Tools Availability
# -------------------------------------------------------------------
echo "4. DICOM Tools Availability"
for tool in wlmscpfs dump2dcm dcmdump echoscu findscu; do
  if command -v "$tool" >/dev/null 2>&1; then
    pass "$tool: $(command -v "$tool")"
  else
    warn "$tool: not found"
  fi
done
echo ""

# -------------------------------------------------------------------
# 5. DICOM Directory Health
# -------------------------------------------------------------------
echo "5. DICOM Directory Health"
check_dir() {
  label="$1"
  dir_path="$2"
  if [ -d "$dir_path" ]; then
    if [ -w "$dir_path" ]; then
      file_count="$(ls -1 "$dir_path" 2>/dev/null | wc -l | tr -d ' ')"
      pass "${label}: writable (${file_count} files)"
    else
      fail "${label}: not writable"
    fi
  else
    fail "${label}: missing (${dir_path})"
  fi
}

check_dir "Worklist Source" "/app/storage/dicom/worklist-source"
check_dir "Worklist Output" "/app/storage/dicom/worklists"
check_dir "Worklist AE Dir" "/app/storage/dicom/worklists/${MWL_AE_TITLE}"

if [ -f "/app/storage/dicom/worklists/${MWL_AE_TITLE}/lockfile" ]; then
  pass "Worklist AE lockfile present"
else
  fail "Worklist AE lockfile missing"
fi
echo ""

echo "==================================================="
echo "Smoke test complete"
echo "==================================================="
