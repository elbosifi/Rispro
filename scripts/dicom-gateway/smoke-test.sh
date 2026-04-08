#!/usr/bin/env bash
# =============================================================================
# RISpro DICOM Gateway Smoke Test
# =============================================================================
# Validates that embedded DICOM services are running and responding.
# Usage: ./scripts/dicom-gateway/smoke-test.sh
# =============================================================================

set -euo pipefail

# Configuration (read from environment or defaults)
MWL_AE_TITLE="${DICOM_MWL_AE_TITLE:-RISPRO_MWL}"
MWL_PORT="${DICOM_MWL_PORT:-11112}"
MPPS_AE_TITLE="${DICOM_MPPS_AE_TITLE:-RISPRO_MPPS}"
MPPS_PORT="${DICOM_MPPS_PORT:-11113}"
BACKEND_URL="${RISPRO_BASE_URL:-http://127.0.0.1:3000}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass() {
  echo -e "${GREEN}✓ PASS${NC} $1"
}

fail() {
  echo -e "${RED}✗ FAIL${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠ WARN${NC} $1"
}

info() {
  echo -e "  INFO: $1"
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
# 4. DICOM C-ECHO to MPPS SCP (if ppsscpfs is available)
# -------------------------------------------------------------------
echo "4. DICOM C-ECHO to MPPS SCP (${MPPS_AE_TITLE}@127.0.0.1:${MPPS_PORT})"
if command -v echoscu >/dev/null 2>&1; then
  if command -v ppsscpfs >/dev/null 2>&1; then
    if echoscu -v -aec "${MPPS_AE_TITLE}" 127.0.0.1 "${MPPS_PORT}" >/dev/null 2>&1; then
      pass "MPPS SCP responded to C-ECHO"
    else
      fail "MPPS SCP did not respond to C-ECHO"
      warn "Check if ppsscpfs is running: ps aux | grep ppsscpfs"
    fi
  else
    warn "ppsscpfs not found. MPPS SCP is disabled."
  fi
else
  warn "echoscu not found. Install DCMTK to run DICOM tests."
fi
echo ""

# -------------------------------------------------------------------
# 5. DICOM Tools Availability
# -------------------------------------------------------------------
echo "5. DICOM Tools Availability"
TOOLS=("wlmscpfs" "ppsscpfs" "dump2dcm" "dcmdump" "echoscu" "findscu")
for tool in "${TOOLS[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    pass "$tool: $(which "$tool")"
  else
    warn "$tool: not found"
  fi
done
echo ""

# -------------------------------------------------------------------
# 6. DICOM Directory Health
# -------------------------------------------------------------------
echo "6. DICOM Directory Health"
DIRS=(
  "Worklist Source:/app/storage/dicom/worklist-source"
  "Worklist Output:/app/storage/dicom/worklists"
  "MPPS Inbox:/app/storage/dicom/mpps/inbox"
  "MPPS Processed:/app/storage/dicom/mpps/processed"
  "MPPS Failed:/app/storage/dicom/mpps/failed"
)
for dir_entry in "${DIRS[@]}"; do
  IFS=':' read -r label dir_path <<< "$dir_entry"
  if [ -d "$dir_path" ]; then
    if [ -w "$dir_path" ]; then
      pass "$label: writable ($(ls -1 "$dir_path" 2>/dev/null | wc -l) files)"
    else
      fail "$label: not writable"
    fi
  else
    fail "$label: missing ($dir_path)"
  fi
done
echo ""

echo "==================================================="
echo "Smoke test complete"
echo "==================================================="
