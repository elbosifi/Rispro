#!/bin/sh
set -eu

BASE_URL="${RISPRO_SMOKE_BASE_URL:-http://127.0.0.1:3000}"

curl -fsS "${BASE_URL}/gateway-health" >/dev/null
curl -fsS "${BASE_URL}/api/health" >/dev/null
curl -fsS "${BASE_URL}/ohif/" >/dev/null
curl -fsS "${BASE_URL}/ohif/app-config.js" | grep -q "/ohif-dicomweb"

proxy_status="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/ohif-dicomweb/studies?StudyInstanceUID=1.2.3")"
case "$proxy_status" in
  401|403) ;;
  *) echo "Expected protected DICOMweb route to reject an unauthenticated request; got ${proxy_status}." >&2; exit 1 ;;
esac

if [ -n "${OHIF_SMOKE_SESSION_COOKIE:-}" ] && [ -n "${OHIF_SMOKE_APPOINTMENT_ID:-}" ]; then
  response="$(curl -fsS -X POST \
    -H 'Content-Type: application/json' \
    -H "Cookie: ${OHIF_SMOKE_SESSION_COOKIE}" \
    --data '{"includePriors":true}' \
    "${BASE_URL}/api/doctor/reporting-board/cases/${OHIF_SMOKE_APPOINTMENT_ID}/viewer-launch")"
  printf '%s' "$response" | grep -Eq '"status":"(ready|retrieving)"'
else
  echo "OHIF authenticated launch smoke skipped: set OHIF_SMOKE_SESSION_COOKIE and OHIF_SMOKE_APPOINTMENT_ID for a controlled test case."
fi

echo "OHIF gateway/base/config/protection smoke checks passed."
