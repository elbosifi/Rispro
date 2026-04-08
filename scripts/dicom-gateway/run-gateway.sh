#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)

if [ -f "$APP_DIR/.env" ]; then
  set -a
  . "$APP_DIR/.env"
  set +a
fi

: "${RISPRO_BASE_URL:=http://127.0.0.1:3000}"
: "${DICOM_BIND_HOST:=0.0.0.0}"
: "${DICOM_MWL_AE_TITLE:=RISPRO_MWL}"
: "${DICOM_MWL_PORT:=11112}"
: "${DICOM_MPPS_AE_TITLE:=RISPRO_MPPS}"
: "${DICOM_MPPS_PORT:=11113}"
: "${DICOM_WORKLIST_SOURCE_DIR:=$APP_DIR/storage/dicom/worklist-source}"
: "${DICOM_WORKLIST_OUTPUT_DIR:=$APP_DIR/storage/dicom/worklists}"
: "${DICOM_MPPS_INBOX_DIR:=$APP_DIR/storage/dicom/mpps/inbox}"

MWL_OUTPUT_DIR="$DICOM_WORKLIST_OUTPUT_DIR/$DICOM_MWL_AE_TITLE"

mkdir -p \
  "$DICOM_WORKLIST_SOURCE_DIR" \
  "$DICOM_WORKLIST_OUTPUT_DIR" \
  "$MWL_OUTPUT_DIR" \
  "$DICOM_MPPS_INBOX_DIR"

: > "$MWL_OUTPUT_DIR/lockfile"

node "$APP_DIR/scripts/dicom-gateway/build-worklists.mjs" &
WORKLIST_BUILDER_PID=$!

cleanup() {
  kill "$WORKLIST_BUILDER_PID" "${MPPS_PROCESSOR_PID:-}" "${MPPS_PID:-}" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

if command -v ppsscpfs >/dev/null 2>&1; then
  if command -v dcmdump >/dev/null 2>&1; then
    node "$APP_DIR/scripts/dicom-gateway/process-mpps-inbox.mjs" &
    MPPS_PROCESSOR_PID=$!
  else
    echo "[DICOM Gateway] WARNING: dcmdump not found. MPPS processor disabled."
  fi

  ppsscpfs \
    -aet "$DICOM_MPPS_AE_TITLE" \
    --output-directory "$DICOM_MPPS_INBOX_DIR" \
    "$DICOM_MPPS_PORT" &
  MPPS_PID=$!
else
  echo "[DICOM Gateway] WARNING: ppsscpfs not found. Continuing with MWL only."
fi

exec wlmscpfs -dfp "$MWL_OUTPUT_DIR" "$DICOM_MWL_PORT"
